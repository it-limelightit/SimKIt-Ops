BEGIN;

CREATE TABLE public.upscale_company_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id uuid NOT NULL UNIQUE REFERENCES public.company_tracker_assignments(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  company_name text NOT NULL,
  device_count integer NOT NULL CHECK (device_count BETWEEN 1 AND 200),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.upscale_company_orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.upscale_company_orders TO authenticated;
CREATE POLICY upscale_company_orders_read ON public.upscale_company_orders
  FOR SELECT TO authenticated USING (
    public.can_access_company_tracker(tracker_id)
    OR public.is_staff(auth.uid())
    OR public.has_scoped_manager_module('logistic')
  );
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
    AND NOT EXISTS(SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='upscale_company_orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.upscale_company_orders;
  END IF;
END $$;

ALTER TABLE public.inventory_materials
  ADD COLUMN order_source text NOT NULL DEFAULT 'simkit'
    CHECK (order_source IN ('simkit','upscale')),
  ADD COLUMN upscale_order_id uuid REFERENCES public.upscale_company_orders(id) ON DELETE RESTRICT,
  ADD COLUMN upscale_device_sequence integer,
  ADD COLUMN client_machine_name text,
  ADD COLUMN upscale_requested_components jsonb,
  ADD COLUMN upscale_confirmed_components jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.inventory_materials ADD CONSTRAINT upscale_material_shape CHECK (
  (order_source = 'simkit' AND upscale_order_id IS NULL AND upscale_device_sequence IS NULL)
  OR
  (order_source = 'upscale' AND upscale_order_id IS NOT NULL
    AND upscale_device_sequence > 0
    AND length(btrim(coalesce(client_machine_name,''))) > 0
    AND upscale_requested_components IS NOT NULL)
);
CREATE UNIQUE INDEX upscale_device_sequence_unique ON public.inventory_materials(upscale_order_id, upscale_device_sequence)
  WHERE upscale_order_id IS NOT NULL;
CREATE UNIQUE INDEX upscale_device_machine_unique ON public.inventory_materials(upscale_order_id, lower(btrim(client_machine_name)))
  WHERE upscale_order_id IS NOT NULL;

-- Browser clients cannot create or remove Upscale rows outside the conversion RPC.
-- SECURITY DEFINER conversion bypasses RLS while retaining its explicit access check.
CREATE POLICY upscale_material_insert_source ON public.inventory_materials AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (order_source = 'simkit');
CREATE POLICY upscale_material_delete_source ON public.inventory_materials AS RESTRICTIVE
  FOR DELETE TO authenticated USING (order_source = 'simkit');

CREATE OR REPLACE FUNCTION public.upscale_device_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE key text; requested jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.order_source IS DISTINCT FROM OLD.order_source THEN
    RAISE EXCEPTION 'Order source cannot be changed';
  END IF;
  IF NEW.order_source <> 'upscale' THEN
    RETURN NEW;
  END IF;
  IF NEW.quantity IS DISTINCT FROM 1 OR NEW.submitted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Each Upscale machine must remain one submitted device order';
  END IF;
  requested := NEW.upscale_requested_components;
  IF coalesce((public.inventory_dispatch_notes(NEW.notes)->>'dm_selected')::boolean,false)
       <> coalesce((requested->>'dm')::boolean,false)
    OR coalesce((public.inventory_dispatch_notes(NEW.notes)->>'without_cavli')::boolean,false)
       <> coalesce((requested->>'without_cavli')::boolean,false) THEN
    RAISE EXCEPTION 'Requested DM and Cavli selections cannot be changed during logistics';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.upscale_order_id IS DISTINCT FROM OLD.upscale_order_id
      OR NEW.upscale_device_sequence IS DISTINCT FROM OLD.upscale_device_sequence
      OR NEW.client_machine_name IS DISTINCT FROM OLD.client_machine_name
      OR NEW.upscale_requested_components IS DISTINCT FROM OLD.upscale_requested_components
      OR NEW.ct1 IS DISTINCT FROM OLD.ct1 OR NEW.ct2 IS DISTINCT FROM OLD.ct2
      OR NEW.ct3 IS DISTINCT FROM OLD.ct3 OR NEW.proxy1 IS DISTINCT FROM OLD.proxy1
      OR NEW.proxy2 IS DISTINCT FROM OLD.proxy2 OR NEW.encoder IS DISTINCT FROM OLD.encoder
      OR NEW.vibration IS DISTINCT FROM OLD.vibration OR NEW.vibration_model IS DISTINCT FROM OLD.vibration_model
      OR NEW.antenna IS DISTINCT FROM OLD.antenna OR NEW.tower_light IS DISTINCT FROM OLD.tower_light
      OR NEW.energy_meter IS DISTINCT FROM OLD.energy_meter OR NEW.plc IS DISTINCT FROM OLD.plc THEN
      RAISE EXCEPTION 'Requested Upscale components cannot be changed during logistics';
    END IF;
  END IF;
  IF lower(btrim(coalesce(public.inventory_dispatch_notes(NEW.notes)->>'logistics_status', NEW.state, '')))
      IN ('shipped','transit','in transit','delivered','dispatched') THEN
    requested := NEW.upscale_requested_components;
    FOR key IN SELECT jsonb_object_keys(requested) LOOP
      IF requested->>key = 'true' AND NEW.upscale_confirmed_components->>key IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Confirm all requested components before dispatch: %', key;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER upscale_device_guard BEFORE INSERT OR UPDATE ON public.inventory_materials
  FOR EACH ROW EXECUTE FUNCTION public.upscale_device_guard();
REVOKE ALL ON FUNCTION public.upscale_device_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.upscale_tracker_stage_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE expected_count integer; actual_count integer;
BEGIN
  IF NEW.stage = 'Converted' AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'Converted') THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Create an Upscale device order before assigning Converted'; END IF;
    SELECT o.device_count, count(m.id) INTO expected_count, actual_count
      FROM public.upscale_company_orders o
      LEFT JOIN public.inventory_materials m ON m.upscale_order_id=o.id
      WHERE o.tracker_id=NEW.id GROUP BY o.device_count;
    IF expected_count IS NULL OR actual_count <> expected_count THEN
      RAISE EXCEPTION 'Complete all Upscale device orders before converting this company';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.stage='Converted' AND NEW.stage IS DISTINCT FROM 'Converted'
    AND EXISTS(SELECT 1 FROM public.upscale_company_orders WHERE tracker_id=OLD.id) THEN
    RAISE EXCEPTION 'This converted company has an Upscale order; revise that order before moving the stage backward';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER upscale_tracker_stage_guard BEFORE INSERT OR UPDATE OF stage ON public.company_tracker_assignments
  FOR EACH ROW EXECUTE FUNCTION public.upscale_tracker_stage_guard();
REVOKE ALL ON FUNCTION public.upscale_tracker_stage_guard() FROM PUBLIC, anon, authenticated;

-- Existing transitions keep their current behavior except the final conversion.
CREATE OR REPLACE FUNCTION public.company_tracker_transition(_tracker_id uuid, _comment text, _manual boolean DEFAULT true)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_stage text; next_stage text; comment_id uuid;
BEGIN
  PERFORM public.assert_manager_module_access('restricted');
  IF btrim(coalesce(_comment,'')) = '' THEN RAISE EXCEPTION 'A comment is required to move stages'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF current_stage IN ('Issue Resolution', 'Monitoring') THEN RAISE EXCEPTION 'This stage advances automatically after its required checklist is complete'; END IF;
  IF current_stage = 'Quotation Sent' THEN RAISE EXCEPTION 'Complete the Upscale device order before converting this company'; END IF;
  next_stage := CASE current_stage WHEN 'Insights Shared' THEN 'Meeting Planned' WHEN 'Meeting Planned' THEN 'Quotation Sent' ELSE NULL END;
  IF next_stage IS NULL THEN RAISE EXCEPTION 'This company is already converted'; END IF;
  SELECT id INTO comment_id FROM public.company_tracker_comments WHERE tracker_id = _tracker_id AND stage = current_stage AND body = btrim(_comment) ORDER BY created_at DESC LIMIT 1;
  IF comment_id IS NULL THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id)
      VALUES (_tracker_id, btrim(_comment), current_stage, auth.uid()) RETURNING id INTO comment_id;
  END IF;
  UPDATE public.company_tracker_assignments SET stage = next_stage, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual)
    VALUES (_tracker_id, current_stage, next_stage, auth.uid(), comment_id, _manual);
  RETURN next_stage;
