-- Reuse a field associate's extra inventory for their next device order.
--
-- Logistics chooses, before In Packing, how many units of each device/sensor
-- come from the ordering associate's extra stock. On entry into Packing the
-- chosen units are skipped from central stock deduction and recorded as used
-- from the associate's extra inventory (order, company, date, who chose).
-- An extra Data Meter covers its whole kit; an extra Antenna Kit covers both
-- antenna parts. Wires, boxes and accessories always come from central stock.
BEGIN;

CREATE TABLE public.associate_extra_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.inventory_materials(id) ON DELETE CASCADE,
  associate_id uuid NOT NULL REFERENCES public.profiles(id),
  group_key text NOT NULL,
  label text NOT NULL,
  model text NOT NULL DEFAULT '',
  quantity integer NOT NULL CHECK(quantity>0),
  unit_price numeric,
  status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','applied')),
  selected_by uuid REFERENCES public.profiles(id),
  selected_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE(order_id,group_key)
);
CREATE INDEX associate_extra_usage_associate_idx ON public.associate_extra_usage(associate_id,group_key);
ALTER TABLE public.associate_extra_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.associate_extra_usage FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.associate_extra_usage TO service_role;

-- Same labels and per-unit models as field_inventory_order_items.
CREATE FUNCTION public.associate_extra_label(_key text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT CASE _key WHEN 'dm' THEN 'Data Meter' WHEN 'antenna' THEN 'Antenna Kit' WHEN 'yhdcctsensor' THEN 'YHDC CT Sensor'
    WHEN 'proximitysensor' THEN 'Proxy Sensor' WHEN 'rotaryencoder' THEN 'Encoder' WHEN 'vibrationsensor' THEN 'Vibration Sensor'
    WHEN 'towerlight' THEN 'Tower Light' WHEN 'energymeter' THEN 'Energy Meter' WHEN 'energymeterctsensor' THEN 'Energy Meter CT Sensor' END
$$;
CREATE FUNCTION public.associate_extra_order_model(_key text,_order public.inventory_materials) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT CASE _key WHEN 'vibrationsensor' THEN coalesce(_order.vibration_model,'') WHEN 'proximitysensor' THEN 'Inductive' ELSE '' END
$$;

-- Units of each extra-capable item an order needs, from the kit requirements.
CREATE FUNCTION public.associate_extra_order_needs(_order public.inventory_materials)
RETURNS TABLE(group_key text,label text,model text,quantity integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE requirements jsonb; k text;
BEGIN
  requirements:=public.inventory_dispatch_requirements(_order);
  FOREACH k IN ARRAY ARRAY['dm','antenna','yhdcctsensor','proximitysensor','rotaryencoder','vibrationsensor','towerlight','energymeter','energymeterctsensor'] LOOP
    group_key:=k; label:=public.associate_extra_label(k); model:=public.associate_extra_order_model(k,_order);
    IF k='dm' THEN
      quantity:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(requirements) r WHERE r->>'reason'='Data Meter Qty/Kit') THEN 1 ELSE 0 END;
    ELSIF k='antenna' THEN
      quantity:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(requirements) r WHERE r->>'key' IN ('magneticmountantenna','rfcableantenna')) THEN 1 ELSE 0 END;
    ELSE
      SELECT coalesce(sum((r->>'quantity')::numeric),0)::integer INTO quantity FROM jsonb_array_elements(requirements) r WHERE r->>'key'=k;
    END IF;
    IF quantity>0 THEN RETURN NEXT; END IF;
  END LOOP;
END $$;

