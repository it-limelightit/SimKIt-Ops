-- Absence justification: like late justification, an employee can tag why they
-- were ABSENT on a working day (this month, or last month until the 7th).
-- Tarun decides; Hardik sees it. Accepted -> the day becomes "absence_justified"
-- and counts as a full paid day instead of absent.
BEGIN;

ALTER TABLE public.attendance_late_requests ALTER COLUMN expected_arrival DROP NOT NULL;
ALTER TABLE public.attendance_late_requests DROP CONSTRAINT attendance_late_requests_expected_arrival_check;
ALTER TABLE public.attendance_late_requests ADD CONSTRAINT attendance_late_requests_expected_arrival_check
  CHECK ((kind='absence_justification' AND expected_arrival IS NULL)
      OR (expected_arrival > time '10:00' AND expected_arrival < time '24:00'));
ALTER TABLE public.attendance_late_requests DROP CONSTRAINT attendance_late_requests_kind_check;
ALTER TABLE public.attendance_late_requests ADD CONSTRAINT attendance_late_requests_kind_check
  CHECK (kind IN ('advance','justification','absence_justification'));
ALTER TABLE public.attendance_late_requests DROP CONSTRAINT late_request_before_deadline;
ALTER TABLE public.attendance_late_requests ADD CONSTRAINT late_request_before_deadline
  CHECK (kind IN ('justification','absence_justification') OR created_at <= ((arrival_date + time '08:00') AT TIME ZONE 'Asia/Kolkata'));
ALTER TABLE public.attendance_late_requests DROP CONSTRAINT attendance_late_requests_tags_check;
ALTER TABLE public.attendance_late_requests ADD CONSTRAINT attendance_late_requests_tags_check CHECK (tags <@ ARRAY[
  'Traffic','Transport delay','Site / client work','Medical','Family emergency','Weather','Personal work','Other',
  'Sick / unwell','Forgot to scan','Scan device problem']::text[]);
ALTER TABLE public.attendance_late_requests DROP CONSTRAINT attendance_late_requests_category_check;
ALTER TABLE public.attendance_late_requests ADD CONSTRAINT attendance_late_requests_category_check
  CHECK (category IN ('Transport delay','Medical appointment','Family emergency','Personal work','Other',
    'Traffic','Site / client work','Medical','Weather','Sick / unwell','Forgot to scan','Scan device problem'));

CREATE OR REPLACE FUNCTION public.attendance_submit_absence_justification(_date date,_tags text[],_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE applicant uuid:=auth.uid(); auth_email text; e attendance_employees; day jsonb;
  today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date; note text; request uuid;
  allowed text[]:=ARRAY['Sick / unwell','Family emergency','Medical','Site / client work','Forgot to scan',
    'Scan device problem','Transport delay','Weather','Personal work','Other'];
BEGIN
  SELECT lower(email) INTO auth_email FROM auth.users WHERE id=applicant AND email_confirmed_at IS NOT NULL;
  IF auth_email IS NULL OR auth_email IN ('tarun@limelightit.io','tarun@limelight.io','admin@limelightit.io')
     OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=applicant AND is_active) THEN
    RAISE EXCEPTION 'Active employee account required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO e FROM attendance_employees WHERE auth_user_id=applicant AND active AND deleted_at IS NULL;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Your office attendance account is not linked'; END IF;
  IF _date IS NULL OR _date>=today OR _date<attendance_tracking_start() OR NOT (
       date_trunc('month',_date)=date_trunc('month',today)
       OR (date_trunc('month',_date)=date_trunc('month',today)-interval '1 month' AND extract(day FROM today)<=7)) THEN
    RAISE EXCEPTION 'You can justify absences from this month, or from last month until the 7th';
  END IF;
  -- The day must show as absent in the employee's own calendar.
  SELECT d INTO day FROM jsonb_array_elements(attendance_my_calendar(date_trunc('month',_date)::date)->'days') d
    WHERE d->>'date'=_date::text;
  IF day IS NULL OR day->>'status'<>'absent' THEN RAISE EXCEPTION 'This day is not marked absent'; END IF;
  IF _tags IS NULL OR cardinality(_tags) NOT BETWEEN 1 AND 4 OR NOT (_tags <@ allowed)
     OR cardinality(_tags)<>(SELECT count(DISTINCT t) FROM unnest(_tags) t) THEN
    RAISE EXCEPTION 'Choose 1 to 4 reason tags';
  END IF;
  note:=btrim(coalesce(_note,''));
  IF 'Other'=ANY(_tags) AND length(note)<5 THEN RAISE EXCEPTION 'Describe your reason (at least 5 characters)'; END IF;
  IF length(note)>1800 THEN RAISE EXCEPTION 'Keep the note under 1800 characters'; END IF;
  IF note='' THEN note:=array_to_string(_tags,', '); END IF;
  IF length(note)<5 THEN note:=note||' — absence'; END IF;
  PERFORM 1 FROM profiles WHERE id=applicant FOR UPDATE;
  IF EXISTS(SELECT 1 FROM attendance_late_requests WHERE owner_id=applicant AND arrival_date=_date AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION 'A request already exists for this date';
  END IF;
  INSERT INTO attendance_late_requests(owner_id,employee_id,arrival_date,expected_arrival,is_half_day,category,reason,
      approver_emails,kind,tags,late_minutes)
    VALUES(applicant,e.id,_date,NULL,false,_tags[1],note,ARRAY['tarun@limelightit.io'],'absence_justification',_tags,NULL)
    RETURNING id INTO request;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details) VALUES(applicant,'absence_justification_submitted',request,
    jsonb_build_object('date',_date,'tags',_tags));
  RETURN request;
