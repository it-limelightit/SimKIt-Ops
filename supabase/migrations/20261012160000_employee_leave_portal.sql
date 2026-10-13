BEGIN;

ALTER TABLE public.attendance_leave_requests
  ADD COLUMN IF NOT EXISTS field_associate_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approver_emails text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS attendance_leave_request_field_associate
  ON public.attendance_leave_requests(field_associate_id,start_date,end_date);

CREATE OR REPLACE FUNCTION public.attendance_can_review_leave() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(),'supervisor') OR EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL
        AND lower(u.email) IN (
          'tarun@limelightit.io','associatelimelight@gmail.com','info@limelightit.io',
          'kuldeepshrimali.limelight@gmail.com','admin@limelightit.io','patidarnit21@gmail.com'
        )
    )
  );
$$;

-- Employee and linked manager self-service leave requests. All applicant identity
-- is derived from the signed-in account; clients cannot submit for someone else.
CREATE OR REPLACE FUNCTION public.attendance_my_leave_requests() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE employee uuid;
BEGIN
  IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'employee') AND NOT public.has_role(auth.uid(),'supervisor')
      AND NOT public.field_ops_associate(auth.uid())) THEN
    RAISE EXCEPTION 'Office account access required' USING ERRCODE='42501';
  END IF;
  IF public.field_ops_associate(auth.uid()) THEN
    RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC),'[]'::jsonb)
      FROM attendance_leave_requests r WHERE r.field_associate_id=auth.uid() AND r.source='manual');
  END IF;
  SELECT e.id INTO employee FROM attendance_employees e
    WHERE e.auth_user_id=auth.uid() AND e.active AND e.deleted_at IS NULL
      AND (public.has_role(auth.uid(),'employee') OR e.department='manager');
  IF employee IS NULL THEN
    IF public.attendance_can_review_leave() THEN RETURN '[]'::jsonb; END IF;
    RAISE EXCEPTION 'Active office account is not linked';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC),'[]'::jsonb)
    FROM attendance_leave_requests r WHERE r.employee_id=employee AND r.source='manual');
END $$;

