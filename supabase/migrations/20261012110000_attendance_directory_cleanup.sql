-- Remove employees from the directory without destroying attendance evidence.
BEGIN;
ALTER TABLE public.attendance_employees ADD COLUMN deleted_at timestamptz;

CREATE FUNCTION public.attendance_delete_employee(_employee uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM attendance_assert_manager();
  PERFORM 1 FROM attendance_employees WHERE id=_employee AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  UPDATE attendance_employees SET active=false, deleted_at=clock_timestamp(),
    deactivated_at=coalesce(deactivated_at,clock_timestamp()) WHERE id=_employee;
  UPDATE attendance_device_commands SET status='failed',error='Employee deleted',lease_token=NULL,lease_until=NULL
    WHERE employee_id=_employee AND status IN ('pending','publishing','published');
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(auth.uid(),'employee_deleted',_employee,jsonb_build_object('device_sync',false));
END $$;
REVOKE ALL ON FUNCTION public.attendance_delete_employee(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_delete_employee(uuid) TO authenticated;

-- Deleted employees cannot be reactivated by an older client.
CREATE FUNCTION public.attendance_guard_deleted_employee() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND (NEW.active OR NEW.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Deleted employees cannot be reactivated';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_guard_deleted_employee BEFORE UPDATE ON public.attendance_employees
FOR EACH ROW EXECUTE FUNCTION public.attendance_guard_deleted_employee();

-- Apply expiry before the limit so old rejections do not crowd out other requests.
-- Historical attendance rows remain available for deleted employees.
CREATE OR REPLACE FUNCTION public.attendance_board(_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$ DECLARE result jsonb; p attendance_settings; BEGIN
  PERFORM attendance_assert_manager();
  IF _date IS NULL THEN RAISE EXCEPTION 'Date required'; END IF;
  SELECT * INTO p FROM attendance_settings WHERE effective_from<=_date ORDER BY effective_from DESC LIMIT 1;
  SELECT jsonb_build_object(
    'settings',(SELECT to_jsonb(s) FROM attendance_settings s ORDER BY effective_from DESC LIMIT 1),
    'device',(SELECT to_jsonb(d)||jsonb_build_object('state',CASE WHEN last_heartbeat_at IS NULL THEN 'unknown' WHEN last_heartbeat_at<now()-interval '5 minutes' THEN 'offline' ELSE 'online' END) FROM attendance_devices d WHERE id='office'),
    'employees',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.name),'[]') FROM attendance_employees e WHERE e.deleted_at IS NULL),
    'rows',(SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id',e.id,'name',coalesce(r.employee_name,e.name),'department',coalesce(r.department,e.department),'enroll_id',e.enroll_id,'entry_at',r.entry_at,'late_minutes',r.late_minutes,'event_id',r.first_event_id,'photo_expires_at',ph.expires_at,'photo_status',ph.status,'leave_conflict',r.id IS NOT NULL AND l.id IS NOT NULL,'status',CASE
      WHEN r.id IS NOT NULL AND l.id IS NOT NULL THEN 'needs_review'
      WHEN r.id IS NOT NULL AND r.late_minutes IS NULL THEN 'needs_review'
      WHEN r.id IS NOT NULL AND r.late_minutes>0 THEN 'late'
      WHEN r.id IS NOT NULL THEN 'present'
      WHEN l.id IS NOT NULL THEN 'on_leave'
      WHEN p.effective_from IS NULL OR p.absence_cutoff IS NULL THEN 'needs_review'
      WHEN NOT extract(dow FROM _date)::integer=ANY(p.working_days) OR _date=ANY(p.holidays) THEN 'off_day'
      WHEN now()<((_date+p.absence_cutoff) AT TIME ZONE 'Asia/Kolkata') THEN 'awaiting_scan'
      WHEN h.work_date IS NOT NULL AND NOT h.gap_detected AND h.last_heartbeat_at>=((_date+p.absence_cutoff) AT TIME ZONE 'Asia/Kolkata') THEN 'absent'
      ELSE 'needs_review' END) ORDER BY coalesce(r.employee_name,e.name)),'[]') FROM attendance_employees e
      LEFT JOIN attendance_daily_records r ON r.employee_id=e.id AND r.work_date=_date
      LEFT JOIN attendance_photos ph ON ph.event_id=r.first_event_id
      LEFT JOIN LATERAL(SELECT id FROM attendance_leave_requests WHERE employee_id=e.id AND status='approved' AND _date BETWEEN start_date AND end_date LIMIT 1) l ON true
      LEFT JOIN attendance_device_health h ON h.work_date=_date
      WHERE r.id IS NOT NULL OR (e.employment_start<=_date AND (e.deactivated_at IS NULL OR (e.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date>=_date))),
    'leaves',(SELECT coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('employee_name',e.name) ORDER BY l.created_at DESC),'[]') FROM (SELECT * FROM attendance_leave_requests WHERE status <> 'rejected' OR reviewed_at IS NULL OR reviewed_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 200) l LEFT JOIN attendance_employees e ON e.id=l.employee_id),
    'review_events',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.received_at DESC),'[]') FROM (SELECT * FROM attendance_scan_events WHERE work_date=_date AND validation_state<>'valid' ORDER BY received_at DESC LIMIT 100) s),
    'server_time',now()
  ) INTO result;
  RETURN result;
END $$;


COMMIT;
