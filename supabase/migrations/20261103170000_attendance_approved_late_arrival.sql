-- Approved late-arrival / half-day requests count as a full on-time day.
-- When an approved request exists for the date AND the employee has a scan,
-- the day is shown as present (green "Late arrival approved" / "Half day
-- approved") with the real scan time, no late minutes and no salary cut.
-- Without a scan the normal rules apply (absent). Days before the tracking
-- start keep their "before tracking start" handling.
BEGIN;

CREATE OR REPLACE FUNCTION public.attendance_apply_approved_arrival(_row jsonb,_employee uuid,_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN a.id IS NOT NULL AND _row->>'entry_at' IS NOT NULL AND _row->>'status' IN ('late','present')
    THEN _row||jsonb_build_object('status','present','late_minutes',0,'arrival_approved',true,
      'arrival_half_day',a.is_half_day,'arrival_expected',a.expected_arrival)
      ||CASE WHEN _row->>'request_status' IS NULL THEN jsonb_build_object(
        'request_type',CASE WHEN a.is_half_day THEN 'half_day' ELSE 'late' END,'request_status','approved',
        'reason',a.reason,'request_reason',a.reason) ELSE '{}'::jsonb END
    ELSE _row END
  FROM (SELECT 1) x LEFT JOIN LATERAL (
    SELECT * FROM attendance_late_requests
    WHERE employee_id=_employee AND arrival_date=_date AND status='approved'
    ORDER BY reviewed_at DESC NULLS LAST LIMIT 1) a ON true
$$;
REVOKE ALL ON FUNCTION public.attendance_apply_approved_arrival(jsonb,uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_apply_approved_arrival(jsonb,uuid,date) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.attendance_my_calendar(_month date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE result jsonb; employee uuid; days jsonb;
BEGIN
  result:=attendance_my_calendar_before_time_guard(_month);
  SELECT id INTO employee FROM attendance_employees WHERE auth_user_id=auth.uid() AND active AND deleted_at IS NULL;
  SELECT coalesce(jsonb_agg(attendance_apply_approved_arrival(attendance_apply_tracking_start(
    CASE WHEN attendance_time_review_required(employee,(r->>'date')::date)
    THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL) ELSE r END
    || attendance_adjustment_details(employee,(r->>'date')::date),(r->>'date')::date),employee,(r->>'date')::date) ORDER BY n),'[]')
    INTO days FROM jsonb_array_elements(result->'days') WITH ORDINALITY a(r,n);
  RETURN jsonb_set(result,'{days}',days)||jsonb_build_object('tracking_start',attendance_tracking_start());
END $function$;

CREATE OR REPLACE FUNCTION public.attendance_board(_date date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE result jsonb; rows jsonb; health jsonb;
BEGIN
  result:=attendance_board_before_time_guard(_date);
  SELECT coalesce(jsonb_agg(attendance_apply_approved_arrival(attendance_apply_tracking_start(
    CASE WHEN attendance_time_review_required((r->>'employee_id')::uuid,_date)
    THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL,'time_review_reason','scan_time_unverified') ELSE r END
    || attendance_adjustment_details((r->>'employee_id')::uuid,_date),_date),(r->>'employee_id')::uuid,_date) ORDER BY n),'[]')
    INTO rows FROM jsonb_array_elements(result->'rows') WITH ORDINALITY a(r,n);
  SELECT coalesce(jsonb_object_agg(component,to_jsonb(h)),'{}') INTO health FROM (
    SELECT DISTINCT ON (component) component,healthy,reason,observed_at FROM attendance_receiver_health_events ORDER BY component,observed_at DESC
  ) h;
  result:=jsonb_set(result,'{rows}',rows);
  result:=jsonb_set(result,'{device}',(result->'device')||jsonb_build_object('connection_health',health));
  result:=result||jsonb_build_object('tracking_start',attendance_tracking_start());
  IF (result#>>'{device,last_heartbeat_at}')::timestamptz<now()-interval '45 seconds'
    THEN result:=jsonb_set(result,'{device,state}','"offline"'); END IF;
  IF (result#>>'{device,state}')='online' AND EXISTS(
    SELECT 1 FROM jsonb_each(health) a WHERE a.key IN ('mqtt','device','supabase') AND (a.value->>'healthy')::boolean=false
  ) THEN result:=jsonb_set(result,'{device,state}','"degraded"'); END IF;
  RETURN result;
END $function$;

-- Same as 20261103160000, plus approved arrivals paid as a full day.
CREATE OR REPLACE FUNCTION public.finance_calendar(_employee uuid, _month date, _overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
  result:=finance_calendar_before_time_guard(_employee,_month,_overrides);
  RETURN (SELECT jsonb_agg(
    CASE
    WHEN (g->>'date')::date<attendance_tracking_start() THEN
      g||jsonb_build_object(
        'status',CASE WHEN g->>'status' IN ('present','late','absent','awaiting_scan','needs_review','not_configured')
          THEN 'needs_review' ELSE g->>'status' END,
        'late_minutes',NULL,'review_reason','before_tracking_start','automatic_units',1,
        'units',CASE WHEN wd AND g->>'status' NOT IN ('scheduled','not_employed') AND _overrides ? (g->>'date')
          THEN _overrides->(g->>'date')->'units' ELSE '1'::jsonb END)
    WHEN g->>'status'='not_employed' THEN g||jsonb_build_object('late_minutes',NULL,'automatic_units',0,'units',0)
    WHEN NOT wd THEN g||jsonb_build_object('late_minutes',NULL,'automatic_units',1,'units',1)
    WHEN g->>'status'='on_leave' OR (g->>'arrival_approved')::boolean IS TRUE THEN
      g||jsonb_build_object('late_minutes',NULL,'automatic_units',1,
        'units',CASE WHEN _overrides ? (g->>'date') THEN _overrides->(g->>'date')->'units' ELSE '1'::jsonb END)
    WHEN g->>'status'<>'late' THEN g||jsonb_build_object('late_minutes',NULL)
    ELSE g END ORDER BY n)
    FROM (SELECT g, n, coalesce((g->>'working_day')::boolean,false) wd FROM (
      SELECT attendance_apply_approved_arrival(CASE WHEN attendance_time_review_required(_employee,(r->>'date')::date)
        THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL,'automatic_units',NULL,
          'units',CASE WHEN coalesce((r->>'working_day')::boolean,false) AND _overrides ? (r->>'date')
            THEN _overrides->(r->>'date')->'units' ELSE 'null'::jsonb END) ELSE r END
        || attendance_adjustment_details(_employee,(r->>'date')::date),_employee,(r->>'date')::date) g, n
      FROM jsonb_array_elements(result) WITH ORDINALITY a(r,n)) y) x);
END $function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