-- An associate's extra balance per item. Received-but-unused confirmations add
-- stock; applied usage removes it. Planned usage on other orders is reserved.
CREATE FUNCTION public.associate_extra_balance(_associate uuid,_exclude_order uuid DEFAULT NULL)
RETURNS TABLE(group_key text,model_key text,gross integer,applied integer,reserved integer,available integer,unit_price numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH stock AS (
    SELECT x->>'group_key' group_key,lower(btrim(coalesce(x->>'model',''))) model_key,count(*)::integer gross,
      CASE WHEN bool_and(x->>'unit_price' IS NOT NULL) THEN round(avg((x->>'unit_price')::numeric),4) END unit_price
    FROM public.installation_order_confirmations c CROSS JOIN LATERAL jsonb_array_elements(c.items) x
    WHERE c.associate_id=_associate AND x->>'received'='true' AND x->>'used'='false'
    GROUP BY 1,2
  ), used AS (
    SELECT u.group_key,lower(btrim(u.model)) model_key,
      coalesce(sum(u.quantity) FILTER (WHERE u.status='applied'),0)::integer applied,
      coalesce(sum(u.quantity) FILTER (WHERE u.status='planned' AND u.order_id IS DISTINCT FROM _exclude_order),0)::integer reserved
    FROM public.associate_extra_usage u WHERE u.associate_id=_associate GROUP BY 1,2
  )
  SELECT s.group_key,s.model_key,s.gross,coalesce(u.applied,0),coalesce(u.reserved,0),
    greatest(s.gross-coalesce(u.applied,0)-coalesce(u.reserved,0),0),s.unit_price
  FROM stock s LEFT JOIN used u ON u.group_key=s.group_key AND u.model_key=s.model_key
$$;

CREATE FUNCTION public.associate_extra_assert_reader() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (coalesce(public.is_staff(auth.uid()),false)
    OR public.has_scoped_manager_module('logistic') OR public.has_scoped_manager_module('inventory')) THEN
    RAISE EXCEPTION 'Logistics manager access required' USING ERRCODE='42501';
  END IF;
END $$;

-- Order eligibility: a submitted Simkit order placed for an active field
-- associate, counted by the packing deduction policy.
CREATE FUNCTION public.associate_extra_order_reason(_order public.inventory_materials) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE cutoff timestamptz;
BEGIN
  IF coalesce(_order.order_source,'simkit')='upscale' THEN RETURN 'Upscale orders do not use field associate extra stock.'; END IF;
  IF _order.submitted IS DISTINCT FROM true THEN RETURN 'Order is not submitted.'; END IF;
  IF _order.created_by IS NULL OR NOT public.field_ops_associate(_order.created_by) THEN RETURN 'This order was not placed by an active field associate.'; END IF;
  SELECT activated_at INTO cutoff FROM public.inventory_dispatch_settings WHERE id=true;
  IF cutoff IS NULL OR _order.created_at IS NULL OR _order.created_at<cutoff
    OR EXISTS(SELECT 1 FROM public.inventory_dispatch_excluded_orders WHERE order_id=_order.id) THEN
    RETURN 'This older order is outside automatic stock deduction.';
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.logistics_extra_stock_options(_order uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.inventory_materials; reason text; locked boolean; items jsonb:='[]'; need record;
  bal record; picked public.associate_extra_usage;
BEGIN
  PERFORM public.associate_extra_assert_reader();
  SELECT * INTO m FROM public.inventory_materials WHERE id=_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device order not found'; END IF;
  reason:=public.associate_extra_order_reason(m);
  locked:=EXISTS(SELECT 1 FROM public.inventory_dispatch_deductions WHERE order_id=m.id);
  IF locked THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('group_key',u.group_key,'label',u.label,'model',u.model,
      'required',u.quantity,'available',u.quantity,'selected',u.quantity,'status',u.status) ORDER BY u.label),'[]')
    INTO items FROM public.associate_extra_usage u WHERE u.order_id=m.id AND u.status='applied';
  ELSIF reason IS NULL THEN
    BEGIN
      FOR need IN SELECT * FROM public.associate_extra_order_needs(m) LOOP
        SELECT * INTO bal FROM public.associate_extra_balance(m.created_by,m.id) b
          WHERE b.group_key=need.group_key AND b.model_key=lower(btrim(need.model));
        SELECT * INTO picked FROM public.associate_extra_usage u WHERE u.order_id=m.id AND u.group_key=need.group_key;
        IF coalesce(bal.available,0)>0 OR picked.id IS NOT NULL THEN
          items:=items||jsonb_build_array(jsonb_build_object('group_key',need.group_key,'label',need.label,'model',need.model,
            'required',need.quantity,'available',coalesce(bal.available,0),'selected',coalesce(picked.quantity,0),'status','planned'));
        END IF;
        bal:=NULL; picked:=NULL;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      reason:=SQLERRM;
      items:='[]';
    END;
  END IF;
  RETURN jsonb_build_object('order_id',m.id,'associate_id',m.created_by,
    'associate_name',coalesce((SELECT nullif(name,'') FROM public.profiles WHERE id=m.created_by),'Field associate'),
    'locked',locked,'eligible',reason IS NULL,'reason',reason,'items',items);
