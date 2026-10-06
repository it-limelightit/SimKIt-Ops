BEGIN;

-- Follow-up visits resolve issues at assigned companies, including commissioned ones, without reopening phases
-- or creating payroll entries. Existing visits and phase scheduling are unchanged.
ALTER TABLE public.field_visit_schedules
  DROP CONSTRAINT field_visit_schedules_visit_type_check;
ALTER TABLE public.field_visit_schedules
  ADD CONSTRAINT field_visit_schedules_visit_type_check
  CHECK (visit_type IN ('assessment', 'installation', 'commissioning', 'follow_up'));

CREATE FUNCTION public.field_ops_schedule_follow_up(
  _site UUID, _associate UUID, _date DATE, _shift TEXT,
  _arrival TIME, _end TIME, _priority TEXT, _note TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result UUID; s public.sites;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Manager access required';
  END IF;
  SELECT * INTO s FROM sites WHERE id = _site;
  IF s.id IS NULL OR NOT public.field_ops_associate(_associate) THEN
    RAISE EXCEPTION 'Select a company and active field associate';
  END IF;
  IF NOT coalesce(_associate = ANY(public.field_ops_worker_ids(s)), false) THEN
    RAISE EXCEPTION 'Company is not assigned to this associate';
  END IF;
  IF NOT public.field_ops_site_active(s) THEN
    RAISE EXCEPTION 'Dropped or rejected companies cannot be scheduled';
  END IF;
  IF _date IS NULL OR _date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Select today or a future date';
  END IF;
  IF _shift IS NULL OR _shift NOT IN
    ('10:00-12:00','12:00-14:00','14:00-16:00','16:00-18:00','18:00-20:00')
    OR _arrival IS NULL OR _end IS NULL OR _end <= _arrival THEN
    RAISE EXCEPTION 'Select a shift and arrival/end times; end must follow arrival';
  END IF;
  IF _priority IS NULL OR _priority NOT IN ('normal','high','emergency') THEN
    RAISE EXCEPTION 'Select a valid priority';
  END IF;
  IF coalesce(trim(_note), '') = '' THEN
    RAISE EXCEPTION 'Describe the issue or reason for this follow-up visit';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text || _date::text, 0));
  IF EXISTS (SELECT 1 FROM field_visit_schedules WHERE site_id = _site
    AND assignee_id = _associate AND visit_type = 'follow_up'
    AND scheduled_for = _date AND status <> 'completed') THEN
    RAISE EXCEPTION 'This company follow-up is already scheduled for this day';
  END IF;
  IF EXISTS (SELECT 1 FROM field_visit_schedules WHERE assignee_id = _associate
    AND scheduled_for = _date AND status <> 'completed'
    AND expected_arrival < _end AND expected_end > _arrival) THEN
    RAISE EXCEPTION 'Arrival/end times overlap another visit';
  END IF;
  INSERT INTO field_visit_schedules
    (site_id, assignee_id, visit_type, scheduled_for, shift, expected_arrival,
     expected_end, priority, note, created_by)
    VALUES (_site, _associate, 'follow_up', _date, _shift, _arrival,
      _end, _priority, trim(_note), auth.uid()) RETURNING id INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.field_ops_schedule_follow_up(UUID,UUID,DATE,TEXT,TIME,TIME,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_ops_schedule_follow_up(UUID,UUID,DATE,TEXT,TIME,TIME,TEXT,TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.field_ops_visit_completion_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status='completed' AND OLD.status <> 'completed'
    AND NEW.visit_type <> 'follow_up' AND public.field_ops_associate(NEW.assignee_id)
    AND NOT public.field_ops_phase_ready(NEW.site_id,NEW.visit_type) THEN
    RAISE EXCEPTION 'Complete all required phase work and approval before completing this visit';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.field_ops_complete_visit(_visit UUID, _delayed BOOLEAN DEFAULT false, _reason TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.field_visit_schedules; s public.sites;
BEGIN
  SELECT * INTO v FROM field_visit_schedules WHERE id=_visit FOR UPDATE;
  SELECT * INTO s FROM sites WHERE id=v.site_id;
  IF v.id IS NULL OR s.id IS NULL OR auth.uid() IS NULL OR NOT public.field_ops_associate(auth.uid()) OR NOT coalesce(auth.uid() = ANY(public.field_ops_worker_ids(s)),false)
    OR NOT coalesce(v.assignee_id = ANY(public.field_ops_worker_ids(s)),false) THEN RAISE EXCEPTION 'Visit not found or access denied'; END IF;
  IF NOT coalesce((SELECT online FROM field_attendance_events WHERE associate_id=auth.uid() AND work_date=(now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY occurred_at DESC LIMIT 1),false) THEN RAISE EXCEPTION 'Mark online first'; END IF;
  IF v.status = 'completed' THEN RETURN; END IF;
  IF _delayed THEN
    IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A delay reason is required'; END IF;
    UPDATE field_visit_schedules SET status='delayed',delay_reason=trim(_reason),updated_at=now() WHERE id=_visit;
  ELSE
    IF v.visit_type <> 'follow_up' AND NOT public.field_ops_phase_ready(v.site_id,v.visit_type) THEN RAISE EXCEPTION 'Complete all required phase work and approval before completing this visit'; END IF;
    UPDATE field_visit_schedules SET status='completed',completed_at=now(),updated_at=now(),delay_reason=NULL WHERE id=_visit;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
