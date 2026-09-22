-- Company tracker: all state changes go through the RPCs below so that role and
-- ownership rules are enforced even when a client bypasses the UI.
CREATE TABLE public.company_tracker_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL UNIQUE REFERENCES public.sites(id) ON DELETE CASCADE,
  assignee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  stage TEXT NOT NULL DEFAULT 'Issue Resolution' CHECK (stage IN ('Issue Resolution','Monitoring','Insights Shared','Meeting Planned','Quotation Sent','Converted')),
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX company_tracker_assignments_assignee_idx ON public.company_tracker_assignments (assignee_id, stage);

CREATE TABLE public.company_tracker_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id UUID NOT NULL REFERENCES public.company_tracker_assignments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  stage TEXT NOT NULL,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX company_tracker_comments_tracker_idx ON public.company_tracker_comments (tracker_id, created_at DESC);

CREATE TABLE public.company_tracker_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id UUID NOT NULL REFERENCES public.company_tracker_assignments(id) ON DELETE CASCADE,
  previous_stage TEXT,
  new_stage TEXT NOT NULL,
  changed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  comment_id UUID REFERENCES public.company_tracker_comments(id) ON DELETE SET NULL,
  was_manual BOOLEAN NOT NULL DEFAULT false,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX company_tracker_history_tracker_idx ON public.company_tracker_stage_history (tracker_id, changed_at DESC);

CREATE TABLE public.company_tracker_monitoring_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id UUID NOT NULL REFERENCES public.company_tracker_assignments(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL CHECK (day_number BETWEEN 1 AND 11),
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','green','red')),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (tracker_id, day_number)
);

ALTER TABLE public.company_tracker_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_tracker_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_tracker_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_tracker_monitoring_days ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.company_tracker_assignments, public.company_tracker_comments, public.company_tracker_stage_history, public.company_tracker_monitoring_days TO authenticated;

CREATE OR REPLACE FUNCTION public.is_company_tracker_manager()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_commissioning_approver()
$$;
CREATE OR REPLACE FUNCTION public.can_access_company_tracker(_tracker_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_company_tracker_manager() OR EXISTS (
    SELECT 1 FROM public.company_tracker_assignments WHERE id = _tracker_id AND assignee_id = auth.uid()
  )
$$;
CREATE POLICY "Tracker assignment read access" ON public.company_tracker_assignments FOR SELECT TO authenticated
  USING (public.is_company_tracker_manager() OR assignee_id = auth.uid());
CREATE POLICY "Tracker comment read access" ON public.company_tracker_comments FOR SELECT TO authenticated
  USING (public.can_access_company_tracker(tracker_id));
CREATE POLICY "Tracker history read access" ON public.company_tracker_stage_history FOR SELECT TO authenticated
  USING (public.can_access_company_tracker(tracker_id));
CREATE POLICY "Tracker monitoring read access" ON public.company_tracker_monitoring_days FOR SELECT TO authenticated
  USING (public.can_access_company_tracker(tracker_id));

CREATE OR REPLACE FUNCTION public.company_tracker_assign(_site_id UUID, _assignee_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_id UUID;
BEGIN
  IF NOT public.is_company_tracker_manager() THEN RAISE EXCEPTION 'Only commissioning managers can assign companies'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = _site_id) THEN RAISE EXCEPTION 'Company not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _assignee_id AND is_active) THEN RAISE EXCEPTION 'Assignee must be an active user'; END IF;
  INSERT INTO public.company_tracker_assignments(site_id, assignee_id, stage, stage_changed_at, created_by)
  VALUES (_site_id, _assignee_id, 'Issue Resolution', now(), auth.uid())
  ON CONFLICT (site_id) DO UPDATE SET assignee_id = EXCLUDED.assignee_id, stage = 'Issue Resolution', stage_changed_at = now(), updated_at = now()
  RETURNING id INTO tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, was_manual)
  VALUES (tracker_id, NULL, 'Issue Resolution', auth.uid(), false);
  RETURN tracker_id;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_add_comment(_tracker_id UUID, _body TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE comment_id UUID; tracker_stage TEXT;
BEGIN
  IF trim(coalesce(_body,'')) = '' THEN RAISE EXCEPTION 'A comment is required'; END IF;
  SELECT stage INTO tracker_stage FROM public.company_tracker_assignments WHERE id = _tracker_id;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, trim(_body), tracker_stage, auth.uid()) RETURNING id INTO comment_id;
  RETURN comment_id;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_transition(_tracker_id UUID, _comment TEXT, _manual BOOLEAN DEFAULT true)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_stage TEXT; next_stage TEXT; comment_id UUID;
