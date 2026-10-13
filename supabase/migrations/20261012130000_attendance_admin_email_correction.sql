BEGIN;
-- Also correct projects where the original allowlist migration was already applied.
CREATE OR REPLACE FUNCTION public.attendance_can_manage() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL
      AND lower(email) IN ('patidarnit21@gmail.com','admin@limelightit.io','tarun@limelightit.io')
  );
$$;
REVOKE ALL ON FUNCTION public.attendance_can_manage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_can_manage() TO authenticated;
COMMIT;
