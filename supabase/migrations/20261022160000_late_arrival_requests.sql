BEGIN;

-- Arrival permission is distinct from full-day leave and must never mark a whole day on leave.
CREATE TABLE public.attendance_late_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  employee_id uuid REFERENCES public.attendance_employees(id),
  arrival_date date NOT NULL,
  expected_arrival time NOT NULL CHECK (expected_arrival > time '10:00' AND expected_arrival < time '24:00'),
  is_half_day boolean NOT NULL DEFAULT false,
  category text NOT NULL CHECK (category IN ('Transport delay','Medical appointment','Family emergency','Personal work','Other')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 1800),
  approver_emails text[] NOT NULL CHECK (cardinality(approver_emails)>0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  comment text,
  CONSTRAINT late_request_before_deadline CHECK (created_at <= ((arrival_date + time '08:00') AT TIME ZONE 'Asia/Kolkata'))
);
CREATE UNIQUE INDEX attendance_late_requests_active_date ON public.attendance_late_requests(owner_id,arrival_date)
  WHERE status IN ('pending','approved');
ALTER TABLE public.attendance_late_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_late_requests FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.attendance_submit_my_late_request(
  _date date, _expected_arrival time, _category text, _description text, _half_day boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE applicant uuid := auth.uid(); auth_email text; employee uuid; department text; mentor text;
  approvers text[]; request uuid; submitted_at timestamptz;
BEGIN
  SELECT lower(email) INTO auth_email FROM auth.users WHERE id=applicant AND email_confirmed_at IS NOT NULL;
  IF auth_email IS NULL OR auth_email IN ('admin@limelightit.io','tarun@limelightit.io','tarun@limelight.io')
      OR NOT (public.has_role(applicant,'employee') OR public.has_role(applicant,'supervisor') OR public.field_ops_associate(applicant))
      OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=applicant AND is_active) THEN
    RAISE EXCEPTION 'Active employee account required' USING ERRCODE='42501';
  END IF;
  -- Serialize submissions by applicant, then check the real server time after acquiring the lock.
  PERFORM 1 FROM profiles WHERE id=applicant FOR UPDATE;
  submitted_at := clock_timestamp();
  IF _date IS NULL OR _date < (submitted_at AT TIME ZONE 'Asia/Kolkata')::date
      OR _date > (submitted_at AT TIME ZONE 'Asia/Kolkata')::date + 90 THEN
    RAISE EXCEPTION 'Choose today or a date within the next 90 days';
  END IF;
  IF submitted_at > ((_date + time '08:00') AT TIME ZONE 'Asia/Kolkata') THEN
    RAISE EXCEPTION 'The deadline is 8:00 AM IST on the requested day, two hours before the 10:00 AM office start. This request cannot be submitted.';
  END IF;
  IF _expected_arrival IS NULL OR _expected_arrival <= time '10:00' OR _expected_arrival >= time '24:00' THEN
    RAISE EXCEPTION 'Choose an expected arrival time after 10:00 AM';
  END IF;
  IF _category IS NULL OR _category NOT IN ('Transport delay','Medical appointment','Family emergency','Personal work','Other') THEN
    RAISE EXCEPTION 'Select a late-arrival reason';
  END IF;
  IF length(btrim(coalesce(_description,''))) NOT BETWEEN 5 AND 1800 THEN
    RAISE EXCEPTION 'Add a reason between 5 and 1800 characters';
  END IF;
  SELECT e.id,e.department INTO employee,department FROM attendance_employees e
    WHERE e.auth_user_id=applicant AND e.active AND e.deleted_at IS NULL FOR UPDATE;
  IF employee IS NULL AND NOT public.field_ops_associate(applicant) THEN RAISE EXCEPTION 'Active office account is not linked'; END IF;
  SELECT lower(btrim(mentor_name)) INTO mentor FROM hr_employees WHERE auth_user_id=applicant AND status<>'left';
  IF mentor IS NOT NULL AND mentor<>'' THEN
    CASE mentor
      WHEN 'kuldeep shrimali' THEN approvers := ARRAY['kuldeepshrimali.limelight@gmail.com'];
      WHEN 'hitesh bhai' THEN approvers := ARRAY['associatelimelight@gmail.com'];
      WHEN 'raghav gaur' THEN approvers := ARRAY['info@limelightit.io'];
      WHEN 'raghav gaur & hitesh bhai' THEN approvers := ARRAY['info@limelightit.io','associatelimelight@gmail.com'];
      WHEN 'tarun purohit' THEN approvers := ARRAY[]::text[];
      ELSE RAISE EXCEPTION 'Your reporting manager is not configured for approvals. Contact HR.';
    END CASE;
  ELSIF public.field_ops_associate(applicant) THEN
    approvers := ARRAY['associatelimelight@gmail.com','info@limelightit.io'];
  ELSIF auth_email='aryankadiya2005@gmail.com' THEN
    approvers := ARRAY['associatelimelight@gmail.com'];
  ELSIF auth_email IN ('patidarnit21@gmail.com','kishanvyas308@gmail.com','nitsanghani1@gmail.com','associatelimelight@gmail.com','info@limelightit.io','kuldeepshrimali.limelight@gmail.com') THEN
    approvers := ARRAY[]::text[];
  ELSIF auth_email IN ('mayankk.limelightit@gmail.com','surajbiswas.limelight@gmail.com','vikashkumavat.limelight@gmail.com') OR department='firmware' THEN
    approvers := ARRAY['kuldeepshrimali.limelight@gmail.com'];
  ELSIF department IN ('manager','software') THEN
    approvers := ARRAY[]::text[];
  ELSE RAISE EXCEPTION 'Your reporting manager is not configured for approvals. Contact HR.';
  END IF;
  SELECT array_agg(DISTINCT address) INTO approvers FROM unnest(approvers || ARRAY['tarun@limelightit.io']) address WHERE address<>auth_email;
  IF EXISTS(SELECT 1 FROM attendance_late_requests WHERE owner_id=applicant AND arrival_date=_date AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION 'A pending or approved arrival request already exists for this date';
  END IF;
  INSERT INTO attendance_late_requests(owner_id,employee_id,arrival_date,expected_arrival,is_half_day,category,reason,approver_emails,created_at)
    VALUES(applicant,employee,_date,_expected_arrival,coalesce(_half_day,false),_category,btrim(_description),approvers,submitted_at) RETURNING id INTO request;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details) VALUES(applicant,'late_arrival_submitted',request,
    jsonb_build_object('date',_date,'expected_arrival',_expected_arrival,'half_day',coalesce(_half_day,false),'approver_emails',approvers));
  RETURN request;