END $$;

CREATE FUNCTION public.logistics_set_extra_stock(_order uuid,_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.inventory_materials; reason text; choice jsonb; need record; bal record; qty integer;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(auth.uid()),false) THEN
    RAISE EXCEPTION 'Inventory manager access required to plan packing' USING ERRCODE='42501';
  END IF;
  SELECT * INTO m FROM public.inventory_materials WHERE id=_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device order not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_dispatch_deductions WHERE order_id=m.id) THEN
    RAISE EXCEPTION 'Stock has already been deducted for this order. Extra stock choices are locked after In Packing';
  END IF;
  reason:=public.associate_extra_order_reason(m);
  IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason; END IF;
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid extra stock selection'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(_items) x GROUP BY x->>'group_key' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Choose each item once';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('associate-extra:'||m.created_by::text,0));
  DELETE FROM public.associate_extra_usage WHERE order_id=m.id AND status='planned';
  FOR choice IN SELECT value FROM jsonb_array_elements(_items) LOOP
    IF jsonb_typeof(choice->'quantity') IS DISTINCT FROM 'number' OR (choice->>'quantity')::numeric<>floor((choice->>'quantity')::numeric)
      OR (choice->>'quantity')::integer<0 THEN RAISE EXCEPTION 'Extra stock quantity must be a whole number'; END IF;
    qty:=(choice->>'quantity')::integer;
    CONTINUE WHEN qty=0;
    SELECT * INTO need FROM public.associate_extra_order_needs(m) n WHERE n.group_key=choice->>'group_key';
    IF need.group_key IS NULL THEN RAISE EXCEPTION 'This order does not need %',coalesce(choice->>'group_key','that item'); END IF;
    IF qty>need.quantity THEN RAISE EXCEPTION '% needs only % unit(s)',need.label,need.quantity; END IF;
    SELECT * INTO bal FROM public.associate_extra_balance(m.created_by,m.id) b
      WHERE b.group_key=need.group_key AND b.model_key=lower(btrim(need.model));
    IF coalesce(bal.available,0)<qty THEN
      RAISE EXCEPTION 'Field associate has only % extra %',coalesce(bal.available,0),need.label;
    END IF;
    INSERT INTO public.associate_extra_usage(order_id,associate_id,group_key,label,model,quantity,unit_price,selected_by)
      VALUES(m.id,m.created_by,need.group_key,need.label,need.model,qty,bal.unit_price,auth.uid());
    need:=NULL; bal:=NULL;
  END LOOP;
  RETURN public.logistics_extra_stock_options(m.id);
END $$;

-- Called by the packing deduction: verify the plan still fits the associate's
-- balance, mark it applied, and remove those units from the stock requirements.
CREATE FUNCTION public.associate_extra_apply(_order public.inventory_materials,_requirements jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u public.associate_extra_usage; need record; bal record; result jsonb:=_requirements;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.associate_extra_usage WHERE order_id=_order.id AND status='planned') THEN RETURN result; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('associate-extra:'||_order.created_by::text,0));
  FOR u IN SELECT * FROM public.associate_extra_usage WHERE order_id=_order.id AND status='planned' ORDER BY group_key FOR UPDATE LOOP
    IF u.associate_id IS DISTINCT FROM _order.created_by THEN RAISE EXCEPTION 'Extra stock choice belongs to another field associate. Choose again'; END IF;
    SELECT * INTO need FROM public.associate_extra_order_needs(_order) n WHERE n.group_key=u.group_key;
    IF need.group_key IS NULL OR u.quantity>need.quantity OR lower(btrim(need.model))<>lower(btrim(u.model)) THEN
      RAISE EXCEPTION 'Extra stock choice for % no longer matches the order. Choose again before In Packing',u.label;
    END IF;
    SELECT b.gross-b.applied AS left_qty INTO bal FROM public.associate_extra_balance(u.associate_id,_order.id) b
      WHERE b.group_key=u.group_key AND b.model_key=lower(btrim(u.model));
    IF coalesce(bal.left_qty,0)<u.quantity THEN
      RAISE EXCEPTION 'Field associate now has only % extra %. Update the extra stock choice before In Packing',coalesce(bal.left_qty,0),u.label;
    END IF;
    IF u.group_key='dm' THEN
      SELECT coalesce(jsonb_agg(r),'[]') INTO result FROM jsonb_array_elements(result) r WHERE r->>'reason'<>'Data Meter Qty/Kit';
    ELSIF u.group_key='antenna' THEN
      SELECT coalesce(jsonb_agg(r),'[]') INTO result FROM jsonb_array_elements(result) r WHERE r->>'key' NOT IN ('magneticmountantenna','rfcableantenna');
    ELSE
      SELECT coalesce(jsonb_agg(CASE WHEN r->>'key'=u.group_key THEN jsonb_set(r,'{quantity}',to_jsonb((r->>'quantity')::numeric-u.quantity)) ELSE r END),'[]')
      INTO result FROM jsonb_array_elements(result) r;
      SELECT coalesce(jsonb_agg(r),'[]') INTO result FROM jsonb_array_elements(result) r WHERE (r->>'quantity')::numeric>0;
    END IF;
    UPDATE public.associate_extra_usage SET status='applied',applied_at=clock_timestamp() WHERE id=u.id;
    need:=NULL; bal:=NULL;
  END LOOP;
  RETURN result;
