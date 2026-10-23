-- Confirm dispatched equipment during Installation. Extras are a view of the
-- received-but-unused confirmation items; central stock is never deducted here.
BEGIN;
CREATE TABLE public.installation_order_confirmations (
  order_id uuid PRIMARY KEY REFERENCES public.inventory_materials(id),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  associate_id uuid NOT NULL REFERENCES public.profiles(id),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  items jsonb NOT NULL CHECK(jsonb_typeof(items)='array'),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.installation_order_confirmations(associate_id,site_id);
ALTER TABLE public.installation_order_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.installation_order_confirmations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.installation_order_confirmations TO service_role;

CREATE TABLE public.installation_inventory_legacy_sites(site_id uuid PRIMARY KEY);
ALTER TABLE public.installation_inventory_legacy_sites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.installation_inventory_legacy_sites FROM PUBLIC,anon,authenticated;
-- Preserve completed installations. This migration does not invent old balances.
INSERT INTO public.installation_inventory_legacy_sites
  SELECT site_id FROM public.installation WHERE data->>'installation_phase_submitted'='true'
    OR data @> '{"coordination_done":true,"photos_uploaded":true}';

CREATE FUNCTION public.field_inventory_manager() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF coalesce(public.is_staff(auth.uid()),false) OR public.has_scoped_manager_module('inventory') THEN
    PERFORM public.assert_manager_module_access('inventory');
    RETURN true;
  END IF;
  RETURN false;
END $$;

CREATE FUNCTION public.field_inventory_assert_site(_site uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.sites s WHERE s.id=_site AND (
    public.field_inventory_manager() OR (public.field_ops_associate(auth.uid()) AND auth.uid()=ANY(public.field_ops_worker_ids(s)))
  )) THEN RAISE EXCEPTION 'Assigned field associate access required' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION public.field_inventory_site_orders(_site uuid) RETURNS SETOF public.inventory_materials
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT m.* FROM public.inventory_materials m JOIN public.sites s ON s.id=_site
  WHERE m.submitted AND coalesce(m.order_source,'simkit')<>'upscale' AND (
    m.site_id=s.id OR (m.site_id IS NULL AND m.material_name=coalesce(nullif(btrim(s.company_name),''),s.name)
      AND (SELECT count(*) FROM public.sites other WHERE coalesce(nullif(btrim(other.company_name),''),other.name)=m.material_name)=1)
  )
$$;

CREATE FUNCTION public.field_inventory_dispatched(_order public.inventory_materials) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT lower(btrim(coalesce(public.inventory_dispatch_notes(_order.notes)->>'logistics_status',_order.state,'')))
    IN ('shipped','transit','in transit','delivered','dispatched')
$$;

CREATE FUNCTION public.field_inventory_assert_legacy_link(_site uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.inventory_materials m JOIN public.sites s ON s.id=_site
    WHERE m.submitted AND m.site_id IS NULL AND coalesce(m.order_source,'simkit')<>'upscale'
    AND m.material_name=coalesce(nullif(btrim(s.company_name),''),s.name)
    AND (SELECT count(*) FROM public.sites other WHERE coalesce(nullif(btrim(other.company_name),''),other.name)=m.material_name)>1
  ) THEN RAISE EXCEPTION 'More than one company matches this legacy order. Ask a manager to link the order to its company before confirming equipment'; END IF;
END $$;

CREATE FUNCTION public.field_inventory_order_items(_order uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.inventory_materials; components jsonb; requirements jsonb; definition record;
  price numeric; count_units integer; item_index integer; result jsonb:='[]'; saved jsonb; dm boolean;
BEGIN
  SELECT items INTO saved FROM public.installation_order_confirmations WHERE order_id=_order;
  IF FOUND THEN RETURN saved; END IF;
  SELECT * INTO m FROM public.inventory_materials WHERE id=_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device order not found'; END IF;
  SELECT items INTO components FROM public.inventory_dispatch_deductions WHERE order_id=m.id AND status='deducted';
  IF components IS NULL OR components='[]'::jsonb THEN
    -- Older orders without a receipt use the manager's current inventory price.
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
    IF definition.key='dm' THEN
      IF NOT dm THEN CONTINUE; END IF;
      count_units:=1;
      SELECT CASE WHEN count(*)>0 AND bool_and(x->>'consumed_value' IS NOT NULL) THEN sum((x->>'consumed_value')::numeric) END
      INTO price FROM jsonb_array_elements(components) x WHERE x->>'reason'='Data Meter Qty/Kit';
    ELSIF definition.key='antenna' THEN
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(components) x WHERE public.inventory_component_key(x->>'category') IN ('magneticmountantenna','rfcableantenna')) THEN CONTINUE; END IF;
      count_units:=1;
      SELECT CASE WHEN count(*)>0 AND bool_and(x->>'consumed_value' IS NOT NULL) THEN sum((x->>'consumed_value')::numeric) END
      INTO price FROM jsonb_array_elements(components) x WHERE public.inventory_component_key(x->>'category') IN ('magneticmountantenna','rfcableantenna');
    ELSE
      SELECT coalesce(sum((x->>'quantity')::numeric),0)::integer,
        CASE WHEN bool_and(x->>'consumed_value' IS NOT NULL) THEN sum((x->>'consumed_value')::numeric)/nullif(sum((x->>'quantity')::numeric),0) END
      INTO count_units,price FROM jsonb_array_elements(components) x WHERE public.inventory_component_key(x->>'category')=definition.key;
    END IF;
    IF count_units<0 OR count_units>100 THEN RAISE EXCEPTION 'Invalid dispatched item quantity'; END IF;
    FOR item_index IN 1..count_units LOOP
      result:=result||jsonb_build_array(jsonb_build_object('key',definition.key||':'||item_index,
        'group_key',definition.key,'label',definition.label,'number',item_index,'count',count_units,
        'model',CASE definition.key WHEN 'vibrationsensor' THEN coalesce(m.vibration_model,'') WHEN 'proximitysensor' THEN 'Inductive' ELSE '' END,
        'quantity',1,'unit','Nos','unit_price',round(price,4),'received',false,'used',false));
    END LOOP;
  END LOOP;
  RETURN result;
END $$;

CREATE FUNCTION public.installation_order_checklist(_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE orders jsonb; order_count integer; legacy boolean;
BEGIN
  PERFORM public.field_inventory_assert_site(_site);
  legacy:=EXISTS(SELECT 1 FROM public.installation_inventory_legacy_sites WHERE site_id=_site);
  SELECT count(*) INTO order_count FROM public.field_inventory_site_orders(_site);
  IF legacy THEN RETURN jsonb_build_object('legacy',true,'waiting_dispatch',false,'required',false,'orders','[]'::jsonb); END IF;
  PERFORM public.field_inventory_assert_legacy_link(_site);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'company_name',m.material_name,'device_id',m.device_id,
    'revision',coalesce(c.revision,0),'associate_id',c.associate_id,'associate_name',coalesce(nullif(p.name,''),'field associate'),
    'confirmed_at',c.confirmed_at,'items',public.field_inventory_order_items(m.id)) ORDER BY m.created_at,m.id),'[]')
  INTO orders FROM public.field_inventory_site_orders(_site) m
  LEFT JOIN public.installation_order_confirmations c ON c.order_id=m.id
  LEFT JOIN public.profiles p ON p.id=c.associate_id
  WHERE public.field_inventory_dispatched(m);
  RETURN jsonb_build_object('legacy',false,'required',order_count>0,'waiting_dispatch',order_count>0 AND orders='[]'::jsonb,'orders',orders);