END $$;

CREATE FUNCTION public.attendance_late_requests(_review boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE reviewer_email text;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND is_active) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE='42501';
  END IF;
  IF _review AND NOT public.attendance_can_review_leave() THEN RAISE EXCEPTION 'Leave review access required' USING ERRCODE='42501'; END IF;
  SELECT CASE WHEN lower(email)='tarun@limelight.io' THEN 'tarun@limelightit.io' ELSE lower(email) END INTO reviewer_email FROM auth.users WHERE id=auth.uid();
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
    'request_type','late','employee_name',coalesce(e.name,p.name,'Employee'),'department',coalesce(e.department,'field associate'),
    'start_date',r.arrival_date,'end_date',r.arrival_date,'days',jsonb_build_array(jsonb_build_object('leave_date',r.arrival_date,'status',r.status)))
    ORDER BY r.created_at DESC),'[]'::jsonb)
    FROM attendance_late_requests r LEFT JOIN attendance_employees e ON e.id=r.employee_id LEFT JOIN profiles p ON p.id=r.owner_id
    WHERE (NOT _review AND r.owner_id=auth.uid()) OR (_review AND r.status='pending' AND r.owner_id<>auth.uid() AND reviewer_email=ANY(r.approver_emails)));
END $$;

CREATE FUNCTION public.attendance_decide_late_request(_request uuid,_decision text,_comment text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r attendance_late_requests; reviewer_email text;
BEGIN
  IF NOT public.attendance_can_review_leave() OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND is_active) THEN
    RAISE EXCEPTION 'Leave review access required' USING ERRCODE='42501';
  END IF;
  IF _decision IS NULL OR _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Choose approve or reject'; END IF;
  SELECT * INTO r FROM attendance_late_requests WHERE id=_request FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  SELECT CASE WHEN lower(email)='tarun@limelight.io' THEN 'tarun@limelightit.io' ELSE lower(email) END INTO reviewer_email FROM auth.users WHERE id=auth.uid();
  IF r.owner_id=auth.uid() OR NOT coalesce(reviewer_email=ANY(r.approver_emails),false) THEN
    RAISE EXCEPTION 'This request is routed to a different approver' USING ERRCODE='42501';
  END IF;
  IF r.status<>'pending' THEN RAISE EXCEPTION 'This request is no longer pending'; END IF;
  UPDATE attendance_late_requests SET status=_decision,reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),comment=left(_comment,1000) WHERE id=r.id;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details) VALUES(auth.uid(),'late_arrival_reviewed',r.id,jsonb_build_object('decision',_decision,'owner_id',r.owner_id));
END $$;

REVOKE ALL ON FUNCTION public.attendance_submit_my_late_request(date,time,text,text,boolean),public.attendance_late_requests(boolean),public.attendance_decide_late_request(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_submit_my_late_request(date,time,text,text,boolean),public.attendance_late_requests(boolean),public.attendance_decide_late_request(uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
