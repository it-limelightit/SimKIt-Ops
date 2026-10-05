BEGIN;

-- Scheduling follows company lifecycle status; earnings retain strict completion checks.
CREATE FUNCTION public.field_ops_company_status(_site public.sites) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE meta JSONB := public.field_ops_site_metadata(_site.task_notes); a JSONB; i JSONB; c JSONB;
  status TEXT := meta->>'status'; latest JSONB; manual BOOLEAN; dispatched BOOLEAN := false; material JSONB; notes JSONB;
BEGIN
  IF NOT public.field_ops_site_active(_site) THEN RETURN 'Dropped / Rejected'; END IF;
  SELECT data INTO a FROM assessment WHERE site_id=_site.id;
  SELECT data INTO i FROM installation WHERE site_id=_site.id;
  SELECT data INTO c FROM commissioning WHERE site_id=_site.id;
  IF jsonb_typeof(meta->'activity_logs')='array' THEN
    SELECT value INTO latest FROM jsonb_array_elements(meta->'activity_logs') WHERE value->>'type'='status_change' LIMIT 1;
  END IF;
  manual := coalesce(meta->>'status_source'='manager' OR latest->>'to_status'=status,false);
  IF (manual OR (meta->>'status_source'='associate' AND NOT (
    coalesce(c->>'commissioning_phase_submitted'='true',false) AND status IN ('In Assessment','Assessed','Panel Dispatched','Installed')))) AND coalesce(status,'')<>'' THEN
    RETURN CASE WHEN status='In Assessment' THEN 'Assessed' ELSE status END;
  END IF;
  IF status IN ('Submitted','Certification Pending','Unsubmitted','Commissioned') THEN RETURN status; END IF;
  IF c->>'commissioning_phase_submitted'='true' THEN RETURN 'Commissioned'; END IF;
  IF status='Installed' THEN RETURN 'Installed'; END IF;
  IF _site.consultant_stage IN ('Completion','Billing') THEN RETURN 'Submitted'; END IF;
  SELECT to_jsonb(m) INTO material FROM inventory_materials m
    WHERE m.submitted IS DISTINCT FROM false AND (
      (length(public.field_ops_company_key(_site.company_name))>0 AND
       (position(public.field_ops_company_key(_site.company_name) IN public.field_ops_company_key(m.material_name))>0 OR position(public.field_ops_company_key(m.material_name) IN public.field_ops_company_key(_site.company_name))>0)) OR
      (length(public.field_ops_company_key(_site.name))>0 AND
       (position(public.field_ops_company_key(_site.name) IN public.field_ops_company_key(m.material_name))>0 OR position(public.field_ops_company_key(m.material_name) IN public.field_ops_company_key(_site.name))>0))) LIMIT 1;
  BEGIN
    notes := CASE WHEN jsonb_typeof(material->'notes')='object' THEN material->'notes' ELSE (material->>'notes')::jsonb END;
  EXCEPTION WHEN invalid_text_representation THEN notes := '{}'::jsonb;
  END;
  dispatched := lower(trim(coalesce(nullif(notes->>'logistics_status',''),material->>'state','Pending'))) IN ('shipped','transit','in transit','delivered');
  IF status='Panel Dispatched' AND dispatched THEN RETURN 'Panel Dispatched'; END IF;
  IF status IN ('Assessed','In Assessment') THEN RETURN 'Assessed'; END IF;
  IF status='Not Started Yet' AND NOT dispatched THEN RETURN status; END IF;
  IF status='Pending Assignment' AND NOT dispatched THEN
    RETURN CASE WHEN EXISTS(SELECT 1 FROM unnest(public.field_ops_worker_ids(_site)) w WHERE w IS NOT NULL) THEN 'Not Started Yet' ELSE status END;
  END IF;
  IF i->>'installation_phase_submitted'='true' OR i @> '{"coordination_done":true,"photos_uploaded":true}' THEN RETURN 'Installed'; END IF;
  IF dispatched THEN RETURN 'Panel Dispatched'; END IF;
  IF a->>'assessment_phase_submitted'='true' OR a @> '{"media_uploaded":true,"factory_operations_done":true}' THEN RETURN 'Assessed'; END IF;
  RETURN CASE WHEN EXISTS(SELECT 1 FROM unnest(public.field_ops_worker_ids(_site)) w WHERE w IS NOT NULL) THEN 'Not Started Yet' ELSE 'Pending Assignment' END;
