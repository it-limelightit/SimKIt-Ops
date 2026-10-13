BEGIN;

-- Store an explicit decision for every calendar day in a leave range.
CREATE TABLE IF NOT EXISTS public.attendance_leave_request_days (
  request_id uuid NOT NULL REFERENCES public.attendance_leave_requests(id) ON DELETE CASCADE,
  leave_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  PRIMARY KEY (request_id,leave_date)
);
CREATE INDEX IF NOT EXISTS attendance_leave_request_days_date_status
  ON public.attendance_leave_request_days(leave_date,status);

-- Preserve the decisions already made on requests created before this migration.
INSERT INTO public.attendance_leave_request_days(request_id,leave_date,status,reviewed_by,reviewed_at)
SELECT r.id,d::date,
  CASE WHEN r.status='approved' THEN 'approved' WHEN r.status='rejected' THEN 'rejected' ELSE 'pending' END,
  r.reviewed_by,r.reviewed_at
FROM public.attendance_leave_requests r
CROSS JOIN LATERAL generate_series(r.start_date::timestamp,r.end_date::timestamp,interval '1 day') d
WHERE r.start_date IS NOT NULL AND r.end_date IS NOT NULL
ON CONFLICT (request_id,leave_date) DO NOTHING;

ALTER TABLE public.attendance_leave_requests
  DROP CONSTRAINT IF EXISTS attendance_leave_requests_status_check;
ALTER TABLE public.attendance_leave_requests
  ADD CONSTRAINT attendance_leave_requests_status_check
  CHECK (status IN ('pending','needs_review','approved','rejected','partial','cancelled'));

ALTER TABLE public.attendance_leave_request_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_leave_request_days FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.attendance_can_review_leave() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(),'supervisor') OR EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL
        AND lower(u.email) IN (
          'tarun@limelightit.io','tarun@limelight.io','associatelimelight@gmail.com','info@limelightit.io',
          'kuldeepshrimali.limelight@gmail.com','admin@limelightit.io','patidarnit21@gmail.com'
        )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.attendance_my_leave_requests() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE employee uuid; auth_email text;
BEGIN
  IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'employee') AND NOT public.has_role(auth.uid(),'supervisor')
      AND NOT public.field_ops_associate(auth.uid())) THEN
    RAISE EXCEPTION 'Office account access required' USING ERRCODE='42501';
  END IF;
  SELECT lower(email) INTO auth_email FROM auth.users WHERE id=auth.uid();
  IF auth_email IN ('tarun@limelightit.io','tarun@limelight.io') THEN RETURN '[]'::jsonb; END IF;
  IF public.field_ops_associate(auth.uid()) THEN
    RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('days',coalesce(x.days,'[]'::jsonb)) ORDER BY r.created_at DESC),'[]'::jsonb)
      FROM attendance_leave_requests r LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('leave_date',d.leave_date,'status',d.status) ORDER BY d.leave_date) days
        FROM attendance_leave_request_days d WHERE d.request_id=r.id
      ) x ON true WHERE r.field_associate_id=auth.uid() AND r.source='manual');
  END IF;
  SELECT e.id INTO employee FROM attendance_employees e
    WHERE e.auth_user_id=auth.uid() AND e.active AND e.deleted_at IS NULL
      AND (public.has_role(auth.uid(),'employee') OR e.department='manager');
  IF employee IS NULL THEN
    IF public.attendance_can_review_leave() THEN RETURN '[]'::jsonb; END IF;
    RAISE EXCEPTION 'Active office account is not linked';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('days',coalesce(x.days,'[]'::jsonb)) ORDER BY r.created_at DESC),'[]'::jsonb)
    FROM attendance_leave_requests r LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('leave_date',d.leave_date,'status',d.status) ORDER BY d.leave_date) days
      FROM attendance_leave_request_days d WHERE d.request_id=r.id
    ) x ON true WHERE r.employee_id=employee AND r.source='manual');
END $$;

