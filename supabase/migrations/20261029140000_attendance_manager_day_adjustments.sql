-- Administrative attendance corrections are separate from raw device scans.
BEGIN;
ALTER TABLE public.attendance_daily_records
  ADD COLUMN entry_source text NOT NULL DEFAULT 'scan' CHECK (entry_source IN ('scan','manager_adjusted')),
  ADD COLUMN adjustment_reason text,
  ADD COLUMN adjusted_by uuid,
  ADD COLUMN adjusted_at timestamptz;

CREATE FUNCTION public.attendance_adjust_day(_employee uuid,_date date,_entry_at timestamptz,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e attendance_employees; s attendance_scan_events; p attendance_settings; prior attendance_daily_records;
BEGIN
  PERFORM attendance_assert_manager();
  IF _date IS NULL OR _entry_at IS NULL OR (_entry_at AT TIME ZONE 'Asia/Kolkata')::date<>_date
    OR _entry_at>now()+interval '5 minutes' OR _entry_at<now()-interval '90 days'
    OR coalesce(length(btrim(_reason)),0) NOT BETWEEN 15 AND 2000
    THEN RAISE EXCEPTION 'Attendance date, administrative entry time and adjustment reason required'; END IF;
  SELECT * INTO e FROM attendance_employees WHERE id=_employee AND deleted_at IS NULL;
  IF e.id IS NULL OR _date<e.employment_start OR (e.deactivated_at IS NOT NULL AND _entry_at>e.deactivated_at)
    THEN RAISE EXCEPTION 'Employee was not active on the attendance date'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(e.id::text||_date::text,0));
  SELECT * INTO s FROM attendance_scan_events WHERE employee_id=e.id AND work_date=_date AND recognized
    AND validation_state IN ('valid','time_unverified') ORDER BY scanned_at,id LIMIT 1;
  IF s.id IS NULL THEN RAISE EXCEPTION 'A recognized face scan is required for this adjustment'; END IF;
  SELECT * INTO prior FROM attendance_daily_records WHERE employee_id=e.id AND work_date=_date;
  SELECT * INTO p FROM attendance_settings WHERE effective_from<=_date ORDER BY effective_from DESC LIMIT 1;
  INSERT INTO attendance_daily_records(employee_id,work_date,first_event_id,entry_at,employee_name,department,policy_snapshot,late_minutes,
    entry_source,adjustment_reason,adjusted_by,adjusted_at)
    VALUES(e.id,_date,s.id,_entry_at,e.name,e.department,coalesce(prior.policy_snapshot,to_jsonb(p)),0,
      'manager_adjusted',btrim(_reason),auth.uid(),clock_timestamp())
    ON CONFLICT(employee_id,work_date) DO UPDATE SET entry_at=excluded.entry_at,late_minutes=0,
      entry_source='manager_adjusted',adjustment_reason=excluded.adjustment_reason,adjusted_by=excluded.adjusted_by,adjusted_at=excluded.adjusted_at;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(auth.uid(),'attendance_day_adjusted',(SELECT id FROM attendance_daily_records WHERE employee_id=e.id AND work_date=_date),
      jsonb_build_object('employee_id',e.id,'work_date',_date,'reason',btrim(_reason),'actual_scan_time_verified',false,
        'late_penalty_waived',true,'before_daily',to_jsonb(prior),
        'after_daily',(SELECT to_jsonb(r) FROM attendance_daily_records r WHERE r.employee_id=e.id AND r.work_date=_date)));
END $$;
REVOKE ALL ON FUNCTION public.attendance_adjust_day(uuid,date,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_adjust_day(uuid,date,timestamptz,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.attendance_time_review_required(_employee uuid,_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM attendance_scan_events WHERE employee_id=_employee AND work_date=_date AND validation_state='time_unverified')
    AND NOT EXISTS(SELECT 1 FROM attendance_daily_records WHERE employee_id=_employee AND work_date=_date AND entry_source='manager_adjusted')
$$;

CREATE FUNCTION public.attendance_adjustment_details(_employee uuid,_date date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce((SELECT jsonb_build_object('entry_source',entry_source,'adjustment_reason',adjustment_reason,'adjusted_at',adjusted_at)
    FROM attendance_daily_records WHERE employee_id=_employee AND work_date=_date AND entry_source='manager_adjusted'),'{}'::jsonb)
$$;
REVOKE ALL ON FUNCTION public.attendance_adjustment_details(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_adjustment_details(uuid,date) TO service_role;

-- Keep the existing guarded view bodies and attach provenance to their rows.
DO $$ DECLARE f record; definition text; old_fragment text:='ELSE r END ORDER BY n'; new_fragment text;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('public.attendance_board(date)','(r->>''employee_id'')::uuid,_date'),
    ('public.attendance_my_calendar(date)','employee,(r->>''date'')::date'),
    ('public.finance_calendar(uuid,date,jsonb)','_employee,(r->>''date'')::date')
  ) a(signature,args) LOOP
    definition:=pg_get_functiondef(f.signature::regprocedure);
    IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Unexpected attendance view definition: %',f.signature; END IF;
    new_fragment:='ELSE r END || attendance_adjustment_details('||f.args||') ORDER BY n';
    EXECUTE replace(definition,old_fragment,new_fragment);
  END LOOP;
END $$;

-- New scans remain saved, but automatic aggregation must not replace an
-- explicitly assigned day/time or silently reintroduce a waived late penalty.
DO $$ DECLARE definition text; fragment text;
BEGIN
  definition:=pg_get_functiondef('public.attendance_ingest_scan(text,text,timestamptz,boolean)'::regprocedure);
  fragment:='SELECT * INTO prior FROM attendance_daily_records WHERE employee_id=e.id AND work_date=d;';
  IF position(fragment IN definition)=0 THEN RAISE EXCEPTION 'Unexpected scan aggregation definition'; END IF;
  EXECUTE replace(definition,fragment,fragment||E'\n'
    ||'IF prior.entry_source=''manager_adjusted'' THEN RETURN jsonb_build_object(''id'',s.id,''state'',state,''duplicate'',false,''expires_at'',public.attendance_photo_expires_at(_scanned_at)); END IF;');
  definition:=pg_get_functiondef('public.attendance_rebuild_verified_day(uuid,date)'::regprocedure);
  fragment:='SELECT * INTO earliest FROM attendance_scan_events';
  IF position(fragment IN definition)=0 THEN RAISE EXCEPTION 'Unexpected attendance rebuild definition'; END IF;
  EXECUTE replace(definition,fragment,
    'IF EXISTS(SELECT 1 FROM attendance_daily_records WHERE employee_id=_employee AND work_date=_date AND entry_source=''manager_adjusted'') THEN RETURN; END IF;'||E'\n'||fragment);
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
