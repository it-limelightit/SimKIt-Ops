-- Salary calendar:
--  * Approved leave is paid (no deduction): automatic_units=1 unless overridden.
--  * Late minutes are shown only on late working days from the tracking start;
--    off days, days before joining and days before 2026-10-15 carry no lateness.
-- Keeps the tracking-start and scan-time-review behaviour from earlier migrations.
BEGIN;

CREATE OR REPLACE FUNCTION public.finance_calendar(_employee uuid, _month date, _overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
  result:=finance_calendar_before_time_guard(_employee,_month,_overrides);
  RETURN (SELECT jsonb_agg(
    CASE
    WHEN (g->>'date')::date<attendance_tracking_start()
      AND g->>'status' IN ('present','late','absent','awaiting_scan','needs_review','not_configured')
    THEN g||jsonb_build_object('status','needs_review','late_minutes',NULL,'review_reason','before_tracking_start',
      -- Non-working / unconfigured days before tracking are 0 (not unresolved), so they
      -- never block salary approval; they are excluded from working days anyway.
      'automatic_units',CASE WHEN coalesce((g->>'working_day')::boolean,false) THEN 1 ELSE 0 END,
      'units',CASE WHEN NOT coalesce((g->>'working_day')::boolean,false) THEN '0'::jsonb
        WHEN _overrides ? (g->>'date') THEN _overrides->(g->>'date')->'units' ELSE '1'::jsonb END)
    WHEN g->>'status'='on_leave' AND coalesce((g->>'working_day')::boolean,false)
    THEN g||jsonb_build_object('automatic_units',1,
      'units',CASE WHEN _overrides ? (g->>'date') THEN _overrides->(g->>'date')->'units' ELSE '1'::jsonb END)
    WHEN g->>'status'<>'late' OR (g->>'date')::date<attendance_tracking_start()
    THEN g||jsonb_build_object('late_minutes',NULL)
    ELSE g END ORDER BY n)
    FROM (SELECT CASE WHEN attendance_time_review_required(_employee,(r->>'date')::date)
      THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL,'automatic_units',NULL,
        'units',CASE WHEN coalesce((r->>'working_day')::boolean,false) AND _overrides ? (r->>'date')
          THEN _overrides->(r->>'date')->'units' ELSE 'null'::jsonb END) ELSE r END
      || attendance_adjustment_details(_employee,(r->>'date')::date) g, n
      FROM jsonb_array_elements(result) WITH ORDINALITY a(r,n)) x);
END $function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