CREATE OR REPLACE FUNCTION public.attendance_submit_my_leave(
  _start date, _end date, _category text, _description text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE employee uuid; request uuid; category text; auth_email text; applicant_department text; approvers text[];
BEGIN
  IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'employee') AND NOT public.has_role(auth.uid(),'supervisor')
      AND NOT public.field_ops_associate(auth.uid())) THEN
    RAISE EXCEPTION 'Office account access required' USING ERRCODE='42501';
  END IF;
  SELECT lower(email) INTO auth_email FROM auth.users WHERE id=auth.uid();
  IF auth_email IN ('tarun@limelightit.io','tarun@limelight.io') THEN
    RAISE EXCEPTION 'Tarun reviewer accounts can review requests but cannot submit leave';
  END IF;
  IF _start IS NULL OR _end IS NULL OR _end<_start OR _start<(now() AT TIME ZONE 'Asia/Kolkata')::date OR _end-_start>90 THEN
    RAISE EXCEPTION 'Choose a valid date range of up to 91 days starting today or later';
  END IF;
  category := btrim(coalesce(_category,''));
  IF category NOT IN ('Marriage','Family medical','Personal health','Other') THEN RAISE EXCEPTION 'Choose a reason category'; END IF;
  IF length(btrim(coalesce(_description,''))) NOT BETWEEN 5 AND 1800 THEN RAISE EXCEPTION 'Add a description between 5 and 1800 characters'; END IF;
  IF auth_email IS NULL THEN RAISE EXCEPTION 'A confirmed account email is required for leave requests'; END IF;

  IF public.field_ops_associate(auth.uid()) THEN
    PERFORM 1 FROM profiles WHERE id=auth.uid() FOR UPDATE;
    IF EXISTS(SELECT 1 FROM attendance_leave_request_days d JOIN attendance_leave_requests r ON r.id=d.request_id
        WHERE r.field_associate_id=auth.uid() AND d.leave_date BETWEEN _start AND _end AND d.status IN ('pending','approved')) THEN
      RAISE EXCEPTION 'A pending or approved request already covers one or more of these dates';
    END IF;
    approvers := ARRAY['associatelimelight@gmail.com','info@limelightit.io','tarun@limelightit.io'];
    INSERT INTO attendance_leave_requests(field_associate_id,approver_emails,start_date,end_date,reason,source)
      VALUES(auth.uid(),approvers,_start,_end,category || ' — ' || btrim(_description),'manual') RETURNING id INTO request;
  ELSE
    SELECT e.id,e.department INTO employee,applicant_department FROM attendance_employees e
      WHERE e.auth_user_id=auth.uid() AND e.active AND e.deleted_at IS NULL
        AND (public.has_role(auth.uid(),'employee') OR e.department='manager') FOR UPDATE;
    IF employee IS NULL THEN RAISE EXCEPTION 'Active office account is not linked'; END IF;
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
      RAISE EXCEPTION 'Leave approvers are not configured for your office team';
    END IF;
    INSERT INTO attendance_leave_requests(employee_id,approver_emails,start_date,end_date,reason,source)
      VALUES(employee,approvers,_start,_end,category || ' — ' || btrim(_description),'manual') RETURNING id INTO request;
  END IF;

  INSERT INTO attendance_leave_request_days(request_id,leave_date)
    SELECT request,d::date FROM generate_series(_start::timestamp,_end::timestamp,interval '1 day') d;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(auth.uid(),'employee_leave_submitted',request,jsonb_build_object('employee_id',employee,'field_associate_id',CASE WHEN employee IS NULL THEN auth.uid() END,'start_date',_start,'end_date',_end,'category',category,'approver_emails',approvers));
  RETURN request;
END $$;

