BEGIN;

-- An office employee account is provisioned by an authorized Attendance
-- manager, so it must not enter the field-associate approval queue.
CREATE OR REPLACE FUNCTION public.attendance_activate_office_employee_profile()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.auth_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id=NEW.auth_user_id
        AND u.raw_app_meta_data->>'office_employee'='true'
        AND u.raw_app_meta_data->>'attendance_employee_id'=NEW.id::text
        AND lower(u.email)=lower(NEW.email)
    )
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=NEW.auth_user_id AND r.role='employee')
    AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=NEW.auth_user_id AND r.role<>'employee')
  THEN
    UPDATE public.profiles SET is_active=true WHERE id=NEW.auth_user_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.attendance_activate_office_employee_profile() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS attendance_activate_office_employee_profile ON public.attendance_employees;
CREATE TRIGGER attendance_activate_office_employee_profile
AFTER INSERT ON public.attendance_employees
FOR EACH ROW EXECUTE FUNCTION public.attendance_activate_office_employee_profile();

-- Repair existing valid office links whose profile was left inactive.
UPDATE public.profiles p SET is_active=true
FROM public.attendance_employees e
JOIN auth.users u ON u.id=e.auth_user_id
WHERE p.id=u.id
  AND e.active
  AND e.deleted_at IS NULL
  AND u.raw_app_meta_data->>'office_employee'='true'
  AND u.raw_app_meta_data->>'attendance_employee_id'=e.id::text
  AND lower(u.email)=lower(e.email)
  AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=u.id AND r.role='employee')
  AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=u.id AND r.role<>'employee')
  AND p.is_active IS DISTINCT FROM true;

COMMIT;
