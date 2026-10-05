-- Additive field operations. Existing phase submission/approval RPCs are unchanged.
BEGIN;

CREATE TABLE public.field_attendance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  associate_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  online BOOLEAN NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  work_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date
);
CREATE TABLE public.field_operations_rollout (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.field_operations_rollout DEFAULT VALUES;
CREATE INDEX ON public.field_attendance_events(associate_id, work_date, occurred_at DESC);
CREATE TABLE public.field_work_rates (
  associate_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  assessment NUMERIC(12,2) NOT NULL CHECK (assessment >= 0),
  installation NUMERIC(12,2) NOT NULL CHECK (installation >= 0),
  commissioning NUMERIC(12,2) NOT NULL CHECK (commissioning >= 0),
  updated_by UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.field_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  associate_id UUID NOT NULL,
  associate_name TEXT NOT NULL,
  associate_joined TIMESTAMPTZ NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('assessment','installation','commissioning')),
  completed_at TIMESTAMPTZ NOT NULL,
  earning_date DATE NOT NULL,
  amount NUMERIC(12,2) CHECK (amount >= 0),
  eligible BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(site_id, phase)
);
CREATE INDEX ON public.field_earnings(associate_id, earning_date);
CREATE TABLE public.field_earning_date_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  earning_id UUID NOT NULL REFERENCES public.field_earnings(id),
  old_date DATE NOT NULL,
  new_date DATE NOT NULL,
  reason TEXT NOT NULL,
  actor_id UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Clearance is a manual payment record, never a transfer of money.
CREATE TABLE public.field_payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  associate_id UUID NOT NULL,
  period_end DATE NOT NULL CHECK (extract(day FROM period_end) = 15),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL,
  reference TEXT,
  recorded_by UUID NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(associate_id, period_end)
);
CREATE TABLE public.field_payment_items (
  payment_id UUID NOT NULL REFERENCES public.field_payment_records(id),
  earning_id UUID PRIMARY KEY REFERENCES public.field_earnings(id),
  amount NUMERIC(12,2) NOT NULL
);

ALTER TABLE public.field_visit_schedules ADD COLUMN shift TEXT;
ALTER TABLE public.field_visit_schedules ADD COLUMN expected_arrival TIME;
ALTER TABLE public.field_visit_schedules ADD COLUMN expected_end TIME;
ALTER TABLE public.field_visit_schedules ADD CONSTRAINT field_visit_time_order CHECK (
  expected_arrival IS NULL OR expected_end > expected_arrival
);

-- Parse only the metadata block used by the application; free-form notes stay untouched.
CREATE FUNCTION public.field_ops_site_metadata(_notes TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE raw TEXT; pos INT; start_pos INT; depth INT := 0; quoted BOOLEAN := false; escaped BOOLEAN := false; ch TEXT;
BEGIN
  pos := position('[METADATA:' IN coalesce(_notes,''));
  IF pos > 0 THEN
    start_pos := pos + length('[METADATA:');
    FOR pos IN start_pos..length(_notes) LOOP
      ch := substring(_notes,pos,1);
      IF escaped THEN escaped := false;
      ELSIF quoted AND ch = chr(92) THEN escaped := true;
      ELSIF ch = '"' THEN quoted := NOT quoted;
      ELSIF NOT quoted AND ch = '{' THEN depth := depth + 1;
      ELSIF NOT quoted AND ch = '}' THEN
        depth := depth - 1;
        IF depth = 0 THEN raw := substring(_notes,start_pos,pos-start_pos+1); EXIT; END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN coalesce(raw::jsonb,'{}'::jsonb);
EXCEPTION WHEN invalid_text_representation THEN RETURN '{}'::jsonb;
END $$;
CREATE FUNCTION public.field_ops_worker_ids(_site public.sites) RETURNS UUID[]
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE result UUID[];
BEGIN
  BEGIN
    SELECT array_agg(value::uuid) INTO result FROM jsonb_array_elements_text(public.field_ops_site_metadata(_site.task_notes)->'worker_ids');
  EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN result := NULL;
  END;
  RETURN coalesce(result, ARRAY[_site.assigned_worker_id]::uuid[]);
END $$;
CREATE FUNCTION public.field_ops_site_active(_site public.sites) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT lower(coalesce(public.field_ops_site_metadata(_site.task_notes)->>'status','')) !~ '(drop|reject)'
    AND lower(coalesce(_site.consultant_stage,'')) !~ '(drop|reject)'
$$;
CREATE FUNCTION public.field_ops_associate(_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM profiles p WHERE p.id = _id AND p.is_active)
    AND public.has_role(_id, 'worker') AND NOT public.is_staff(_id)
$$;
CREATE FUNCTION public.field_ops_period_end(_date DATE) RETURNS DATE
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (date_trunc('month', _date)::date +
    CASE WHEN extract(day FROM _date) > 15 THEN interval '1 month' ELSE interval '0 month' END + interval '14 days')::date
$$;
CREATE FUNCTION public.field_ops_company_key(_name TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(_name,'')),
    '^m/s\.?\s+|^ms\.?\s+','','g'), '\s+pvt\.?\s*ltd\.?|\s+private\s+limited','','g'),
    '\s+ltd\.?','','g'),'[^a-z0-9]','','g')
