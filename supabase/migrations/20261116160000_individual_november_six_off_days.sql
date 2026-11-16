-- Individual off days must not change the whole office holiday policy.
BEGIN;
CREATE TABLE public.attendance_employee_off_days (
  employee_id uuid NOT NULL REFERENCES public.attendance_employees(id),
  work_date date NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(employee_id,work_date)
);
ALTER TABLE public.attendance_employee_off_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_employee_off_days FROM PUBLIC,anon,authenticated;

-- All public attendance calendars, the daily board, and finance use this helper.
-- Keep approved WFH requests as history; the individual off day takes precedence.
DO $$
DECLARE definition text; fragment text := 'SELECT CASE';
BEGIN
  definition:=pg_get_functiondef('public.attendance_apply_approved_arrival(jsonb,uuid,date)'::regprocedure);
  IF position(fragment IN definition)=0 THEN RAISE EXCEPTION 'Unexpected attendance classifier definition'; END IF;
  EXECUTE replace(definition,fragment,fragment||E'\n'
    ||'    WHEN EXISTS(SELECT 1 FROM attendance_employee_off_days o WHERE o.employee_id=_employee AND o.work_date=_date)'
    ||E'\n    THEN (_row - ''late_justification'') || jsonb_build_object('
    ||'''status'',''off_day'',''working_day'',false,''late_minutes'',NULL,''leave_conflict'',false,'
    ||'''request_type'',NULL,''request_status'',NULL,''request_reason'',NULL,''arrival_approved'',false,'
    ||'''time_review_reason'',NULL,''review_reason'',NULL,''reason'',(SELECT reason FROM attendance_employee_off_days o WHERE o.employee_id=_employee AND o.work_date=_date))');
END $$;

DO $$
DECLARE employee attendance_employees; before_rows jsonb; day_row jsonb; office_before jsonb; office_after jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','7fc4ff35-5b18-4660-82a4-31db45326f81',true);
  SELECT jsonb_agg(r ORDER BY r->>'employee_id') INTO office_before
    FROM jsonb_array_elements(attendance_board(date '2026-11-06')->'rows') r
    WHERE r->>'employee_id' NOT IN ('0d6be561-e9cc-4f53-a158-868929d8db72','1196d266-b9cb-418f-a0cf-735264ca39b4');
  IF (SELECT count(*) FROM attendance_employees WHERE email IN ('nitsanghani1@gmail.com','kishanvyas308@gmail.com') AND deleted_at IS NULL)<>2
    THEN RAISE EXCEPTION 'Expected both employee accounts'; END IF;
  FOR employee IN SELECT * FROM attendance_employees WHERE email IN ('nitsanghani1@gmail.com','kishanvyas308@gmail.com') AND deleted_at IS NULL LOOP
    SELECT r INTO day_row FROM jsonb_array_elements(attendance_team_calendar(employee.id,date '2026-11-01')->'days') r WHERE r->>'date'='2026-11-06';
    before_rows:=day_row;
    INSERT INTO attendance_employee_off_days(employee_id,work_date,reason)
      VALUES(employee.id,date '2026-11-06','Individual off day on 6 November 2026, as requested by user.');
    INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
      VALUES(NULL,'individual_off_day_assigned',employee.id,jsonb_build_object(
        'employee_id',employee.id,'work_date','2026-11-06','source','migration 20261116160000',
        'reason','User requested off day instead of WFH for this date.','before_calendar',before_rows));
    SELECT r INTO day_row FROM jsonb_array_elements(attendance_team_calendar(employee.id,date '2026-11-01')->'days') r WHERE r->>'date'='2026-11-06';
    IF day_row->>'status' IS DISTINCT FROM 'off_day' OR (day_row->>'working_day')::boolean IS DISTINCT FROM false
      OR day_row->>'request_status' IS NOT NULL THEN RAISE EXCEPTION 'Off day verification failed for %: %',employee.email,day_row; END IF;
  END LOOP;
  SELECT jsonb_agg(r ORDER BY r->>'employee_id') INTO office_after
    FROM jsonb_array_elements(attendance_board(date '2026-11-06')->'rows') r
    WHERE r->>'employee_id' NOT IN ('0d6be561-e9cc-4f53-a158-868929d8db72','1196d266-b9cb-418f-a0cf-735264ca39b4');
  IF office_before IS DISTINCT FROM office_after THEN RAISE EXCEPTION 'Other employees changed unexpectedly'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(attendance_board(date '2026-11-06')->'rows') r
    WHERE r->>'employee_id' IN ('0d6be561-e9cc-4f53-a158-868929d8db72','1196d266-b9cb-418f-a0cf-735264ca39b4') AND r->>'status'<>'off_day')
    THEN RAISE EXCEPTION 'Daily board verification failed'; END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
