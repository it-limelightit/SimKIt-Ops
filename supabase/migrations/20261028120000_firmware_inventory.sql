BEGIN;

-- Loans and return events are permanent records. Receipt allocations preserve
-- the original stock rows, model, unit and cost when stock is returned.
CREATE TABLE public.firmware_inventory_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  owner_name text NOT NULL,
  taken_date date NOT NULL,
  category text NOT NULL,
  model text NOT NULL,
  component_key text NOT NULL,
  model_key text NOT NULL,
  unit text NOT NULL,
  quantity numeric(14,2) NOT NULL CHECK(quantity>0),
  returned_quantity numeric(14,2) NOT NULL DEFAULT 0 CHECK(returned_quantity>=0 AND returned_quantity<=quantity),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
  stock_before numeric NOT NULL,
  stock_after numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(request_id,component_key,model_key,unit),
  CHECK(stock_before-quantity=stock_after AND stock_after>=0)
);
CREATE INDEX ON public.firmware_inventory_loans(owner_id,created_at DESC);
CREATE TABLE public.firmware_inventory_allocations (
  loan_id uuid NOT NULL REFERENCES public.firmware_inventory_loans(id),
  stock_id uuid NOT NULL REFERENCES public.inventory_stock(id) ON DELETE RESTRICT,
  quantity numeric(14,2) NOT NULL CHECK(quantity>0),
  returned_quantity numeric(14,2) NOT NULL DEFAULT 0 CHECK(returned_quantity>=0 AND returned_quantity<=quantity),
  PRIMARY KEY(loan_id,stock_id)
);
CREATE TABLE public.firmware_inventory_returns (
  id uuid PRIMARY KEY,
  loan_id uuid NOT NULL REFERENCES public.firmware_inventory_loans(id),
  quantity numeric(14,2) NOT NULL CHECK(quantity>0),
  return_date date NOT NULL,
  actor_id uuid NOT NULL,
  actor_name text NOT NULL,
  stock_before numeric NOT NULL,
  stock_after numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(stock_before+quantity=stock_after)
);
ALTER TABLE public.firmware_inventory_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firmware_inventory_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firmware_inventory_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.firmware_inventory_loans,public.firmware_inventory_allocations,public.firmware_inventory_returns FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.firmware_inventory_loans,public.firmware_inventory_allocations,public.firmware_inventory_returns TO service_role;

CREATE FUNCTION public.firmware_inventory_access() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM attendance_employees e
    WHERE e.auth_user_id=auth.uid() AND e.active AND e.deleted_at IS NULL AND e.department='firmware'
    AND (public.has_role(auth.uid(),'employee') OR public.has_role(auth.uid(),'supervisor')))
$$;

CREATE FUNCTION public.firmware_inventory_data(_manager boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF _manager THEN
    IF NOT public.field_inventory_manager() THEN RAISE EXCEPTION 'Inventory manager access required' USING ERRCODE='42501'; END IF;
  ELSIF NOT public.firmware_inventory_access() THEN
    RAISE EXCEPTION 'Active firmware employee access required' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('products',(
    SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY category,model,unit),'[]') FROM (
      SELECT min(s.id::text) stock_id,min(s.category) category,coalesce(min(s.sensor_type),'') model,
        public.inventory_dispatch_stock_unit(s) unit,sum(s.actual_quantity) available
      FROM inventory_stock s WHERE s.actual_quantity>=0
        AND coalesce(public.inventory_dispatch_notes(s.notes)->>'inventory_entry_type','')<>'bulk_order'
      GROUP BY public.inventory_component_key(s.category),public.inventory_component_model(s.category,s.sensor_type),public.inventory_dispatch_stock_unit(s)
    ) p), 'loans',(
    SELECT coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('returns',(
      SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.return_date,r.created_at),'[]') FROM firmware_inventory_returns r WHERE r.loan_id=l.id
    )) ORDER BY l.created_at DESC,l.id),'[]') FROM firmware_inventory_loans l WHERE _manager OR l.owner_id=auth.uid()));
END $$;

