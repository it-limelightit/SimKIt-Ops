-- Auth admin creation inserts the user before applying custom app metadata.
-- Assign the office role when the server-owned office flag first becomes true.
-- No existing rows are updated by this migration.
BEGIN;

CREATE OR REPLACE FUNCTION public.attendance_office_auth_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.raw_app_meta_data->>'office_employee' IS DISTINCT FROM 'true' THEN
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.raw_app_meta_data->>'office_employee'='true' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Office metadata is also used by linked managers. Preserve their roles.
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id=NEW.id AND role::text NOT IN ('worker','employee')
  ) THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.user_roles WHERE user_id=NEW.id AND role::text='worker';
  INSERT INTO public.user_roles(user_id,role) VALUES(NEW.id,'employee')
    ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET is_active=true WHERE id=NEW.id;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.attendance_office_auth_created() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zz_attendance_office_auth_created ON auth.users;
CREATE TRIGGER zz_attendance_office_auth_created
AFTER INSERT OR UPDATE OF raw_app_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.attendance_office_auth_created();

COMMIT;