END $$;

CREATE FUNCTION public.field_ops_company_phase(_site public.sites) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE public.field_ops_company_status(_site)
    WHEN 'Not Started Yet' THEN 'assessment' WHEN 'Pending Assignment' THEN 'assessment'
    WHEN 'Assessed' THEN 'installation' WHEN 'Panel Dispatched' THEN 'installation' WHEN 'Device Order' THEN 'installation'
    WHEN 'Installed' THEN 'commissioning' ELSE 'complete' END
$$;
REVOKE ALL ON FUNCTION public.field_ops_company_status(public.sites), public.field_ops_company_phase(public.sites) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.field_ops_schedule(_site UUID, _associate UUID, _phase TEXT, _date DATE, _shift TEXT, _arrival TIME, _end TIME, _priority TEXT DEFAULT 'normal', _note TEXT DEFAULT NULL) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result UUID; s public.sites; next_phase TEXT;
BEGIN
  SELECT * INTO s FROM sites WHERE id = _site;
  IF auth.uid() IS NULL OR s.id IS NULL OR NOT public.field_ops_associate(_associate) THEN RAISE EXCEPTION 'Select a company and active field associate'; END IF;
  IF NOT coalesce(_associate = ANY(public.field_ops_worker_ids(s)),false) THEN RAISE EXCEPTION 'Company is not assigned to this associate'; END IF;
  IF NOT public.field_ops_site_active(s) THEN RAISE EXCEPTION 'Dropped or rejected companies cannot be scheduled'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN
    IF _associate <> auth.uid() OR _priority <> 'normal' OR _date <> (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Schedule your own companies for today'; END IF;
    IF NOT coalesce((SELECT online FROM field_attendance_events WHERE associate_id=auth.uid() AND work_date=_date ORDER BY occurred_at DESC LIMIT 1),false) THEN RAISE EXCEPTION 'Mark online first'; END IF;
  END IF;
  IF _date IS NULL OR _date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Select today or a future date'; END IF;
  IF _shift IS NULL OR _shift NOT IN ('10:00-12:00','12:00-14:00','14:00-16:00','16:00-18:00','18:00-20:00') OR _arrival IS NULL OR _end IS NULL OR _end <= _arrival THEN RAISE EXCEPTION 'Select a shift and arrival/end times; end must follow arrival'; END IF;
  IF _priority IS NULL OR _priority NOT IN ('normal','high','emergency') THEN RAISE EXCEPTION 'Select a valid priority'; END IF;
  next_phase := public.field_ops_company_phase(s);
  IF next_phase='complete' THEN RAISE EXCEPTION 'Company has no pending visit stage'; END IF;
  IF _phase IS DISTINCT FROM next_phase THEN RAISE EXCEPTION 'Refresh company list; the phase has changed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text || _date::text,0));
  IF EXISTS(SELECT 1 FROM field_visit_schedules WHERE site_id=_site AND assignee_id=_associate AND visit_type=_phase AND scheduled_for=_date AND status <> 'completed') THEN RAISE EXCEPTION 'This company phase is already scheduled for this day'; END IF;
  IF EXISTS(SELECT 1 FROM field_visit_schedules WHERE assignee_id=_associate AND scheduled_for=_date AND status <> 'completed' AND expected_arrival < _end AND expected_end > _arrival) THEN RAISE EXCEPTION 'Arrival/end times overlap another visit'; END IF;
  INSERT INTO field_visit_schedules(site_id,assignee_id,visit_type,scheduled_for,shift,expected_arrival,expected_end,priority,note,created_by)
    VALUES(_site,_associate,_phase,_date,_shift,_arrival,_end,_priority,nullif(trim(_note),''),auth.uid()) RETURNING id INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.field_ops_board() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE staff BOOLEAN := public.is_staff(auth.uid()); result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT (staff OR public.field_ops_associate(auth.uid())) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT jsonb_build_object(
    'today',(now() AT TIME ZONE 'Asia/Kolkata')::date,
    'tracking_started',(SELECT (started_at AT TIME ZONE 'Asia/Kolkata')::date FROM field_operations_rollout),
    'users',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'joined',u.joined,'active',u.active,
      'online',u.active AND coalesce((SELECT online FROM field_attendance_events WHERE associate_id=u.id AND work_date=(now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY occurred_at DESC LIMIT 1),false))) FROM (
        SELECT p.id,coalesce(p.name,p.email) AS name,p.created_at AS joined,p.is_active AS active FROM profiles p
        WHERE public.has_role(p.id,'worker') AND NOT public.is_staff(p.id) AND (p.is_active OR EXISTS(SELECT 1 FROM field_earnings WHERE associate_id=p.id))
        UNION ALL SELECT e.associate_id,max(e.associate_name),min(e.associate_joined),false FROM field_earnings e
        WHERE NOT EXISTS(SELECT 1 FROM profiles WHERE id=e.associate_id) GROUP BY e.associate_id
      ) u WHERE staff OR (u.id=auth.uid() AND u.active)),'[]'::jsonb),
    'attendance',coalesce((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('actor_name',coalesce(p.name,p.email,'Former user')) ORDER BY a.occurred_at DESC) FROM field_attendance_events a LEFT JOIN profiles p ON p.id=a.actor_id WHERE staff OR a.associate_id=auth.uid()),'[]'::jsonb),
    'rates',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM field_work_rates r WHERE staff OR r.associate_id=auth.uid()),'[]'::jsonb),
    'earnings',coalesce((SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object('company_name',coalesce(s.company_name,s.name,e.company_name),
      'eligible',e.eligible AND (e.site_id IS NULL OR public.field_ops_phase_ready(e.site_id,e.phase)),'paid',EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id))) FROM field_earnings e LEFT JOIN sites s ON s.id=e.site_id WHERE staff OR e.associate_id=auth.uid()),'[]'::jsonb),
    'payments',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM field_payment_records p WHERE staff OR p.associate_id=auth.uid()),'[]'::jsonb),
    'date_changes',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM field_earning_date_changes c JOIN field_earnings e ON e.id=c.earning_id WHERE staff OR e.associate_id=auth.uid()),'[]'::jsonb),
    'sites',coalesce((SELECT jsonb_agg(jsonb_build_object('site_id',s.id,'company_name',coalesce(s.company_name,s.name),'worker_ids',public.field_ops_worker_ids(s),
      'active',public.field_ops_site_active(s),'status',public.field_ops_company_status(s),
      'phase',public.field_ops_company_phase(s),
      'assessment_ready',public.field_ops_phase_ready(s.id,'assessment'),'installation_ready',public.field_ops_phase_ready(s.id,'installation'),'commissioning_ready',public.field_ops_phase_ready(s.id,'commissioning'),
      'assessment_completed_at',CASE WHEN public.field_ops_phase_ready(s.id,'assessment') THEN coalesce((SELECT completed_at FROM field_earnings WHERE site_id=s.id AND phase='assessment'),a.updated_at) ELSE NULL END))
      FROM sites s LEFT JOIN assessment a ON a.site_id=s.id WHERE staff OR auth.uid()=ANY(public.field_ops_worker_ids(s))),'[]'::jsonb),
    'visits',coalesce((SELECT jsonb_agg(to_jsonb(v) || jsonb_build_object('company_name',coalesce(s.company_name,s.name)) ORDER BY v.scheduled_for,v.expected_arrival) FROM field_visit_schedules v JOIN sites s ON s.id=v.site_id WHERE staff OR v.assignee_id=auth.uid() OR (auth.uid()=ANY(public.field_ops_worker_ids(s)) AND v.assignee_id=ANY(public.field_ops_worker_ids(s)))),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
