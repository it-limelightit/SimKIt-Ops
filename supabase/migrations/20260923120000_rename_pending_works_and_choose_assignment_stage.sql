-- Rename the first Company Tracker stage while retaining all existing records.
ALTER TABLE public.company_tracker_assignments
  DROP CONSTRAINT IF EXISTS company_tracker_assignments_stage_check;

UPDATE public.company_tracker_assignments
SET stage = 'Pending Works'
WHERE stage = 'Issue Resolution';

UPDATE public.company_tracker_stage_history
SET previous_stage = 'Pending Works'
WHERE previous_stage = 'Issue Resolution';

UPDATE public.company_tracker_stage_history
SET new_stage = 'Pending Works'
WHERE new_stage = 'Issue Resolution';

UPDATE public.company_tracker_comments
SET stage = replace(stage, 'Issue Resolution', 'Pending Works')
WHERE stage LIKE '%Issue Resolution%';

ALTER TABLE public.company_tracker_assignments
  ADD CONSTRAINT company_tracker_assignments_stage_check
  CHECK (stage IN ('Pending Works', 'Monitoring', 'Insights Shared', 'Meeting Planned', 'Quotation Sent', 'Converted'));

-- A manager selects the initial tracker stage during assignment.
DROP FUNCTION IF EXISTS public.company_tracker_assign(UUID, UUID);

CREATE OR REPLACE FUNCTION public.company_tracker_assign(_site_id UUID, _assignee_id UUID, _stage TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_id UUID;
BEGIN
  IF NOT public.is_company_tracker_manager() THEN RAISE EXCEPTION 'Only commissioning managers can assign companies'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = _site_id) THEN RAISE EXCEPTION 'Company not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _assignee_id AND is_active) THEN RAISE EXCEPTION 'Assignee must be an active user'; END IF;
  IF _stage NOT IN ('Pending Works', 'Monitoring', 'Insights Shared', 'Meeting Planned', 'Quotation Sent', 'Converted') THEN
    RAISE EXCEPTION 'Select a valid stage';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_tracker_assignments WHERE site_id = _site_id) THEN
    RAISE EXCEPTION 'This company is already in the tracker. Delete its tracker record before assigning it again.';
  END IF;

  INSERT INTO public.company_tracker_assignments(site_id, assignee_id, stage, stage_changed_at, created_by)
  VALUES (_site_id, _assignee_id, _stage, now(), auth.uid())
  RETURNING id INTO tracker_id;

  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, was_manual)
  VALUES (tracker_id, NULL, _stage, auth.uid(), false);

  RETURN tracker_id;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_complete_issue_resolution(_tracker_id UUID, _checklist JSONB)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE all_checked BOOLEAN; current_stage TEXT;
BEGIN
  IF NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF current_stage IS DISTINCT FROM 'Pending Works' THEN RAISE EXCEPTION 'Pending Works is not active'; END IF;
  all_checked := coalesce((_checklist->>'Business Profile')::boolean,false) AND coalesce((_checklist->>'Product List')::boolean,false) AND coalesce((_checklist->>'Availability')::boolean,false) AND coalesce((_checklist->>'Performance')::boolean,false) AND coalesce((_checklist->>'Energy')::boolean,false) AND coalesce((_checklist->>'OEE')::boolean,false);
  INSERT INTO public.company_tracker_issue_resolution(tracker_id, checklist, completed_at, completed_by)
  VALUES (_tracker_id, _checklist, CASE WHEN all_checked THEN now() ELSE NULL END, CASE WHEN all_checked THEN auth.uid() ELSE NULL END)
  ON CONFLICT (tracker_id) DO UPDATE SET checklist = EXCLUDED.checklist, completed_at = EXCLUDED.completed_at, completed_by = EXCLUDED.completed_by;
  IF NOT all_checked THEN RETURN 'pending'; END IF;
  UPDATE public.company_tracker_assignments SET stage = 'Monitoring', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, was_manual)
  VALUES (_tracker_id, 'Pending Works', 'Monitoring', auth.uid(), false);
  RETURN 'Monitoring';
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_transition(_tracker_id UUID, _comment TEXT, _manual BOOLEAN DEFAULT true)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_stage TEXT; next_stage TEXT; comment_id UUID;
BEGIN
  IF trim(coalesce(_comment,'')) = '' THEN RAISE EXCEPTION 'A comment is required to move stages'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF current_stage IN ('Pending Works', 'Monitoring') THEN RAISE EXCEPTION 'This stage advances automatically after its required checklist is complete'; END IF;
  next_stage := CASE current_stage WHEN 'Insights Shared' THEN 'Meeting Planned' WHEN 'Meeting Planned' THEN 'Quotation Sent' WHEN 'Quotation Sent' THEN 'Converted' ELSE NULL END;
  IF next_stage IS NULL THEN RAISE EXCEPTION 'This company is already converted'; END IF;
  SELECT id INTO comment_id FROM public.company_tracker_comments WHERE tracker_id = _tracker_id AND stage = current_stage AND body = trim(_comment) ORDER BY created_at DESC LIMIT 1;
  IF comment_id IS NULL THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id)
    VALUES (_tracker_id, trim(_comment), current_stage, auth.uid()) RETURNING id INTO comment_id;
  END IF;
  UPDATE public.company_tracker_assignments SET stage = next_stage, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual)
  VALUES (_tracker_id, current_stage, next_stage, auth.uid(), comment_id, _manual);
  RETURN next_stage;
END; $$;

GRANT EXECUTE ON FUNCTION public.company_tracker_assign(UUID, UUID, TEXT), public.company_tracker_complete_issue_resolution(UUID, JSONB), public.company_tracker_transition(UUID, TEXT, BOOLEAN) TO authenticated;
