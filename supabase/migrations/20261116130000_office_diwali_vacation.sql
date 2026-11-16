-- Office Diwali vacation, inclusive of 7 through 14 November 2026.
-- Use the existing holiday policy so attendance and finance agree.
BEGIN;
DO $$
DECLARE
  policy attendance_settings;
  after_policy attendance_settings;
  staff attendance_employees;
  calendar jsonb;
  checked_days integer;
BEGIN
  FOR policy IN
    SELECT s.* FROM attendance_settings s
    WHERE s.effective_from<=date '2026-11-14'
      AND (s.effective_from>=date '2026-11-07' OR s.effective_from=(
        SELECT max(effective_from) FROM attendance_settings WHERE effective_from<=date '2026-11-07'))
    ORDER BY s.effective_from FOR UPDATE
  LOOP
    UPDATE attendance_settings SET holidays=ARRAY(
      SELECT DISTINCT holiday FROM (
        SELECT unnest(coalesce(policy.holidays,'{}'::date[])) holiday
        UNION ALL
        SELECT d::date FROM generate_series(timestamp '2026-11-07',timestamp '2026-11-14',interval '1 day') d
      ) dates ORDER BY holiday),updated_at=clock_timestamp(),updated_by=NULL
      WHERE effective_from=policy.effective_from RETURNING * INTO after_policy;
    INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
      VALUES(NULL,'office_diwali_vacation_configured',NULL,jsonb_build_object(
        'reason','User requested all SimKit office staff off for Diwali vacation, 7–14 November 2026 inclusive.',
        'start_date','2026-11-07','end_date','2026-11-14',
        'before_settings',to_jsonb(policy),'after_settings',to_jsonb(after_policy),
        'source','migration 20261116130000'));
  END LOOP;
  IF NOT FOUND THEN RAISE EXCEPTION 'No attendance policy covers the vacation'; END IF;

  PERFORM set_config('request.jwt.claim.sub','7fc4ff35-5b18-4660-82a4-31db45326f81',true);
  FOR staff IN SELECT * FROM attendance_employees WHERE deleted_at IS NULL AND active LOOP
    calendar:=attendance_team_calendar(staff.id,date '2026-11-01');
    SELECT count(*) INTO checked_days FROM jsonb_array_elements(calendar->'days') d
      WHERE d->>'date' BETWEEN '2026-11-07' AND '2026-11-14'
        AND d->>'status'='off_day' AND (d->>'working_day')::boolean=false;
    IF checked_days<>8 THEN RAISE EXCEPTION 'Vacation calendar verification failed for %: % days',staff.name,checked_days; END IF;
  END LOOP;
END $$;
COMMIT;
