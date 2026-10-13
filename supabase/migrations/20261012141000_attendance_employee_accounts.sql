BEGIN;
ALTER TABLE public.attendance_employees ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- Only server-owned app metadata can choose the office role. Preserve the
-- existing signup trigger for every other user (including field associates).
CREATE OR REPLACE FUNCTION public.attendance_office_auth_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.raw_app_meta_data->>'office_employee' = 'true' THEN
    DELETE FROM user_roles WHERE user_id=NEW.id;
    INSERT INTO user_roles(user_id,role) VALUES(NEW.id,'employee');
    UPDATE profiles SET is_active=true WHERE id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.attendance_office_auth_created() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zz_attendance_office_auth_created ON auth.users;
CREATE TRIGGER zz_attendance_office_auth_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.attendance_office_auth_created();

CREATE OR REPLACE FUNCTION public.attendance_save_employee_account(
  _employee uuid, _auth_user uuid, _name text, _department text, _enroll_id text,
  _email text, _email_verified boolean, _start date, _create boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE account auth.users; existing attendance_employees;
BEGIN
  PERFORM attendance_assert_manager();
  SELECT * INTO account FROM auth.users WHERE id=_auth_user;
  IF account.id IS NULL OR account.raw_app_meta_data->>'office_employee' IS DISTINCT FROM 'true'
    OR account.raw_app_meta_data->>'attendance_employee_id' IS DISTINCT FROM _employee::text
    OR lower(account.email) IS DISTINCT FROM lower(btrim(_email))
    OR NOT public.has_role(_auth_user,'employee')
    OR EXISTS(SELECT 1 FROM user_roles WHERE user_id=_auth_user AND role<>'employee') THEN
    RAISE EXCEPTION 'Invalid office login account';
  END IF;
  IF _create THEN
    IF _name IS NULL OR length(btrim(_name)) NOT BETWEEN 1 AND 120 OR
       _department IS NULL OR _department NOT IN ('firmware','logistic','software','manager') OR
       _start IS NULL OR _start>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN
      RAISE EXCEPTION 'Invalid employee details';
    END IF;
    INSERT INTO attendance_employees(id,auth_user_id,name,department,enroll_id,email,email_verified,employment_start,created_by)
      VALUES(_employee,_auth_user,btrim(_name),_department,btrim(_enroll_id),lower(btrim(_email)),_email_verified,_start,auth.uid());
    INSERT INTO attendance_device_commands(employee_id) VALUES(_employee);
  ELSE
    SELECT * INTO existing FROM attendance_employees WHERE id=_employee AND deleted_at IS NULL FOR UPDATE;
    IF existing.id IS NULL OR (existing.auth_user_id IS NOT NULL AND existing.auth_user_id<>_auth_user) THEN
      RAISE EXCEPTION 'Employee account link mismatch';
    END IF;
    PERFORM attendance_update_employee(_employee,_name,_department,_email,_email_verified,_start);
    UPDATE attendance_employees SET auth_user_id=_auth_user WHERE id=_employee;
  END IF;
  UPDATE profiles SET name=btrim(_name),email=lower(btrim(_email)) WHERE id=_auth_user;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id)
    VALUES(auth.uid(),CASE WHEN _create THEN 'employee_account_created' ELSE 'employee_account_updated' END,_employee);
  RETURN _employee;
END $$;
REVOKE ALL ON FUNCTION public.attendance_save_employee_account(uuid,uuid,text,text,text,text,boolean,date,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_save_employee_account(uuid,uuid,text,text,text,text,boolean,date,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.attendance_my_account() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'employee') THEN RAISE EXCEPTION 'Office employee access required'; END IF;
  RETURN (SELECT jsonb_build_object('id',e.id,'name',e.name,'enroll_id',e.enroll_id,'active',e.active)
    FROM attendance_employees e WHERE auth_user_id=auth.uid() AND e.deleted_at IS NULL);
END $$;
CREATE OR REPLACE FUNCTION public.attendance_my_history() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE employee uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'employee') THEN RAISE EXCEPTION 'Office employee access required'; END IF;
  SELECT id INTO employee FROM attendance_employees WHERE auth_user_id=auth.uid() AND active AND deleted_at IS NULL;
  IF employee IS NULL THEN RAISE EXCEPTION 'Office account is inactive or not linked'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.work_date DESC),'[]')
    FROM (SELECT work_date,entry_at,late_minutes FROM attendance_daily_records WHERE employee_id=employee ORDER BY work_date DESC LIMIT 90) r);
END $$;
REVOKE ALL ON FUNCTION public.attendance_my_account(), public.attendance_my_history() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_my_account(), public.attendance_my_history() TO authenticated;
COMMIT;
