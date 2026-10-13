BEGIN;

CREATE OR REPLACE FUNCTION public.attendance_link_manager_login(
  _employee uuid, _auth_user uuid, _email text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE account auth.users; existing attendance_employees;
BEGIN
  PERFORM attendance_assert_manager();
  SELECT * INTO account FROM auth.users WHERE id=_auth_user;
  IF account.id IS NULL
    OR account.email_confirmed_at IS NULL
    OR account.raw_app_meta_data->>'office_employee' IS DISTINCT FROM 'true'
    OR account.raw_app_meta_data->>'attendance_employee_id' IS DISTINCT FROM _employee::text
    OR lower(account.email) IS DISTINCT FROM lower(btrim(_email))
    OR NOT public.has_role(_auth_user,'supervisor') THEN
    RAISE EXCEPTION 'Existing SimKit manager login could not be verified';
  END IF;
  SELECT * INTO existing FROM attendance_employees
    WHERE id=_employee AND deleted_at IS NULL FOR UPDATE;
  IF existing.id IS NULL OR existing.department<>'manager' OR NOT existing.active THEN
    RAISE EXCEPTION 'Active manager attendance record not found';
  END IF;
  IF existing.auth_user_id IS NOT NULL AND existing.auth_user_id<>_auth_user THEN
    RAISE EXCEPTION 'Attendance record is linked to another login';
  END IF;
  UPDATE attendance_employees SET auth_user_id=_auth_user,email=lower(btrim(_email)),email_verified=true
    WHERE id=_employee;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
    VALUES(auth.uid(),'office_manager_login_linked',_employee,jsonb_build_object('roles_changed',false,'password_changed',false));
END $$;
REVOKE ALL ON FUNCTION public.attendance_link_manager_login(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_link_manager_login(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.attendance_my_account() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'employee') AND NOT public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'Office employee access required';
  END IF;
  RETURN (SELECT jsonb_build_object('id',e.id,'name',e.name,'enroll_id',e.enroll_id,'active',e.active)
    FROM attendance_employees e WHERE e.auth_user_id=auth.uid() AND e.deleted_at IS NULL
      AND (public.has_role(auth.uid(),'employee') OR (e.department='manager' AND public.has_role(auth.uid(),'supervisor'))));
END $$;

CREATE OR REPLACE FUNCTION public.attendance_my_history() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE employee uuid;
BEGIN
  IF auth.uid() IS NULL OR (NOT public.has_role(auth.uid(),'employee') AND NOT public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'Office employee access required';
  END IF;
  SELECT id INTO employee FROM attendance_employees e WHERE e.auth_user_id=auth.uid() AND e.active AND e.deleted_at IS NULL
    AND (public.has_role(auth.uid(),'employee') OR (e.department='manager' AND public.has_role(auth.uid(),'supervisor')));
  IF employee IS NULL THEN RAISE EXCEPTION 'Office account is inactive or not linked'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.work_date DESC),'[]')
    FROM (SELECT work_date,entry_at,late_minutes FROM attendance_daily_records WHERE employee_id=employee ORDER BY work_date DESC LIMIT 90) r);
END $$;

COMMIT;
