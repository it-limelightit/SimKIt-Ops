BEGIN;
-- Separate leave annotations: do not change field attendance events or earnings rules.
CREATE OR REPLACE FUNCTION public.field_ops_leave_calendar(_associate uuid,_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE first_day date; last_day date;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_staff(auth.uid()) OR (_associate=auth.uid() AND public.field_ops_associate(auth.uid()))) THEN
  RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';
 END IF;
 IF _associate IS NULL OR _month IS NULL OR _month<date '2000-01-01' OR _month>date '2100-12-31' THEN RAISE EXCEPTION 'Choose an associate and a valid month'; END IF;
 first_day:=date_trunc('month',_month)::date;
 last_day:=(first_day+interval '1 month'-interval '1 day')::date;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('date',d.work_date,'request_type',q.request_type,'request_status',q.day_status,'reason',q.reason) ORDER BY d.work_date),'[]'::jsonb)
  FROM (SELECT day::date work_date FROM generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') day) d
  JOIN LATERAL (
   SELECT coalesce(r.request_type,'leave') request_type,r.reason,coalesce(x.status,CASE WHEN r.status='partial' THEN 'pending' ELSE r.status END) day_status
   FROM attendance_leave_requests r LEFT JOIN attendance_leave_request_days x ON x.request_id=r.id AND x.leave_date=d.work_date
   WHERE r.field_associate_id=_associate AND d.work_date BETWEEN r.start_date AND r.end_date AND r.status IN ('pending','approved','partial','rejected')
   ORDER BY CASE coalesce(x.status,r.status) WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,r.created_at DESC LIMIT 1
  ) q ON true);
END $$;
REVOKE ALL ON FUNCTION public.field_ops_leave_calendar(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_ops_leave_calendar(uuid,date) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
