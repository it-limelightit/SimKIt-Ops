-- Allow an administrative attendance day without a face scan, and mark
-- mayankk.limelightit@gmail.com present on time on Saturday 2026-10-31.
-- No scan exists for that day, so no scan event is fabricated: the daily
-- record has first_event_id NULL, entry_source='manager_adjusted', entry at
-- the 10:00 IST shift start (0 min late), and an audit log entry.
-- Later scans will not overwrite a manager-adjusted day.
BEGIN;
ALTER TABLE public.attendance_daily_records ALTER COLUMN first_event_id DROP NOT NULL;

DO $$
DECLARE e attendance_employees; p attendance_settings; prior attendance_daily_records; record uuid;
  day date := date '2026-10-31';
  reason text := 'Administrative correction: marked present on time (no face scan recorded).';
BEGIN
  SELECT * INTO e FROM attendance_employees WHERE lower(email)='mayankk.limelightit@gmail.com' AND deleted_at IS NULL;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Attendance employee not found'; END IF;
  SELECT * INTO p FROM attendance_settings WHERE effective_from<=day ORDER BY effective_from DESC LIMIT 1;
  SELECT * INTO prior FROM attendance_daily_records WHERE employee_id=e.id AND work_date=day FOR UPDATE;
  INSERT INTO attendance_daily_records(employee_id,work_date,first_event_id,entry_at,employee_name,department,
      policy_snapshot,late_minutes,entry_source,adjustment_reason,adjusted_by,adjusted_at)
    VALUES(e.id,day,NULL,(day + p.shift_start) AT TIME ZONE 'Asia/Kolkata',e.name,e.department,
      to_jsonb(p),0,'manager_adjusted',reason,NULL,clock_timestamp())
    ON CONFLICT(employee_id,work_date) DO UPDATE SET entry_at=excluded.entry_at,late_minutes=0,
      entry_source='manager_adjusted',adjustment_reason=excluded.adjustment_reason,adjusted_at=excluded.adjusted_at
    RETURNING id INTO record;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(NULL,'attendance_day_adjusted',record,jsonb_build_object(
      'employee_id',e.id,'work_date',day,'reason',reason,'face_scan_recorded',false,
      'late_penalty_waived',true,'source','migration 20261103180000',
      'before_daily',to_jsonb(prior),
      'after_daily',(SELECT to_jsonb(r) FROM attendance_daily_records r WHERE r.id=record)));
END $$;
COMMIT;