END $$;

CREATE FUNCTION public.installation_confirm_order(_site uuid,_order uuid,_revision integer,_items jsonb) RETURNS jsonb
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
    IF used AND NOT received THEN RAISE EXCEPTION 'An item cannot be used before it is received'; END IF;
    -- Keep server-owned quantities and inventory prices; ignore client overrides.
    result:=result||jsonb_build_array(item||jsonb_build_object('received',received,'used',used));
  END LOOP;
  next_revision:=coalesce(existing.revision,0)+1;
  INSERT INTO public.installation_order_confirmations(order_id,site_id,associate_id,revision,items)
    VALUES(_order,_site,auth.uid(),next_revision,result)
  ON CONFLICT(order_id) DO UPDATE SET items=excluded.items,revision=excluded.revision,updated_at=now();
  RETURN jsonb_build_object('revision',next_revision,'items',result);
END $$;

CREATE FUNCTION public.field_associate_extra_inventory() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE manager boolean;
BEGIN
  manager:=public.field_inventory_manager();
  IF NOT manager AND NOT public.field_ops_associate(auth.uid()) THEN RAISE EXCEPTION 'Field inventory access required' USING ERRCODE='42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.associate_name,g.label,g.model),'[]') FROM (
    SELECT c.associate_id,coalesce(nullif(p.name,''),'Field associate') AS associate_name,x->>'group_key' AS group_key,x->>'label' AS label,x->>'model' AS model,
      'Nos'::text AS unit,count(*)::integer AS quantity,
      CASE WHEN bool_and(x->>'unit_price' IS NOT NULL) THEN round(avg((x->>'unit_price')::numeric),4) END AS unit_price,
      CASE WHEN bool_and(x->>'unit_price' IS NOT NULL) THEN round(sum((x->>'unit_price')::numeric),2) END AS total_value,
      string_agg(DISTINCT coalesce(s.company_name,s.name),', ') AS companies
    FROM public.installation_order_confirmations c JOIN public.profiles p ON p.id=c.associate_id
    JOIN public.sites s ON s.id=c.site_id CROSS JOIN LATERAL jsonb_array_elements(c.items) x
    WHERE (manager OR c.associate_id=auth.uid()) AND x->>'received'='true' AND x->>'used'='false'
    GROUP BY c.associate_id,p.name,x->>'group_key',x->>'label',x->>'model'
  ) g);