END $$;

-- Packing deduction (from 20261021120000) with the extra stock step added.
CREATE OR REPLACE FUNCTION public.inventory_dispatch_deduct_once() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE status text; cutoff timestamptz; requirements jsonb; requirement jsonb; s inventory_stock;
  available numeric; remaining numeric; consumed numeric; cost numeric; total_cost numeric:=0;
  items jsonb:='[]'::jsonb; receipt jsonb;
BEGIN
  status:=lower(btrim(coalesce(public.inventory_dispatch_notes(NEW.notes)->>'logistics_status',NEW.state,'')));
  IF NEW.submitted IS TRUE AND NOT EXISTS(SELECT 1 FROM public.inventory_logs WHERE order_id=NEW.id::text) THEN
    INSERT INTO public.inventory_logs(order_id,quantity_changed,change_type,consumed_value)
      VALUES(NEW.id::text,0,'INVENTORY_SERVER_MANAGED',0);
  END IF;
  IF NEW.submitted IS DISTINCT FROM true OR status NOT IN ('packing','in packing','in_packing','shipped','transit','in transit','delivered','dispatched') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND status=lower(btrim(coalesce(public.inventory_dispatch_notes(OLD.notes)->>'logistics_status',OLD.state,''))) THEN RETURN NEW; END IF;
  SELECT activated_at INTO cutoff FROM public.inventory_dispatch_settings WHERE id=true;
  IF cutoff IS NULL OR NEW.created_at IS NULL OR NEW.created_at<cutoff
    OR EXISTS(SELECT 1 FROM public.inventory_dispatch_excluded_orders WHERE order_id=NEW.id) THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_dispatch_deductions WHERE order_id=NEW.id) THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Inventory manager access required to dispatch an order' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_logs WHERE order_id=NEW.id::text AND change_type='DISPATCH_DEDUCTION') THEN
    INSERT INTO public.inventory_dispatch_deductions(order_id,actor_id,status,trigger_status)
      VALUES(NEW.id,auth.uid(),'legacy_already_deducted',status);
    RETURN NEW;
  END IF;
  IF public.inventory_dispatch_selected(coalesce(public.inventory_dispatch_notes(NEW.notes)->>'dm_selected','true'))
    AND btrim(coalesce(NEW.uplink,''))='' THEN
    RAISE EXCEPTION 'Select and save the uplink type in Hardware Configuration before marking In Packing';
  END IF;
  requirements:=public.inventory_dispatch_requirements(NEW);
  -- Units chosen from the field associate's extra stock are not taken from central stock.
  requirements:=public.associate_extra_apply(NEW,requirements);
  PERFORM 1 FROM public.inventory_stock candidate WHERE public.inventory_component_key(candidate.category) IN (
    SELECT r->>'key' FROM jsonb_array_elements(requirements) r) ORDER BY candidate.id FOR UPDATE;
  FOR requirement IN SELECT value FROM jsonb_array_elements(requirements) LOOP
    SELECT coalesce(sum(candidate.actual_quantity),0) INTO available FROM public.inventory_stock candidate
      WHERE public.inventory_component_key(candidate.category)=requirement->>'key'
      AND public.inventory_component_model(candidate.category,candidate.sensor_type)=requirement->>'model'
      AND public.inventory_dispatch_stock_unit(candidate)=requirement->>'unit'
      AND candidate.actual_quantity>=0 AND coalesce(public.inventory_dispatch_notes(candidate.notes)->>'inventory_entry_type','')<>'bulk_order';
    IF available<(requirement->>'quantity')::numeric THEN
      RAISE EXCEPTION 'Insufficient stock: % %. Required % %, available % %. Check the inventory item, model and unit.',
        requirement->>'category',CASE WHEN requirement->>'model'='' THEN '' ELSE '('||(requirement->>'model')||')' END,
        requirement->>'quantity',requirement->>'unit',available,requirement->>'unit' USING ERRCODE='P0001';
    END IF;
  END LOOP;
  FOR requirement IN SELECT value FROM jsonb_array_elements(requirements) LOOP
    remaining:=(requirement->>'quantity')::numeric;
    FOR s IN SELECT x.* FROM public.inventory_stock x
      WHERE public.inventory_component_key(x.category)=requirement->>'key'
      AND public.inventory_component_model(x.category,x.sensor_type)=requirement->>'model'
      AND public.inventory_dispatch_stock_unit(x)=requirement->>'unit'
      AND x.actual_quantity>0 AND coalesce(public.inventory_dispatch_notes(x.notes)->>'inventory_entry_type','')<>'bulk_order'
      ORDER BY x.entry_date,x.created_at,x.id
    LOOP
      EXIT WHEN remaining<=0;
      consumed:=least(remaining,s.actual_quantity);
      cost:=round(consumed*s.unit_price,2);
      UPDATE public.inventory_stock SET actual_quantity=actual_quantity-consumed,updated_at=clock_timestamp() WHERE id=s.id;
      INSERT INTO public.inventory_logs(stock_id,order_id,quantity_changed,change_type,triggered_by,unit,unit_price_snapshot,consumed_value)
        VALUES(s.id,NEW.id::text,-consumed,'DISPATCH_DEDUCTION',auth.uid(),requirement->>'unit',s.unit_price,cost);
      receipt:=jsonb_build_object('stock_id',s.id,'category',s.category,'sensor_type',s.sensor_type,'quantity',consumed,'unit',requirement->>'unit','unit_price',s.unit_price,'consumed_value',cost,'remaining_quantity',s.actual_quantity-consumed,'reason',requirement->>'reason');
      items:=items||jsonb_build_array(receipt);
      total_cost:=total_cost+cost;
      remaining:=remaining-consumed;
    END LOOP;
    IF remaining>0 THEN RAISE EXCEPTION 'Inventory changed during deduction; no stock or status changes were saved'; END IF;
  END LOOP;
  INSERT INTO public.inventory_dispatch_deductions(order_id,actor_id,status,trigger_status,items,consumed_value,packing_policy)
    VALUES(NEW.id,auth.uid(),'deducted',status,items,total_cost,true);
  RETURN NEW;
