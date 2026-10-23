-- Manager Advance Order uses the existing device-order logistics pipeline.
BEGIN;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id);
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS advance_order_actor uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS inventory_materials_site ON public.inventory_materials(site_id);

CREATE OR REPLACE FUNCTION public.logistics_assert_manager() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    coalesce(public.is_staff(auth.uid()),false) OR public.has_scoped_manager_module('logistic')
  ) THEN RAISE EXCEPTION 'Logistics manager access required' USING ERRCODE='42501'; END IF;
  PERFORM public.assert_manager_module_access('logistic');
END $$;

CREATE OR REPLACE FUNCTION public.logistics_company_context(_site public.sites) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'id',_site.id,'name',_site.name,'company_name',_site.company_name,'city',_site.city,
    'address',nullif(btrim(_site.address),''),'associate_id',p.id,'associate_name',p.name,
    'contact_name',coalesce(public.field_ops_site_metadata(_site.task_notes)->>'c1_name',''),
    'contact_mobile',coalesce(public.field_ops_site_metadata(_site.task_notes)->>'c1_mobile',''))
  FROM (SELECT 1) singleton
  LEFT JOIN LATERAL (
    SELECT profile.id,profile.name FROM unnest(public.field_ops_worker_ids(_site)) WITH ORDINALITY w(id,position)
    JOIN public.profiles profile ON profile.id=w.id
    WHERE public.field_ops_associate(profile.id) ORDER BY w.position LIMIT 1
  ) p ON true
$$;

CREATE OR REPLACE FUNCTION public.logistics_advance_companies() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.logistics_assert_manager();
  RETURN (SELECT coalesce(jsonb_agg(public.logistics_company_context(s) ORDER BY coalesce(s.company_name,s.name)),'[]'::jsonb)
    FROM public.sites s WHERE public.field_ops_site_active(s));
END $$;

CREATE OR REPLACE FUNCTION public.logistics_create_advance_order(_site uuid,_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sites; company jsonb; options jsonb; k text; selected boolean:=false;
  result public.inventory_materials; company_name text;
BEGIN
  PERFORM public.logistics_assert_manager();
  SELECT * INTO s FROM public.sites WHERE id=_site FOR UPDATE;
  IF NOT FOUND OR NOT public.field_ops_site_active(s) THEN RAISE EXCEPTION 'Active company not found'; END IF;
  company:=public.logistics_company_context(s);
  IF nullif(company->>'associate_id','') IS NULL THEN RAISE EXCEPTION 'Assign an active field associate before ordering'; END IF;
  IF nullif(company->>'address','') IS NULL THEN RAISE EXCEPTION 'Company delivery address is required'; END IF;
  IF jsonb_typeof(_selection) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Device selections required'; END IF;
  options:=public.inventory_dispatch_notes(_selection->>'notes');
  IF jsonb_typeof(options->'dm_selected') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(options->'without_cavli') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid device selection'; END IF;
  FOREACH k IN ARRAY ARRAY['ct1','ct2','ct3','proxy1','proxy2','encoder','vibration','antenna','tower_light','energy_meter'] LOOP
    IF coalesce(_selection->>k,'FALSE') NOT IN ('TRUE','FALSE') THEN RAISE EXCEPTION 'Invalid sensor selection: %',k; END IF;
    selected:=selected OR coalesce(_selection->>k='TRUE',false);
  END LOOP;
  IF NOT selected AND NOT (options->>'dm_selected')::boolean THEN RAISE EXCEPTION 'Select at least one device or sensor'; END IF;
  IF _selection->>'ct2'='TRUE' OR (_selection->>'ct1'='TRUE' AND _selection->>'ct3'='TRUE') THEN RAISE EXCEPTION 'Choose single-phase or three-phase CT sensors'; END IF;
  IF _selection->>'vibration'='TRUE' AND coalesce(_selection->>'vibration_model','') NOT IN ('renke','witmotion','vibe-q') THEN RAISE EXCEPTION 'Choose a valid vibration model'; END IF;
  company_name:=coalesce(nullif(btrim(s.company_name),''),s.name);
  PERFORM pg_advisory_xact_lock(hashtextextended('simkit-order:'||company_name,0));
  IF EXISTS(SELECT 1 FROM public.inventory_materials m WHERE m.submitted AND coalesce(m.order_source,'simkit')<>'upscale'
    AND (m.site_id=s.id OR m.material_name=company_name)) THEN RAISE EXCEPTION 'Already ordered: An order has already been placed for this company'; END IF;
  INSERT INTO public.inventory_materials(material_name,location,site_id,advance_order_actor,created_by,quantity,unit,submitted,state,
    ct1,ct2,ct3,proxy1,proxy2,proxy_model,encoder,vibration,vibration_model,antenna,tower_light,energy_meter,plc,notes)
  VALUES(company_name,company->>'address',s.id,auth.uid(),(company->>'associate_id')::uuid,1,'pcs',true,'Available',
    coalesce(_selection->>'ct1','FALSE'),'FALSE',coalesce(_selection->>'ct3','FALSE'),
    coalesce(_selection->>'proxy1','FALSE'),coalesce(_selection->>'proxy2','FALSE'),
    CASE WHEN _selection->>'proxy1'='TRUE' OR _selection->>'proxy2'='TRUE' THEN 'Inductive' END,
    coalesce(_selection->>'encoder','FALSE'),coalesce(_selection->>'vibration','FALSE'),
    CASE WHEN _selection->>'vibration'='TRUE' THEN _selection->>'vibration_model' END,
    coalesce(_selection->>'antenna','FALSE'),coalesce(_selection->>'tower_light','FALSE'),coalesce(_selection->>'energy_meter','FALSE'),'FALSE',
    jsonb_build_object('dm_selected',(options->>'dm_selected')::boolean,
      'without_cavli',(options->>'dm_selected')::boolean AND (options->>'without_cavli')::boolean,
      'logistics_status','Pending','packing_date','','transit_date','','arrived_date','','courier_id','','courier_partner','')::text)
  RETURNING * INTO result;
  RETURN to_jsonb(result);
END $$;

REVOKE ALL ON FUNCTION public.logistics_assert_manager(),public.logistics_company_context(public.sites),
  public.logistics_advance_companies(),public.logistics_create_advance_order(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_advance_companies(),public.logistics_create_advance_order(uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