END $$;
REVOKE ALL ON FUNCTION public.attendance_submit_absence_justification(date,text[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_submit_absence_justification(date,text[],text) TO authenticated;

-- Day info: late OR absence justification (with its kind).
CREATE OR REPLACE FUNCTION public.attendance_late_justification_info(_employee uuid,_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce((SELECT jsonb_build_object('late_justification',jsonb_build_object(
      'id',r.id,'kind',r.kind,'status',r.status,'tags',r.tags,'reason',r.reason,'late_minutes',r.late_minutes,
      'submitted_at',r.created_at,'reviewed_at',r.reviewed_at,'comment',r.comment))
    FROM attendance_late_requests r
    WHERE r.employee_id=_employee AND r.arrival_date=_date AND r.kind IN ('justification','absence_justification')
    ORDER BY CASE r.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 1),'{}'::jsonb)
$$;

-- Approved requests on a day: late/half-day arrivals (existing) and accepted absences.
CREATE OR REPLACE FUNCTION public.attendance_apply_approved_arrival(_row jsonb,_employee uuid,_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE
    WHEN a.id IS NOT NULL AND a.kind='absence_justification' AND _row->>'status'='absent'
    THEN _row||jsonb_build_object('status','absence_justified','late_minutes',NULL,
      'request_type','absence_justified','request_status','approved','reason',a.reason,'request_reason',a.reason)
    WHEN a.id IS NOT NULL AND a.kind<>'absence_justification' AND _row->>'entry_at' IS NOT NULL AND _row->>'status' IN ('late','present')
    THEN _row||jsonb_build_object('status','present','late_minutes',0,'arrival_approved',true,
      'arrival_half_day',a.is_half_day,'arrival_expected',a.expected_arrival)
      ||CASE WHEN _row->>'request_status' IS NULL THEN jsonb_build_object(
        'request_type',CASE WHEN a.kind='justification' THEN 'late_justified' WHEN a.is_half_day THEN 'half_day' ELSE 'late' END,
        'request_status','approved','reason',a.reason,'request_reason',a.reason) ELSE '{}'::jsonb END
    ELSE _row END
  FROM (SELECT 1) x LEFT JOIN LATERAL (
    SELECT * FROM attendance_late_requests
    WHERE employee_id=_employee AND arrival_date=_date AND status='approved'
    ORDER BY reviewed_at DESC NULLS LAST LIMIT 1) a ON true
$$;

-- Salary: an accepted absence is a full paid day.
DO $$ DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.finance_calendar(uuid,date,jsonb)'::regprocedure); o := d;
  IF position('absence_justified' IN d) = 0 THEN
    d := replace(d, 'WHEN g->>''status'' IN (''on_leave'',''site_visit'')', 'WHEN g->>''status'' IN (''on_leave'',''site_visit'',''absence_justified'')');
    IF d = o THEN RAISE EXCEPTION 'Unexpected finance_calendar definition'; END IF;
    EXECUTE d;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
