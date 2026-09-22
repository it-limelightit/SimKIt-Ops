-- Label existing rollback comments clearly in the comment history.
UPDATE public.company_tracker_comments c
SET stage = 'Previous stage: ' || h.previous_stage || ' → ' || h.new_stage
FROM public.company_tracker_stage_history h
WHERE h.comment_id = c.id
  AND array_position(ARRAY['Issue Resolution','Monitoring','Insights Shared','Meeting Planned','Quotation Sent','Converted'], h.new_stage)
    < array_position(ARRAY['Issue Resolution','Monitoring','Insights Shared','Meeting Planned','Quotation Sent','Converted'], h.previous_stage);

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
  INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id)
  VALUES (_tracker_id, trim(_comment), 'Previous stage: ' || current_stage || ' → ' || previous_stage_value, auth.uid())
  RETURNING id INTO comment_id;
  UPDATE public.company_tracker_assignments SET stage = previous_stage_value, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, current_stage, previous_stage_value, auth.uid(), comment_id, true);
  RETURN previous_stage_value;
END; $$;

GRANT EXECUTE ON FUNCTION public.company_tracker_move_previous(UUID, TEXT) TO authenticated;
