-- 1) Late-arrival justification (after the fact).
--    An employee who arrived late picks 1-4 reason tags (+ note) for any late
--    day of the current month, up to today. Only Tarun decides; Hardik sees it.
--    Approved -> the day counts as a full on-time day (no half-day cut), via the
--    existing approved-arrival rule.
-- 2) Site visit requests (office staff only), approved by Tarun only.
--    Approved -> status 'site_visit': green, full paid day, no face scan needed.
BEGIN;

-- ---------- Late justification: table ----------
ALTER TABLE public.attendance_late_requests
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'advance',
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS late_minutes integer;
ALTER TABLE public.attendance_late_requests
  ADD CONSTRAINT attendance_late_requests_kind_check CHECK (kind IN ('advance','justification')),
  ADD CONSTRAINT attendance_late_requests_tags_check CHECK (tags <@ ARRAY[
    'Traffic','Transport delay','Site / client work','Medical','Family emergency','Weather','Personal work','Other']::text[]);
ALTER TABLE public.attendance_late_requests DROP CONSTRAINT late_request_before_deadline;
ALTER TABLE public.attendance_late_requests ADD CONSTRAINT late_request_before_deadline
  CHECK (kind='justification' OR created_at <= ((arrival_date + time '08:00') AT TIME ZONE 'Asia/Kolkata'));
ALTER TABLE public.attendance_late_requests DROP CONSTRAINT attendance_late_requests_category_check;
ALTER TABLE public.attendance_late_requests ADD CONSTRAINT attendance_late_requests_category_check
  CHECK (category IN ('Transport delay','Medical appointment','Family emergency','Personal work','Other',
    'Traffic','Site / client work','Medical','Weather'));

CREATE OR REPLACE FUNCTION public.attendance_submit_late_justification(_date date,_tags text[],_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE applicant uuid:=auth.uid(); auth_email text; e attendance_employees; rec attendance_daily_records;
  today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date; note text; request uuid;
  allowed text[]:=ARRAY['Traffic','Transport delay','Site / client work','Medical','Family emergency','Weather','Personal work','Other'];
BEGIN
  SELECT lower(email) INTO auth_email FROM auth.users WHERE id=applicant AND email_confirmed_at IS NOT NULL;
  IF auth_email IS NULL OR auth_email IN ('tarun@limelightit.io','tarun@limelight.io','admin@limelightit.io')
     OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=applicant AND is_active) THEN
    RAISE EXCEPTION 'Active employee account required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO e FROM attendance_employees WHERE auth_user_id=applicant AND active AND deleted_at IS NULL;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Your office attendance account is not linked'; END IF;
  IF _date IS NULL OR _date>today OR date_trunc('month',_date)<>date_trunc('month',today) OR _date<attendance_tracking_start() THEN
    RAISE EXCEPTION 'You can justify late arrivals from this month only, up to today';
  END IF;
  SELECT * INTO rec FROM attendance_daily_records WHERE employee_id=e.id AND work_date=_date;
  IF rec.id IS NULL OR coalesce(rec.late_minutes,0)<=0 THEN RAISE EXCEPTION 'No late arrival is recorded for this date'; END IF;
  IF _tags IS NULL OR cardinality(_tags) NOT BETWEEN 1 AND 4 OR NOT (_tags <@ allowed)
     OR cardinality(_tags)<>(SELECT count(DISTINCT t) FROM unnest(_tags) t) THEN
    RAISE EXCEPTION 'Choose 1 to 4 reason tags';
  END IF;
  note:=btrim(coalesce(_note,''));
  IF 'Other'=ANY(_tags) AND length(note)<5 THEN RAISE EXCEPTION 'Describe your reason (at least 5 characters)'; END IF;
  IF length(note)>1800 THEN RAISE EXCEPTION 'Keep the note under 1800 characters'; END IF;
  IF note='' THEN note:=array_to_string(_tags,', '); END IF;
  IF length(note)<5 THEN note:=note||' — late arrival'; END IF;
  PERFORM 1 FROM profiles WHERE id=applicant FOR UPDATE;
  IF EXISTS(SELECT 1 FROM attendance_late_requests WHERE owner_id=applicant AND arrival_date=_date AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION 'A late request already exists for this date';
  END IF;
  INSERT INTO attendance_late_requests(owner_id,employee_id,arrival_date,expected_arrival,is_half_day,category,reason,
      approver_emails,kind,tags,late_minutes)
    VALUES(applicant,e.id,_date,(rec.entry_at AT TIME ZONE 'Asia/Kolkata')::time,false,_tags[1],note,
      ARRAY['tarun@limelightit.io'],'justification',_tags,rec.late_minutes)
    RETURNING id INTO request;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details) VALUES(applicant,'late_justification_submitted',request,
    jsonb_build_object('date',_date,'tags',_tags,'late_minutes',rec.late_minutes));
  RETURN request;
