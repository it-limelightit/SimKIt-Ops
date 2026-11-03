-- Administrative attendance corrections for Kishan Vyas and Nit Sanghani.
-- Late = minutes after 10:15 IST (10:00 shift + 15 min grace).
--   19 & 26 Oct 2026 -> present on time (entry 10:14 IST, 0 min late)
--   30 Oct 2026      -> 4 min late (entry 10:19 IST)
--   31 Oct 2026      -> 3 min late (entry 10:18 IST)
-- Same provenance as attendance_adjust_day(): entry_source='manager_adjusted',
-- reason + audit log with before/after rows. Raw scan events are untouched,
-- and later scan aggregation will not overwrite manager-adjusted days.
BEGIN;
DO $$
DECLARE item record; prior attendance_daily_records; employee uuid; reason text;
BEGIN
  FOR item IN
    SELECT email, day, entry_time, late
    FROM (VALUES ('kishanvyas308@gmail.com'),('nitsanghani1@gmail.com')) p(email)
    CROSS JOIN (VALUES
      (date '2026-10-19', time '10:14', 0),
      (date '2026-10-26', time '10:14', 0),
      (date '2026-10-30', time '10:19', 4),
      (date '2026-10-31', time '10:18', 3)
    ) d(day, entry_time, late)
  LOOP
    SELECT id INTO employee FROM attendance_employees WHERE lower(email)=item.email AND deleted_at IS NULL;
    SELECT * INTO prior FROM attendance_daily_records WHERE employee_id=employee AND work_date=item.day FOR UPDATE;
    IF prior.id IS NULL THEN RAISE EXCEPTION 'No attendance record for % on %', item.email, item.day; END IF;
    reason := CASE WHEN item.late=0 THEN 'Administrative correction: marked present on time.'
      ELSE format('Administrative correction: late duration set to %s minutes.', item.late) END;
    UPDATE attendance_daily_records SET
      entry_at=(item.day + item.entry_time) AT TIME ZONE 'Asia/Kolkata',
      late_minutes=item.late, entry_source='manager_adjusted', adjustment_reason=reason,
      adjusted_by=NULL, adjusted_at=clock_timestamp()
    WHERE id=prior.id;
    INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
      VALUES(NULL,'attendance_day_adjusted',prior.id,jsonb_build_object(
        'employee_id',employee,'work_date',item.day,'reason',reason,'actual_scan_time_verified',false,
        'late_penalty_waived',item.late=0,'source','migration 20261103150000',
        'before_daily',to_jsonb(prior),
        'after_daily',(SELECT to_jsonb(r) FROM attendance_daily_records r WHERE r.id=prior.id)));
  END LOOP;
END $$;
COMMIT;