CREATE OR REPLACE FUNCTION public.attendance_submit_my_leave(
  _start date, _end date, _category text, _description text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE employee uuid; request uuid; category text;
  auth_email text; applicant_department text;
  approvers text[];
BEGIN
  IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'employee') AND NOT public.has_role(auth.uid(),'supervisor')
      AND NOT public.field_ops_associate(auth.uid())) THEN
    RAISE EXCEPTION 'Office account access required' USING ERRCODE='42501';
  END IF;
  IF _start IS NULL OR _end IS NULL OR _end<_start OR _start<(now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Choose a valid date range starting today or later';
  END IF;
  category := btrim(coalesce(_category,''));
  IF category NOT IN ('Marriage','Family medical','Personal health','Other') THEN RAISE EXCEPTION 'Choose a reason category'; END IF;
  IF length(btrim(coalesce(_description,''))) NOT BETWEEN 5 AND 1800 THEN RAISE EXCEPTION 'Add a description between 5 and 1800 characters'; END IF;
  SELECT lower(email) INTO auth_email FROM auth.users WHERE id=auth.uid();
  IF auth_email IS NULL THEN RAISE EXCEPTION 'A confirmed account email is required for leave requests'; END IF;
  IF public.field_ops_associate(auth.uid()) THEN
    IF EXISTS(SELECT 1 FROM attendance_leave_requests r WHERE r.field_associate_id=auth.uid()
        AND r.status IN ('pending','approved') AND r.start_date<=_end AND r.end_date>=_start) THEN
      RAISE EXCEPTION 'You already have a pending or approved request covering these dates';
    END IF;
    approvers := ARRAY['associatelimelight@gmail.com','info@limelightit.io','tarun@limelightit.io'];
    INSERT INTO attendance_leave_requests(field_associate_id,approver_emails,start_date,end_date,reason,source)
      VALUES(auth.uid(),approvers,_start,_end,category || ' — ' || btrim(_description),'manual') RETURNING id INTO request;
  ELSE
    SELECT e.id,e.department INTO employee,applicant_department FROM attendance_employees e
      WHERE e.auth_user_id=auth.uid() AND e.active AND e.deleted_at IS NULL
        AND (public.has_role(auth.uid(),'employee') OR e.department='manager') FOR UPDATE;
    IF employee IS NULL THEN RAISE EXCEPTION 'Active office account is not linked'; END IF;
    IF EXISTS(SELECT 1 FROM attendance_leave_requests r WHERE r.employee_id=employee
        AND r.status IN ('pending','approved') AND r.start_date<=_end AND r.end_date>=_start) THEN
      RAISE EXCEPTION 'You already have a pending or approved request covering these dates';
    END IF;
    IF auth_email='aryankadiya2005@gmail.com' THEN
      approvers := ARRAY['associatelimelight@gmail.com','tarun@limelightit.io'];
    ELSIF auth_email IN ('patidarnit21@gmail.com','kishanvyas308@gmail.com',
        'associatelimelight@gmail.com','info@limelightit.io','kuldeepshrimali.limelight@gmail.com') THEN
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
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(auth.uid(),'employee_leave_submitted',request,jsonb_build_object('employee_id',employee,'field_associate_id',CASE WHEN employee IS NULL THEN auth.uid() END,'start_date',_start,'end_date',_end,'category',category,'approver_emails',approvers));
  RETURN request;
END $$;

CREATE OR REPLACE FUNCTION public.attendance_leave_review_queue() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.attendance_can_review_leave() THEN
    RAISE EXCEPTION 'Manager access required' USING ERRCODE='42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
      'employee_name',coalesce(e.name,p.name,p.email,'Field associate'),
      'department',coalesce(e.department,'field associate'),'employee_id',e.id
    ) ORDER BY r.created_at),'[]'::jsonb)
    FROM attendance_leave_requests r
    LEFT JOIN attendance_employees e ON e.id=r.employee_id
    LEFT JOIN profiles p ON p.id=r.field_associate_id
    JOIN auth.users reviewer ON reviewer.id=auth.uid()
    WHERE r.source='manual' AND r.status='pending'
      AND lower(reviewer.email)=ANY(r.approver_emails)
      AND coalesce(e.auth_user_id,r.field_associate_id) IS DISTINCT FROM auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.attendance_decide_employee_leave(_request uuid,_decision text,_comment text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r attendance_leave_requests;
BEGIN
  IF NOT public.attendance_can_review_leave() THEN
    RAISE EXCEPTION 'Manager access required' USING ERRCODE='42501';
  END IF;
  IF _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Choose approve or reject'; END IF;
  SELECT * INTO r FROM attendance_leave_requests WHERE id=_request AND source='manual' FOR UPDATE;
  IF r.id IS NULL OR r.status<>'pending' THEN RAISE EXCEPTION 'This request is no longer pending'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND lower(u.email)=ANY(r.approver_emails)) THEN
    RAISE EXCEPTION 'This request is routed to a different approver' USING ERRCODE='42501';
  END IF;
  IF coalesce((SELECT auth_user_id FROM attendance_employees WHERE id=r.employee_id),r.field_associate_id)=auth.uid() THEN
    RAISE EXCEPTION 'You cannot decide your own leave request' USING ERRCODE='42501';
  END IF;
  IF _decision='approved' AND (
      (r.employee_id IS NOT NULL AND EXISTS(SELECT 1 FROM attendance_leave_requests x WHERE x.id<>r.id
        AND x.employee_id=r.employee_id AND x.status='approved' AND x.start_date<=r.end_date AND x.end_date>=r.start_date)) OR
      (r.field_associate_id IS NOT NULL AND EXISTS(SELECT 1 FROM attendance_leave_requests x WHERE x.id<>r.id
        AND x.field_associate_id=r.field_associate_id AND x.status='approved' AND x.start_date<=r.end_date AND x.end_date>=r.start_date))
    ) THEN
    RAISE EXCEPTION 'An approved leave already covers these dates';
  END IF;
  UPDATE attendance_leave_requests SET status=_decision,reviewed_by=auth.uid(),reviewed_at=now(),comment=left(btrim(coalesce(_comment,'')),1000)
    WHERE id=_request;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(auth.uid(),'employee_leave_reviewed',_request,jsonb_build_object('decision',_decision,'comment',left(btrim(coalesce(_comment,'')),1000)));
END $$;

REVOKE ALL ON FUNCTION public.attendance_my_leave_requests(),public.attendance_submit_my_leave(date,date,text,text),public.attendance_leave_review_queue(),public.attendance_decide_employee_leave(uuid,text,text),public.attendance_can_review_leave() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_my_leave_requests(),public.attendance_submit_my_leave(date,date,text,text),public.attendance_leave_review_queue(),public.attendance_decide_employee_leave(uuid,text,text),public.attendance_can_review_leave() TO authenticated;

COMMIT;