END $$;

CREATE FUNCTION public.installation_require_equipment_confirmation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE has_order boolean; dispatched integer;
BEGIN
  IF (NEW.data->>'installation_phase_submitted' IS DISTINCT FROM 'true'
      AND NOT (NEW.data @> '{"coordination_done":true,"photos_uploaded":true}'))
    OR EXISTS(SELECT 1 FROM public.installation_inventory_legacy_sites WHERE site_id=NEW.site_id) THEN RETURN NEW; END IF;
  PERFORM public.field_inventory_assert_legacy_link(NEW.site_id);
  SELECT EXISTS(SELECT 1 FROM public.field_inventory_site_orders(NEW.site_id)) INTO has_order;
  IF NOT has_order THEN RETURN NEW; END IF;
  SELECT count(*) INTO dispatched FROM public.field_inventory_site_orders(NEW.site_id) m WHERE public.field_inventory_dispatched(m);
  IF dispatched=0 THEN RAISE EXCEPTION 'Wait for the device order to be dispatched before submitting Installation'; END IF;
  IF EXISTS(SELECT 1 FROM public.field_inventory_site_orders(NEW.site_id) m WHERE public.field_inventory_dispatched(m)
    AND NOT EXISTS(SELECT 1 FROM public.installation_order_confirmations c WHERE c.order_id=m.id AND c.site_id=NEW.site_id)) THEN
    RAISE EXCEPTION 'Confirm received and used equipment before submitting Installation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER installation_require_equipment_confirmation BEFORE INSERT OR UPDATE ON public.installation
FOR EACH ROW EXECUTE FUNCTION public.installation_require_equipment_confirmation();

REVOKE ALL ON FUNCTION public.field_inventory_manager(),public.field_inventory_assert_site(uuid),
  public.field_inventory_site_orders(uuid),public.field_inventory_dispatched(public.inventory_materials),public.field_inventory_order_items(uuid),
  public.field_inventory_assert_legacy_link(uuid),
  public.installation_order_checklist(uuid),public.installation_confirm_order(uuid,uuid,integer,jsonb),
  public.field_associate_extra_inventory(),public.installation_require_equipment_confirmation() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.installation_order_checklist(uuid),public.installation_confirm_order(uuid,uuid,integer,jsonb),
  public.field_associate_extra_inventory() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
