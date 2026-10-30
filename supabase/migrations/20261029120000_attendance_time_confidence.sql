-- Preserve receipt-time protection against reset device clocks without assigning
-- recovery time to scans whose actual timing cannot be established.
BEGIN;
ALTER TABLE public.attendance_scan_events
  ADD COLUMN receiver_received_at timestamptz,
  ADD COLUMN device_time_raw text,
  ADD COLUMN time_source text NOT NULL DEFAULT 'legacy_receiver'
    CHECK (time_source IN ('legacy_receiver','receiver_live','unverified','manager_verified')),
  ADD COLUMN time_review_reason text;
ALTER TABLE public.attendance_scan_events DROP CONSTRAINT attendance_scan_events_validation_state_check;
ALTER TABLE public.attendance_scan_events ADD CONSTRAINT attendance_scan_events_validation_state_check
  CHECK (validation_state IN ('valid','unknown_employee','inactive_employee','invalid_time','failed_recognition','time_unverified'));
CREATE INDEX attendance_unverified_times ON public.attendance_scan_events(employee_id,work_date)
  WHERE validation_state='time_unverified';

CREATE TABLE public.attendance_receiver_health_events (
  event_id uuid PRIMARY KEY,
  component text NOT NULL CHECK (component IN ('mqtt','device','device_clock','supabase')),
  healthy boolean NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 128),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX attendance_receiver_health_latest ON public.attendance_receiver_health_events(component,observed_at DESC);
ALTER TABLE public.attendance_receiver_health_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.attendance_receiver_health_events TO authenticated;
GRANT ALL ON public.attendance_receiver_health_events TO service_role;
CREATE POLICY attendance_manager_read ON public.attendance_receiver_health_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'supervisor') AND EXISTS(SELECT 1 FROM public.attendance_devices WHERE id='office'));

