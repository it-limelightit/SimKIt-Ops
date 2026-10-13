BEGIN;

-- Read the current account from Auth rather than accepting a client email or role.
CREATE FUNCTION public.attendance_can_manage() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL
      AND lower(email) IN ('patidarnit21@gmail.com','admin@limelightit.io','tarun@limelightit.io')
  );
$$;
REVOKE ALL ON FUNCTION public.attendance_can_manage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_can_manage() TO authenticated;

-- Every interactive attendance RPC already calls this guard.
CREATE OR REPLACE FUNCTION public.attendance_assert_manager() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.attendance_can_manage() THEN
    RAISE EXCEPTION 'Attendance access required' USING ERRCODE = '42501';
  END IF;
END $$;

-- Protect direct REST reads as well as RPCs. Webhooks and scheduled jobs retain
-- their existing service-role authentication and are unaffected.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_devices','attendance_settings','attendance_employees',
    'attendance_device_commands','attendance_scan_events','attendance_daily_records',
    'attendance_photos','attendance_leave_requests','attendance_device_health','attendance_audit_logs'] LOOP
    EXECUTE format('DROP POLICY attendance_manager_read ON public.%I', t);
    EXECUTE format('CREATE POLICY attendance_manager_read ON public.%I FOR SELECT TO authenticated USING (public.attendance_can_manage())', t);
  END LOOP;
END $$;
COMMIT;