CREATE OR REPLACE FUNCTION public.attendance_leave_review_queue() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.attendance_can_review_leave() THEN RAISE EXCEPTION 'Manager access required' USING ERRCODE='42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
      'employee_name',coalesce(e.name,p.name,p.email,'Field associate'),
      'department',coalesce(e.department,'field associate'),'employee_id',e.id,'days',coalesce(x.days,'[]'::jsonb)
    ) ORDER BY r.created_at),'[]'::jsonb)
    FROM attendance_leave_requests r
    LEFT JOIN attendance_employees e ON e.id=r.employee_id
    LEFT JOIN profiles p ON p.id=r.field_associate_id
    LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('leave_date',d.leave_date,'status',d.status) ORDER BY d.leave_date) days
      FROM attendance_leave_request_days d WHERE d.request_id=r.id) x ON true
    JOIN auth.users reviewer ON reviewer.id=auth.uid()
    WHERE r.source='manual' AND r.status='pending'
      AND (lower(reviewer.email)=ANY(r.approver_emails) OR (lower(reviewer.email)='tarun@limelight.io' AND 'tarun@limelightit.io'=ANY(r.approver_emails)))
      AND coalesce(e.auth_user_id,r.field_associate_id) IS DISTINCT FROM auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.attendance_review_leave(_request uuid,_decision text,_comment text DEFAULT NULL,_employee uuid DEFAULT NULL,_start date DEFAULT NULL,_end date DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE r attendance_leave_requests; BEGIN
  PERFORM attendance_assert_manager();
  IF _decision NOT IN ('approved','rejected','cancelled') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO r FROM attendance_leave_requests WHERE id=_request FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF coalesce(cardinality(r.approver_emails),0)>0 THEN RAISE EXCEPTION 'Review this request in My leave and decide each day'; END IF;
  IF r.status NOT IN ('pending','needs_review') AND NOT (r.status='approved' AND _decision='cancelled') THEN RAISE EXCEPTION 'Request already reviewed'; END IF;
  r.employee_id := coalesce(_employee,r.employee_id); r.start_date := coalesce(_start,r.start_date); r.end_date := coalesce(_end,r.end_date);
  IF _decision='approved' THEN
    IF r.employee_id IS NULL OR r.start_date IS NULL OR r.end_date IS NULL OR r.end_date < r.start_date THEN RAISE EXCEPTION 'Employee and valid dates required for approval'; END IF;
    PERFORM 1 FROM attendance_employees WHERE id=r.employee_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
    IF EXISTS(SELECT 1 FROM attendance_leave_requests WHERE id<>r.id AND employee_id=r.employee_id AND status='approved' AND start_date<=r.end_date AND end_date>=r.start_date) THEN RAISE EXCEPTION 'Approved leave already covers these dates'; END IF;
  END IF;
  UPDATE attendance_leave_requests SET employee_id=r.employee_id,start_date=r.start_date,end_date=r.end_date,status=_decision,reviewed_by=auth.uid(),reviewed_at=now(),comment=left(_comment,1000) WHERE id=_request;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details) VALUES(auth.uid(),'leave_reviewed',_request,jsonb_build_object('decision',_decision,'comment',left(_comment,1000)));
END $$;

CREATE OR REPLACE FUNCTION public.attendance_decide_employee_leave_days(_request uuid,_decisions jsonb,_comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r attendance_leave_requests; reviewer_email text; total_days integer; payload_days integer; unique_days integer; approved_days integer; rejected_days integer;
BEGIN
  IF NOT public.attendance_can_review_leave() THEN RAISE EXCEPTION 'Manager access required' USING ERRCODE='42501'; END IF;
  SELECT lower(email) INTO reviewer_email FROM auth.users WHERE id=auth.uid();
  SELECT * INTO r FROM attendance_leave_requests WHERE id=_request AND source='manual' FOR UPDATE;
  IF r.id IS NULL OR r.status<>'pending' THEN RAISE EXCEPTION 'This request is no longer pending'; END IF;
  IF NOT (reviewer_email=ANY(r.approver_emails) OR (reviewer_email='tarun@limelight.io' AND 'tarun@limelightit.io'=ANY(r.approver_emails))) THEN
    RAISE EXCEPTION 'This request is routed to a different approver' USING ERRCODE='42501';
  END IF;
  IF coalesce((SELECT auth_user_id FROM attendance_employees WHERE id=r.employee_id),r.field_associate_id)=auth.uid() THEN
    RAISE EXCEPTION 'You cannot decide your own leave request' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(_decisions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Choose a decision for every requested day'; END IF;
  IF jsonb_array_length(_decisions)=0 THEN RAISE EXCEPTION 'Choose a decision for every requested day'; END IF;
  SELECT count(*) INTO total_days FROM attendance_leave_request_days WHERE request_id=r.id;
  SELECT count(*),count(DISTINCT x.date::date) INTO payload_days,unique_days
    FROM jsonb_to_recordset(_decisions) AS x(date text,decision text);
  IF payload_days<>total_days OR unique_days<>total_days OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(_decisions) AS x(date text,decision text)
    WHERE x.decision NOT IN ('approved','rejected') OR NOT EXISTS (
      SELECT 1 FROM attendance_leave_request_days d WHERE d.request_id=r.id AND d.leave_date=x.date::date AND d.status='pending'
    )
  ) THEN RAISE EXCEPTION 'Provide one approve or reject decision for each requested day'; END IF;

  -- Serialize approvals for one employee/associate so concurrent overlapping requests cannot both pass.
  IF r.employee_id IS NOT NULL THEN PERFORM 1 FROM attendance_employees WHERE id=r.employee_id FOR UPDATE;
  ELSE PERFORM 1 FROM profiles WHERE id=r.field_associate_id FOR UPDATE; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(_decisions) AS x(date text,decision text)
    JOIN attendance_leave_request_days d ON d.leave_date=x.date::date AND d.status='approved'
    JOIN attendance_leave_requests other ON other.id=d.request_id AND other.id<>r.id
    WHERE x.decision='approved' AND ((r.employee_id IS NOT NULL AND other.employee_id=r.employee_id)
      OR (r.field_associate_id IS NOT NULL AND other.field_associate_id=r.field_associate_id))
  ) THEN RAISE EXCEPTION 'An approved leave already covers one or more selected dates'; END IF;

  UPDATE attendance_leave_request_days d SET status=x.decision,reviewed_by=auth.uid(),reviewed_at=now()
    FROM jsonb_to_recordset(_decisions) AS x(date text,decision text)
    WHERE d.request_id=r.id AND d.leave_date=x.date::date;
  SELECT count(*) FILTER (WHERE status='approved'),count(*) FILTER (WHERE status='rejected') INTO approved_days,rejected_days
    FROM attendance_leave_request_days WHERE request_id=r.id;
  UPDATE attendance_leave_requests SET status=CASE WHEN approved_days>0 AND rejected_days>0 THEN 'partial'
    WHEN approved_days>0 THEN 'approved' ELSE 'rejected' END,
    reviewed_by=auth.uid(),reviewed_at=now(),comment=left(btrim(coalesce(_comment,'')),1000) WHERE id=r.id;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(auth.uid(),'employee_leave_days_reviewed',r.id,jsonb_build_object('approved_days',approved_days,'rejected_days',rejected_days,'comment',left(btrim(coalesce(_comment,'')),1000)));
