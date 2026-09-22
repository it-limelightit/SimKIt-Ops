-- One-time Issue Resolution checklist.
CREATE TABLE public.company_tracker_issue_resolution (
  tracker_id UUID PRIMARY KEY REFERENCES public.company_tracker_assignments(id) ON DELETE CASCADE,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.company_tracker_issue_resolution ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.company_tracker_issue_resolution TO authenticated;
CREATE POLICY "Tracker issue resolution read access" ON public.company_tracker_issue_resolution FOR SELECT TO authenticated USING (public.can_access_company_tracker(tracker_id));

CREATE OR REPLACE FUNCTION public.company_tracker_complete_issue_resolution(_tracker_id UUID, _checklist JSONB)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE all_checked BOOLEAN; current_stage TEXT;
BEGIN
  IF NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF current_stage IS DISTINCT FROM 'Issue Resolution' THEN RAISE EXCEPTION 'Issue Resolution is not active'; END IF;
  all_checked := coalesce((_checklist->>'Business Profile')::boolean,false) AND coalesce((_checklist->>'Product List')::boolean,false) AND coalesce((_checklist->>'Availability')::boolean,false) AND coalesce((_checklist->>'Performance')::boolean,false) AND coalesce((_checklist->>'Energy')::boolean,false) AND coalesce((_checklist->>'OEE')::boolean,false);
  INSERT INTO public.company_tracker_issue_resolution(tracker_id, checklist, completed_at, completed_by)
  VALUES (_tracker_id, _checklist, CASE WHEN all_checked THEN now() ELSE NULL END, CASE WHEN all_checked THEN auth.uid() ELSE NULL END)
  ON CONFLICT (tracker_id) DO UPDATE SET checklist = EXCLUDED.checklist, completed_at = EXCLUDED.completed_at, completed_by = EXCLUDED.completed_by;
  IF NOT all_checked THEN RETURN 'pending'; END IF;
  UPDATE public.company_tracker_assignments SET stage = 'Monitoring', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, was_manual) VALUES (_tracker_id, 'Issue Resolution', 'Monitoring', auth.uid(), false);
  RETURN 'Monitoring';
END; $$;

-- Monitoring has one outcome per calendar day. A missed prior day makes the
-- current day red, which extends the cycle from six total days to eleven.
CREATE OR REPLACE FUNCTION public.company_tracker_complete_monitoring_day(_tracker_id UUID, _day_number INTEGER, _outcome TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_row public.company_tracker_assignments; day_result TEXT; has_red BOOLEAN; total_days INTEGER; all_green BOOLEAN; automatic_comment_id UUID; expected_day INTEGER;
BEGIN
  SELECT * INTO tracker_row FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF tracker_row.stage <> 'Monitoring' THEN RAISE EXCEPTION 'Monitoring is not active'; END IF;
  IF _outcome NOT IN ('work', 'leave') THEN RAISE EXCEPTION 'Select Work perfect or Leave'; END IF;
  expected_day := (current_date - tracker_row.stage_changed_at::date) + 1;
  IF _day_number <> expected_day THEN RAISE EXCEPTION 'Only the current monitoring day can be completed'; END IF;
  IF _day_number < 1 OR _day_number > 11 THEN RAISE EXCEPTION 'Invalid monitoring day'; END IF;
  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
  SELECT _tracker_id, n, jsonb_build_object('outcome', 'missed'), 'red', now(), auth.uid()
  FROM generate_series(1, _day_number - 1) n
  WHERE NOT EXISTS (SELECT 1 FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = _tracker_id AND d.day_number = n)
  ON CONFLICT (tracker_id, day_number) DO NOTHING;
  day_result := CASE WHEN _outcome = 'leave' THEN 'red' ELSE 'green' END;
  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
  VALUES (_tracker_id, _day_number, jsonb_build_object('outcome', _outcome), day_result, now(), auth.uid())
  ON CONFLICT (tracker_id, day_number) DO UPDATE SET checklist = EXCLUDED.checklist, result = EXCLUDED.result, completed_at = now(), completed_by = auth.uid();
  SELECT EXISTS(SELECT 1 FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND result = 'red') INTO has_red;
  total_days := CASE WHEN has_red THEN 11 ELSE 6 END;
  SELECT count(*) = total_days INTO all_green FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND day_number <= total_days;
  IF all_green THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, 'The required monitoring cycle was completed; moved automatically to Insights Shared.', 'Monitoring', auth.uid()) RETURNING id INTO automatic_comment_id;
    UPDATE public.company_tracker_assignments SET stage = 'Insights Shared', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
    INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, 'Monitoring', 'Insights Shared', auth.uid(), automatic_comment_id, false);
    RETURN 'Insights Shared';
  END IF;
  RETURN day_result;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_transition(_tracker_id UUID, _comment TEXT, _manual BOOLEAN DEFAULT true)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_stage TEXT; next_stage TEXT; comment_id UUID;
BEGIN
  IF trim(coalesce(_comment,'')) = '' THEN RAISE EXCEPTION 'A comment is required to move stages'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF current_stage IN ('Issue Resolution', 'Monitoring') THEN RAISE EXCEPTION 'This stage advances automatically after its required checklist is complete'; END IF;
  next_stage := CASE current_stage WHEN 'Insights Shared' THEN 'Meeting Planned' WHEN 'Meeting Planned' THEN 'Quotation Sent' WHEN 'Quotation Sent' THEN 'Converted' ELSE NULL END;
  IF next_stage IS NULL THEN RAISE EXCEPTION 'This company is already converted'; END IF;
  SELECT id INTO comment_id FROM public.company_tracker_comments WHERE tracker_id = _tracker_id AND stage = current_stage AND body = trim(_comment) ORDER BY created_at DESC LIMIT 1;
  IF comment_id IS NULL THEN INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, trim(_comment), current_stage, auth.uid()) RETURNING id INTO comment_id; END IF;
  UPDATE public.company_tracker_assignments SET stage = next_stage, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, current_stage, next_stage, auth.uid(), comment_id, _manual);
  RETURN next_stage;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_board()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'site_id', a.site_id, 'stage', a.stage, 'stage_changed_at', a.stage_changed_at,
    'company_name', coalesce(s.company_name, s.name), 'city', s.city, 'assignee_id', a.assignee_id, 'assignee_name', p.name,
    'issue_checklist', coalesce((SELECT ir.checklist FROM public.company_tracker_issue_resolution ir WHERE ir.tracker_id = a.id), '{}'::jsonb),
    'comments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'stage', c.stage, 'created_at', c.created_at, 'author', cp.name) ORDER BY c.created_at DESC), '[]'::jsonb) FROM public.company_tracker_comments c LEFT JOIN public.profiles cp ON cp.id = c.author_id WHERE c.tracker_id = a.id),
    'monitoring_days', (SELECT coalesce(jsonb_agg(jsonb_build_object('day_number', d.day_number, 'checklist', d.checklist, 'result', d.result, 'completed_at', d.completed_at) ORDER BY d.day_number), '[]'::jsonb) FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = a.id)
  ) ORDER BY a.updated_at DESC), '[]'::jsonb)
  FROM public.company_tracker_assignments a JOIN public.sites s ON s.id = a.site_id LEFT JOIN public.profiles p ON p.id = a.assignee_id
  WHERE public.is_company_tracker_manager() OR a.assignee_id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.company_tracker_complete_issue_resolution(UUID, JSONB), public.company_tracker_complete_monitoring_day(UUID, INTEGER, TEXT), public.company_tracker_transition(UUID, TEXT, BOOLEAN), public.company_tracker_board() TO authenticated;