END $$;

-- Installation items: central-stock units from the receipt, plus units taken
-- from the associate's extra stock (marked from_extra and already received).
CREATE OR REPLACE FUNCTION public.field_inventory_order_items(_order uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.inventory_materials; components jsonb; requirements jsonb; definition record;
  price numeric; count_units integer; extra_units integer; extra_price numeric; item_index integer;
  result jsonb:='[]'; saved jsonb; dm boolean; has_receipt boolean; from_extra boolean;
BEGIN
  SELECT items INTO saved FROM public.installation_order_confirmations WHERE order_id=_order;
  IF FOUND THEN RETURN saved; END IF;
  SELECT * INTO m FROM public.inventory_materials WHERE id=_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device order not found'; END IF;
  SELECT items INTO components FROM public.inventory_dispatch_deductions WHERE order_id=m.id AND status='deducted';
  has_receipt:=FOUND AND components IS NOT NULL
    AND (components<>'[]'::jsonb OR EXISTS(SELECT 1 FROM public.associate_extra_usage WHERE order_id=m.id AND status='applied'));
  IF NOT has_receipt THEN
    requirements:=public.inventory_dispatch_requirements(m);
    SELECT coalesce(jsonb_agg(jsonb_build_object('category',r->>'category','sensor_type',r->>'model',
      'quantity',(r->>'quantity')::numeric,'consumed_value',(r->>'quantity')::numeric*p.unit_price,'reason',r->>'reason')),'[]')
    INTO components FROM jsonb_array_elements(requirements) r
    LEFT JOIN LATERAL (SELECT s.unit_price FROM public.inventory_stock s
      WHERE public.inventory_component_key(s.category)=r->>'key'
      AND public.inventory_component_model(s.category,s.sensor_type)=r->>'model'
      AND public.inventory_dispatch_stock_unit(s)=r->>'unit'
      AND coalesce(public.inventory_dispatch_notes(s.notes)->>'inventory_entry_type','')<>'bulk_order'
      ORDER BY s.updated_at DESC,s.created_at DESC,s.id LIMIT 1) p ON true;
  END IF;
  dm:=EXISTS(SELECT 1 FROM jsonb_array_elements(components) x WHERE x->>'reason'='Data Meter Qty/Kit');
  FOR definition IN SELECT * FROM (VALUES
    ('dm','Data Meter'),('antenna','Antenna Kit'),('yhdcctsensor','YHDC CT Sensor'),
    ('proximitysensor','Proxy Sensor'),('rotaryencoder','Encoder'),('vibrationsensor','Vibration Sensor'),
    ('towerlight','Tower Light'),('energymeter','Energy Meter'),('energymeterctsensor','Energy Meter CT Sensor')
  ) AS definitions(key,label) LOOP
    price:=NULL;
    IF definition.key='dm' THEN
      count_units:=CASE WHEN dm THEN 1 ELSE 0 END;
      SELECT CASE WHEN count(*)>0 AND bool_and(x->>'consumed_value' IS NOT NULL) THEN sum((x->>'consumed_value')::numeric) END
      INTO price FROM jsonb_array_elements(components) x WHERE x->>'reason'='Data Meter Qty/Kit';
    ELSIF definition.key='antenna' THEN
      count_units:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(components) x WHERE public.inventory_component_key(x->>'category') IN ('magneticmountantenna','rfcableantenna')) THEN 1 ELSE 0 END;
      SELECT CASE WHEN count(*)>0 AND bool_and(x->>'consumed_value' IS NOT NULL) THEN sum((x->>'consumed_value')::numeric) END
      INTO price FROM jsonb_array_elements(components) x WHERE public.inventory_component_key(x->>'category') IN ('magneticmountantenna','rfcableantenna');
    ELSE
      SELECT coalesce(sum((x->>'quantity')::numeric),0)::integer,
        CASE WHEN bool_and(x->>'consumed_value' IS NOT NULL) THEN sum((x->>'consumed_value')::numeric)/nullif(sum((x->>'quantity')::numeric),0) END
      INTO count_units,price FROM jsonb_array_elements(components) x WHERE public.inventory_component_key(x->>'category')=definition.key;
    END IF;
    SELECT coalesce(sum(u.quantity),0)::integer,max(u.unit_price) INTO extra_units,extra_price
      FROM public.associate_extra_usage u WHERE u.order_id=m.id AND u.status='applied' AND u.group_key=definition.key;
    IF count_units<0 OR count_units+extra_units>100 THEN RAISE EXCEPTION 'Invalid dispatched item quantity'; END IF;
    CONTINUE WHEN count_units+extra_units=0;
    FOR item_index IN 1..(count_units+extra_units) LOOP
      from_extra:=item_index>count_units;
      result:=result||jsonb_build_array(jsonb_build_object('key',definition.key||':'||item_index,
        'group_key',definition.key,'label',definition.label,'number',item_index,'count',count_units+extra_units,
        'model',public.associate_extra_order_model(definition.key,m),
        'quantity',1,'unit','Nos','unit_price',round(CASE WHEN from_extra THEN extra_price ELSE price END,4),
        'received',from_extra,'used',false,'from_extra',from_extra));
    END LOOP;
  END LOOP;
  RETURN result;
