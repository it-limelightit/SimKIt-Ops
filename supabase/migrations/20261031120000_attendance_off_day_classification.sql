-- Classify configured weekly off days and holidays before recorded arrivals.
-- Apply the policy effective on each date, including historical dates. Keep raw
-- scans and daily records intact; off-day lateness is suppressed in read results.
-- Patch the private classifiers so time-review guards, manager adjustments,
-- access checks and device health reporting remain in place.
BEGIN;

DO $$
DECLARE
  target record;
  definition text;
  off_condition text;
  status_fragment text := '''status'',CASE';
  late_fragment text := '''late_minutes'',r.late_minutes';
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('public.attendance_board_before_time_guard(date)', '_date'),
    ('public.attendance_my_calendar_before_time_guard(date)', 'd.work_date')
  ) AS classifiers(signature, date_expression) LOOP
    definition := pg_get_functiondef(target.signature::regprocedure);
    IF position(status_fragment IN definition) = 0
      OR position(late_fragment IN definition) = 0 THEN
      RAISE EXCEPTION 'Unexpected attendance classifier definition: %', target.signature;
    END IF;

    off_condition := format(
      'p.effective_from IS NOT NULL AND (NOT extract(dow FROM %s)::integer=ANY(p.working_days) OR %s=ANY(p.holidays))',
      target.date_expression, target.date_expression
    );
    -- Dates before employment retain their existing calendar classification.
    IF target.date_expression = 'd.work_date' THEN
      off_condition := 'd.work_date>=employee.employment_start AND (' || off_condition || ')';
    END IF;

    definition := replace(definition, status_fragment,
      status_fragment || E'\n    WHEN ' || off_condition || ' THEN ''off_day''');
    definition := replace(definition, late_fragment,
      '''late_minutes'',CASE WHEN ' || off_condition || ' THEN NULL ELSE r.late_minutes END');
    EXECUTE definition;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
