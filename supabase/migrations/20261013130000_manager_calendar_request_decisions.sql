-- Add per-day request decisions to manager calendar rows; attendance classification is unchanged.
BEGIN;
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
      WHEN p.effective_from IS NULL OR p.absence_cutoff IS NULL THEN 'needs_review'
      WHEN NOT extract(dow FROM _date)::integer=ANY(p.working_days) OR _date=ANY(p.holidays) THEN 'off_day'
      WHEN now()<((_date+p.absence_cutoff) AT TIME ZONE 'Asia/Kolkata') THEN 'awaiting_scan'
      WHEN h.work_date IS NOT NULL AND NOT h.gap_detected AND h.last_heartbeat_at>=((_date+p.absence_cutoff) AT TIME ZONE 'Asia/Kolkata') THEN 'absent'
      ELSE 'needs_review' END) ORDER BY coalesce(r.employee_name,e.name)),'[]') FROM attendance_employees e
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
      LEFT JOIN attendance_device_health h ON h.work_date=_date
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
NOTIFY pgrst, 'reload schema';
COMMIT;