BEGIN
  IF trim(coalesce(_comment,'')) = '' THEN RAISE EXCEPTION 'A comment is required to move stages'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  next_stage := CASE current_stage WHEN 'Issue Resolution' THEN 'Monitoring' WHEN 'Monitoring' THEN 'Insights Shared' WHEN 'Insights Shared' THEN 'Meeting Planned' WHEN 'Meeting Planned' THEN 'Quotation Sent' WHEN 'Quotation Sent' THEN 'Converted' ELSE NULL END;
  IF next_stage IS NULL THEN RAISE EXCEPTION 'This company is already converted'; END IF;
  INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, trim(_comment), current_stage, auth.uid()) RETURNING id INTO comment_id;
  UPDATE public.company_tracker_assignments SET stage = next_stage, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, current_stage, next_stage, auth.uid(), comment_id, _manual);
  RETURN next_stage;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_save_monitoring(_tracker_id UUID, _day_number INTEGER, _checklist JSONB)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_row public.company_tracker_assignments; all_checked BOOLEAN; day_result TEXT; has_red BOOLEAN; total_days INTEGER; all_green BOOLEAN; automatic_comment_id UUID;
BEGIN
  SELECT * INTO tracker_row FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF tracker_row.stage <> 'Monitoring' THEN RAISE EXCEPTION 'Monitoring is not active'; END IF;
  IF _day_number < 1 OR _day_number > 11 THEN RAISE EXCEPTION 'Invalid monitoring day'; END IF;
  IF NOT public.is_company_tracker_manager() AND (tracker_row.stage_changed_at::date + (_day_number - 1)) <> current_date THEN RAISE EXCEPTION 'Only today''s monitoring checklist can be edited'; END IF;
  IF EXISTS (SELECT 1 FROM generate_series(1, _day_number - 1) n WHERE NOT EXISTS (SELECT 1 FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = _tracker_id AND d.day_number = n AND d.result IN ('green','red'))) THEN day_result := 'red';
  ELSE
    all_checked := coalesce((_checklist->>'Business Profile')::boolean,false) AND coalesce((_checklist->>'Product List')::boolean,false) AND coalesce((_checklist->>'Availability')::boolean,false) AND coalesce((_checklist->>'Performance')::boolean,false) AND coalesce((_checklist->>'Energy')::boolean,false) AND coalesce((_checklist->>'OAE')::boolean,false);
    day_result := CASE WHEN all_checked THEN 'green' ELSE 'red' END;
  END IF;
  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by) VALUES (_tracker_id, _day_number, _checklist, day_result, now(), auth.uid())
  ON CONFLICT (tracker_id, day_number) DO UPDATE SET checklist = EXCLUDED.checklist, result = EXCLUDED.result, completed_at = now(), completed_by = auth.uid();
  SELECT EXISTS(SELECT 1 FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND result = 'red') INTO has_red;
  total_days := CASE WHEN has_red THEN 11 ELSE 6 END;
  SELECT count(*) = total_days AND bool_and(result = 'green') INTO all_green FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND day_number <= total_days;
  IF all_green THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id)
    VALUES (_tracker_id, 'All required monitoring days were completed successfully; moved automatically to Insights Shared.', 'Monitoring', auth.uid())
    RETURNING id INTO automatic_comment_id;
    UPDATE public.company_tracker_assignments SET stage = 'Insights Shared', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
    INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, 'Monitoring', 'Insights Shared', auth.uid(), automatic_comment_id, false);
    RETURN 'Insights Shared';
  END IF;
  RETURN day_result;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_board()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'site_id', a.site_id, 'stage', a.stage, 'stage_changed_at', a.stage_changed_at,
    'company_name', coalesce(s.company_name, s.name), 'city', s.city,
    'assignee_id', a.assignee_id, 'assignee_name', p.name,
    'comments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'stage', c.stage, 'created_at', c.created_at, 'author', cp.name) ORDER BY c.created_at DESC), '[]'::jsonb) FROM public.company_tracker_comments c LEFT JOIN public.profiles cp ON cp.id = c.author_id WHERE c.tracker_id = a.id),
    'monitoring_days', (SELECT coalesce(jsonb_agg(jsonb_build_object('day_number', d.day_number, 'checklist', d.checklist, 'result', d.result, 'completed_at', d.completed_at) ORDER BY d.day_number), '[]'::jsonb) FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = a.id)
  ) ORDER BY a.updated_at DESC), '[]'::jsonb)
  FROM public.company_tracker_assignments a
  JOIN public.sites s ON s.id = a.site_id
  LEFT JOIN public.profiles p ON p.id = a.assignee_id
  WHERE public.is_company_tracker_manager() OR a.assignee_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.company_tracker_assignment_options()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'sites', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', coalesce(s.company_name, s.name)) ORDER BY coalesce(s.company_name, s.name)) FROM public.sites s), '[]'::jsonb),
    'users', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.name, p.email)) ORDER BY coalesce(p.name, p.email)) FROM public.profiles p WHERE p.is_active), '[]'::jsonb)
  )
  WHERE public.is_company_tracker_manager()
$$;

GRANT EXECUTE ON FUNCTION public.company_tracker_assign(UUID, UUID), public.company_tracker_add_comment(UUID, TEXT), public.company_tracker_transition(UUID, TEXT, BOOLEAN), public.company_tracker_save_monitoring(UUID, INTEGER, JSONB), public.company_tracker_board(), public.company_tracker_assignment_options() TO authenticated;
