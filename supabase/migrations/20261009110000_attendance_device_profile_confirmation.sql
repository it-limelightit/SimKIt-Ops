-- A profile upload or a validated recognized scan proves device enrollment.
-- Neither is a correlated acknowledgment of a particular adduser command.
BEGIN;
CREATE OR REPLACE FUNCTION public.attendance_confirm_device_profile(
  _enroll_id text, _source text, _observed_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE employee attendance_employees;
BEGIN
  IF _enroll_id IS NULL OR _observed_at IS NULL OR _source IS NULL
    OR _source NOT IN ('profile','scan') THEN RAISE EXCEPTION 'Invalid enrollment evidence'; END IF;
  IF _source='profile' AND (_observed_at>now()+interval '1 minute'
    OR _observed_at<now()-interval '24 hours') THEN RAISE EXCEPTION 'Fresh profile evidence required'; END IF;
  SELECT * INTO employee FROM attendance_employees
    WHERE device_id='office' AND enroll_id=_enroll_id FOR UPDATE;
  IF employee.id IS NULL OR NOT employee.active
    OR (_observed_at AT TIME ZONE 'Asia/Kolkata')::date<employee.employment_start THEN RETURN false; END IF;
  IF _source='scan' AND NOT EXISTS (
    SELECT 1 FROM attendance_scan_events WHERE employee_id=employee.id
    AND enroll_id=_enroll_id AND scanned_at=_observed_at AND recognized
    AND validation_state='valid'
  ) THEN RAISE EXCEPTION 'Validated recognized scan required'; END IF;
  IF employee.enrollment_status<>'enrolled' THEN
    UPDATE attendance_employees SET enrollment_status='enrolled' WHERE id=employee.id;
    INSERT INTO attendance_audit_logs(action,record_id,details)
      VALUES('device_profile_confirmed',employee.id,jsonb_build_object('source',_source,'observed_at',_observed_at));
  END IF;
  -- Stop unsent retries once the device profile is verified; preserve command history.
  UPDATE attendance_device_commands SET status='failed',error='Device profile already verified; enrollment retry cancelled'
    WHERE employee_id=employee.id AND status='pending';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.attendance_confirm_device_profile(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_confirm_device_profile(text,text,timestamptz) TO service_role;

-- Repair only employees for whom a real validated scan already provides evidence.
SELECT public.attendance_confirm_device_profile(e.enroll_id,'scan',s.scanned_at)
FROM attendance_employees e
JOIN LATERAL (
  SELECT scanned_at FROM attendance_scan_events WHERE employee_id=e.id
    AND recognized AND validation_state='valid' ORDER BY scanned_at DESC LIMIT 1
) s ON true WHERE e.active AND e.enrollment_status<>'enrolled';
COMMIT;
