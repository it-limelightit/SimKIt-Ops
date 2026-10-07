-- Additive office/device attendance. No existing field attendance/payroll functions are changed.
BEGIN;
CREATE TABLE public.attendance_devices (
  id text PRIMARY KEY CHECK (id = 'office'),
  label text NOT NULL DEFAULT 'Office face device',
  broker_host text NOT NULL DEFAULT '62.72.43.204',
  broker_port integer NOT NULL DEFAULT 1883,
  last_heartbeat_at timestamptz,
  last_scan_at timestamptz
);
INSERT INTO public.attendance_devices(id) VALUES ('office');
CREATE TABLE public.attendance_settings (
  effective_from date PRIMARY KEY,
  shift_start time NOT NULL,
  grace_minutes integer NOT NULL CHECK (grace_minutes BETWEEN 0 AND 120),
  absence_cutoff time,
  working_days integer[] NOT NULL CHECK (cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ ARRAY[0,1,2,3,4,5,6]),
  holidays date[] NOT NULL DEFAULT '{}',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (extract(epoch FROM absence_cutoff) > extract(epoch FROM shift_start) + grace_minutes * 60)
);
-- User confirmed 10 AM; choose 15 minutes from the allowed 10-15 minute range.
-- Leave absence cutoff unset until the manager confirms the working calendar.
INSERT INTO public.attendance_settings(effective_from,shift_start,grace_minutes,working_days)
VALUES((now() AT TIME ZONE 'Asia/Kolkata')::date,'10:00',15,ARRAY[0,1,2,3,4,5,6]);
CREATE TABLE public.attendance_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL DEFAULT 'office' REFERENCES public.attendance_devices(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  department text NOT NULL CHECK (department IN ('firmware','hardware','logistic','software','manager')),
  enroll_id text NOT NULL CHECK (length(btrim(enroll_id)) BETWEEN 1 AND 64),
  email text CHECK (email IS NULL OR email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  email_verified boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  employment_start date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  deactivated_at timestamptz,
  enrollment_status text NOT NULL DEFAULT 'pending' CHECK (enrollment_status IN ('pending','enrolled','failed')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id,enroll_id)
);
CREATE UNIQUE INDEX attendance_employee_email ON public.attendance_employees(lower(email)) WHERE email IS NOT NULL;
CREATE TABLE public.attendance_device_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.attendance_employees(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','publishing','published','acknowledged','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);
CREATE UNIQUE INDEX attendance_one_open_command ON public.attendance_device_commands(employee_id) WHERE status IN ('pending','publishing','published');
CREATE INDEX ON public.attendance_device_commands(next_attempt_at) WHERE status IN ('pending','publishing','published');
CREATE TABLE public.attendance_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL REFERENCES public.attendance_devices(id),
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 128),
  enroll_id text NOT NULL CHECK (length(enroll_id) BETWEEN 1 AND 64),
  employee_id uuid REFERENCES public.attendance_employees(id),
  scanned_at timestamptz NOT NULL,
  recognized boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  work_date date NOT NULL,
  validation_state text NOT NULL CHECK (validation_state IN ('valid','unknown_employee','inactive_employee','invalid_time','failed_recognition')),
  UNIQUE(device_id,event_id)
);
CREATE INDEX ON public.attendance_scan_events(employee_id,work_date,scanned_at);
CREATE TABLE public.attendance_daily_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.attendance_employees(id),
  work_date date NOT NULL,
  first_event_id uuid NOT NULL REFERENCES public.attendance_scan_events(id),
  entry_at timestamptz NOT NULL,
  employee_name text NOT NULL,
  department text NOT NULL,
  policy_snapshot jsonb,
  late_minutes integer,
  UNIQUE(employee_id,work_date)
);
CREATE TABLE public.attendance_photos (
  event_id uuid PRIMARY KEY REFERENCES public.attendance_scan_events(id),
  storage_path text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available','deleted')),
  deleted_at timestamptz
);
CREATE INDEX ON public.attendance_photos(expires_at) WHERE status <> 'deleted';
CREATE TABLE public.attendance_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.attendance_employees(id),
  sender_email text,
  start_date date,
  end_date date,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  source text NOT NULL CHECK (source IN ('manual','email')),
  message_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','needs_review','approved','rejected','cancelled')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX ON public.attendance_leave_requests(employee_id,start_date,end_date);
