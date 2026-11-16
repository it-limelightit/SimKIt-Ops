-- Requested administrative correction; raw device scans remain intact.
BEGIN;
DO $$
DECLARE
  employee attendance_employees;
  prior attendance_daily_records;
  day_row jsonb;
  reason text := 'Administrative correction requested by user: 3 November 2026 present on time at 10:11 AM Asia/Kolkata.';
BEGIN
  SELECT * INTO STRICT employee FROM attendance_employees
    WHERE lower(email)='kishanvyas308@gmail.com' AND deleted_at IS NULL;
  PERFORM pg_advisory_xact_lock(hashtextextended(employee.id::text||'2026-11-03',0));
  SELECT * INTO STRICT prior FROM attendance_daily_records
    WHERE employee_id=employee.id AND work_date=date '2026-11-03' FOR UPDATE;
  UPDATE attendance_daily_records SET entry_at=timestamptz '2026-11-03 10:11:00+05:30',
    late_minutes=0,entry_source='manager_adjusted',adjustment_reason=reason,
    adjusted_by=NULL,adjusted_at=clock_timestamp() WHERE id=prior.id;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(NULL,'attendance_day_adjusted',prior.id,jsonb_build_object(
      'employee_id',employee.id,'work_date','2026-11-03','reason',reason,
      'actual_scan_time_verified',false,'late_penalty_waived',true,
      'source','migration 20261116140000','before_daily',to_jsonb(prior),
      'after_daily',(SELECT to_jsonb(r) FROM attendance_daily_records r WHERE r.id=prior.id)));
  PERFORM set_config('request.jwt.claim.sub','7fc4ff35-5b18-4660-82a4-31db45326f81',true);
  SELECT d INTO day_row FROM jsonb_array_elements(attendance_team_calendar(employee.id,date '2026-11-01')->'days') d
    WHERE d->>'date'='2026-11-03';
  IF day_row IS NULL OR day_row->>'status'<>'present'
      OR (day_row->>'entry_at')::timestamptz<>timestamptz '2026-11-03 10:11:00+05:30'
      OR (day_row->>'late_minutes')::integer IS DISTINCT FROM 0
    THEN RAISE EXCEPTION 'Calendar verification failed: %',day_row; END IF;
END $$;
COMMIT;