$$;
CREATE FUNCTION public.field_ops_phase_ready(_site UUID, _phase TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d JSONB;
BEGIN
  IF _phase = 'assessment' THEN
    SELECT data INTO d FROM assessment WHERE site_id = _site;
    RETURN coalesce(d @> '{"assessment_phase_submitted":true,"mom_uploaded":true,"media_uploaded":true,"factory_operations_done":true}', false)
      AND (coalesce(d->>'device_order_completed','false') = 'true' OR EXISTS (
        SELECT 1 FROM inventory_materials m JOIN sites s ON s.id = _site
        WHERE m.submitted = true AND (
          (length(public.field_ops_company_key(s.company_name)) > 0 AND length(public.field_ops_company_key(m.material_name)) > 0
          AND (position(public.field_ops_company_key(s.company_name) IN public.field_ops_company_key(m.material_name)) > 0
            OR position(public.field_ops_company_key(m.material_name) IN public.field_ops_company_key(s.company_name)) > 0))
          OR (length(public.field_ops_company_key(s.name)) > 0 AND length(public.field_ops_company_key(m.material_name)) > 0
          AND (position(public.field_ops_company_key(s.name) IN public.field_ops_company_key(m.material_name)) > 0
            OR position(public.field_ops_company_key(m.material_name) IN public.field_ops_company_key(s.name)) > 0))
        )
      ));
  ELSIF _phase = 'installation' THEN
    SELECT data INTO d FROM installation WHERE site_id = _site;
    RETURN coalesce(d @> '{"installation_phase_submitted":true,"coordination_done":true,"photos_uploaded":true}', false);
  ELSIF _phase = 'commissioning' THEN
    SELECT data INTO d FROM commissioning WHERE site_id = _site;
    RETURN coalesce(d->>'commissioning_phase_submitted','false') = 'true'
      AND EXISTS(SELECT 1 FROM commissioning_approval_requests WHERE site_id = _site AND status = 'approved');
  END IF;
  RETURN false;
END $$;

CREATE TABLE public.field_existing_completions (
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  PRIMARY KEY(site_id,phase)
);
-- Remember completed work at rollout so later edits cannot create historical payroll.
INSERT INTO public.field_existing_completions(site_id,phase)
  SELECT s.id,p.phase FROM public.sites s CROSS JOIN (VALUES('assessment'),('installation'),('commissioning')) p(phase)
  WHERE public.field_ops_phase_ready(s.id,p.phase);

-- Only new completion transitions create earnings. No automatic historical payroll backfill.
CREATE FUNCTION public.field_ops_capture_earning() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE worker UUID; stamp TIMESTAMPTZ; rate NUMERIC; ready BOOLEAN; previous public.field_earnings;
BEGIN
  ready := public.field_ops_phase_ready(NEW.site_id, TG_TABLE_NAME);
  SELECT * INTO previous FROM field_earnings WHERE site_id = NEW.site_id AND phase = TG_TABLE_NAME FOR UPDATE;
  IF previous.id IS NOT NULL THEN
    -- Paid entries are immutable; live eligibility is still checked before reporting/payment.
    IF NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id = previous.id) THEN
      UPDATE field_earnings SET eligible = ready WHERE id = previous.id;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ready THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM field_existing_completions WHERE site_id=NEW.site_id AND phase=TG_TABLE_NAME) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.data IS NOT DISTINCT FROM OLD.data THEN RETURN NEW; END IF;
  worker := NEW.worker_id;
  IF TG_TABLE_NAME = 'commissioning' THEN
    SELECT requested_by, reviewed_at INTO worker, stamp FROM commissioning_approval_requests WHERE site_id = NEW.site_id AND status = 'approved';
  END IF;
  -- Manager edits must not replace the associate's entitlement with the editing manager.
  IF TG_TABLE_NAME <> 'commissioning' AND NOT public.field_ops_associate(worker) THEN
    IF TG_OP = 'UPDATE' AND public.field_ops_associate(OLD.worker_id) THEN worker := OLD.worker_id;
    ELSE SELECT assigned_worker_id INTO worker FROM sites WHERE id = NEW.site_id;
    END IF;
  END IF;
  IF NOT public.field_ops_associate(worker) THEN RETURN NEW; END IF;
  stamp := coalesce(stamp, now());
  SELECT CASE TG_TABLE_NAME WHEN 'assessment' THEN assessment WHEN 'installation' THEN installation ELSE commissioning END
    INTO rate FROM field_work_rates WHERE associate_id = worker;
  INSERT INTO field_earnings(site_id,company_name,associate_id,associate_name,associate_joined,phase,completed_at,earning_date,amount)
    SELECT NEW.site_id,coalesce(s.company_name,s.name),worker,coalesce(p.name,p.email,'Field associate'),p.created_at,TG_TABLE_NAME,stamp,(stamp AT TIME ZONE 'Asia/Kolkata')::date,rate
    FROM sites s JOIN profiles p ON p.id=worker WHERE s.id=NEW.site_id
    ON CONFLICT(site_id,phase) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER field_ops_assessment_earning AFTER INSERT OR UPDATE ON public.assessment FOR EACH ROW EXECUTE FUNCTION public.field_ops_capture_earning();