CREATE TABLE public.attendance_device_health (
  work_date date PRIMARY KEY,
  first_heartbeat_at timestamptz NOT NULL,
  last_heartbeat_at timestamptz NOT NULL,
  gap_detected boolean NOT NULL
);
CREATE TABLE public.attendance_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  record_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Read access only for managers. All writes use guarded RPCs or service-role functions.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_devices','attendance_settings','attendance_employees','attendance_device_commands','attendance_scan_events','attendance_daily_records','attendance_photos','attendance_leave_requests','attendance_device_health','attendance_audit_logs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
    EXECUTE format('CREATE POLICY attendance_manager_read ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(),''supervisor''))',t);
  END LOOP;
END $$;

CREATE FUNCTION public.attendance_assert_manager() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$ BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'supervisor') THEN RAISE EXCEPTION 'Manager access required' USING ERRCODE = '42501'; END IF;
END $$;

CREATE FUNCTION public.attendance_save_employee(_name text,_department text,_enroll_id text,_email text DEFAULT NULL,_email_verified boolean DEFAULT false,_start date DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE employee uuid; BEGIN
  PERFORM attendance_assert_manager();
  IF _start > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Employment start cannot be in the future'; END IF;
  INSERT INTO attendance_employees(name,department,enroll_id,email,email_verified,employment_start,created_by)
    VALUES(btrim(_name),_department,btrim(_enroll_id),nullif(lower(btrim(_email)),''),_email_verified AND nullif(btrim(_email),'') IS NOT NULL,coalesce(_start,(now() AT TIME ZONE 'Asia/Kolkata')::date),auth.uid()) RETURNING id INTO employee;
  INSERT INTO attendance_device_commands(employee_id) VALUES(employee);
  INSERT INTO attendance_audit_logs(actor_id,action,record_id) VALUES(auth.uid(),'employee_created',employee);
  RETURN employee;
END $$;

CREATE FUNCTION public.attendance_retry_enrollment(_employee uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
  PERFORM attendance_assert_manager();
  PERFORM 1 FROM attendance_employees WHERE id=_employee AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active employee not found'; END IF;
  IF EXISTS(SELECT 1 FROM attendance_device_commands WHERE employee_id=_employee AND status IN ('pending','publishing','published')) THEN RETURN; END IF;
  INSERT INTO attendance_device_commands(employee_id) VALUES(_employee);
  UPDATE attendance_employees SET enrollment_status='pending' WHERE id=_employee;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id) VALUES(auth.uid(),'enrollment_retried',_employee);
END $$;

CREATE FUNCTION public.attendance_set_active(_employee uuid,_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
  PERFORM attendance_assert_manager();
  IF _active IS NULL THEN RAISE EXCEPTION 'Active state required'; END IF;
  UPDATE attendance_employees SET active=_active,deactivated_at=CASE WHEN _active THEN NULL ELSE clock_timestamp() END WHERE id=_employee;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details) VALUES(auth.uid(),'employee_active_changed',_employee,jsonb_build_object('active',_active,'device_sync',false));
END $$;

CREATE FUNCTION public.attendance_save_settings(_start time,_grace integer,_cutoff time,_days integer[],_holidays date[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
  PERFORM attendance_assert_manager();
  IF _start IS NULL OR _grace IS NULL OR _cutoff IS NULL OR _days IS NULL THEN RAISE EXCEPTION 'Complete office timing and working days required'; END IF;
  INSERT INTO attendance_settings VALUES((now() AT TIME ZONE 'Asia/Kolkata')::date,_start,_grace,_cutoff,_days,coalesce(_holidays,'{}'),auth.uid(),now())
    ON CONFLICT(effective_from) DO UPDATE SET shift_start=excluded.shift_start,grace_minutes=excluded.grace_minutes,absence_cutoff=excluded.absence_cutoff,working_days=excluded.working_days,holidays=excluded.holidays,updated_by=auth.uid(),updated_at=now();
  INSERT INTO attendance_audit_logs(actor_id,action,details) VALUES(auth.uid(),'settings_saved',jsonb_build_object('start',_start,'grace',_grace,'cutoff',_cutoff,'days',_days,'holidays',_holidays));
END $$;

CREATE FUNCTION public.attendance_create_leave(_employee uuid,_start date,_end date,_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE request uuid; BEGIN
  PERFORM attendance_assert_manager();
  IF _start IS NULL OR _end IS NULL OR _employee IS NULL THEN RAISE EXCEPTION 'Employee and dates required'; END IF;
  PERFORM 1 FROM attendance_employees WHERE id=_employee AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active employee not found'; END IF;
  INSERT INTO attendance_leave_requests(employee_id,start_date,end_date,reason,source) VALUES(_employee,_start,_end,btrim(_reason),'manual') RETURNING id INTO request;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id) VALUES(auth.uid(),'leave_created',request);
  RETURN request;
END $$;

CREATE FUNCTION public.attendance_review_leave(_request uuid,_decision text,_comment text DEFAULT NULL,_employee uuid DEFAULT NULL,_start date DEFAULT NULL,_end date DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE r attendance_leave_requests; BEGIN
  PERFORM attendance_assert_manager();
  IF _decision NOT IN ('approved','rejected','cancelled') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO r FROM attendance_leave_requests WHERE id=_request FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
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

-- Service-only atomic ingestion: event identity is immutable; duplicates may retry photos.
CREATE FUNCTION public.attendance_ingest_scan(_event_id text,_enroll_id text,_scanned_at timestamptz,_recognized boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e attendance_employees; s attendance_scan_events; p attendance_settings; d date; state text; threshold timestamptz; minutes integer; prior attendance_daily_records;
BEGIN
  IF _scanned_at IS NULL OR _event_id IS NULL OR _enroll_id IS NULL OR _recognized IS NULL THEN RAISE EXCEPTION 'Missing scan fields'; END IF;
  d := (_scanned_at AT TIME ZONE 'Asia/Kolkata')::date;
  SELECT * INTO e FROM attendance_employees WHERE device_id='office' AND enroll_id=_enroll_id;
  state := CASE WHEN NOT _recognized THEN 'failed_recognition' WHEN _scanned_at>now()+interval '5 minutes' OR _scanned_at<now()-interval '90 days' THEN 'invalid_time' WHEN e.id IS NULL THEN 'unknown_employee' WHEN d<e.employment_start OR (e.deactivated_at IS NOT NULL AND _scanned_at>e.deactivated_at) THEN 'inactive_employee' ELSE 'valid' END;
  INSERT INTO attendance_scan_events(device_id,event_id,enroll_id,employee_id,scanned_at,recognized,work_date,validation_state) VALUES('office',_event_id,_enroll_id,e.id,_scanned_at,_recognized,d,state) ON CONFLICT(device_id,event_id) DO NOTHING RETURNING * INTO s;
  IF s.id IS NULL THEN
    SELECT * INTO s FROM attendance_scan_events WHERE device_id='office' AND event_id=_event_id;
    IF s.enroll_id<>_enroll_id OR s.scanned_at<>_scanned_at OR s.recognized<>_recognized THEN RAISE EXCEPTION 'Event ID reused with different scan details'; END IF;
    RETURN jsonb_build_object('id',s.id,'state',s.validation_state,'duplicate',true,'expires_at',s.scanned_at+interval '24 hours');
  END IF;
  UPDATE attendance_devices SET last_scan_at=clock_timestamp() WHERE id='office';
  IF state='valid' THEN
    -- Serialize aggregation per employee/date, including the first concurrent scan.
    PERFORM pg_advisory_xact_lock(hashtextextended(e.id::text||d::text,0));
    SELECT * INTO prior FROM attendance_daily_records WHERE employee_id=e.id AND work_date=d;
    SELECT * INTO p FROM attendance_settings WHERE effective_from<=d ORDER BY effective_from DESC LIMIT 1;
    IF prior.id IS NOT NULL THEN
      threshold := ((d + (prior.policy_snapshot->>'shift_start')::time) AT TIME ZONE 'Asia/Kolkata') + (prior.policy_snapshot->>'grace_minutes')::integer*interval '1 minute';
    ELSIF p.effective_from IS NOT NULL THEN
      threshold := ((d+p.shift_start) AT TIME ZONE 'Asia/Kolkata') + p.grace_minutes*interval '1 minute';
    END IF;
    minutes := CASE WHEN threshold IS NULL THEN NULL ELSE greatest(0,ceil(extract(epoch FROM (_scanned_at-threshold))/60)::integer) END;
    INSERT INTO attendance_daily_records(employee_id,work_date,first_event_id,entry_at,employee_name,department,policy_snapshot,late_minutes)
      VALUES(e.id,d,s.id,_scanned_at,e.name,e.department,CASE WHEN p.effective_from IS NULL THEN NULL ELSE to_jsonb(p) END,minutes)
      ON CONFLICT(employee_id,work_date) DO UPDATE SET first_event_id=excluded.first_event_id,entry_at=excluded.entry_at,late_minutes=excluded.late_minutes WHERE excluded.entry_at<attendance_daily_records.entry_at;
    IF prior.id IS NOT NULL AND _scanned_at<prior.entry_at THEN
      INSERT INTO attendance_audit_logs(action,record_id,details) VALUES('earlier_scan_received',prior.id,jsonb_build_object('before',prior.entry_at,'after',_scanned_at));
    END IF;
  END IF;
  RETURN jsonb_build_object('id',s.id,'state',state,'duplicate',false,'expires_at',_scanned_at+interval '24 hours');
END $$;

CREATE FUNCTION public.attendance_heartbeat() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE stamp timestamptz := clock_timestamp(); d date; p attendance_settings; BEGIN
  d := (stamp AT TIME ZONE 'Asia/Kolkata')::date;
  SELECT * INTO p FROM attendance_settings WHERE effective_from<=d ORDER BY effective_from DESC LIMIT 1;
  UPDATE attendance_devices SET last_heartbeat_at=stamp WHERE id='office';
  INSERT INTO attendance_device_health VALUES(d,stamp,stamp,p.effective_from IS NULL OR p.absence_cutoff IS NULL OR stamp>((d+p.shift_start) AT TIME ZONE 'Asia/Kolkata')+interval '5 minutes')
  ON CONFLICT(work_date) DO UPDATE SET last_heartbeat_at=excluded.last_heartbeat_at,gap_detected=attendance_device_health.gap_detected OR (excluded.last_heartbeat_at-attendance_device_health.last_heartbeat_at>interval '5 minutes' AND excluded.last_heartbeat_at>((d+p.shift_start) AT TIME ZONE 'Asia/Kolkata') AND (attendance_device_health.last_heartbeat_at AT TIME ZONE 'Asia/Kolkata')::time < p.absence_cutoff);
END $$;

CREATE FUNCTION public.attendance_claim_commands(_employee uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE result jsonb; BEGIN
  UPDATE attendance_device_commands SET status='failed',error='Device acknowledgment not received; review before retry' WHERE status='published' AND next_attempt_at<=now();
  UPDATE attendance_device_commands SET status='failed',error='Publish retry limit reached; review before retry' WHERE status='publishing' AND attempts>=5 AND lease_until<now();
  UPDATE attendance_employees e SET enrollment_status='failed' WHERE EXISTS(SELECT 1 FROM attendance_device_commands c WHERE c.employee_id=e.id AND c.status='failed') AND NOT EXISTS(SELECT 1 FROM attendance_device_commands c WHERE c.employee_id=e.id AND c.status IN ('pending','publishing','published')) AND e.enrollment_status<>'enrolled';
  WITH claimed AS (
    SELECT c.id FROM attendance_device_commands c JOIN attendance_employees e ON e.id=c.employee_id WHERE e.active AND (_employee IS NULL OR c.employee_id=_employee) AND c.attempts<5 AND ((c.status='pending' AND c.next_attempt_at<=now()) OR (c.status='publishing' AND c.lease_until<now())) ORDER BY c.created_at FOR UPDATE OF c SKIP LOCKED LIMIT 5
  ), changed AS (
    UPDATE attendance_device_commands c SET status='publishing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' FROM claimed WHERE c.id=claimed.id RETURNING c.*
  ) SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('name',e.name,'department',e.department,'enroll_id',e.enroll_id)),'[]') INTO result FROM changed c JOIN attendance_employees e ON e.id=c.employee_id;
  RETURN result;
END $$;

CREATE FUNCTION public.attendance_finish_command(_id uuid,_lease uuid,_sent boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
  UPDATE attendance_device_commands SET status=CASE WHEN _sent THEN 'published' WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,error=CASE WHEN _sent THEN NULL ELSE 'Publishing failed; check integration configuration or connectivity' END,next_attempt_at=now()+CASE WHEN _sent THEN interval '10 minutes' ELSE least(3600,power(2,attempts)::integer*30)*interval '1 second' END,lease_until=NULL
    WHERE id=_id AND lease_token=_lease AND status='publishing';
  UPDATE attendance_employees e SET enrollment_status='failed' FROM attendance_device_commands c WHERE c.id=_id AND c.employee_id=e.id AND c.status='failed';
END $$;

CREATE FUNCTION public.attendance_ack_command(_id uuid,_enroll_id text,_success boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE employee uuid; BEGIN
  IF _success IS NULL THEN RAISE EXCEPTION 'Acknowledgment success required'; END IF;
  SELECT c.employee_id INTO employee FROM attendance_device_commands c JOIN attendance_employees e ON e.id=c.employee_id WHERE c.id=_id AND e.enroll_id=_enroll_id FOR UPDATE OF c;
  IF employee IS NULL THEN RAISE EXCEPTION 'Unknown enrollment command'; END IF;
  -- Ignore responses to superseded commands and repeated terminal acknowledgments.
  IF EXISTS(SELECT 1 FROM attendance_device_commands WHERE employee_id=employee AND created_at>(SELECT created_at FROM attendance_device_commands WHERE id=_id)) OR EXISTS(SELECT 1 FROM attendance_device_commands WHERE id=_id AND status='acknowledged') THEN RETURN; END IF;
  UPDATE attendance_device_commands SET status=CASE WHEN _success THEN 'acknowledged' ELSE 'failed' END,acknowledged_at=now(),error=CASE WHEN _success THEN NULL ELSE 'Device rejected enrollment' END WHERE id=_id;
  UPDATE attendance_employees SET enrollment_status=CASE WHEN _success THEN 'enrolled' ELSE 'failed' END WHERE id=employee;
  INSERT INTO attendance_audit_logs(action,record_id,details) VALUES('device_enrollment_ack',_id,jsonb_build_object('success',_success));
END $$;

CREATE FUNCTION public.attendance_email_leave(_message_id text,_sender text,_start date,_end date,_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE employee uuid; request uuid; review boolean; BEGIN
  SELECT id INTO employee FROM attendance_employees WHERE lower(email)=lower(_sender) AND email_verified AND active;
  review := employee IS NULL OR _start IS NULL OR _end IS NULL OR _end<_start OR EXISTS(SELECT 1 FROM attendance_leave_requests WHERE employee_id=employee AND status IN ('pending','approved') AND start_date<=_end AND end_date>=_start);
  INSERT INTO attendance_leave_requests(employee_id,sender_email,start_date,end_date,reason,source,message_id,status) VALUES(employee,left(_sender,254),CASE WHEN _end>=_start THEN _start END,CASE WHEN _end>=_start THEN _end END,left(_reason,2000),'email',_message_id,CASE WHEN review THEN 'needs_review' ELSE 'pending' END) ON CONFLICT(message_id) DO NOTHING RETURNING id INTO request;
  RETURN coalesce(request,(SELECT id FROM attendance_leave_requests WHERE message_id=_message_id));
END $$;

CREATE FUNCTION public.attendance_board(_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$ DECLARE result jsonb; p attendance_settings; BEGIN
  PERFORM attendance_assert_manager();
  IF _date IS NULL THEN RAISE EXCEPTION 'Date required'; END IF;
  SELECT * INTO p FROM attendance_settings WHERE effective_from<=_date ORDER BY effective_from DESC LIMIT 1;
  SELECT jsonb_build_object(
    'settings',(SELECT to_jsonb(s) FROM attendance_settings s ORDER BY effective_from DESC LIMIT 1),
    'device',(SELECT to_jsonb(d)||jsonb_build_object('state',CASE WHEN last_heartbeat_at IS NULL THEN 'unknown' WHEN last_heartbeat_at<now()-interval '5 minutes' THEN 'offline' ELSE 'online' END) FROM attendance_devices d WHERE id='office'),
    'employees',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.name),'[]') FROM attendance_employees e),
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
    'leaves',(SELECT coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('employee_name',e.name) ORDER BY l.created_at DESC),'[]') FROM (SELECT * FROM attendance_leave_requests ORDER BY created_at DESC LIMIT 200) l LEFT JOIN attendance_employees e ON e.id=l.employee_id),
    'review_events',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.received_at DESC),'[]') FROM (SELECT * FROM attendance_scan_events WHERE work_date=_date AND validation_state<>'valid' ORDER BY received_at DESC LIMIT 100) s),
    'server_time',now()
  ) INTO result;
  RETURN result;
END $$;

CREATE FUNCTION public.attendance_history(_employee uuid,_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$ BEGIN
  PERFORM attendance_assert_manager();
  RETURN jsonb_build_object(
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('photo_status',p.status,'photo_expires_at',p.expires_at) ORDER BY e.scanned_at),'[]') FROM attendance_scan_events e LEFT JOIN attendance_photos p ON p.event_id=e.id WHERE e.employee_id=_employee AND e.work_date=_date),
    'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.occurred_at DESC),'[]') FROM attendance_audit_logs a WHERE a.record_id IN (SELECT id FROM attendance_daily_records WHERE employee_id=_employee AND work_date=_date))
  );
END $$;

-- Explicit grants prevent public/anonymous invocation of privileged helpers.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'attendance_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
    IF f.proname IN ('attendance_assert_manager','attendance_save_employee','attendance_retry_enrollment','attendance_set_active','attendance_save_settings','attendance_create_leave','attendance_review_leave','attendance_board','attendance_history') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
  END LOOP;
END $$;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('attendance-photos','attendance-photos',false,2097152,ARRAY['image/jpeg','image/png']) ON CONFLICT(id) DO NOTHING;
-- No authenticated storage policy: photo access is issued by the guarded Edge Function only.
COMMIT;
