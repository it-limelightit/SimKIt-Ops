-- Monthly salary covers the whole calendar month (Sundays / off days included).
--   daily rate = base salary / days in month
--   payable    = sum of day units over every calendar day
--   salary     = base * payable / days in month
-- Day units (finance_calendar):
--   * off days (not working days)                         -> 1 (paid)
--   * approved leave / approved WFH / on time              -> 1
--   * late                                                 -> 0.5
--   * absent, unpaid                                       -> 0
--   * every day before attendance_tracking_start() (2026-10-15),
--     including days before the joining date              -> 1 (not tracked, paid)
--   * days before joining from the tracking start onwards  -> 0 (pro-rata for new joiners)
-- A manual day override on a working day still wins.
-- Supersedes the finance_calendar body of 20261103140000.
BEGIN;

CREATE OR REPLACE FUNCTION public.finance_calendar(_employee uuid, _month date, _overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
  result:=finance_calendar_before_time_guard(_employee,_month,_overrides);
  RETURN (SELECT jsonb_agg(
    CASE
    -- Before tracking start: never deducted.
    WHEN (g->>'date')::date<attendance_tracking_start() THEN
      g||jsonb_build_object(
        'status',CASE WHEN g->>'status' IN ('present','late','absent','awaiting_scan','needs_review','not_configured')
          THEN 'needs_review' ELSE g->>'status' END,
        'late_minutes',NULL,'review_reason','before_tracking_start','automatic_units',1,
        'units',CASE WHEN wd AND g->>'status' NOT IN ('scheduled','not_employed') AND _overrides ? (g->>'date')
          THEN _overrides->(g->>'date')->'units' ELSE '1'::jsonb END)
    -- New joiners after the tracking start: days before joining are not paid.
    WHEN g->>'status'='not_employed' THEN g||jsonb_build_object('late_minutes',NULL,'automatic_units',0,'units',0)
    -- Off days (Sundays, weekly offs, holidays) are part of the monthly salary.
    WHEN NOT wd THEN g||jsonb_build_object('late_minutes',NULL,'automatic_units',1,'units',1)
    -- Approved leave is paid.
    WHEN g->>'status'='on_leave' THEN g||jsonb_build_object('late_minutes',NULL,'automatic_units',1,
      'units',CASE WHEN _overrides ? (g->>'date') THEN _overrides->(g->>'date')->'units' ELSE '1'::jsonb END)
    WHEN g->>'status'<>'late' THEN g||jsonb_build_object('late_minutes',NULL)
    ELSE g END ORDER BY n)
    FROM (SELECT g, n, coalesce((g->>'working_day')::boolean,false) wd FROM (
      SELECT CASE WHEN attendance_time_review_required(_employee,(r->>'date')::date)
        THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL,'automatic_units',NULL,
          'units',CASE WHEN coalesce((r->>'working_day')::boolean,false) AND _overrides ? (r->>'date')
            THEN _overrides->(r->>'date')->'units' ELSE 'null'::jsonb END) ELSE r END
        || attendance_adjustment_details(_employee,(r->>'date')::date) g, n
      FROM jsonb_array_elements(result) WITH ORDINALITY a(r,n)) y) x);
END $function$;

-- salary_save: divide by calendar days instead of working days.
DO $$ DECLARE definition text;
  old_fragment text := 'SELECT count(*) FILTER(WHERE (d->>''working_day'')::boolean),coalesce(sum((d->>''units'')::numeric),0) INTO working,payable';
BEGIN
  definition := pg_get_functiondef('public.salary_save(uuid,date,numeric,jsonb,integer,text)'::regprocedure);
  IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Unexpected salary_save definition'; END IF;
  EXECUTE replace(definition, old_fragment,
    'SELECT count(*),coalesce(sum((d->>''units'')::numeric),0) INTO working,payable');
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
