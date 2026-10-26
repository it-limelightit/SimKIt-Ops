BEGIN;

-- Prospective ledger: no INSERT ... SELECT from historical dispatch receipts.
CREATE TABLE public.inventory_history_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.inventory_history_settings DEFAULT VALUES;

CREATE TABLE public.inventory_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  reference text GENERATED ALWAYS AS ('ISS-' || lpad(issue_number::text,greatest(6,length(issue_number::text)),'0')) STORED,
  order_id uuid NOT NULL UNIQUE,
  company_name text NOT NULL,
  device_id text,
  order_source text NOT NULL,
  order_created_at timestamptz,
  issued_at timestamptz NOT NULL,
  actor_id uuid,
  actor_name text NOT NULL,
  status_at_issue text NOT NULL
);
CREATE INDEX inventory_issues_date_idx ON public.inventory_issues(issued_at DESC,id);
CREATE INDEX inventory_issues_company_idx ON public.inventory_issues(company_name);

CREATE TABLE public.inventory_issue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.inventory_issues(id),
  component_key text NOT NULL,
  model_key text NOT NULL,
  category text NOT NULL,
  model text NOT NULL,
  unit text NOT NULL,
  quantity numeric NOT NULL CHECK(quantity>0),
  stock_before numeric NOT NULL,
  stock_after numeric NOT NULL,
  CHECK(stock_before-quantity=stock_after AND stock_after>=0),
  UNIQUE(issue_id,component_key,model_key,unit)
);
CREATE INDEX inventory_issue_items_product_idx ON public.inventory_issue_items(component_key,model_key,unit);
ALTER TABLE public.inventory_history_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_issue_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_history_settings,public.inventory_issues,public.inventory_issue_items FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.inventory_history_settings,public.inventory_issues,public.inventory_issue_items TO service_role;

CREATE FUNCTION public.inventory_capture_issue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cutoff timestamptz; issue uuid; m public.inventory_materials; item record; balance numeric;
BEGIN
  SELECT activated_at INTO cutoff FROM inventory_history_settings WHERE singleton;
  IF cutoff IS NULL OR NEW.status<>'deducted' OR NEW.applied_at<cutoff OR NEW.items='[]'::jsonb THEN RETURN NEW; END IF;
  SELECT * INTO m FROM inventory_materials WHERE id=NEW.order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cannot record stock issue without its order'; END IF;
  INSERT INTO inventory_issues(order_id,company_name,device_id,order_source,order_created_at,issued_at,actor_id,actor_name,status_at_issue)
  VALUES(m.id,m.material_name,m.device_id,coalesce(m.order_source,'simkit'),m.created_at,NEW.applied_at,NEW.actor_id,
    coalesce((SELECT nullif(name,'') FROM profiles WHERE id=NEW.actor_id),'Inventory manager'),NEW.trigger_status)
  ON CONFLICT(order_id) DO NOTHING RETURNING id INTO issue;
  IF issue IS NULL THEN RETURN NEW; END IF;
  -- Dispatch already holds the component stock locks until this transaction ends.
  -- Aggregate FIFO receipt batches into one item/model/unit line, using total
  -- central product stock rather than an individual batch's remaining balance.
  FOR item IN
    SELECT public.inventory_component_key(x->>'category') component,
      public.inventory_component_model(x->>'category',x->>'sensor_type') model_key,
      min(x->>'category') category,coalesce(min(nullif(x->>'sensor_type','')),'') model,
      x->>'unit' unit,sum((x->>'quantity')::numeric) quantity
    FROM jsonb_array_elements(NEW.items) x GROUP BY 1,2,5
  LOOP
    SELECT coalesce(sum(s.actual_quantity),0) INTO balance FROM inventory_stock s
    WHERE public.inventory_component_key(s.category)=item.component
      AND public.inventory_component_model(s.category,s.sensor_type)=item.model_key
      AND public.inventory_dispatch_stock_unit(s)=item.unit AND s.actual_quantity>=0
      AND coalesce(public.inventory_dispatch_notes(s.notes)->>'inventory_entry_type','')<>'bulk_order';
    INSERT INTO inventory_issue_items(issue_id,component_key,model_key,category,model,unit,quantity,stock_before,stock_after)
      VALUES(issue,item.component,item.model_key,item.category,item.model,item.unit,item.quantity,balance+item.quantity,balance);
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_record_issue AFTER INSERT ON public.inventory_dispatch_deductions
  FOR EACH ROW EXECUTE FUNCTION public.inventory_capture_issue();
