BEGIN;

-- Allow managers to assign Converted before creating the Upscale order.
CREATE OR REPLACE FUNCTION public.upscale_tracker_stage_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE expected_count integer; actual_count integer;
BEGIN
  IF NEW.stage = 'Converted' AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'Converted') THEN
    IF TG_OP = 'INSERT' THEN
      IF public.is_company_tracker_manager() IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Only commissioning managers can assign Converted directly'; END IF;
      RETURN NEW;
    END IF;
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

-- Expose the pending order state on the tracker board.
CREATE OR REPLACE FUNCTION public.company_tracker_board()
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE board JSONB;
BEGIN
  PERFORM public.company_tracker_mark_missed_monitoring_days();
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'site_id', a.site_id, 'stage', a.stage, 'stage_changed_at', a.stage_changed_at,
    'upscale_order_pending', a.stage = 'Converted' AND NOT EXISTS (SELECT 1 FROM public.upscale_company_orders o WHERE o.tracker_id = a.id),
    'company_name', coalesce(s.company_name, s.name), 'city', s.city, 'assignee_id', a.assignee_id, 'assignee_name', p.name,
    'issue_checklist', coalesce((SELECT ir.checklist FROM public.company_tracker_issue_resolution ir WHERE ir.tracker_id = a.id), '{}'::jsonb),
    'comments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'stage', c.stage, 'created_at', c.created_at, 'author', cp.name) ORDER BY c.created_at DESC), '[]'::jsonb) FROM public.company_tracker_comments c LEFT JOIN public.profiles cp ON cp.id = c.author_id WHERE c.tracker_id = a.id),
    'monitoring_days', (SELECT coalesce(jsonb_agg(jsonb_build_object('day_number', d.day_number, 'checklist', d.checklist, 'result', d.result, 'completed_at', d.completed_at) ORDER BY d.day_number), '[]'::jsonb) FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = a.id)
  ) ORDER BY a.updated_at DESC), '[]'::jsonb) INTO board
  FROM public.company_tracker_assignments a JOIN public.sites s ON s.id = a.site_id LEFT JOIN public.profiles p ON p.id = a.assignee_id
  WHERE public.is_company_tracker_manager() OR a.assignee_id = auth.uid();
  RETURN board;
END; $$;

-- Reuse the validated device order flow for already converted companies.
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
  IF tracker_row.stage NOT IN ('Quotation Sent','Converted') THEN RAISE EXCEPTION 'Company must be in Quotation Sent or Converted'; END IF;
  IF EXISTS(SELECT 1 FROM public.upscale_company_orders WHERE tracker_id=_tracker_id) THEN RAISE EXCEPTION 'This company already has an Upscale device order'; END IF;
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
    WHERE tracker_id=_tracker_id AND stage=tracker_row.stage AND body=btrim(_comment)
    ORDER BY created_at DESC LIMIT 1;
  IF comment_id IS NULL THEN
    INSERT INTO public.company_tracker_comments(tracker_id,body,stage,author_id)
      VALUES(_tracker_id,btrim(_comment),tracker_row.stage,auth.uid()) RETURNING id INTO comment_id;
  END IF;
  IF tracker_row.stage='Quotation Sent' THEN
    UPDATE public.company_tracker_assignments SET stage='Converted',stage_changed_at=now(),updated_at=now() WHERE id=_tracker_id;
    INSERT INTO public.company_tracker_stage_history(tracker_id,previous_stage,new_stage,changed_by,comment_id,was_manual)
      VALUES(_tracker_id,'Quotation Sent','Converted',auth.uid(),comment_id,true);
  END IF;
  RETURN order_id;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
