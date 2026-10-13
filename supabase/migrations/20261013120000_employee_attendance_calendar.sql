BEGIN;
-- Employee-only monthly view: expose the caller's own days, not the manager board.
CREATE OR REPLACE FUNCTION public.attendance_my_calendar(_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE employee attendance_employees; first_day date; last_day date; today date;
BEGIN
 IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'employee') AND NOT public.has_role(auth.uid(),'supervisor')) THEN
  RAISE EXCEPTION 'Office employee access required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO employee FROM attendance_employees WHERE auth_user_id=auth.uid() AND active AND deleted_at IS NULL;
 IF employee.id IS NULL THEN RAISE EXCEPTION 'Active office account is not linked'; END IF;
 IF _month IS NULL OR _month < date '2000-01-01' OR _month > date '2100-12-31' THEN RAISE EXCEPTION 'Choose a valid calendar month'; END IF;
 first_day := date_trunc('month',_month)::date;
 last_day := (first_day+interval '1 month'-interval '1 day')::date;
 today := (now() AT TIME ZONE 'Asia/Kolkata')::date;
 RETURN jsonb_build_object('month',first_day,'today',today,'days',(
  SELECT jsonb_agg(jsonb_build_object(
   'date',d.work_date,'entry_at',r.entry_at,'late_minutes',r.late_minutes,
   'working_day',CASE WHEN d.work_date<employee.employment_start THEN false WHEN p.effective_from IS NULL THEN NULL ELSE extract(dow FROM d.work_date)::integer=ANY(p.working_days) AND NOT d.work_date=ANY(p.holidays) END,
   'request_type',q.request_type,'request_status',q.day_status,'reason',q.reason,
   'status',CASE
    WHEN r.id IS NOT NULL AND q.day_status='approved' AND q.request_type='leave' THEN 'needs_review'
    WHEN r.id IS NOT NULL AND r.late_minutes IS NULL THEN 'needs_review'
    WHEN r.id IS NOT NULL AND r.late_minutes>0 THEN 'late'
    WHEN r.id IS NOT NULL THEN 'present'
    WHEN d.work_date<employee.employment_start THEN 'not_employed'
    WHEN q.day_status='approved' AND q.request_type='wfh' THEN 'work_from_home'
    WHEN q.day_status='approved' THEN 'on_leave'
    WHEN p.effective_from IS NULL THEN 'not_configured'
    WHEN NOT extract(dow FROM d.work_date)::integer=ANY(p.working_days) OR d.work_date=ANY(p.holidays) THEN 'off_day'
    WHEN d.work_date>today THEN 'scheduled'
    WHEN d.work_date=today AND (p.absence_cutoff IS NULL OR now()<((d.work_date+p.absence_cutoff) AT TIME ZONE 'Asia/Kolkata')) THEN 'awaiting_scan'
    WHEN p.absence_cutoff IS NOT NULL AND h.work_date IS NOT NULL AND NOT h.gap_detected AND h.last_heartbeat_at>=((d.work_date+p.absence_cutoff) AT TIME ZONE 'Asia/Kolkata') THEN 'absent'
    ELSE 'needs_review' END
  ) ORDER BY d.work_date)
  FROM (SELECT day::date work_date FROM generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') day) d
  LEFT JOIN LATERAL (SELECT * FROM attendance_settings WHERE effective_from<=d.work_date ORDER BY effective_from DESC LIMIT 1) p ON true
  LEFT JOIN attendance_daily_records r ON r.employee_id=employee.id AND r.work_date=d.work_date
  LEFT JOIN attendance_device_health h ON h.work_date=d.work_date
  LEFT JOIN LATERAL (
   SELECT coalesce(l.request_type,'leave') request_type,l.reason,
    coalesce(x.status,CASE WHEN l.status='partial' THEN 'pending' ELSE l.status END) day_status
   FROM attendance_leave_requests l LEFT JOIN attendance_leave_request_days x ON x.request_id=l.id AND x.leave_date=d.work_date
   WHERE l.employee_id=employee.id AND d.work_date BETWEEN l.start_date AND l.end_date AND l.status IN ('pending','approved','partial','rejected')
   ORDER BY CASE coalesce(x.status,l.status) WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,l.created_at DESC LIMIT 1
  ) q ON true
 ));
END $$;
REVOKE ALL ON FUNCTION public.attendance_my_calendar(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_my_calendar(date) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
