-- nitsanghani1@gmail.com: the two administratively recorded requests (Leave
-- 17 Oct 2026, WFH 24 Oct 2026) show request date 3 Nov (when entered). Set
-- each request date — and its approval time — to the day before the requested
-- date, 10:00 IST. Idempotent.
BEGIN;
DO $$
DECLARE r record; stamp timestamptz;
BEGIN
  FOR r IN
    SELECT l.* FROM attendance_leave_requests l JOIN attendance_employees e ON e.id=l.employee_id
    WHERE lower(e.email)='nitsanghani1@gmail.com' AND l.status='approved'
      AND l.comment='Approved administratively'
      AND (l.request_type, l.start_date) IN (('leave', date '2026-10-17'), ('wfh', date '2026-10-24'))
  LOOP
    stamp := ((r.start_date - 1) + time '10:00') AT TIME ZONE 'Asia/Kolkata';
    CONTINUE WHEN r.created_at = stamp;
    UPDATE attendance_leave_requests SET created_at=stamp, reviewed_at=stamp WHERE id=r.id;
    UPDATE attendance_leave_request_days SET reviewed_at=stamp WHERE request_id=r.id;
    INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
      VALUES(NULL,'leave_request_date_corrected',r.id,jsonb_build_object(
        'employee_email','nitsanghani1@gmail.com','request_type',r.request_type,'requested_date',r.start_date,
        'request_date_before',r.created_at,'request_date_after',stamp,'source','migration 20261104180000'));
  END LOOP;
END $$;
COMMIT;
