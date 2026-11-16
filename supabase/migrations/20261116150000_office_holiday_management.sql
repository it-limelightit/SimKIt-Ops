BEGIN;

CREATE TABLE public.attendance_office_holidays (
  work_date date PRIMARY KEY,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 200),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_office_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_office_holidays FROM PUBLIC,anon,authenticated;

-- Label the Diwali dates already configured at the user's request.
INSERT INTO attendance_office_holidays(work_date,reason)
SELECT d::date,'Diwali vacation'
FROM generate_series(timestamp '2026-11-07',timestamp '2026-11-14',interval '1 day') d
WHERE d::date=ANY((SELECT holidays FROM attendance_settings WHERE effective_from<=d::date ORDER BY effective_from DESC LIMIT 1)::date[]);

CREATE FUNCTION public.attendance_office_off_days() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.assert_manager_module_access('restricted');
  PERFORM attendance_assert_manager();
  SELECT coalesce(jsonb_agg(jsonb_build_object('date',work_date,'reason',coalesce(h.reason,'Office holiday')) ORDER BY work_date),'[]'::jsonb)
    INTO result
  FROM (
    SELECT DISTINCT holiday AS work_date FROM attendance_settings s CROSS JOIN LATERAL unnest(s.holidays) holiday
    WHERE holiday=ANY((SELECT holidays FROM attendance_settings WHERE effective_from<=holiday ORDER BY effective_from DESC LIMIT 1)::date[])
  ) dates LEFT JOIN attendance_office_holidays h USING(work_date);
  RETURN result;
END $$;

CREATE FUNCTION public.attendance_save_off_days(_start date,_end date,_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE policy attendance_settings; before_policies jsonb; before_reasons jsonb;
BEGIN
  PERFORM public.assert_manager_module_access('restricted');
  PERFORM attendance_assert_manager();
  IF _start IS NULL OR _end IS NULL OR _end<_start OR _end-_start>365
    OR _start<date '2000-01-01' OR _end>date '2100-12-31'
    OR coalesce(length(btrim(_reason)),0) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'Choose a date range of up to 366 days and a reason between 3 and 200 characters';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance_office_holidays',0));
  IF NOT EXISTS(SELECT 1 FROM attendance_settings WHERE effective_from<=_start) THEN
    RAISE EXCEPTION 'Save an office schedule effective on or before the first off day';
  END IF;
  SELECT jsonb_agg(to_jsonb(s)) INTO before_policies FROM attendance_settings s WHERE effective_from<=_end;
  SELECT jsonb_agg(to_jsonb(h)) INTO before_reasons FROM attendance_office_holidays h WHERE work_date BETWEEN _start AND _end;
  -- Update every policy that is effective during the range, including historical settings.
  FOR policy IN SELECT * FROM attendance_settings s
    WHERE s.effective_from<=_end AND (s.effective_from>=_start OR s.effective_from=(
      SELECT max(effective_from) FROM attendance_settings WHERE effective_from<=_start))
    ORDER BY effective_from FOR UPDATE
  LOOP
    UPDATE attendance_settings SET holidays=ARRAY(
      SELECT DISTINCT holiday FROM (
        SELECT unnest(coalesce(policy.holidays,'{}'::date[])) holiday
        UNION ALL SELECT d::date FROM generate_series(_start::timestamp,_end::timestamp,interval '1 day') d
      ) dates ORDER BY holiday),updated_by=auth.uid(),updated_at=clock_timestamp()
      WHERE effective_from=policy.effective_from;
  END LOOP;
  INSERT INTO attendance_office_holidays(work_date,reason,updated_by,updated_at)
    SELECT d::date,btrim(_reason),auth.uid(),clock_timestamp()
    FROM generate_series(_start::timestamp,_end::timestamp,interval '1 day') d
    ON CONFLICT(work_date) DO UPDATE SET reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  INSERT INTO attendance_audit_logs(actor_id,action,details) VALUES(auth.uid(),'office_off_days_saved',
    jsonb_build_object('start_date',_start,'end_date',_end,'reason',btrim(_reason),
      'before_settings',before_policies,'before_reasons',before_reasons));
END $$;

CREATE FUNCTION public.attendance_remove_off_days(_start date,_end date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE before_policies jsonb; before_reasons jsonb;
BEGIN
  PERFORM public.assert_manager_module_access('restricted');
  PERFORM attendance_assert_manager();
  IF _start IS NULL OR _end IS NULL OR _end<_start OR _end-_start>365
    OR _start<date '2000-01-01' OR _end>date '2100-12-31' THEN RAISE EXCEPTION 'Choose a valid date range of up to 366 days'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance_office_holidays',0));
  PERFORM 1 FROM attendance_settings ORDER BY effective_from FOR UPDATE;
  SELECT jsonb_agg(to_jsonb(s)) INTO before_policies FROM attendance_settings s
    WHERE EXISTS(SELECT 1 FROM unnest(s.holidays) h WHERE h BETWEEN _start AND _end);
  SELECT jsonb_agg(to_jsonb(h)) INTO before_reasons FROM attendance_office_holidays h WHERE work_date BETWEEN _start AND _end;
  UPDATE attendance_settings s SET holidays=ARRAY(SELECT h FROM unnest(s.holidays) h WHERE h NOT BETWEEN _start AND _end ORDER BY h),
    updated_by=auth.uid(),updated_at=clock_timestamp()
    WHERE EXISTS(SELECT 1 FROM unnest(s.holidays) h WHERE h BETWEEN _start AND _end);
  DELETE FROM attendance_office_holidays WHERE work_date BETWEEN _start AND _end;
  INSERT INTO attendance_audit_logs(actor_id,action,details) VALUES(auth.uid(),'office_off_days_removed',
    jsonb_build_object('start_date',_start,'end_date',_end,'before_settings',before_policies,'before_reasons',before_reasons));
END $$;

REVOKE ALL ON FUNCTION public.attendance_office_off_days(),public.attendance_save_off_days(date,date,text),public.attendance_remove_off_days(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_office_off_days(),public.attendance_save_off_days(date,date,text),public.attendance_remove_off_days(date,date) TO authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