END $$;

-- The old whole-range endpoint cannot be used to bypass day-by-day review.
REVOKE ALL ON FUNCTION public.attendance_decide_employee_leave(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.attendance_my_leave_requests(),public.attendance_submit_my_leave(date,date,text,text),public.attendance_leave_review_queue(),public.attendance_can_review_leave() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_my_leave_requests(),public.attendance_submit_my_leave(date,date,text,text),public.attendance_leave_review_queue(),public.attendance_can_review_leave(),public.attendance_decide_employee_leave_days(uuid,jsonb,text) TO authenticated;

-- New portal requests use day rows; old email-created approvals retain the range fallback.
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
      LEFT JOIN LATERAL(SELECT id FROM attendance_leave_requests q WHERE q.employee_id=e.id AND q.status IN ('approved','partial')
        AND _date BETWEEN q.start_date AND q.end_date AND (NOT EXISTS(SELECT 1 FROM attendance_leave_request_days d WHERE d.request_id=q.id)
          OR EXISTS(SELECT 1 FROM attendance_leave_request_days d WHERE d.request_id=q.id AND d.leave_date=_date AND d.status='approved')) LIMIT 1) l ON true
      LEFT JOIN attendance_device_health h ON h.work_date=_date
      WHERE r.id IS NOT NULL OR (e.employment_start<=_date AND (e.deactivated_at IS NULL OR (e.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date>=_date))),
    'leaves',(SELECT coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('employee_name',e.name,
      'days',coalesce(x.days,'[]'::jsonb)) ORDER BY l.created_at DESC),'[]') FROM
      (SELECT * FROM attendance_leave_requests WHERE status <> 'rejected' OR reviewed_at IS NULL OR reviewed_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 200) l
      LEFT JOIN attendance_employees e ON e.id=l.employee_id LEFT JOIN LATERAL(
        SELECT jsonb_agg(jsonb_build_object('leave_date',d.leave_date,'status',d.status) ORDER BY d.leave_date) days
        FROM attendance_leave_request_days d WHERE d.request_id=l.id) x ON true),
    'review_events',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.received_at DESC),'[]') FROM (SELECT * FROM attendance_scan_events WHERE work_date=_date AND validation_state<>'valid' ORDER BY received_at DESC LIMIT 100) s),
    'server_time',now()
  ) INTO result;
  RETURN result;
END $$;

COMMIT;