END $$;

-- Confirmation (from 20261023110000): units from extra stock stay received.
CREATE OR REPLACE FUNCTION public.installation_confirm_order(_site uuid,_order uuid,_revision integer,_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.inventory_materials; existing public.installation_order_confirmations;
  template jsonb; item jsonb; choice jsonb; received boolean; used boolean; result jsonb:='[]'; next_revision integer;
BEGIN
  PERFORM public.field_inventory_assert_site(_site);
  IF NOT public.field_ops_associate(auth.uid()) THEN RAISE EXCEPTION 'Only an assigned active field associate can confirm equipment'; END IF;
  IF EXISTS(SELECT 1 FROM public.installation_inventory_legacy_sites WHERE site_id=_site) THEN RAISE EXCEPTION 'Historical installation is unchanged'; END IF;
  PERFORM public.field_inventory_assert_legacy_link(_site);
  SELECT * INTO m FROM public.inventory_materials WHERE id=_order FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.field_inventory_site_orders(_site) WHERE id=_order)
    OR NOT public.field_inventory_dispatched(m) THEN RAISE EXCEPTION 'Dispatched order not found for this company'; END IF;
  SELECT * INTO existing FROM public.installation_order_confirmations WHERE order_id=_order FOR UPDATE;
  IF existing.order_id IS NOT NULL AND (existing.site_id<>_site OR existing.associate_id<>auth.uid()) THEN
    RAISE EXCEPTION 'This order is already confirmed by another field associate';
  END IF;
  IF _revision IS DISTINCT FROM coalesce(existing.revision,0) THEN RAISE EXCEPTION 'Equipment confirmation changed. Refresh before saving'; END IF;
  template:=public.field_inventory_order_items(_order);
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Confirm every dispatched device and sensor'; END IF;
  IF jsonb_array_length(_items)<>jsonb_array_length(template) OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(_items) x GROUP BY x->>'key' HAVING count(*)<>1
  ) THEN RAISE EXCEPTION 'Confirm every dispatched device and sensor exactly once'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(template) LOOP
    SELECT value INTO choice FROM jsonb_array_elements(_items) WHERE value->>'key'=item->>'key';
    IF choice IS NULL OR jsonb_typeof(choice->'received') IS DISTINCT FROM 'boolean' OR jsonb_typeof(choice->'used') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Received and Used confirmations are required for every item'; END IF;
    received:=(choice->>'received')::boolean; used:=(choice->>'used')::boolean;
    IF coalesce((item->>'from_extra')::boolean,false) AND NOT received THEN
      RAISE EXCEPTION '% came from your extra stock and is already with you; keep it marked received',item->>'label';
    END IF;
    IF used AND NOT received THEN RAISE EXCEPTION 'An item cannot be used before it is received'; END IF;
    result:=result||jsonb_build_array(item||jsonb_build_object('received',received,'used',used));
  END LOOP;
  next_revision:=coalesce(existing.revision,0)+1;
  INSERT INTO public.installation_order_confirmations(order_id,site_id,associate_id,revision,items)
    VALUES(_order,_site,auth.uid(),next_revision,result)
  ON CONFLICT(order_id) DO UPDATE SET items=excluded.items,revision=excluded.revision,updated_at=now();
  RETURN jsonb_build_object('revision',next_revision,'items',result);
