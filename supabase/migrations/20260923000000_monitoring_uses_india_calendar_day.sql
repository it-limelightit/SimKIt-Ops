-- Monitoring-day progression is based on calendar dates in India, not elapsed
-- 24-hour intervals or the database server's timezone.
CREATE OR REPLACE FUNCTION public.company_tracker_complete_monitoring_day(_tracker_id UUID, _day_number INTEGER, _outcome TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_row public.company_tracker_assignments; day_result TEXT; has_red BOOLEAN; total_days INTEGER; all_green BOOLEAN; automatic_comment_id UUID; expected_day INTEGER;
BEGIN
  SELECT * INTO tracker_row FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF tracker_row.stage <> 'Monitoring' THEN RAISE EXCEPTION 'Monitoring is not active'; END IF;
  IF _outcome NOT IN ('work', 'leave') THEN RAISE EXCEPTION 'Select Work perfect or Leave'; END IF;

  expected_day := (((now() AT TIME ZONE 'Asia/Kolkata')::date - (tracker_row.stage_changed_at AT TIME ZONE 'Asia/Kolkata')::date) + 1);
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
