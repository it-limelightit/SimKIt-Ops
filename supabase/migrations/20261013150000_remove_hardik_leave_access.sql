BEGIN;

-- Hardik's account keeps its existing supervisor and attendance capabilities.
-- Leave review is separately denied, including direct calls to legacy endpoints.
CREATE OR REPLACE FUNCTION public.attendance_can_review_leave() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND lower(btrim(coalesce(u.email, ''))) <> 'admin@limelightit.io'
      AND (
        public.has_role(u.id, 'supervisor') OR (
          u.email_confirmed_at IS NOT NULL AND lower(u.email) IN (
            'tarun@limelightit.io', 'tarun@limelight.io',
            'associatelimelight@gmail.com', 'info@limelightit.io',
            'kuldeepshrimali.limelight@gmail.com', 'nitsanghani1@gmail.com'
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.attendance_review_leave(
  _request uuid, _decision text, _comment text DEFAULT NULL,
  _employee uuid DEFAULT NULL, _start date DEFAULT NULL, _end date DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r attendance_leave_requests;
BEGIN
  PERFORM attendance_assert_manager();
  IF NOT public.attendance_can_review_leave() THEN
    RAISE EXCEPTION 'Leave review access required' USING ERRCODE = '42501';
  END IF;
  IF _decision NOT IN ('approved', 'rejected', 'cancelled') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO r FROM attendance_leave_requests WHERE id = _request FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF coalesce(cardinality(r.approver_emails), 0) > 0 THEN
    RAISE EXCEPTION 'Review this request in My leave and decide each day';
  END IF;
  IF r.status NOT IN ('pending', 'needs_review') AND NOT (r.status = 'approved' AND _decision = 'cancelled') THEN
    RAISE EXCEPTION 'Request already reviewed';
  END IF;
  r.employee_id := coalesce(_employee, r.employee_id);
  r.start_date := coalesce(_start, r.start_date);
  r.end_date := coalesce(_end, r.end_date);
  IF _decision = 'approved' THEN
    IF r.employee_id IS NULL OR r.start_date IS NULL OR r.end_date IS NULL OR r.end_date < r.start_date THEN
      RAISE EXCEPTION 'Employee and valid dates required for approval';
    END IF;
    PERFORM 1 FROM attendance_employees WHERE id = r.employee_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
    IF EXISTS (
      SELECT 1 FROM attendance_leave_requests WHERE id <> r.id AND employee_id = r.employee_id
        AND status = 'approved' AND start_date <= r.end_date AND end_date >= r.start_date
    ) THEN RAISE EXCEPTION 'Approved leave already covers these dates'; END IF;
  END IF;
  UPDATE attendance_leave_requests
    SET employee_id = r.employee_id, start_date = r.start_date, end_date = r.end_date,
      status = _decision, reviewed_by = auth.uid(), reviewed_at = now(), comment = left(_comment, 1000)
    WHERE id = _request;
  INSERT INTO attendance_audit_logs(actor_id, action, record_id, details)
    VALUES(auth.uid(), 'leave_reviewed', _request, jsonb_build_object('decision', _decision, 'comment', left(_comment, 1000)));
END $$;

REVOKE ALL ON FUNCTION public.attendance_can_review_leave(), public.attendance_review_leave(uuid, text, text, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_can_review_leave(), public.attendance_review_leave(uuid, text, text, uuid, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