END $$;

-- Extra inventory view (from 20261102120000) net of units used on later orders.
-- Used units are taken from the oldest source company first.
CREATE OR REPLACE FUNCTION public.field_associate_extra_inventory() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE manager boolean;
BEGIN
  manager:=public.field_inventory_manager();
  IF NOT manager AND NOT public.field_ops_associate(auth.uid()) THEN RAISE EXCEPTION 'Field inventory access required' USING ERRCODE='42501'; END IF;
  RETURN (
    WITH base AS (
      SELECT c.associate_id,coalesce(nullif(p.name,''),'Field associate') AS associate_name,
        x->>'group_key' AS group_key,x->>'label' AS label,coalesce(x->>'model','') AS model,
        lower(btrim(coalesce(x->>'model',''))) AS model_key,
        coalesce(s.company_name,s.name) AS company,(x->>'unit_price') AS unit_price_text,c.confirmed_at
      FROM public.installation_order_confirmations c
      JOIN public.profiles p ON p.id=c.associate_id
      JOIN public.sites s ON s.id=c.site_id
      CROSS JOIN LATERAL jsonb_array_elements(c.items) x
      WHERE (manager OR c.associate_id=auth.uid()) AND x->>'received'='true' AND x->>'used'='false'
    ),
    used_rows AS (
      SELECT u.associate_id,u.group_key,lower(btrim(u.model)) AS model_key,sum(u.quantity)::integer AS used_quantity,
        jsonb_agg(jsonb_build_object('order_id',u.order_id,'company',m.material_name,'device_id',m.device_id,
          'quantity',u.quantity,'used_at',u.applied_at,
          'selected_by',coalesce((SELECT nullif(name,'') FROM public.profiles WHERE id=u.selected_by),'Logistics'))
          ORDER BY u.applied_at DESC) AS usage_history
      FROM public.associate_extra_usage u JOIN public.inventory_materials m ON m.id=u.order_id
      WHERE u.status='applied' AND (manager OR u.associate_id=auth.uid())
      GROUP BY 1,2,3
    ),
    per_company AS (
      SELECT associate_id,associate_name,group_key,label,model_key,min(model) AS model,company,
        count(*)::integer AS quantity,bool_and(unit_price_text IS NOT NULL) AS price_known,
        CASE WHEN bool_and(unit_price_text IS NOT NULL) THEN sum(unit_price_text::numeric) END AS gross_value,
        max(confirmed_at) AS last_confirmed_at
      FROM base GROUP BY associate_id,associate_name,group_key,label,model_key,company
    ),
    netted AS (
      SELECT pc.*,
        pc.quantity-greatest(0,least(pc.quantity,coalesce(u.used_quantity,0)-(sum(pc.quantity) OVER w-pc.quantity))) AS net_quantity
      FROM per_company pc LEFT JOIN used_rows u ON u.associate_id=pc.associate_id AND u.group_key=pc.group_key AND u.model_key=pc.model_key
      WINDOW w AS (PARTITION BY pc.associate_id,pc.group_key,pc.model_key ORDER BY pc.last_confirmed_at,pc.company
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    ),
    grouped AS (
      SELECT n.associate_id,n.associate_name,n.group_key,min(n.label) AS label,min(n.model) AS model,n.model_key,
        'Nos'::text AS unit,
        sum(n.net_quantity)::integer AS quantity,
        sum(n.quantity)::integer AS received_quantity,
        bool_and(n.price_known) AS price_known,
        CASE WHEN bool_and(n.price_known) THEN round(sum(n.gross_value*n.net_quantity/n.quantity),2) END AS total_value,
        CASE WHEN bool_and(n.price_known) THEN round(sum(n.gross_value)/nullif(sum(n.quantity),0),4) END AS unit_price,
        string_agg(DISTINCT n.company,', ') FILTER (WHERE n.net_quantity>0) AS companies,
        coalesce(to_jsonb(array_agg(DISTINCT n.company) FILTER (WHERE n.net_quantity>0)),'[]') AS company_list,
        max(n.last_confirmed_at) AS last_confirmed_at,
        coalesce(jsonb_agg(jsonb_build_object('company',n.company,'quantity',n.net_quantity,
          'total_value',CASE WHEN n.price_known THEN round(n.gross_value*n.net_quantity/n.quantity,2) END,
          'last_confirmed_at',n.last_confirmed_at) ORDER BY n.company) FILTER (WHERE n.net_quantity>0),'[]') AS company_breakdown
      FROM netted n GROUP BY n.associate_id,n.associate_name,n.group_key,n.model_key
    )
    SELECT coalesce(jsonb_agg((to_jsonb(g)-'price_known'-'model_key')
        ||jsonb_build_object('used_quantity',coalesce(u.used_quantity,0),'usage_history',coalesce(u.usage_history,'[]'::jsonb))
      ORDER BY g.last_confirmed_at DESC NULLS LAST,g.associate_name,g.label,g.model),'[]')
    FROM grouped g LEFT JOIN used_rows u ON u.associate_id=g.associate_id AND u.group_key=g.group_key AND u.model_key=g.model_key
  );
END $$;

REVOKE ALL ON FUNCTION public.associate_extra_label(text),public.associate_extra_order_model(text,public.inventory_materials),
  public.associate_extra_order_needs(public.inventory_materials),public.associate_extra_balance(uuid,uuid),
  public.associate_extra_assert_reader(),public.associate_extra_order_reason(public.inventory_materials),
  public.associate_extra_apply(public.inventory_materials,jsonb),
  public.logistics_extra_stock_options(uuid),public.logistics_set_extra_stock(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_extra_stock_options(uuid),public.logistics_set_extra_stock(uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
