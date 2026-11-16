-- Requested attendance corrections for Nit Sanghani, November 2026.
-- Keep raw scans and archive the superseded test justification in the audit log.
BEGIN;
DO $$
DECLARE
  employee attendance_employees;
  prior attendance_daily_records;
  justification attendance_late_requests;
  wfh_request_id uuid;
  result jsonb;
  day_row jsonb;
  correction text := 'Administrative correction requested by user: 3 November 2026 present on time at 10:10 AM Asia/Kolkata; supersedes test late justification.';
BEGIN
  SELECT * INTO STRICT employee FROM attendance_employees
    WHERE lower(email)='nitsanghani1@gmail.com' AND deleted_at IS NULL;
  PERFORM pg_advisory_xact_lock(hashtextextended(employee.id::text||'2026-11-03',0));
  SELECT * INTO STRICT prior FROM attendance_daily_records
    WHERE employee_id=employee.id AND work_date=date '2026-11-03' FOR UPDATE;

  -- Only the identified test request is superseded; its full prior state is retained.
  FOR justification IN SELECT * FROM attendance_late_requests
    WHERE id='c2501c03-fe1a-4379-a7ca-154bf4256875'
      AND employee_id=employee.id AND arrival_date=date '2026-11-03'
      AND reason='Test purpose' FOR UPDATE
  LOOP
    INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
      VALUES(NULL,'late_justification_superseded',justification.id,
        jsonb_build_object('employee_id',employee.id,'work_date','2026-11-03',
          'reason',correction,'before_request',to_jsonb(justification),
          'source','migration 20261116120000'));
    DELETE FROM attendance_late_requests WHERE id=justification.id;
  END LOOP;

  UPDATE attendance_daily_records SET entry_at=timestamptz '2026-11-03 10:10:00+05:30',
    late_minutes=0,entry_source='manager_adjusted',adjustment_reason=correction,
    adjusted_by=NULL,adjusted_at=clock_timestamp()
    WHERE id=prior.id;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(NULL,'attendance_day_adjusted',prior.id,jsonb_build_object(
      'employee_id',employee.id,'work_date','2026-11-03','reason',correction,
      'actual_scan_time_verified',false,'late_penalty_waived',true,
      'source','migration 20261116120000','before_daily',to_jsonb(prior),
      'after_daily',(SELECT to_jsonb(r) FROM attendance_daily_records r WHERE r.id=prior.id)));

  IF EXISTS(SELECT 1 FROM attendance_leave_requests r WHERE r.employee_id=employee.id
      AND r.start_date<=date '2026-11-06' AND r.end_date>=date '2026-11-06'
      AND r.status IN ('pending','approved','partial')
      AND NOT (r.request_type='wfh' AND r.start_date=date '2026-11-06' AND r.end_date=date '2026-11-06'))
    THEN RAISE EXCEPTION 'Conflicting request covers 6 November'; END IF;
  SELECT id INTO wfh_request_id FROM attendance_leave_requests
    WHERE employee_id=employee.id AND request_type='wfh'
      AND start_date=date '2026-11-06' AND end_date=date '2026-11-06'
      AND status IN ('pending','approved','partial') LIMIT 1 FOR UPDATE;
  IF wfh_request_id IS NULL THEN
    INSERT INTO attendance_leave_requests(employee_id,sender_email,start_date,end_date,reason,
      source,status,reviewed_at,comment,approver_emails,request_type)
      VALUES(employee.id,employee.email,date '2026-11-06',date '2026-11-06',
        'Work from home approved as requested by user for 6 November 2026.',
        'manual','approved',clock_timestamp(),'Administrative correction requested by user.',
        ARRAY['tarun@limelightit.io'],'wfh') RETURNING id INTO wfh_request_id;
  ELSE
    UPDATE attendance_leave_requests SET status='approved',reviewed_at=clock_timestamp(),
      comment='Administrative correction requested by user.' WHERE id=wfh_request_id;
  END IF;
  INSERT INTO attendance_leave_request_days(request_id,leave_date,status,reviewed_at)
    VALUES(wfh_request_id,date '2026-11-06','approved',clock_timestamp())
    ON CONFLICT(request_id,leave_date) DO UPDATE SET status='approved',reviewed_at=excluded.reviewed_at;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(NULL,'attendance_wfh_administratively_approved',wfh_request_id,jsonb_build_object(
      'employee_id',employee.id,'work_date','2026-11-06','source','migration 20261116120000',
      'reason','Approved WFH requested by user.',
      'after_request',(SELECT to_jsonb(r) FROM attendance_leave_requests r WHERE r.id=wfh_request_id)));

  -- Check the same calendar used by attendance history; failures roll back both edits.
  PERFORM set_config('request.jwt.claim.sub',employee.auth_user_id::text,true);
  result:=attendance_team_calendar(employee.id,date '2026-11-01');
  SELECT r INTO day_row FROM jsonb_array_elements(result->'days') r WHERE r->>'date'='2026-11-03';
  IF day_row IS NULL OR day_row->>'status'<>'present'
      OR (day_row->>'entry_at')::timestamptz<>timestamptz '2026-11-03 10:10:00+05:30'
      OR (day_row->>'late_minutes')::integer<>0 OR day_row ? 'late_justification'
    THEN RAISE EXCEPTION '3 November calendar verification failed: %',day_row; END IF;
  SELECT r INTO day_row FROM jsonb_array_elements(result->'days') r WHERE r->>'date'='2026-11-06';
  IF day_row IS NULL OR day_row->>'status'<>'work_from_home' OR day_row->>'request_status'<>'approved'
    THEN RAISE EXCEPTION '6 November calendar verification failed: %',day_row; END IF;
END $$;
COMMIT;
