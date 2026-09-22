-- Prevent a company from being tracked twice. Managers can remove an assignment
-- first if it was created in error, then assign it again if required.
CREATE OR REPLACE FUNCTION public.company_tracker_assign(_site_id UUID, _assignee_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_id UUID;
BEGIN
  IF NOT public.is_company_tracker_manager() THEN RAISE EXCEPTION 'Only commissioning managers can assign companies'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = _site_id) THEN RAISE EXCEPTION 'Company not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _assignee_id AND is_active) THEN RAISE EXCEPTION 'Assignee must be an active user'; END IF;
  IF EXISTS (SELECT 1 FROM public.company_tracker_assignments WHERE site_id = _site_id) THEN
    RAISE EXCEPTION 'This company is already in the tracker. Delete its tracker record before assigning it again.';
  END IF;
  INSERT INTO public.company_tracker_assignments(site_id, assignee_id, stage, stage_changed_at, created_by)
  VALUES (_site_id, _assignee_id, 'Issue Resolution', now(), auth.uid())
  RETURNING id INTO tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, was_manual)
  VALUES (tracker_id, NULL, 'Issue Resolution', auth.uid(), false);
  RETURN tracker_id;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_assignment_options()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'sites', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', coalesce(s.company_name, s.name)) ORDER BY coalesce(s.company_name, s.name)) FROM public.sites s WHERE NOT EXISTS (SELECT 1 FROM public.company_tracker_assignments a WHERE a.site_id = s.id)), '[]'::jsonb),
    'users', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.name, p.email)) ORDER BY coalesce(p.name, p.email)) FROM public.profiles p WHERE p.is_active), '[]'::jsonb)
  )
  WHERE public.is_company_tracker_manager()
$$;

CREATE OR REPLACE FUNCTION public.company_tracker_delete(_tracker_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_company_tracker_manager() THEN RAISE EXCEPTION 'Only commissioning managers can delete tracker records'; END IF;
  DELETE FROM public.company_tracker_assignments WHERE id = _tracker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tracker record was not found'; END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.company_tracker_assign(UUID, UUID), public.company_tracker_assignment_options(), public.company_tracker_delete(UUID) TO authenticated;
