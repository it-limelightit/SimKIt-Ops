-- Classify absence only after the entire IST working date has ended without a valid scan.
-- Keep leave/WFH decisions, scan evidence, late minutes, history and access controls intact.
BEGIN;
-- Keep the existing RPC signature and nullable legacy column for older clients.
-- Cutoff values supplied by older clients no longer control absence classification.
CREATE OR REPLACE FUNCTION public.attendance_save_settings(_start time,_grace integer,_cutoff time,_days integer[],_holidays date[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
  PERFORM attendance_assert_manager();
  IF _start IS NULL OR _grace IS NULL OR _days IS NULL THEN RAISE EXCEPTION 'Complete office timing and working days required'; END IF;
  INSERT INTO attendance_settings(effective_from,shift_start,grace_minutes,absence_cutoff,working_days,holidays,updated_by,updated_at)
    VALUES((now() AT TIME ZONE 'Asia/Kolkata')::date,_start,_grace,NULL,_days,coalesce(_holidays,'{}'),auth.uid(),now())
    ON CONFLICT(effective_from) DO UPDATE SET shift_start=excluded.shift_start,grace_minutes=excluded.grace_minutes,absence_cutoff=NULL,working_days=excluded.working_days,holidays=excluded.holidays,updated_by=auth.uid(),updated_at=now();
  INSERT INTO attendance_audit_logs(actor_id,action,details) VALUES(auth.uid(),'settings_saved',jsonb_build_object('start',_start,'grace',_grace,'absence_policy','full_working_day','days',_days,'holidays',_holidays));
END $$;

CREATE OR REPLACE FUNCTION public.attendance_board(_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$ DECLARE result jsonb; p attendance_settings; BEGIN
  PERFORM attendance_assert_manager();
  IF _date IS NULL THEN RAISE EXCEPTION 'Date required'; END IF;
  SELECT * INTO p FROM attendance_settings WHERE effective_from<=_date ORDER BY effective_from DESC LIMIT 1;
  SELECT jsonb_build_object(
    'settings',(SELECT to_jsonb(s) FROM attendance_settings s ORDER BY effective_from DESC LIMIT 1),
    'device',(SELECT to_jsonb(d)||jsonb_build_object('state',CASE WHEN last_heartbeat_at IS NULL THEN 'unknown' WHEN last_heartbeat_at<now()-interval '5 minutes' THEN 'offline' ELSE 'online' END) FROM attendance_devices d WHERE id='office'),
    'employees',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.name),'[]') FROM attendance_employees e WHERE e.deleted_at IS NULL),
    'rows',(SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id',e.id,'name',coalesce(r.employee_name,e.name),'department',coalesce(r.department,e.department),'enroll_id',e.enroll_id,'entry_at',r.entry_at,'late_minutes',r.late_minutes,'event_id',r.first_event_id,'photo_expires_at',ph.expires_at,'photo_status',ph.status,'leave_conflict',r.id IS NOT NULL AND l.id IS NOT NULL,'request_type',req.request_type,'request_status',req.day_status,'request_reason',req.reason,'status',CASE
      WHEN r.id IS NOT NULL AND l.kind='leave' THEN 'needs_review'
      WHEN r.id IS NOT NULL AND r.late_minutes IS NULL THEN 'needs_review'
      WHEN r.id IS NOT NULL AND r.late_minutes>0 THEN 'late'
      WHEN r.id IS NOT NULL THEN 'present'
      WHEN l.kind='leave' THEN 'on_leave'
      WHEN l.kind='wfh' THEN 'work_from_home'
      WHEN p.effective_from IS NULL THEN 'needs_review'
      WHEN NOT extract(dow FROM _date)::integer=ANY(p.working_days) OR _date=ANY(p.holidays) THEN 'off_day'
      WHEN _date >= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'awaiting_scan'
      ELSE 'absent' END) ORDER BY coalesce(r.employee_name,e.name)),'[]') FROM attendance_employees e
      LEFT JOIN attendance_daily_records r ON r.employee_id=e.id AND r.work_date=_date
      LEFT JOIN attendance_photos ph ON ph.event_id=r.first_event_id
      LEFT JOIN LATERAL(SELECT q.id,CASE WHEN coalesce(q.request_type,'leave')='wfh' THEN 'wfh' ELSE 'leave' END kind
        FROM attendance_leave_requests q WHERE q.employee_id=e.id AND q.status IN ('approved','partial')
        AND _date BETWEEN q.start_date AND q.end_date AND (NOT EXISTS(SELECT 1 FROM attendance_leave_request_days d WHERE d.request_id=q.id)
          OR EXISTS(SELECT 1 FROM attendance_leave_request_days d WHERE d.request_id=q.id AND d.leave_date=_date AND d.status='approved')) LIMIT 1) l ON true
      LEFT JOIN LATERAL (
        SELECT coalesce(q.request_type,'leave') request_type,q.reason,
          coalesce(x.status,CASE WHEN q.status='partial' THEN 'pending' ELSE q.status END) day_status
        FROM attendance_leave_requests q LEFT JOIN attendance_leave_request_days x ON x.request_id=q.id AND x.leave_date=_date
        WHERE q.employee_id=e.id AND _date BETWEEN q.start_date AND q.end_date AND q.status IN ('pending','approved','partial','rejected')
        ORDER BY CASE coalesce(x.status,q.status) WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,q.created_at DESC LIMIT 1
      ) req ON true
      WHERE r.id IS NOT NULL OR (e.employment_start<=_date AND (e.deactivated_at IS NULL OR (e.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date>=_date))),
    'leaves',(SELECT coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('employee_name',e.name,'days',coalesce(x.days,'[]'::jsonb)) ORDER BY l.created_at DESC),'[]')
      FROM (SELECT * FROM attendance_leave_requests WHERE status <> 'rejected' OR reviewed_at IS NULL OR reviewed_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 200) l
      LEFT JOIN attendance_employees e ON e.id=l.employee_id LEFT JOIN LATERAL(
        SELECT jsonb_agg(jsonb_build_object('leave_date',d.leave_date,'status',d.status) ORDER BY d.leave_date) days
        FROM attendance_leave_request_days d WHERE d.request_id=l.id) x ON true),
    'review_events',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.received_at DESC),'[]') FROM (SELECT * FROM attendance_scan_events WHERE work_date=_date AND validation_state<>'valid' ORDER BY received_at DESC LIMIT 100) s),
    'server_time',now()
  ) INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.attendance_my_calendar(_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE employee attendance_employees; first_day date; last_day date; today date;
BEGIN
 IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'employee') AND NOT public.has_role(auth.uid(),'supervisor')) THEN
  RAISE EXCEPTION 'Office employee access required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO employee FROM attendance_employees WHERE auth_user_id=auth.uid() AND active AND deleted_at IS NULL;
 IF employee.id IS NULL THEN RAISE EXCEPTION 'Active office account is not linked'; END IF;
 IF _month IS NULL OR _month < date '2000-01-01' OR _month > date '2100-12-31' THEN RAISE EXCEPTION 'Choose a valid calendar month'; END IF;
 first_day := date_trunc('month',_month)::date;
 last_day := (first_day+interval '1 month'-interval '1 day')::date;
 today := (now() AT TIME ZONE 'Asia/Kolkata')::date;
 RETURN jsonb_build_object('month',first_day,'today',today,'days',(
  SELECT jsonb_agg(jsonb_build_object(
   'date',d.work_date,'entry_at',r.entry_at,'late_minutes',r.late_minutes,
   'working_day',CASE WHEN d.work_date<employee.employment_start THEN false WHEN p.effective_from IS NULL THEN NULL ELSE extract(dow FROM d.work_date)::integer=ANY(p.working_days) AND NOT d.work_date=ANY(p.holidays) END,
   'request_type',q.request_type,'request_status',q.day_status,'reason',q.reason,
   'status',CASE
    WHEN r.id IS NOT NULL AND q.day_status='approved' AND q.request_type='leave' THEN 'needs_review'
    WHEN r.id IS NOT NULL AND r.late_minutes IS NULL THEN 'needs_review'
    WHEN r.id IS NOT NULL AND r.late_minutes>0 THEN 'late'
    WHEN r.id IS NOT NULL THEN 'present'
    WHEN d.work_date<employee.employment_start THEN 'not_employed'
    WHEN q.day_status='approved' AND q.request_type='wfh' THEN 'work_from_home'
    WHEN q.day_status='approved' THEN 'on_leave'
    WHEN p.effective_from IS NULL THEN 'not_configured'
    WHEN NOT extract(dow FROM d.work_date)::integer=ANY(p.working_days) OR d.work_date=ANY(p.holidays) THEN 'off_day'
    WHEN d.work_date>today THEN 'scheduled'
    WHEN d.work_date=today THEN 'awaiting_scan'
    ELSE 'absent' END
  ) ORDER BY d.work_date)
  FROM (SELECT day::date work_date FROM generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') day) d
  LEFT JOIN LATERAL (SELECT * FROM attendance_settings WHERE effective_from<=d.work_date ORDER BY effective_from DESC LIMIT 1) p ON true
  LEFT JOIN attendance_daily_records r ON r.employee_id=employee.id AND r.work_date=d.work_date
  LEFT JOIN LATERAL (
   SELECT coalesce(l.request_type,'leave') request_type,l.reason,
    coalesce(x.status,CASE WHEN l.status='partial' THEN 'pending' ELSE l.status END) day_status
   FROM attendance_leave_requests l LEFT JOIN attendance_leave_request_days x ON x.request_id=l.id AND x.leave_date=d.work_date
   WHERE l.employee_id=employee.id AND d.work_date BETWEEN l.start_date AND l.end_date AND l.status IN ('pending','approved','partial','rejected')
   ORDER BY CASE coalesce(x.status,l.status) WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,l.created_at DESC LIMIT 1
  ) q ON true
 ));
END $$;
REVOKE ALL ON FUNCTION public.attendance_my_calendar(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_my_calendar(date) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