CREATE TRIGGER field_ops_installation_earning AFTER INSERT OR UPDATE ON public.installation FOR EACH ROW EXECUTE FUNCTION public.field_ops_capture_earning();
CREATE TRIGGER field_ops_commissioning_earning AFTER INSERT OR UPDATE ON public.commissioning FOR EACH ROW EXECUTE FUNCTION public.field_ops_capture_earning();

-- An externally submitted device order can be the last required assessment item.
-- Capture the earning without changing the assessment form or its timestamps.
CREATE FUNCTION public.field_ops_device_order_earning() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.submitted IS DISTINCT FROM true THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.submitted IS NOT DISTINCT FROM NEW.submitted AND OLD.material_name IS NOT DISTINCT FROM NEW.material_name THEN RETURN NEW; END IF;
  INSERT INTO field_earnings(site_id,company_name,associate_id,associate_name,associate_joined,phase,completed_at,earning_date,amount)
    SELECT a.site_id,coalesce(s.company_name,s.name),w.worker,coalesce(p.name,p.email,'Field associate'),p.created_at,'assessment',now(),(now() AT TIME ZONE 'Asia/Kolkata')::date,r.assessment
    FROM assessment a JOIN sites s ON s.id=a.site_id
    CROSS JOIN LATERAL (SELECT CASE WHEN public.field_ops_associate(a.worker_id) THEN a.worker_id ELSE s.assigned_worker_id END AS worker) w
    JOIN profiles p ON p.id=w.worker
    LEFT JOIN field_work_rates r ON r.associate_id=w.worker
    WHERE public.field_ops_associate(w.worker) AND public.field_ops_phase_ready(a.site_id,'assessment')
      AND NOT EXISTS(SELECT 1 FROM field_existing_completions h WHERE h.site_id=a.site_id AND h.phase='assessment')
    ON CONFLICT(site_id,phase) DO UPDATE SET eligible=true;
  RETURN NEW;
