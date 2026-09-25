-- Isolated scheduler: it does not alter sites, appointments, assignments,
-- phase forms, or Company Tracker records.
CREATE TABLE IF NOT EXISTS public.field_visit_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  assignee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  visit_type TEXT NOT NULL CHECK (visit_type IN ('assessment', 'installation', 'commissioning')),
  scheduled_for DATE NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'emergency')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'delayed')),
  note TEXT,
  delay_reason TEXT,
  manager_due_date DATE,
  manager_note TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS field_visit_schedules_assignee_date_idx ON public.field_visit_schedules (assignee_id, scheduled_for);
ALTER TABLE public.field_visit_schedules ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.field_visit_schedules TO authenticated;
DROP POLICY IF EXISTS "Field visit schedules visible to assignee and staff" ON public.field_visit_schedules;
CREATE POLICY "Field visit schedules visible to assignee and staff" ON public.field_visit_schedules FOR SELECT TO authenticated USING (assignee_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.field_visit_schedule_board()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'site_id', v.site_id, 'company_name', coalesce(s.company_name, s.name), 'city', s.city,
    'assignee_id', v.assignee_id, 'assignee_name', p.name, 'visit_type', v.visit_type,
    'scheduled_for', v.scheduled_for, 'priority', v.priority, 'status', v.status, 'note', v.note,
    'delay_reason', v.delay_reason, 'manager_due_date', v.manager_due_date, 'manager_note', v.manager_note,
    'created_at', v.created_at, 'completed_at', v.completed_at
  ) ORDER BY v.scheduled_for, v.created_at DESC), '[]'::jsonb)
  FROM public.field_visit_schedules v JOIN public.sites s ON s.id = v.site_id
  LEFT JOIN public.profiles p ON p.id = v.assignee_id
  WHERE public.is_staff(auth.uid()) OR v.assignee_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.field_visit_schedule_options()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'sites', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'site_id', s.id, 'company_name', coalesce(s.company_name, s.name), 'assignee_id', s.assigned_worker_id,
      'status', CASE
        WHEN coalesce(c.data->>'commissioning_phase_submitted', 'false') = 'true' THEN 'Commissioned'
        WHEN coalesce(i.data->>'installation_phase_submitted', 'false') = 'true' THEN 'Installed'
        WHEN coalesce(a.data->>'assessment_phase_submitted', 'false') = 'true' THEN 'Assessed'
        ELSE 'Not Started'
      END
    ) ORDER BY coalesce(s.company_name, s.name))
    FROM public.sites s
    LEFT JOIN public.assessment a ON a.site_id = s.id
    LEFT JOIN public.installation i ON i.site_id = s.id
    LEFT JOIN public.commissioning c ON c.site_id = s.id
    WHERE public.is_staff(auth.uid()) OR s.assigned_worker_id = auth.uid()), '[]'::jsonb),
    'users', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.name, p.email)) ORDER BY coalesce(p.name, p.email)) FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'worker' WHERE p.is_active), '[]'::jsonb)
  )
$$;

CREATE OR REPLACE FUNCTION public.field_visit_schedule_create(_site_id UUID, _visit_type TEXT, _scheduled_for DATE, _note TEXT DEFAULT NULL, _assignee_id UUID DEFAULT NULL, _priority TEXT DEFAULT 'normal', _manager_due_date DATE DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE visit_id UUID; visit_assignee UUID;
BEGIN
  IF _visit_type NOT IN ('assessment', 'installation', 'commissioning') THEN RAISE EXCEPTION 'Select a valid visit type'; END IF;
  IF _scheduled_for IS NULL THEN RAISE EXCEPTION 'Select a visit date'; END IF;
  IF _priority NOT IN ('normal', 'high', 'emergency') THEN RAISE EXCEPTION 'Select a valid priority'; END IF;
  IF public.is_staff(auth.uid()) THEN
    visit_assignee := _assignee_id;
    IF visit_assignee IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'worker' WHERE p.id = visit_assignee AND p.is_active) THEN RAISE EXCEPTION 'Select an active Field Associate'; END IF;
  ELSE
    visit_assignee := auth.uid();
    IF _assignee_id IS NOT NULL OR _priority <> 'normal' OR NOT EXISTS (SELECT 1 FROM public.sites WHERE id = _site_id AND assigned_worker_id = auth.uid()) THEN RAISE EXCEPTION 'You can schedule only your assigned companies'; END IF;
  END IF;
  INSERT INTO public.field_visit_schedules(site_id, assignee_id, visit_type, scheduled_for, note, created_by)
  VALUES (_site_id, visit_assignee, _visit_type, _scheduled_for, nullif(trim(coalesce(_note, '')), ''), auth.uid()) RETURNING id INTO visit_id;
  UPDATE public.field_visit_schedules SET priority = _priority, manager_due_date = CASE WHEN public.is_staff(auth.uid()) THEN _manager_due_date ELSE NULL END WHERE id = visit_id;
  RETURN visit_id;
END; $$;

CREATE OR REPLACE FUNCTION public.field_visit_schedule_update_status(_visit_id UUID, _status TEXT, _delay_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _status NOT IN ('scheduled', 'completed', 'delayed') THEN RAISE EXCEPTION 'Select a valid status'; END IF;
  IF _status = 'delayed' AND trim(coalesce(_delay_reason, '')) = '' THEN RAISE EXCEPTION 'A delay reason is required'; END IF;
  -- Completion is always recorded by the assigned Field Associate. This also
  -- lets a dual-role user complete their own visit from the manager tracker.
  UPDATE public.field_visit_schedules SET status = _status, delay_reason = CASE WHEN _status = 'delayed' THEN trim(_delay_reason) ELSE NULL END, completed_at = CASE WHEN _status = 'completed' THEN now() ELSE NULL END, updated_at = now() WHERE id = _visit_id AND assignee_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Visit not found or access denied'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.field_visit_schedule_set_priority(_visit_id UUID, _priority TEXT, _manager_due_date DATE DEFAULT NULL, _manager_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Only managers can set priority'; END IF;
  IF _priority NOT IN ('normal', 'high', 'emergency') THEN RAISE EXCEPTION 'Select a valid priority'; END IF;
  UPDATE public.field_visit_schedules SET priority = _priority, manager_due_date = _manager_due_date, manager_note = nullif(trim(coalesce(_manager_note, '')), ''), updated_at = now() WHERE id = _visit_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visit not found'; END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.field_visit_schedule_board(), public.field_visit_schedule_options(), public.field_visit_schedule_create(UUID, TEXT, DATE, TEXT, UUID, TEXT, DATE), public.field_visit_schedule_update_status(UUID, TEXT, TEXT), public.field_visit_schedule_set_priority(UUID, TEXT, DATE, TEXT) TO authenticated;