CREATE FUNCTION public.attendance_record_receiver_health(_event_id uuid,_component text,_healthy boolean,_reason text,_observed_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF _observed_at IS NULL OR _observed_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid health observation time'; END IF;
  INSERT INTO attendance_receiver_health_events(event_id,component,healthy,reason,observed_at)
    VALUES(_event_id,_component,_healthy,_reason,_observed_at) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.attendance_record_receiver_health(uuid,text,boolean,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_record_receiver_health(uuid,text,boolean,text,timestamptz) TO service_role;

CREATE FUNCTION public.attendance_ingest_scan_v2(_event_id text,_enroll_id text,_scanned_at timestamptz,_recognized boolean,
  _receiver_received_at timestamptz,_device_time_raw text,_time_source text,_time_review_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e attendance_employees; s attendance_scan_events; result jsonb; d date; state text;
BEGIN
  IF _event_id IS NULL OR _enroll_id IS NULL OR _scanned_at IS NULL OR _recognized IS NULL OR _receiver_received_at IS NULL
    OR _scanned_at<>_receiver_received_at OR _time_source IS NULL OR _time_source NOT IN ('receiver_live','unverified')
    OR length(coalesce(_device_time_raw,''))>40 OR length(coalesce(_time_review_reason,''))>128
    OR (_time_source='unverified' AND coalesce(length(btrim(_time_review_reason)),0)=0)
  THEN RAISE EXCEPTION 'Invalid scan timing evidence'; END IF;
  -- Serialize retries of the same event, including when an old local queue was pruned.
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance-event:'||_event_id,0));
  SELECT * INTO s FROM attendance_scan_events WHERE device_id='office' AND event_id=_event_id;
  IF s.id IS NOT NULL THEN
    IF s.enroll_id<>_enroll_id OR s.recognized<>_recognized THEN RAISE EXCEPTION 'Event ID reused with different scan details'; END IF;
    RETURN jsonb_build_object('id',s.id,'state',s.validation_state,'duplicate',true,'expires_at',attendance_photo_expires_at(s.scanned_at));
  END IF;
  IF _time_source='receiver_live' THEN
    result:=attendance_ingest_scan(_event_id,_enroll_id,_scanned_at,_recognized);
    UPDATE attendance_scan_events SET receiver_received_at=_receiver_received_at,device_time_raw=_device_time_raw,
      time_source=_time_source,time_review_reason=NULL WHERE id=(result->>'id')::uuid;
    RETURN result;
  END IF;
  -- This is an observation date, not a claim that the employee scanned at receipt.
  d:=(_receiver_received_at AT TIME ZONE 'Asia/Kolkata')::date;
  SELECT * INTO e FROM attendance_employees WHERE device_id='office' AND enroll_id=_enroll_id;
  state:=CASE WHEN NOT _recognized THEN 'failed_recognition' WHEN e.id IS NULL THEN 'unknown_employee'
    WHEN _receiver_received_at>now()+interval '5 minutes' OR _receiver_received_at<now()-interval '90 days' THEN 'invalid_time'
    WHEN d<e.employment_start OR (e.deactivated_at IS NOT NULL AND _receiver_received_at>e.deactivated_at) THEN 'inactive_employee'
    ELSE 'time_unverified' END;
  INSERT INTO attendance_scan_events(device_id,event_id,enroll_id,employee_id,scanned_at,recognized,work_date,validation_state,
    receiver_received_at,device_time_raw,time_source,time_review_reason)
    VALUES('office',_event_id,_enroll_id,e.id,_scanned_at,_recognized,d,state,
      _receiver_received_at,_device_time_raw,'unverified',_time_review_reason) RETURNING * INTO s;
  UPDATE attendance_devices SET last_scan_at=clock_timestamp() WHERE id='office';
  -- No daily entry or late minutes are created for an unverified timestamp.
  RETURN jsonb_build_object('id',s.id,'state',state,'duplicate',false,'expires_at',attendance_photo_expires_at(_scanned_at));
END $$;
REVOKE ALL ON FUNCTION public.attendance_ingest_scan_v2(text,text,timestamptz,boolean,timestamptz,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_ingest_scan_v2(text,text,timestamptz,boolean,timestamptz,text,text,text) TO service_role;

CREATE FUNCTION public.attendance_flag_outage_scans(_events uuid[],_evidence text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s attendance_scan_events; flagged integer:=0;
BEGIN
  IF cardinality(_events) NOT BETWEEN 1 AND 1000 OR coalesce(length(btrim(_evidence)),0) NOT BETWEEN 10 AND 2000
    THEN RAISE EXCEPTION 'Select specific outage records and supply evidence'; END IF;
  FOR s IN SELECT * FROM attendance_scan_events WHERE id=ANY(_events) AND validation_state='valid' AND time_source='legacy_receiver' ORDER BY id FOR UPDATE LOOP
    INSERT INTO attendance_audit_logs(action,record_id,details)
      VALUES('outage_scan_flagged',(SELECT id FROM attendance_daily_records WHERE employee_id=s.employee_id AND work_date=s.work_date),
        jsonb_build_object('event_id',s.id,'employee_id',s.employee_id,'evidence',btrim(_evidence),'before_scan',to_jsonb(s),
          'before_daily',(SELECT to_jsonb(r) FROM attendance_daily_records r WHERE r.employee_id=s.employee_id AND r.work_date=s.work_date)));
    UPDATE attendance_scan_events SET receiver_received_at=coalesce(receiver_received_at,scanned_at),time_source='unverified',time_review_reason='outage_affected',validation_state='time_unverified' WHERE id=s.id;
    UPDATE attendance_daily_records SET late_minutes=NULL WHERE first_event_id=s.id;
    flagged:=flagged+1;
  END LOOP;
  RETURN flagged;
END $$;
REVOKE ALL ON FUNCTION public.attendance_flag_outage_scans(uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_flag_outage_scans(uuid[],text) TO service_role;

CREATE FUNCTION public.attendance_time_review_required(_employee uuid,_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM attendance_scan_events WHERE employee_id=_employee AND work_date=_date AND validation_state='time_unverified')
$$;
REVOKE ALL ON FUNCTION public.attendance_time_review_required(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_time_review_required(uuid,date) TO service_role;

-- Wrap existing classification so leave/calendar policies stay intact. The prior
-- functions become private implementation details, never a bypass for clients.
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.attendance_board(date)'::regprocedure),
    'FUNCTION public.attendance_board(', 'FUNCTION public.attendance_board_before_time_guard(');
END $$;
REVOKE ALL ON FUNCTION public.attendance_board_before_time_guard(date) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.attendance_board(_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; rows jsonb; health jsonb;
BEGIN
  result:=attendance_board_before_time_guard(_date);
  SELECT coalesce(jsonb_agg(CASE WHEN attendance_time_review_required((r->>'employee_id')::uuid,_date)
    THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL,'time_review_reason','scan_time_unverified') ELSE r END ORDER BY n),'[]')
    INTO rows FROM jsonb_array_elements(result->'rows') WITH ORDINALITY a(r,n);
  SELECT coalesce(jsonb_object_agg(component,to_jsonb(h)),'{}') INTO health FROM (
    SELECT DISTINCT ON (component) component,healthy,reason,observed_at FROM attendance_receiver_health_events ORDER BY component,observed_at DESC
  ) h;
  result:=jsonb_set(result,'{rows}',rows);
  result:=jsonb_set(result,'{device}',(result->'device')||jsonb_build_object('connection_health',health));
  IF (result#>>'{device,last_heartbeat_at}')::timestamptz<now()-interval '45 seconds'
    THEN result:=jsonb_set(result,'{device,state}','"offline"'); END IF;
  IF (result#>>'{device,state}')='online' AND EXISTS(
    SELECT 1 FROM jsonb_each(health) a WHERE a.key IN ('mqtt','device','supabase') AND (a.value->>'healthy')::boolean=false
  ) THEN result:=jsonb_set(result,'{device,state}','"degraded"'); END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.attendance_board(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_board(date) TO authenticated,service_role;

DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.attendance_my_calendar(date)'::regprocedure),
    'FUNCTION public.attendance_my_calendar(', 'FUNCTION public.attendance_my_calendar_before_time_guard(');
END $$;
REVOKE ALL ON FUNCTION public.attendance_my_calendar_before_time_guard(date) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.attendance_my_calendar(_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; employee uuid; days jsonb;
BEGIN
  result:=attendance_my_calendar_before_time_guard(_month);
  SELECT id INTO employee FROM attendance_employees WHERE auth_user_id=auth.uid() AND active AND deleted_at IS NULL;
  SELECT coalesce(jsonb_agg(CASE WHEN attendance_time_review_required(employee,(r->>'date')::date)
    THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL) ELSE r END ORDER BY n),'[]')
    INTO days FROM jsonb_array_elements(result->'days') WITH ORDINALITY a(r,n);
  RETURN jsonb_set(result,'{days}',days);
END $$;
REVOKE ALL ON FUNCTION public.attendance_my_calendar(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_my_calendar(date) TO authenticated,service_role;

DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.finance_calendar(uuid,date,jsonb)'::regprocedure),
    'FUNCTION public.finance_calendar(', 'FUNCTION public.finance_calendar_before_time_guard(');
END $$;
REVOKE ALL ON FUNCTION public.finance_calendar_before_time_guard(uuid,date,jsonb) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.finance_calendar(_employee uuid,_month date,_overrides jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  result:=finance_calendar_before_time_guard(_employee,_month,_overrides);
  RETURN (SELECT jsonb_agg(CASE WHEN attendance_time_review_required(_employee,(r->>'date')::date)
    THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL,'automatic_units',NULL,
      'units',CASE WHEN coalesce((r->>'working_day')::boolean,false) AND _overrides ? (r->>'date')
        THEN _overrides->(r->>'date')->'units' ELSE 'null'::jsonb END) ELSE r END ORDER BY n)
    FROM jsonb_array_elements(result) WITH ORDINALITY a(r,n));
END $$;
REVOKE ALL ON FUNCTION public.finance_calendar(uuid,date,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finance_calendar(uuid,date,jsonb) TO authenticated,service_role;

-- A manager must supply a verified time and evidence; the original observation
-- remains available for auditing. No automatic guess repairs historical data.
CREATE FUNCTION public.attendance_rebuild_verified_day(_employee uuid,_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e attendance_employees; p attendance_settings; prior attendance_daily_records;
  earliest attendance_scan_events; threshold timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_employee::text||_date::text,0));
  SELECT * INTO earliest FROM attendance_scan_events WHERE employee_id=_employee AND work_date=_date AND validation_state='valid' ORDER BY scanned_at,id LIMIT 1;
  IF earliest.id IS NULL THEN
    DELETE FROM attendance_daily_records WHERE employee_id=_employee AND work_date=_date;
    RETURN;
  END IF;
  SELECT * INTO e FROM attendance_employees WHERE id=_employee;
  SELECT * INTO prior FROM attendance_daily_records WHERE employee_id=_employee AND work_date=_date;
  SELECT * INTO p FROM attendance_settings WHERE effective_from<=_date ORDER BY effective_from DESC LIMIT 1;
  IF prior.id IS NOT NULL THEN
    threshold:=((_date+(prior.policy_snapshot->>'shift_start')::time) AT TIME ZONE 'Asia/Kolkata')+(prior.policy_snapshot->>'grace_minutes')::integer*interval '1 minute';
  ELSIF p.effective_from IS NOT NULL THEN
    threshold:=((_date+p.shift_start) AT TIME ZONE 'Asia/Kolkata')+p.grace_minutes*interval '1 minute';
  END IF;
  INSERT INTO attendance_daily_records(employee_id,work_date,first_event_id,entry_at,employee_name,department,policy_snapshot,late_minutes)
    VALUES(e.id,_date,earliest.id,earliest.scanned_at,e.name,e.department,to_jsonb(p),
      CASE WHEN threshold IS NULL THEN NULL ELSE greatest(0,ceil(extract(epoch FROM (earliest.scanned_at-threshold))/60)::integer) END)
    ON CONFLICT(employee_id,work_date) DO UPDATE SET first_event_id=excluded.first_event_id,entry_at=excluded.entry_at,late_minutes=excluded.late_minutes;
END $$;
REVOKE ALL ON FUNCTION public.attendance_rebuild_verified_day(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_rebuild_verified_day(uuid,date) TO service_role;

CREATE FUNCTION public.attendance_resolve_scan_time(_event uuid,_verified_at timestamptz,_evidence text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s attendance_scan_events; e attendance_employees; d date; prior jsonb;
BEGIN
  PERFORM attendance_assert_manager();
  IF _verified_at IS NULL OR _verified_at>now()+interval '5 minutes' OR _verified_at<now()-interval '90 days'
    OR coalesce(length(btrim(_evidence)),0) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'Verified scan time and supporting evidence required'; END IF;
  SELECT * INTO s FROM attendance_scan_events WHERE id=_event FOR UPDATE;
  IF s.id IS NULL OR s.validation_state<>'time_unverified' THEN RAISE EXCEPTION 'Unverified scan not found'; END IF;
  SELECT * INTO e FROM attendance_employees WHERE id=s.employee_id;
  d:=(_verified_at AT TIME ZONE 'Asia/Kolkata')::date;
  IF e.id IS NULL OR NOT s.recognized OR d<e.employment_start OR (e.deactivated_at IS NOT NULL AND _verified_at>e.deactivated_at)
    THEN RAISE EXCEPTION 'Verified time does not match active employment'; END IF;
  -- Lock both dates in stable order when a recovered scan belongs to yesterday.
  PERFORM pg_advisory_xact_lock(hashtextextended(e.id::text||least(d,s.work_date)::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(e.id::text||greatest(d,s.work_date)::text,0));
  SELECT to_jsonb(r) INTO prior FROM attendance_daily_records r WHERE employee_id=e.id AND work_date=s.work_date;
  UPDATE attendance_scan_events SET scanned_at=_verified_at,work_date=d,validation_state='valid',time_source='manager_verified',time_review_reason=NULL WHERE id=s.id;
  UPDATE attendance_photos SET expires_at=attendance_photo_expires_at(_verified_at) WHERE event_id=s.id AND status<>'deleted';
  PERFORM attendance_rebuild_verified_day(e.id,d);
  IF d<>s.work_date THEN PERFORM attendance_rebuild_verified_day(e.id,s.work_date); END IF;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(auth.uid(),'scan_time_verified',(SELECT id FROM attendance_daily_records WHERE employee_id=e.id AND work_date=d),
      jsonb_build_object('event_id',s.id,'employee_id',e.id,'before',s.scanned_at,'after',_verified_at,'evidence',btrim(_evidence),'original_work_date',s.work_date,'before_daily',prior));
END $$;
REVOKE ALL ON FUNCTION public.attendance_resolve_scan_time(uuid,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_resolve_scan_time(uuid,timestamptz,text) TO authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