END $$;
CREATE TRIGGER field_ops_device_order_earning AFTER INSERT OR UPDATE ON public.inventory_materials FOR EACH ROW EXECUTE FUNCTION public.field_ops_device_order_earning();

-- Protect the legacy status endpoint too; dual-role visits keep their existing behavior.
CREATE FUNCTION public.field_ops_visit_completion_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status='completed' AND OLD.status <> 'completed' AND public.field_ops_associate(NEW.assignee_id)
    AND NOT public.field_ops_phase_ready(NEW.site_id,NEW.visit_type) THEN
    RAISE EXCEPTION 'Complete all required phase work and approval before completing this visit';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER field_ops_visit_completion_guard BEFORE UPDATE ON public.field_visit_schedules FOR EACH ROW EXECUTE FUNCTION public.field_ops_visit_completion_guard();

CREATE FUNCTION public.field_ops_attendance(_associate UUID, _online BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.field_ops_associate(_associate) THEN RAISE EXCEPTION 'Select an active field associate'; END IF;
  IF NOT public.is_staff(auth.uid()) AND (_associate <> auth.uid() OR NOT _online) THEN RAISE EXCEPTION 'Access denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text,0));
  IF (SELECT online FROM field_attendance_events WHERE associate_id = _associate AND work_date = (now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY occurred_at DESC LIMIT 1) IS NOT DISTINCT FROM _online THEN RETURN; END IF;
  INSERT INTO field_attendance_events(associate_id,actor_id,online) VALUES(_associate,auth.uid(),_online);
END $$;

CREATE FUNCTION public.field_ops_set_rates(_associate UUID, _assessment NUMERIC, _installation NUMERIC, _commissioning NUMERIC) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) OR NOT public.field_ops_associate(_associate) THEN RAISE EXCEPTION 'Manager access required'; END IF;
  IF _assessment IS NULL OR _installation IS NULL OR _commissioning IS NULL OR least(_assessment,_installation,_commissioning) < 0 THEN RAISE EXCEPTION 'Enter non-negative rates'; END IF;
  INSERT INTO field_work_rates(associate_id,assessment,installation,commissioning,updated_by)
    VALUES(_associate,_assessment,_installation,_commissioning,auth.uid())
    ON CONFLICT(associate_id) DO UPDATE SET assessment=EXCLUDED.assessment, installation=EXCLUDED.installation, commissioning=EXCLUDED.commissioning, updated_by=auth.uid(), updated_at=now();
  -- Resolve unpriced work once; never reprice existing amounts.
  UPDATE field_earnings SET amount = CASE phase WHEN 'assessment' THEN _assessment WHEN 'installation' THEN _installation ELSE _commissioning END
    WHERE associate_id = _associate AND amount IS NULL;
END $$;

CREATE FUNCTION public.field_ops_schedule(_site UUID, _associate UUID, _phase TEXT, _date DATE, _shift TEXT, _arrival TIME, _end TIME, _priority TEXT DEFAULT 'normal', _note TEXT DEFAULT NULL) RETURNS UUID
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
  IF public.field_ops_phase_ready(_site,'commissioning') THEN RAISE EXCEPTION 'Company is already commissioned'; END IF;
  next_phase := CASE WHEN public.field_ops_phase_ready(_site,'installation') THEN 'commissioning'
    WHEN EXISTS(SELECT 1 FROM assessment WHERE site_id=_site AND data->>'assessment_phase_submitted'='true') THEN 'installation' ELSE 'assessment' END;
  IF _phase IS DISTINCT FROM next_phase THEN RAISE EXCEPTION 'Refresh company list; the phase has changed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text || _date::text,0));
  IF EXISTS(SELECT 1 FROM field_visit_schedules WHERE site_id=_site AND assignee_id=_associate AND visit_type=_phase AND scheduled_for=_date AND status <> 'completed') THEN RAISE EXCEPTION 'This company phase is already scheduled for this day'; END IF;
  IF EXISTS(SELECT 1 FROM field_visit_schedules WHERE assignee_id=_associate AND scheduled_for=_date AND status <> 'completed' AND expected_arrival < _end AND expected_end > _arrival) THEN RAISE EXCEPTION 'Arrival/end times overlap another visit'; END IF;
  INSERT INTO field_visit_schedules(site_id,assignee_id,visit_type,scheduled_for,shift,expected_arrival,expected_end,priority,note,created_by)
    VALUES(_site,_associate,_phase,_date,_shift,_arrival,_end,_priority,nullif(trim(_note),''),auth.uid()) RETURNING id INTO result;
  RETURN result;
END $$;

CREATE FUNCTION public.field_ops_complete_visit(_visit UUID, _delayed BOOLEAN DEFAULT false, _reason TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.field_visit_schedules; s public.sites;
BEGIN
  SELECT * INTO v FROM field_visit_schedules WHERE id=_visit FOR UPDATE;
  SELECT * INTO s FROM sites WHERE id=v.site_id;
  IF v.id IS NULL OR s.id IS NULL OR auth.uid() IS NULL OR NOT public.field_ops_associate(auth.uid()) OR NOT coalesce(auth.uid() = ANY(public.field_ops_worker_ids(s)),false)
    OR NOT coalesce(v.assignee_id = ANY(public.field_ops_worker_ids(s)),false) THEN RAISE EXCEPTION 'Visit not found or access denied'; END IF;
  IF NOT coalesce((SELECT online FROM field_attendance_events WHERE associate_id=auth.uid() AND work_date=(now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY occurred_at DESC LIMIT 1),false) THEN RAISE EXCEPTION 'Mark online first'; END IF;
  IF v.status = 'completed' THEN RETURN; END IF;
  IF _delayed THEN
    IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A delay reason is required'; END IF;
    UPDATE field_visit_schedules SET status='delayed',delay_reason=trim(_reason),updated_at=now() WHERE id=_visit;
  ELSE
    IF NOT public.field_ops_phase_ready(v.site_id,v.visit_type) THEN RAISE EXCEPTION 'Complete all required phase work and approval before completing this visit'; END IF;
    UPDATE field_visit_schedules SET status='completed',completed_at=now(),updated_at=now(),delay_reason=NULL WHERE id=_visit;
  END IF;
END $$;

CREATE FUNCTION public.field_ops_edit_commissioning_date(_earning UUID, _date DATE, _reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.field_earnings;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Manager access required'; END IF;
  SELECT * INTO e FROM field_earnings WHERE id=_earning FOR UPDATE;
  IF e.id IS NULL OR e.phase <> 'commissioning' OR NOT public.field_ops_phase_ready(e.site_id,'commissioning') THEN RAISE EXCEPTION 'Select approved commissioning work'; END IF;
  IF EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id) THEN RAISE EXCEPTION 'Paid earnings cannot be moved'; END IF;
  IF _date IS NULL OR _date > (e.completed_at AT TIME ZONE 'Asia/Kolkata')::date
    OR _date < (e.associate_joined AT TIME ZONE 'Asia/Kolkata')::date
    OR coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'Choose a work date from joining through approval and enter a reason'; END IF;
  IF EXISTS(SELECT 1 FROM field_payment_records WHERE associate_id=e.associate_id AND period_end=public.field_ops_period_end(_date)) THEN RAISE EXCEPTION 'Destination payment period is already cleared'; END IF;
  INSERT INTO field_earning_date_changes(earning_id,old_date,new_date,reason,actor_id) VALUES(e.id,e.earning_date,_date,trim(_reason),auth.uid());
  UPDATE field_earnings SET earning_date=_date WHERE id=e.id;
END $$;

CREATE FUNCTION public.field_ops_record_payment(_associate UUID, _period_end DATE, _paid_on DATE, _reference TEXT DEFAULT NULL) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE total NUMERIC; payment UUID;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Manager access required'; END IF;
  IF _period_end IS NULL OR extract(day FROM _period_end) <> 15 OR _period_end >= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Select a finished 16th–15th payment period'; END IF;
  IF _paid_on IS NULL OR _paid_on > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Enter a valid payment date'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text || _period_end::text,0));
  PERFORM 1 FROM field_earnings WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end FOR UPDATE;
  IF EXISTS(SELECT 1 FROM field_earnings WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end AND eligible AND amount IS NULL) THEN RAISE EXCEPTION 'Set rates before clearing payment'; END IF;
  SELECT sum(amount) INTO total FROM field_earnings e WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end AND eligible
    AND (site_id IS NULL OR public.field_ops_phase_ready(site_id,phase)) AND NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id);
  IF coalesce(total,0) <= 0 THEN RAISE EXCEPTION 'No payable completed work in this period'; END IF;
  INSERT INTO field_payment_records(associate_id,period_end,amount,paid_on,reference,recorded_by) VALUES(_associate,_period_end,total,_paid_on,nullif(trim(_reference),''),auth.uid()) RETURNING id INTO payment;
  INSERT INTO field_payment_items(payment_id,earning_id,amount) SELECT payment,e.id,e.amount FROM field_earnings e WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end AND eligible AND (site_id IS NULL OR public.field_ops_phase_ready(site_id,phase)) AND NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id);
  RETURN payment;
END $$;

CREATE FUNCTION public.field_ops_board() RETURNS JSONB
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
      'active',public.field_ops_site_active(s),
      'phase',CASE WHEN public.field_ops_phase_ready(s.id,'commissioning') THEN 'complete' WHEN public.field_ops_phase_ready(s.id,'installation') THEN 'commissioning' WHEN a.data->>'assessment_phase_submitted'='true' THEN 'installation' ELSE 'assessment' END,
      'assessment_ready',public.field_ops_phase_ready(s.id,'assessment'),'installation_ready',public.field_ops_phase_ready(s.id,'installation'),'commissioning_ready',public.field_ops_phase_ready(s.id,'commissioning'),
      'assessment_completed_at',CASE WHEN public.field_ops_phase_ready(s.id,'assessment') THEN coalesce((SELECT completed_at FROM field_earnings WHERE site_id=s.id AND phase='assessment'),a.updated_at) ELSE NULL END))
      FROM sites s LEFT JOIN assessment a ON a.site_id=s.id WHERE staff OR auth.uid()=ANY(public.field_ops_worker_ids(s))),'[]'::jsonb),
    'visits',coalesce((SELECT jsonb_agg(to_jsonb(v) || jsonb_build_object('company_name',coalesce(s.company_name,s.name)) ORDER BY v.scheduled_for,v.expected_arrival) FROM field_visit_schedules v JOIN sites s ON s.id=v.site_id WHERE staff OR v.assignee_id=auth.uid() OR (auth.uid()=ANY(public.field_ops_worker_ids(s)) AND v.assignee_id=ANY(public.field_ops_worker_ids(s)))),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

-- All writes go through validated RPCs; no authenticated direct-write policies.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['field_operations_rollout','field_existing_completions','field_attendance_events','field_work_rates','field_earnings','field_earning_date_changes','field_payment_records','field_payment_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
  END LOOP;
END $$;
-- Functions default to PUBLIC EXECUTE in Postgres; explicitly restrict every new function.
DO $$ DECLARE f RECORD; BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'field_ops_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.field_ops_board(), public.field_ops_attendance(UUID,BOOLEAN), public.field_ops_set_rates(UUID,NUMERIC,NUMERIC,NUMERIC), public.field_ops_schedule(UUID,UUID,TEXT,DATE,TEXT,TIME,TIME,TEXT,TEXT), public.field_ops_complete_visit(UUID,BOOLEAN,TEXT), public.field_ops_edit_commissioning_date(UUID,DATE,TEXT), public.field_ops_record_payment(UUID,DATE,DATE,TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
