-- Permanently rename the monitoring field while preserving completed checklists.
UPDATE public.company_tracker_monitoring_days
SET checklist = (jsonb_set(checklist, '{OEE}', checklist->'OAE', true) - 'OAE')
WHERE checklist ? 'OAE';

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
    all_checked := coalesce((_checklist->>'Business Profile')::boolean,false) AND coalesce((_checklist->>'Product List')::boolean,false) AND coalesce((_checklist->>'Availability')::boolean,false) AND coalesce((_checklist->>'Performance')::boolean,false) AND coalesce((_checklist->>'Energy')::boolean,false) AND coalesce((_checklist->>'OEE')::boolean,false);
    day_result := CASE WHEN all_checked THEN 'green' ELSE 'red' END;
  END IF;
  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by) VALUES (_tracker_id, _day_number, _checklist, day_result, now(), auth.uid())
  ON CONFLICT (tracker_id, day_number) DO UPDATE SET checklist = EXCLUDED.checklist, result = EXCLUDED.result, completed_at = now(), completed_by = auth.uid();
  SELECT EXISTS(SELECT 1 FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND result = 'red') INTO has_red;
  total_days := CASE WHEN has_red THEN 11 ELSE 6 END;
  SELECT count(*) = total_days AND bool_and(result = 'green') INTO all_green FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND day_number <= total_days;
  IF all_green THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, 'All required monitoring days were completed successfully; moved automatically to Insights Shared.', 'Monitoring', auth.uid()) RETURNING id INTO automatic_comment_id;
    UPDATE public.company_tracker_assignments SET stage = 'Insights Shared', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
    INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, 'Monitoring', 'Insights Shared', auth.uid(), automatic_comment_id, false);
    RETURN 'Insights Shared';
  END IF;
  RETURN day_result;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_move_previous(_tracker_id UUID, _comment TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_stage TEXT; previous_stage_value TEXT; comment_id UUID;
BEGIN
  IF NOT public.is_company_tracker_manager() THEN RAISE EXCEPTION 'Only commissioning managers can move a company to a previous stage'; END IF;
  IF trim(coalesce(_comment, '')) = '' THEN RAISE EXCEPTION 'A comment is required to move stages'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tracker record was not found'; END IF;
  SELECT previous_stage INTO previous_stage_value FROM public.company_tracker_stage_history WHERE tracker_id = _tracker_id AND new_stage = current_stage AND previous_stage IS NOT NULL ORDER BY changed_at DESC LIMIT 1;
  IF previous_stage_value IS NULL THEN RAISE EXCEPTION 'There is no previous stage for this company'; END IF;
  INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, trim(_comment), current_stage, auth.uid()) RETURNING id INTO comment_id;
  UPDATE public.company_tracker_assignments SET stage = previous_stage_value, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, current_stage, previous_stage_value, auth.uid(), comment_id, true);
  RETURN previous_stage_value;
END; $$;

GRANT EXECUTE ON FUNCTION public.company_tracker_save_monitoring(UUID, INTEGER, JSONB), public.company_tracker_move_previous(UUID, TEXT) TO authenticated;
