-- Attendance photo retention only. Attendance rows and scan history are never deleted.
BEGIN;
CREATE OR REPLACE FUNCTION public.attendance_photo_expires_at(_scanned_at timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE STRICT SET search_path=public AS $$
  SELECT (((_scanned_at AT TIME ZONE 'Asia/Kolkata')::date + 1) + time '02:00') AT TIME ZONE 'Asia/Kolkata'
$$;
REVOKE ALL ON FUNCTION public.attendance_photo_expires_at(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_photo_expires_at(timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.attendance_ingest_scan(_event_id text,_enroll_id text,_scanned_at timestamptz,_recognized boolean DEFAULT true) RETURNS jsonb
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
    RETURN jsonb_build_object('id',s.id,'state',s.validation_state,'duplicate',true,'expires_at',public.attendance_photo_expires_at(s.scanned_at));
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
  RETURN jsonb_build_object('id',s.id,'state',state,'duplicate',false,'expires_at',public.attendance_photo_expires_at(_scanned_at));
END $$;
UPDATE public.attendance_photos p SET expires_at=public.attendance_photo_expires_at(s.scanned_at)
FROM public.attendance_scan_events s WHERE s.id=p.event_id AND p.status<>'deleted';
COMMIT;
