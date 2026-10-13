-- A linked office supervisor can request their own leave/WFH without changing roles or department.
-- Identity, active employment, WFH eligibility and existing approval routing remain enforced.
BEGIN;

CREATE OR REPLACE FUNCTION public.attendance_my_account() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'employee') AND NOT public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'Office employee access required';
  END IF;
  RETURN (SELECT jsonb_build_object('id',e.id,'name',e.name,'enroll_id',e.enroll_id,'active',e.active)
    FROM attendance_employees e WHERE e.auth_user_id=auth.uid() AND e.deleted_at IS NULL
      AND (public.has_role(auth.uid(),'employee') OR public.has_role(auth.uid(),'supervisor')));
END $$;

CREATE OR REPLACE FUNCTION public.attendance_my_history() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE employee uuid;
BEGIN
  IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'employee') AND NOT public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'Office employee access required';
  END IF;
  SELECT id INTO employee FROM attendance_employees e WHERE e.auth_user_id=auth.uid() AND e.active AND e.deleted_at IS NULL
    AND (public.has_role(auth.uid(),'employee') OR public.has_role(auth.uid(),'supervisor'));
  IF employee IS NULL THEN RAISE EXCEPTION 'Office account is inactive or not linked'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.work_date DESC),'[]')
    FROM (SELECT work_date,entry_at,late_minutes FROM attendance_daily_records WHERE employee_id=employee ORDER BY work_date DESC LIMIT 90) r);
END $$;

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
      AND (public.has_role(auth.uid(),'employee') OR public.has_role(auth.uid(),'supervisor'));
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
        AND (public.has_role(auth.uid(),'employee') OR public.has_role(auth.uid(),'supervisor')) FOR UPDATE;
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
      AND (public.has_role(auth.uid(),'employee') OR public.has_role(auth.uid(),'supervisor')) FOR UPDATE;
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

NOTIFY pgrst, 'reload schema';
COMMIT;
