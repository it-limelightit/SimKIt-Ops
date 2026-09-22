-- When a user has already added a comment in the current stage, reuse that
-- comment as the required transition note instead of creating a duplicate.
CREATE OR REPLACE FUNCTION public.company_tracker_transition(_tracker_id UUID, _comment TEXT, _manual BOOLEAN DEFAULT true)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_stage TEXT; next_stage TEXT; comment_id UUID;
BEGIN
  IF trim(coalesce(_comment,'')) = '' THEN RAISE EXCEPTION 'A comment is required to move stages'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  next_stage := CASE current_stage WHEN 'Issue Resolution' THEN 'Monitoring' WHEN 'Monitoring' THEN 'Insights Shared' WHEN 'Insights Shared' THEN 'Meeting Planned' WHEN 'Meeting Planned' THEN 'Quotation Sent' WHEN 'Quotation Sent' THEN 'Converted' ELSE NULL END;
  IF next_stage IS NULL THEN RAISE EXCEPTION 'This company is already converted'; END IF;
  SELECT id INTO comment_id FROM public.company_tracker_comments
  WHERE tracker_id = _tracker_id AND stage = current_stage AND body = trim(_comment)
  ORDER BY created_at DESC LIMIT 1;
  IF comment_id IS NULL THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id)
    VALUES (_tracker_id, trim(_comment), current_stage, auth.uid()) RETURNING id INTO comment_id;
  END IF;
  UPDATE public.company_tracker_assignments SET stage = next_stage, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual)
  VALUES (_tracker_id, current_stage, next_stage, auth.uid(), comment_id, _manual);
  RETURN next_stage;
END; $$;

GRANT EXECUTE ON FUNCTION public.company_tracker_transition(UUID, TEXT, BOOLEAN) TO authenticated;
