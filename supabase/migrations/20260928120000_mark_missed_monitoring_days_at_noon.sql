-- A monitoring outcome is due by 12:00 PM India time. When it has not been
-- recorded by then, preserve the existing missed-day behaviour by recording it
-- as a red Leave/Absent outcome. The board runs this reconciliation before it
-- is returned, so the status is persisted as soon as the tracker is opened.
CREATE OR REPLACE FUNCTION public.company_tracker_mark_missed_monitoring_days()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  india_now TIMESTAMP;
  tracker_row RECORD;
  due_day INTEGER;
  has_red BOOLEAN;
  total_days INTEGER;
  completed_days INTEGER;
  automatic_comment_id UUID;
BEGIN
  india_now := now() AT TIME ZONE 'Asia/Kolkata';
  IF india_now::time < TIME '12:00' THEN RETURN; END IF;

  FOR tracker_row IN
    SELECT id, stage_changed_at
    FROM public.company_tracker_assignments
    WHERE stage = 'Monitoring'
    FOR UPDATE
  LOOP
    due_day := LEAST(11, ((india_now::date - (tracker_row.stage_changed_at AT TIME ZONE 'Asia/Kolkata')::date) + 1));
    IF due_day < 1 THEN CONTINUE; END IF;

    INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
    SELECT tracker_row.id, n, jsonb_build_object('outcome', 'missed'), 'red', now(), auth.uid()
    FROM generate_series(1, due_day) n
    WHERE NOT EXISTS (
      SELECT 1 FROM public.company_tracker_monitoring_days d
      WHERE d.tracker_id = tracker_row.id AND d.day_number = n
    )
    ON CONFLICT (tracker_id, day_number) DO NOTHING;

    SELECT EXISTS(SELECT 1 FROM public.company_tracker_monitoring_days WHERE tracker_id = tracker_row.id AND result = 'red') INTO has_red;
    total_days := CASE WHEN has_red THEN 11 ELSE 6 END;
    SELECT count(*) INTO completed_days FROM public.company_tracker_monitoring_days WHERE tracker_id = tracker_row.id AND day_number <= total_days;
    IF completed_days = total_days THEN
      INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id)
      VALUES (tracker_row.id, 'The required monitoring cycle was completed; moved automatically to Insights Shared.', 'Monitoring', auth.uid())
      RETURNING id INTO automatic_comment_id;
      UPDATE public.company_tracker_assignments SET stage = 'Insights Shared', stage_changed_at = now(), updated_at = now() WHERE id = tracker_row.id;
      INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual)
      VALUES (tracker_row.id, 'Monitoring', 'Insights Shared', auth.uid(), automatic_comment_id, false);
    END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_complete_monitoring_day(_tracker_id UUID, _day_number INTEGER, _outcome TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tracker_row public.company_tracker_assignments;
  day_result TEXT;
  has_red BOOLEAN;
  total_days INTEGER;
  all_green BOOLEAN;
  automatic_comment_id UUID;
  expected_day INTEGER;
  india_now TIMESTAMP;
BEGIN
  -- A stale screen cannot overwrite the red result assigned at noon.
  PERFORM public.company_tracker_mark_missed_monitoring_days();
  SELECT * INTO tracker_row FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF tracker_row.stage <> 'Monitoring' THEN RAISE EXCEPTION 'Monitoring is not active'; END IF;
  IF _outcome NOT IN ('work', 'leave') THEN RAISE EXCEPTION 'Select Work perfect or Leave'; END IF;

  india_now := now() AT TIME ZONE 'Asia/Kolkata';
  expected_day := ((india_now::date - (tracker_row.stage_changed_at AT TIME ZONE 'Asia/Kolkata')::date) + 1);
  IF _day_number <> expected_day THEN RAISE EXCEPTION 'Only the current monitoring day can be completed'; END IF;
  IF _day_number < 1 OR _day_number > 11 THEN RAISE EXCEPTION 'Invalid monitoring day'; END IF;
  IF india_now::time >= TIME '12:00' THEN
    SELECT result INTO day_result FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND day_number = _day_number;
    RETURN coalesce(day_result, 'red');
  END IF;

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

CREATE OR REPLACE FUNCTION public.company_tracker_board()
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE board JSONB;
BEGIN
  PERFORM public.company_tracker_mark_missed_monitoring_days();
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'site_id', a.site_id, 'stage', a.stage, 'stage_changed_at', a.stage_changed_at,
    'company_name', coalesce(s.company_name, s.name), 'city', s.city, 'assignee_id', a.assignee_id, 'assignee_name', p.name,
    'issue_checklist', coalesce((SELECT ir.checklist FROM public.company_tracker_issue_resolution ir WHERE ir.tracker_id = a.id), '{}'::jsonb),
    'comments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'stage', c.stage, 'created_at', c.created_at, 'author', cp.name) ORDER BY c.created_at DESC), '[]'::jsonb) FROM public.company_tracker_comments c LEFT JOIN public.profiles cp ON cp.id = c.author_id WHERE c.tracker_id = a.id),
    'monitoring_days', (SELECT coalesce(jsonb_agg(jsonb_build_object('day_number', d.day_number, 'checklist', d.checklist, 'result', d.result, 'completed_at', d.completed_at) ORDER BY d.day_number), '[]'::jsonb) FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = a.id)
  ) ORDER BY a.updated_at DESC), '[]'::jsonb) INTO board
  FROM public.company_tracker_assignments a JOIN public.sites s ON s.id = a.site_id LEFT JOIN public.profiles p ON p.id = a.assignee_id
  WHERE public.is_company_tracker_manager() OR a.assignee_id = auth.uid();
  RETURN board;
END; $$;

REVOKE EXECUTE ON FUNCTION public.company_tracker_mark_missed_monitoring_days() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_tracker_complete_monitoring_day(UUID, INTEGER, TEXT), public.company_tracker_board() TO authenticated;
