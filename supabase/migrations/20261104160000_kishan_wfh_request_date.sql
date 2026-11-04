-- kishanvyas308@gmail.com: the administratively recorded WFH for 23 Oct 2026
-- shows its request date as 3 Nov (when it was entered). Set the request date
-- (and its approval time) to 22 Oct 2026. Idempotent.
BEGIN;
DO $$
DECLARE r attendance_leave_requests; stamp timestamptz := timestamptz '2026-10-22 10:00+05:30';
BEGIN
  SELECT l.* INTO r FROM attendance_leave_requests l JOIN attendance_employees e ON e.id=l.employee_id
  WHERE lower(e.email)='kishanvyas308@gmail.com' AND l.request_type='wfh'
    AND l.start_date=date '2026-10-23' AND l.end_date=date '2026-10-23' AND l.status='approved'
  ORDER BY l.created_at DESC LIMIT 1;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Kishan''s 23 Oct WFH request not found'; END IF;
  IF r.created_at = stamp THEN RETURN; END IF;
  UPDATE attendance_leave_requests SET created_at=stamp, reviewed_at=stamp WHERE id=r.id;
  UPDATE attendance_leave_request_days SET reviewed_at=stamp WHERE request_id=r.id;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(NULL,'leave_request_date_corrected',r.id,jsonb_build_object(
      'employee_email','kishanvyas308@gmail.com','request_date_before',r.created_at,'request_date_after',stamp,
      'source','migration 20261104160000'));
END $$;
COMMIT;
