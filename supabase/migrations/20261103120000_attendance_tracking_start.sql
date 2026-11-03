-- Attendance tracking officially starts on 2026-10-15 (IST work date).
-- Earlier days are not counted: office/late/absent results before that date are
-- shown as "needs_review" (reason before_tracking_start) with no late minutes.
-- Raw scans, daily records, approved leave/WFH and off days stay untouched.
-- Also records three administratively approved requests.
BEGIN;

CREATE OR REPLACE FUNCTION public.attendance_tracking_start() RETURNS date
LANGUAGE sql IMMUTABLE AS $$ SELECT date '2026-10-15' $$;
GRANT EXECUTE ON FUNCTION public.attendance_tracking_start() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.attendance_apply_tracking_start(_row jsonb,_date date) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _date<attendance_tracking_start()
    AND _row->>'status' IN ('present','late','absent','awaiting_scan','needs_review')
    THEN _row||jsonb_build_object('status','needs_review','late_minutes',NULL,'review_reason','before_tracking_start')
    ELSE _row END
$$;
REVOKE ALL ON FUNCTION public.attendance_apply_tracking_start(jsonb,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_apply_tracking_start(jsonb,date) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.attendance_my_calendar(_month date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE result jsonb; employee uuid; days jsonb;
BEGIN
  result:=attendance_my_calendar_before_time_guard(_month);
  SELECT id INTO employee FROM attendance_employees WHERE auth_user_id=auth.uid() AND active AND deleted_at IS NULL;
  SELECT coalesce(jsonb_agg(attendance_apply_tracking_start(CASE WHEN attendance_time_review_required(employee,(r->>'date')::date)
    THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL) ELSE r END
    || attendance_adjustment_details(employee,(r->>'date')::date),(r->>'date')::date) ORDER BY n),'[]')
    INTO days FROM jsonb_array_elements(result->'days') WITH ORDINALITY a(r,n);
  RETURN jsonb_set(result,'{days}',days)||jsonb_build_object('tracking_start',attendance_tracking_start());
END $function$;

CREATE OR REPLACE FUNCTION public.attendance_board(_date date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE result jsonb; rows jsonb; health jsonb;
BEGIN
  result:=attendance_board_before_time_guard(_date);
  SELECT coalesce(jsonb_agg(attendance_apply_tracking_start(CASE WHEN attendance_time_review_required((r->>'employee_id')::uuid,_date)
    THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL,'time_review_reason','scan_time_unverified') ELSE r END
    || attendance_adjustment_details((r->>'employee_id')::uuid,_date),_date) ORDER BY n),'[]')
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

-- Administratively approved requests (idempotent).
DO $$
DECLARE item record; request uuid; employee uuid;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('nitsanghani1@gmail.com',date '2026-10-17','leave'),
    ('nitsanghani1@gmail.com',date '2026-10-24','wfh'),
    ('kishanvyas308@gmail.com',date '2026-10-23','wfh')
  ) v(email,day,kind) LOOP
    SELECT id INTO employee FROM attendance_employees WHERE lower(email)=item.email AND deleted_at IS NULL;
    IF employee IS NULL THEN RAISE EXCEPTION 'Attendance employee % not found',item.email; END IF;
    IF EXISTS(SELECT 1 FROM attendance_leave_requests WHERE employee_id=employee AND request_type=item.kind
      AND status='approved' AND item.day BETWEEN start_date AND end_date) THEN CONTINUE; END IF;
    INSERT INTO attendance_leave_requests(employee_id,sender_email,start_date,end_date,reason,source,status,reviewed_at,comment,request_type)
      VALUES(employee,item.email,item.day,item.day,
        CASE item.kind WHEN 'wfh' THEN 'Work from home (recorded by administrator)' ELSE 'Leave (recorded by administrator)' END,
        'manual','approved',now(),'Approved administratively',item.kind)
      RETURNING id INTO request;
    INSERT INTO attendance_leave_request_days(request_id,leave_date,status,reviewed_at) VALUES(request,item.day,'approved',now());
    INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
      VALUES(NULL,'leave_request_admin_approved',request,
        jsonb_build_object('employee_id',employee,'date',item.day,'request_type',item.kind,'source','migration 20261103120000'));
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