END $$;
REVOKE ALL ON FUNCTION public.attendance_submit_late_justification(date,text[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_submit_late_justification(date,text[],text) TO authenticated;

-- Justification status for a day (shown to the employee, managers, Hardik and Tarun).
CREATE OR REPLACE FUNCTION public.attendance_late_justification_info(_employee uuid,_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce((SELECT jsonb_build_object('late_justification',jsonb_build_object(
      'id',r.id,'status',r.status,'tags',r.tags,'reason',r.reason,'late_minutes',r.late_minutes,
      'submitted_at',r.created_at,'reviewed_at',r.reviewed_at,'comment',r.comment))
    FROM attendance_late_requests r
    WHERE r.employee_id=_employee AND r.arrival_date=_date AND r.kind='justification'
    ORDER BY CASE r.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 1),'{}'::jsonb)
$$;
REVOKE ALL ON FUNCTION public.attendance_late_justification_info(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_late_justification_info(uuid,date) TO authenticated,service_role;

-- Approved arrivals: label accepted justifications distinctly.
CREATE OR REPLACE FUNCTION public.attendance_apply_approved_arrival(_row jsonb,_employee uuid,_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN a.id IS NOT NULL AND _row->>'entry_at' IS NOT NULL AND _row->>'status' IN ('late','present')
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

-- ---------- Site visit ----------
ALTER TABLE public.attendance_leave_requests DROP CONSTRAINT attendance_leave_requests_request_type_check;
ALTER TABLE public.attendance_leave_requests ADD CONSTRAINT attendance_leave_requests_request_type_check
  CHECK (request_type IN ('leave','wfh','site_visit'));

CREATE OR REPLACE FUNCTION public.attendance_submit_my_site_visit(_start date,_end date,_description text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE employee uuid; auth_email text; request uuid;
BEGIN
  PERFORM public.assert_manager_module_access('leave');
  IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'employee') AND NOT public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'Office employee account required' USING ERRCODE='42501';
  END IF;
  SELECT lower(u.email) INTO auth_email FROM auth.users u WHERE u.id=auth.uid();
  IF auth_email IS NULL THEN RAISE EXCEPTION 'A confirmed account email is required'; END IF;
  IF auth_email IN ('tarun@limelightit.io','tarun@limelight.io','admin@limelightit.io') THEN RAISE EXCEPTION 'Reviewer accounts cannot submit site visits'; END IF;
  IF _start IS NULL OR _end IS NULL OR _end<_start OR _start<(now() AT TIME ZONE 'Asia/Kolkata')::date OR _end-_start>30 THEN
    RAISE EXCEPTION 'Choose a valid date range of up to 31 days starting today or later';
  END IF;
  IF length(btrim(coalesce(_description,''))) NOT BETWEEN 5 AND 1800 THEN RAISE EXCEPTION 'Add the site and purpose (5 to 1800 characters)'; END IF;
  SELECT e.id INTO employee FROM attendance_employees e
    WHERE e.auth_user_id=auth.uid() AND e.active AND e.deleted_at IS NULL FOR UPDATE;
  IF employee IS NULL THEN RAISE EXCEPTION 'Site visits are for office staff with an attendance account'; END IF;
  IF EXISTS(SELECT 1 FROM attendance_leave_request_days d JOIN attendance_leave_requests r ON r.id=d.request_id
      WHERE r.employee_id=employee AND d.leave_date BETWEEN _start AND _end AND d.status IN ('pending','approved')) THEN
    RAISE EXCEPTION 'A pending or approved request already covers one or more of these dates';
  END IF;
  INSERT INTO attendance_leave_requests(employee_id,approver_emails,start_date,end_date,reason,source,request_type)
    VALUES(employee,ARRAY['tarun@limelightit.io'],_start,_end,'Site visit — '||btrim(_description),'manual','site_visit')
    RETURNING id INTO request;
  INSERT INTO attendance_leave_request_days(request_id,leave_date)
    SELECT request,d::date FROM generate_series(_start::timestamp,_end::timestamp,interval '1 day') d;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(auth.uid(),'employee_site_visit_submitted',request,jsonb_build_object('employee_id',employee,'start_date',_start,'end_date',_end));
  RETURN request;
END $$;
REVOKE ALL ON FUNCTION public.attendance_submit_my_site_visit(date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_submit_my_site_visit(date,date,text) TO authenticated;

-- Approved site visit -> 'site_visit' status (off days stay off days).
CREATE OR REPLACE FUNCTION public.attendance_apply_site_visit(_row jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _row->>'request_type'='site_visit' AND _row->>'request_status'='approved'
    AND _row->>'status' IN ('on_leave','needs_review','absent','awaiting_scan','late','present','scheduled')
    AND coalesce(_row->>'review_reason','')<>'before_tracking_start'
    THEN _row||jsonb_build_object('status','site_visit','late_minutes',NULL)
    ELSE _row END
$$;
GRANT EXECUTE ON FUNCTION public.attendance_apply_site_visit(jsonb) TO authenticated,service_role;

-- ---------- Wrappers ----------
CREATE OR REPLACE FUNCTION public.attendance_my_calendar(_month date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE result jsonb; employee uuid; days jsonb;
BEGIN
  result:=attendance_my_calendar_before_time_guard(_month);
  SELECT id INTO employee FROM attendance_employees WHERE auth_user_id=auth.uid() AND active AND deleted_at IS NULL;
  SELECT coalesce(jsonb_agg(attendance_apply_site_visit(attendance_apply_approved_arrival(attendance_apply_tracking_start(
    CASE WHEN attendance_time_review_required(employee,(r->>'date')::date)
    THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL) ELSE r END
    || attendance_adjustment_details(employee,(r->>'date')::date),(r->>'date')::date),employee,(r->>'date')::date))
    || attendance_late_justification_info(employee,(r->>'date')::date) ORDER BY n),'[]')
    INTO days FROM jsonb_array_elements(result->'days') WITH ORDINALITY a(r,n);
  RETURN jsonb_set(result,'{days}',days)||jsonb_build_object('tracking_start',attendance_tracking_start());
END $function$;

CREATE OR REPLACE FUNCTION public.attendance_board(_date date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE result jsonb; rows jsonb; health jsonb;
BEGIN
  result:=attendance_board_before_time_guard(_date);
  SELECT coalesce(jsonb_agg(attendance_apply_site_visit(attendance_apply_approved_arrival(attendance_apply_tracking_start(
    CASE WHEN attendance_time_review_required((r->>'employee_id')::uuid,_date)
    THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL,'time_review_reason','scan_time_unverified') ELSE r END
    || attendance_adjustment_details((r->>'employee_id')::uuid,_date),_date),(r->>'employee_id')::uuid,_date))
    || attendance_late_justification_info((r->>'employee_id')::uuid,_date) ORDER BY n),'[]')
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

CREATE OR REPLACE FUNCTION public.finance_calendar(_employee uuid, _month date, _overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
  result:=finance_calendar_before_time_guard(_employee,_month,_overrides);
  RETURN (SELECT jsonb_agg(
    CASE
    WHEN (g->>'date')::date<attendance_tracking_start() THEN
      g||jsonb_build_object(
        'status',CASE WHEN g->>'status' IN ('present','late','absent','awaiting_scan','needs_review','not_configured')
          THEN 'needs_review' ELSE g->>'status' END,
        'late_minutes',NULL,'review_reason','before_tracking_start','automatic_units',1,
        'units',CASE WHEN wd AND g->>'status' NOT IN ('scheduled','not_employed') AND _overrides ? (g->>'date')
          THEN _overrides->(g->>'date')->'units' ELSE '1'::jsonb END)
    WHEN g->>'status'='not_employed' THEN g||jsonb_build_object('late_minutes',NULL,'automatic_units',0,'units',0)
    WHEN NOT wd THEN g||jsonb_build_object('late_minutes',NULL,'automatic_units',1,'units',1)
    WHEN g->>'status' IN ('on_leave','site_visit') OR (g->>'arrival_approved')::boolean IS TRUE THEN
      g||jsonb_build_object('late_minutes',NULL,'automatic_units',1,
        'units',CASE WHEN _overrides ? (g->>'date') THEN _overrides->(g->>'date')->'units' ELSE '1'::jsonb END)
    WHEN g->>'status'<>'late' THEN g||jsonb_build_object('late_minutes',NULL)
    ELSE g END ORDER BY n)
    FROM (SELECT g, n, coalesce((g->>'working_day')::boolean,false) wd FROM (
      SELECT attendance_apply_site_visit(attendance_apply_approved_arrival(CASE WHEN attendance_time_review_required(_employee,(r->>'date')::date)
        THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL,'automatic_units',NULL,
          'units',CASE WHEN coalesce((r->>'working_day')::boolean,false) AND _overrides ? (r->>'date')
            THEN _overrides->(r->>'date')->'units' ELSE 'null'::jsonb END) ELSE r END
        || attendance_adjustment_details(_employee,(r->>'date')::date),_employee,(r->>'date')::date))
        || attendance_late_justification_info(_employee,(r->>'date')::date) g, n
      FROM jsonb_array_elements(result) WITH ORDINALITY a(r,n)) y) x);
END $function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
