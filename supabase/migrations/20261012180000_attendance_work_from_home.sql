BEGIN;

ALTER TABLE public.attendance_employees
  ADD COLUMN IF NOT EXISTS work_from_home_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.attendance_leave_requests
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'leave';
ALTER TABLE public.attendance_leave_requests
  DROP CONSTRAINT IF EXISTS attendance_leave_requests_request_type_check;
ALTER TABLE public.attendance_leave_requests
  ADD CONSTRAINT attendance_leave_requests_request_type_check CHECK (request_type IN ('leave','wfh'));

CREATE OR REPLACE FUNCTION public.attendance_set_wfh_eligibility(_employee uuid,_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor_email text; employee_name text;
BEGIN
  SELECT lower(email) INTO actor_email FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
  IF actor_email IS NULL OR actor_email NOT IN ('tarun@limelightit.io','tarun@limelight.io') THEN
    RAISE EXCEPTION 'Only Tarun can change work-from-home eligibility' USING ERRCODE='42501';
  END IF;
  IF _enabled IS NULL THEN RAISE EXCEPTION 'Choose whether work-from-home access is enabled'; END IF;
  UPDATE attendance_employees SET work_from_home_enabled=_enabled
    WHERE id=_employee AND active AND deleted_at IS NULL RETURNING name INTO employee_name;
  IF employee_name IS NULL THEN RAISE EXCEPTION 'Active office employee not found'; END IF;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(auth.uid(),'employee_wfh_eligibility_changed',_employee,jsonb_build_object('enabled',_enabled,'employee_name',employee_name));
END $$;

CREATE OR REPLACE FUNCTION public.attendance_my_wfh_eligibility() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce((SELECT e.work_from_home_enabled FROM attendance_employees e
    WHERE e.auth_user_id=auth.uid() AND e.active AND e.deleted_at IS NULL),false)
    WHERE auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.attendance_submit_my_wfh(_start date,_end date,_description text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE employee uuid; applicant_department text; auth_email text; approvers text[]; request uuid;
BEGIN
  IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'employee') AND NOT public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'Office employee account required' USING ERRCODE='42501';
  END IF;
  SELECT lower(u.email) INTO auth_email FROM auth.users u WHERE u.id=auth.uid();
  IF auth_email IS NULL THEN RAISE EXCEPTION 'A confirmed account email is required'; END IF;
  IF auth_email IN ('tarun@limelightit.io','tarun@limelight.io') THEN RAISE EXCEPTION 'Tarun reviewer accounts cannot submit requests'; END IF;
  IF _start IS NULL OR _end IS NULL OR _end<_start OR _start<(now() AT TIME ZONE 'Asia/Kolkata')::date OR _end-_start>90 THEN
    RAISE EXCEPTION 'Choose a valid date range of up to 91 days starting today or later';
  END IF;
  IF length(btrim(coalesce(_description,''))) NOT BETWEEN 5 AND 1800 THEN RAISE EXCEPTION 'Add a description between 5 and 1800 characters'; END IF;
  SELECT e.id,e.department INTO employee,applicant_department FROM attendance_employees e
    WHERE e.auth_user_id=auth.uid() AND e.active AND e.deleted_at IS NULL AND e.work_from_home_enabled
      AND (public.has_role(auth.uid(),'employee') OR e.department='manager') FOR UPDATE;
  IF employee IS NULL THEN RAISE EXCEPTION 'Work-from-home access is not enabled for your account'; END IF;
  IF EXISTS(SELECT 1 FROM attendance_leave_request_days d JOIN attendance_leave_requests r ON r.id=d.request_id
      WHERE r.employee_id=employee AND d.leave_date BETWEEN _start AND _end AND d.status IN ('pending','approved')) THEN
    RAISE EXCEPTION 'A pending or approved request already covers one or more of these dates';
  END IF;
  IF auth_email='aryankadiya2005@gmail.com' THEN
    approvers := ARRAY['associatelimelight@gmail.com','tarun@limelightit.io'];
  ELSIF auth_email IN ('patidarnit21@gmail.com','kishanvyas308@gmail.com','associatelimelight@gmail.com','info@limelightit.io','kuldeepshrimali.limelight@gmail.com') THEN
    approvers := ARRAY['tarun@limelightit.io'];
  ELSIF auth_email IN ('mayankk.limelightit@gmail.com','surajbiswas.limelight@gmail.com','vikashkumavat.limelight@gmail.com') THEN
    approvers := ARRAY['kuldeepshrimali.limelight@gmail.com','tarun@limelightit.io'];
  ELSIF applicant_department='manager' OR applicant_department='software' THEN
    approvers := ARRAY['tarun@limelightit.io'];
  ELSIF applicant_department='firmware' THEN
    approvers := ARRAY['kuldeepshrimali.limelight@gmail.com','tarun@limelightit.io'];
  ELSE
    RAISE EXCEPTION 'Work-from-home approvers are not configured for your office team';
  END IF;
  INSERT INTO attendance_leave_requests(employee_id,approver_emails,start_date,end_date,reason,source,request_type)
    VALUES(employee,approvers,_start,_end,'Work from home — '||btrim(_description),'manual','wfh') RETURNING id INTO request;
  INSERT INTO attendance_leave_request_days(request_id,leave_date)
    SELECT request,d::date FROM generate_series(_start::timestamp,_end::timestamp,interval '1 day') d;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(auth.uid(),'employee_wfh_submitted',request,jsonb_build_object('employee_id',employee,'start_date',_start,'end_date',_end,'approver_emails',approvers));
  RETURN request;
END $$;

REVOKE ALL ON FUNCTION public.attendance_set_wfh_eligibility(uuid,boolean),public.attendance_my_wfh_eligibility(),public.attendance_submit_my_wfh(date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_set_wfh_eligibility(uuid,boolean),public.attendance_my_wfh_eligibility(),public.attendance_submit_my_wfh(date,date,text) TO authenticated;

-- Treat approved WFH days as scheduled work, not leave or unexplained absence.
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

COMMIT;