END $$;

CREATE OR REPLACE FUNCTION public.company_tracker_convert_upscale(_tracker_id uuid, _comment text, _devices jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tracker_row public.company_tracker_assignments; company text; destination text;
  order_id uuid; comment_id uuid; device jsonb; ordinal integer:=0; machine text;
  seen_names text[]:='{}'; count_devices integer; components jsonb; dm boolean; without_cavli boolean;
  component_key text; flag text;
BEGIN
  PERFORM public.assert_manager_module_access('restricted');
  IF auth.uid() IS NULL OR btrim(coalesce(_comment,'')) = '' THEN RAISE EXCEPTION 'A conversion comment is required'; END IF;
  IF jsonb_typeof(_devices) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Device orders must be an array'; END IF;
  count_devices := jsonb_array_length(_devices);
  IF count_devices NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Device count must be between 1 and 200'; END IF;
  SELECT * INTO tracker_row FROM public.company_tracker_assignments WHERE id=_tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF tracker_row.stage <> 'Quotation Sent' THEN RAISE EXCEPTION 'Company must be in Quotation Sent'; END IF;
  SELECT coalesce(nullif(btrim(s.company_name),''),s.name), coalesce(nullif(btrim(s.address),''),nullif(btrim(s.city),''),'Address not specified')
    INTO company,destination FROM public.sites s WHERE s.id=tracker_row.site_id;
  IF company IS NULL THEN RAISE EXCEPTION 'Company site not found'; END IF;
  INSERT INTO public.upscale_company_orders(tracker_id,site_id,company_name,device_count,created_by)
    VALUES(_tracker_id,tracker_row.site_id,company,count_devices,auth.uid()) RETURNING id INTO order_id;
  FOR device IN SELECT value FROM jsonb_array_elements(_devices) LOOP
    ordinal:=ordinal+1;
    IF jsonb_typeof(device) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Device % must be an object',ordinal; END IF;
    machine:=btrim(coalesce(device->>'machine_name',''));
    IF length(machine) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Device % needs a machine name of 1 to 120 characters',ordinal; END IF;
    IF lower(machine)=ANY(seen_names) THEN RAISE EXCEPTION 'Duplicate machine name: %',machine; END IF;
    seen_names:=array_append(seen_names,lower(machine));
    components:=device->'components';
    IF jsonb_typeof(components) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Device % needs component selections',ordinal; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_each_text(components) entry WHERE entry.value='true' AND entry.key <> 'without_cavli') THEN
      RAISE EXCEPTION 'Select at least one device component on device %',ordinal;
    END IF;
    FOR component_key IN SELECT jsonb_object_keys(components) LOOP
      IF component_key <> ALL(ARRAY['dm','without_cavli','ct1','ct2','ct3','proxy1','proxy2','encoder','vibration','antenna','tower_light','energy_meter','plc'])
        OR jsonb_typeof(components->component_key) <> 'boolean' THEN
        RAISE EXCEPTION 'Invalid component selection on device %: %',ordinal,component_key;
      END IF;
    END LOOP;
    dm:=coalesce((components->>'dm')::boolean,false);
    without_cavli:=coalesce((components->>'without_cavli')::boolean,false);
    IF without_cavli AND NOT dm THEN RAISE EXCEPTION 'Without Cavli requires DM on device %',ordinal; END IF;
    IF coalesce((components->>'vibration')::boolean,false) THEN
      IF lower(coalesce(device->>'vibration_model','')) NOT IN ('renke','witmotion','vibe-q') THEN
        RAISE EXCEPTION 'Select a vibration model on device %',ordinal;
      END IF;
    END IF;
    INSERT INTO public.inventory_materials(
      material_name,location,quantity,unit,state,submitted,created_by,notes,
      order_source,upscale_order_id,upscale_device_sequence,client_machine_name,
      upscale_requested_components,ct1,ct2,ct3,proxy1,proxy2,encoder,vibration,vibration_model,
      antenna,tower_light,energy_meter,plc,proxy_model
    ) VALUES (
      company,destination,1,'pcs','Available',true,auth.uid(),
      jsonb_build_object('dm_selected',dm,'without_cavli',without_cavli,'logistics_status','Pending',
        'courier_partner','','packing_date','','transit_date','','arrived_date','','courier_id','')::text,
      'upscale',order_id,ordinal,machine,components,
      CASE WHEN coalesce((components->>'ct1')::boolean,false) THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN coalesce((components->>'ct2')::boolean,false) THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN coalesce((components->>'ct3')::boolean,false) THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN coalesce((components->>'proxy1')::boolean,false) THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN coalesce((components->>'proxy2')::boolean,false) THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN coalesce((components->>'encoder')::boolean,false) THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN coalesce((components->>'vibration')::boolean,false) THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN coalesce((components->>'vibration')::boolean,false) THEN device->>'vibration_model' ELSE NULL END,
      CASE WHEN coalesce((components->>'antenna')::boolean,false) THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN coalesce((components->>'tower_light')::boolean,false) THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN coalesce((components->>'energy_meter')::boolean,false) THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN coalesce((components->>'plc')::boolean,false) THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN coalesce((components->>'proxy1')::boolean,false) OR coalesce((components->>'proxy2')::boolean,false) THEN 'Inductive' ELSE NULL END
    );
  END LOOP;
  SELECT id INTO comment_id FROM public.company_tracker_comments
    WHERE tracker_id=_tracker_id AND stage='Quotation Sent' AND body=btrim(_comment)
    ORDER BY created_at DESC LIMIT 1;
  IF comment_id IS NULL THEN
    INSERT INTO public.company_tracker_comments(tracker_id,body,stage,author_id)
      VALUES(_tracker_id,btrim(_comment),'Quotation Sent',auth.uid()) RETURNING id INTO comment_id;
  END IF;
  UPDATE public.company_tracker_assignments SET stage='Converted',stage_changed_at=now(),updated_at=now() WHERE id=_tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id,previous_stage,new_stage,changed_by,comment_id,was_manual)
    VALUES(_tracker_id,'Quotation Sent','Converted',auth.uid(),comment_id,true);
  RETURN order_id;
END $$;
REVOKE ALL ON FUNCTION public.company_tracker_convert_upscale(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_tracker_convert_upscale(uuid,text,jsonb) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
