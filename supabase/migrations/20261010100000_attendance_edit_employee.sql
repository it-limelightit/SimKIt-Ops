BEGIN;
CREATE OR REPLACE FUNCTION public.attendance_update_employee(
  _employee uuid, _name text, _department text, _email text DEFAULT NULL,
  _email_verified boolean DEFAULT false, _start date DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM attendance_assert_manager();
  IF _name IS NULL OR length(btrim(_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Name is required (maximum 120 characters)';
  END IF;
  IF _department IS NULL OR _department NOT IN ('firmware','hardware','logistic','software','manager') THEN
    RAISE EXCEPTION 'Invalid department';
  END IF;
  IF _start IS NULL OR _start > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Valid employment start date is required';
  END IF;
  IF length(btrim(_email)) > 254 THEN RAISE EXCEPTION 'Email is too long'; END IF;
  UPDATE attendance_employees SET name=btrim(_name),department=_department,
    email=nullif(lower(btrim(_email)),''),
    email_verified=coalesce(_email_verified,false) AND nullif(btrim(_email),'') IS NOT NULL,
    employment_start=_start
  WHERE id=_employee;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id)
  VALUES(auth.uid(),'employee_updated',_employee);
END $$;
REVOKE ALL ON FUNCTION public.attendance_update_employee(uuid,text,text,text,boolean,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_update_employee(uuid,text,text,text,boolean,date) TO authenticated;
COMMIT;