CREATE FUNCTION public.firmware_inventory_take(_request uuid,_date date,_items jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE draft jsonb; selected inventory_stock; s inventory_stock; loan uuid; available numeric;
  qty numeric; remaining numeric; used numeric; employee_name text; today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NOT public.firmware_inventory_access() THEN RAISE EXCEPTION 'Active firmware employee access required' USING ERRCODE='42501'; END IF;
  IF _request IS NULL OR _date IS NULL OR _date>today OR _items IS NULL OR jsonb_typeof(_items)<>'array'
    OR jsonb_array_length(_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Choose a valid date and 1 to 50 items'; END IF;
  -- Serializes retries, including a retry sent while the first request is pending.
  PERFORM pg_advisory_xact_lock(hashtextextended(_request::text,0));
  IF EXISTS(SELECT 1 FROM firmware_inventory_loans WHERE request_id=_request) THEN
    IF EXISTS(SELECT 1 FROM firmware_inventory_loans WHERE request_id=_request AND owner_id<>auth.uid()) THEN RAISE EXCEPTION 'Invalid request'; END IF;
    RETURN;
  END IF;
  SELECT e.name INTO employee_name FROM attendance_employees e WHERE e.auth_user_id=auth.uid() AND e.deleted_at IS NULL;
  -- Same stable stock lock order used by dispatch; stock and ledger commit together.
  PERFORM 1 FROM inventory_stock ORDER BY id FOR UPDATE;
  FOR draft IN SELECT value FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO selected FROM inventory_stock WHERE id=(draft->>'stock_id')::uuid;
    IF NOT FOUND OR selected.actual_quantity<0 OR coalesce(public.inventory_dispatch_notes(selected.notes)->>'inventory_entry_type','')='bulk_order' THEN
      RAISE EXCEPTION 'Inventory item is unavailable. Refresh and try again';
    END IF;
    qty:=(draft->>'quantity')::numeric;
    IF qty IS NULL OR qty<=0 OR qty<>round(qty,2) OR qty::text IN ('NaN','Infinity','-Infinity')
      OR (public.inventory_dispatch_stock_unit(selected)<>'Meter' AND qty<>trunc(qty)) THEN RAISE EXCEPTION 'Enter a positive quantity (whole items, or up to two decimals for Meter)'; END IF;
    IF coalesce(length(btrim(draft->>'reason')),0) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Enter a reason of 1 to 1000 characters'; END IF;
    SELECT coalesce(sum(x.actual_quantity),0) INTO available FROM inventory_stock x
      WHERE public.inventory_component_key(x.category)=public.inventory_component_key(selected.category)
      AND public.inventory_component_model(x.category,x.sensor_type)=public.inventory_component_model(selected.category,selected.sensor_type)
      AND public.inventory_dispatch_stock_unit(x)=public.inventory_dispatch_stock_unit(selected) AND x.actual_quantity>=0
      AND coalesce(public.inventory_dispatch_notes(x.notes)->>'inventory_entry_type','')<>'bulk_order';
    IF available<qty THEN RAISE EXCEPTION 'Insufficient stock for %. Available: % %',selected.category,available,public.inventory_dispatch_stock_unit(selected); END IF;
    INSERT INTO firmware_inventory_loans(request_id,owner_id,owner_name,taken_date,category,model,component_key,model_key,unit,quantity,reason,stock_before,stock_after)
      VALUES(_request,auth.uid(),employee_name,_date,selected.category,coalesce(selected.sensor_type,''),public.inventory_component_key(selected.category),
        public.inventory_component_model(selected.category,selected.sensor_type),public.inventory_dispatch_stock_unit(selected),qty,btrim(draft->>'reason'),available,available-qty)
      RETURNING id INTO loan;
    remaining:=qty;
    FOR s IN SELECT x.* FROM inventory_stock x WHERE x.actual_quantity>0
      AND public.inventory_component_key(x.category)=public.inventory_component_key(selected.category)
      AND public.inventory_component_model(x.category,x.sensor_type)=public.inventory_component_model(selected.category,selected.sensor_type)
      AND public.inventory_dispatch_stock_unit(x)=public.inventory_dispatch_stock_unit(selected)
      AND coalesce(public.inventory_dispatch_notes(x.notes)->>'inventory_entry_type','')<>'bulk_order' ORDER BY x.entry_date,x.created_at,x.id
    LOOP
      EXIT WHEN remaining<=0;
      used:=least(remaining,s.actual_quantity);
      UPDATE inventory_stock SET actual_quantity=actual_quantity-used,updated_at=now() WHERE id=s.id;
      INSERT INTO firmware_inventory_allocations(loan_id,stock_id,quantity) VALUES(loan,s.id,used);
      INSERT INTO inventory_logs(stock_id,order_id,quantity_changed,change_type,triggered_by,unit,unit_price_snapshot,consumed_value)
        VALUES(s.id,loan::text,-used,'FIRMWARE_TAKE',auth.uid(),public.inventory_dispatch_stock_unit(s),s.unit_price,used*s.unit_price);
      remaining:=remaining-used;
    END LOOP;
  END LOOP;
END $$;

CREATE FUNCTION public.firmware_inventory_return(_request uuid,_loan uuid,_quantity numeric,_date date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l firmware_inventory_loans; allocation firmware_inventory_allocations; remaining numeric; restored numeric; available numeric; actor text;
BEGIN
  IF NOT public.firmware_inventory_access() THEN RAISE EXCEPTION 'Active firmware employee access required' USING ERRCODE='42501'; END IF;
  IF _request IS NULL THEN RAISE EXCEPTION 'Return request is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_request::text,0));
  IF EXISTS(SELECT 1 FROM firmware_inventory_returns WHERE id=_request) THEN
    IF NOT EXISTS(SELECT 1 FROM firmware_inventory_returns WHERE id=_request AND actor_id=auth.uid() AND loan_id=_loan) THEN RAISE EXCEPTION 'Invalid return request'; END IF;
    RETURN;
  END IF;
  SELECT * INTO l FROM firmware_inventory_loans WHERE id=_loan AND owner_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only return your own inventory' USING ERRCODE='42501'; END IF;
  IF _date IS NULL OR _date<l.taken_date OR _date>(now() AT TIME ZONE 'Asia/Kolkata')::date
    OR _date<coalesce((SELECT max(return_date) FROM firmware_inventory_returns WHERE loan_id=l.id),l.taken_date) THEN RAISE EXCEPTION 'Return date must follow the taken date and previous returns, and cannot be in the future'; END IF;
  IF _quantity IS NULL OR _quantity<=0 OR _quantity::text IN ('NaN','Infinity','-Infinity') OR _quantity<>round(_quantity,2)
    OR _quantity>l.quantity-l.returned_quantity OR (l.unit<>'Meter' AND _quantity<>trunc(_quantity)) THEN RAISE EXCEPTION 'Enter a positive return quantity within the outstanding balance'; END IF;
  PERFORM 1 FROM inventory_stock WHERE public.inventory_component_key(category)=l.component_key ORDER BY id FOR UPDATE;
  -- Do not restore into an edited receipt with a different product or unit.
  IF EXISTS(SELECT 1 FROM firmware_inventory_allocations a JOIN inventory_stock s ON s.id=a.stock_id WHERE a.loan_id=l.id
    AND (public.inventory_component_key(s.category)<>l.component_key OR public.inventory_component_model(s.category,s.sensor_type)<>l.model_key
      OR public.inventory_dispatch_stock_unit(s)<>l.unit OR s.actual_quantity<0
      OR coalesce(public.inventory_dispatch_notes(s.notes)->>'inventory_entry_type','')='bulk_order')) THEN
    RAISE EXCEPTION 'Original stock item was changed. Ask an inventory manager to restore its category, model and unit before returning';
  END IF;
  SELECT coalesce(sum(s.actual_quantity),0) INTO available FROM inventory_stock s WHERE public.inventory_component_key(s.category)=l.component_key
    AND public.inventory_component_model(s.category,s.sensor_type)=l.model_key AND public.inventory_dispatch_stock_unit(s)=l.unit
    AND s.actual_quantity>=0 AND coalesce(public.inventory_dispatch_notes(s.notes)->>'inventory_entry_type','')<>'bulk_order';
  remaining:=_quantity;
  FOR allocation IN SELECT * FROM firmware_inventory_allocations WHERE loan_id=l.id AND returned_quantity<quantity ORDER BY stock_id LOOP
    EXIT WHEN remaining<=0;
    restored:=least(remaining,allocation.quantity-allocation.returned_quantity);
    UPDATE inventory_stock SET actual_quantity=actual_quantity+restored,updated_at=now() WHERE id=allocation.stock_id;
    UPDATE firmware_inventory_allocations SET returned_quantity=returned_quantity+restored WHERE loan_id=l.id AND stock_id=allocation.stock_id;
    INSERT INTO inventory_logs(stock_id,order_id,quantity_changed,change_type,triggered_by,unit)
      VALUES(allocation.stock_id,l.id::text,restored,'FIRMWARE_RETURN',auth.uid(),l.unit);
    remaining:=remaining-restored;
  END LOOP;
  UPDATE firmware_inventory_loans SET returned_quantity=returned_quantity+_quantity WHERE id=l.id;
  SELECT e.name INTO actor FROM attendance_employees e WHERE e.auth_user_id=auth.uid() AND e.deleted_at IS NULL;
  INSERT INTO firmware_inventory_returns(id,loan_id,quantity,return_date,actor_id,actor_name,stock_before,stock_after)
    VALUES(_request,l.id,_quantity,_date,auth.uid(),actor,available,available+_quantity);
END $$;

REVOKE ALL ON FUNCTION public.firmware_inventory_access(),public.firmware_inventory_data(boolean),public.firmware_inventory_take(uuid,date,jsonb),public.firmware_inventory_return(uuid,uuid,numeric,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.firmware_inventory_access(),public.firmware_inventory_data(boolean),public.firmware_inventory_take(uuid,date,jsonb),public.firmware_inventory_return(uuid,uuid,numeric,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