REVOKE ALL ON FUNCTION public.inventory_capture_issue() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.inventory_history(
  _view text DEFAULT 'company',_company text DEFAULT '',_item text DEFAULT '',
  _from date DEFAULT NULL,_to date DEFAULT NULL,_search text DEFAULT '',_page integer DEFAULT 1,_page_size integer DEFAULT 20
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_staff(auth.uid()) OR public.has_scoped_manager_module('inventory')) THEN
    RAISE EXCEPTION 'Inventory manager access required' USING ERRCODE='42501';
  END IF;
  PERFORM public.assert_manager_module_access('inventory');
  IF _view NOT IN ('company','item') OR _page IS NULL OR _page<1 OR _page_size IS NULL OR _page_size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid history page'; END IF;
  IF _from>_to THEN RAISE EXCEPTION 'End date must be on or after start date'; END IF;
  WITH current_stock AS MATERIALIZED (
    SELECT public.inventory_component_key(s.category) component,public.inventory_component_model(s.category,s.sensor_type) model_key,
      public.inventory_dispatch_stock_unit(s) unit,sum(s.actual_quantity) quantity
    FROM inventory_stock s WHERE s.actual_quantity>=0 AND coalesce(public.inventory_dispatch_notes(s.notes)->>'inventory_entry_type','')<>'bulk_order'
    GROUP BY 1,2,3
  ), matching AS MATERIALIZED (
    SELECT i.*,h.company_name,h.reference,h.order_id,h.issued_at,h.actor_name,h.device_id,h.order_source,h.order_created_at,h.status_at_issue,
      m.id IS NOT NULL order_exists,
      coalesce(nullif(public.inventory_dispatch_notes(m.notes)->>'logistics_status',''),m.state,h.status_at_issue) logistics_status,
      c.quantity current_stock,
      jsonb_build_array(i.component_key,i.model_key,i.unit)::text item_key
    FROM inventory_issue_items i JOIN inventory_issues h ON h.id=i.issue_id
    LEFT JOIN inventory_materials m ON m.id=h.order_id
    LEFT JOIN current_stock c ON c.component=i.component_key AND c.model_key=i.model_key AND c.unit=i.unit
    WHERE (coalesce(_company,'')='' OR h.company_name=_company)
      AND (coalesce(_item,'')='' OR jsonb_build_array(i.component_key,i.model_key,i.unit)::text=_item)
      AND (_from IS NULL OR h.issued_at>=(_from::timestamp AT TIME ZONE 'Asia/Kolkata'))
      AND (_to IS NULL OR h.issued_at<((_to+1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
      AND (coalesce(btrim(_search),'')='' OR concat_ws(' ',h.company_name,h.reference,h.order_id::text,h.device_id,i.category,i.model) ILIKE '%'||btrim(_search)||'%')
  ), grouped AS (
    SELECT issue_id,reference,company_name,order_id,issued_at,actor_name,device_id,order_source,order_created_at,status_at_issue,order_exists,logistics_status,
      (SELECT count(*) FROM inventory_issue_items all_items WHERE all_items.issue_id=t.issue_id) total_item_types,
      jsonb_agg(jsonb_build_object('id',id,'category',category,'model',model,'unit',unit,'quantity',quantity,'stock_before',stock_before,'stock_after',stock_after,'current_stock',current_stock,'item_key',item_key) ORDER BY category,model,unit) items
    FROM matching t GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12
  ), company_page AS (SELECT * FROM grouped ORDER BY issued_at DESC,issue_id DESC LIMIT _page_size OFFSET (_page-1)*_page_size),
  item_page AS (SELECT * FROM matching ORDER BY issued_at DESC,issue_id DESC,category,model,id LIMIT _page_size OFFSET (_page-1)*_page_size)
  SELECT jsonb_build_object(
    'activated_at',(SELECT activated_at FROM inventory_history_settings WHERE singleton),
    'refreshed_at',now(),'total_records',CASE WHEN _view='company' THEN (SELECT count(*) FROM grouped) ELSE (SELECT count(*) FROM matching) END,
    'issue_count',(SELECT count(*) FROM grouped),'company_count',(SELECT count(DISTINCT company_name) FROM matching),
    'item_type_count',(SELECT count(DISTINCT item_key) FROM matching),
    'companies',(SELECT coalesce(jsonb_agg(company_name ORDER BY company_name),'[]') FROM (SELECT DISTINCT company_name FROM inventory_issues) companies),
    'products',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'category',category,'model',model,'unit',unit) ORDER BY category,model,unit),'[]') FROM (
      SELECT jsonb_build_array(component_key,model_key,unit)::text key,min(category) category,min(model) model,unit FROM inventory_issue_items GROUP BY component_key,model_key,unit) products),
    'issues',CASE WHEN _view='company' THEN (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY issued_at DESC,issue_id DESC),'[]') FROM company_page p) ELSE '[]'::jsonb END,
    'item_rows',CASE WHEN _view='item' THEN (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY issued_at DESC,issue_id DESC,category,model,id),'[]') FROM item_page p) ELSE '[]'::jsonb END
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.inventory_history(text,text,text,date,date,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.inventory_history(text,text,text,date,date,text,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
