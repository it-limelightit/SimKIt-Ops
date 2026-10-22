-- For databases that already applied the initial HR migration.
-- The current base migration also includes this directory behavior.
BEGIN;
CREATE OR REPLACE FUNCTION public.hr_board() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date; BEGIN
 PERFORM hr_assert_access();
 RETURN jsonb_build_object('today',today,
  'employees',(SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('current_term',t.data,'enroll_id',a.enroll_id,'enrollment_status',a.enrollment_status) ORDER BY e.name),'[]')
   FROM hr_employees e LEFT JOIN attendance_employees a ON a.id=e.attendance_employee_id
   LEFT JOIN LATERAL(SELECT to_jsonb(v) data FROM hr_employment_terms v WHERE v.employee_id=e.id
    ORDER BY (v.effective_from<=today) DESC,CASE WHEN v.effective_from<=today THEN v.effective_from END DESC,
     CASE WHEN v.effective_from>today THEN v.effective_from END ASC,v.revision DESC LIMIT 1) t ON true),
  'terms',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY effective_from DESC,revision DESC),'[]') FROM hr_employment_terms t),
  'offers',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY created_at DESC),'[]') FROM hr_offer_letters o),
  'candidates',(SELECT coalesce(jsonb_agg(x.data ORDER BY x.name),'[]') FROM (
   SELECT coalesce(a.name,p.name,u.email) name,jsonb_build_object('auth_user_id',u.id,'attendance_employee_id',a.id,
    'name',coalesce(a.name,p.name,''),'email',u.email,'mobile',coalesce(p.mobile,''),'department',a.department,
    'enroll_id',a.enroll_id,'enrollment_status',a.enrollment_status,
    'directory_visible',coalesce(a.active,false) OR (p.is_active AND NOT EXISTS(SELECT 1 FROM user_roles WHERE user_id=u.id AND role::text='supervisor')
     AND EXISTS(SELECT 1 FROM user_roles WHERE user_id=u.id AND role::text IN ('employee','worker'))),
    'joining_date',a.employment_start,'app_access',CASE WHEN EXISTS(SELECT 1 FROM user_roles WHERE user_id=u.id AND role::text='supervisor') THEN 'manager'
     WHEN EXISTS(SELECT 1 FROM user_roles WHERE user_id=u.id AND role::text='employee') THEN 'employee' ELSE 'field_associate' END) data
   FROM auth.users u JOIN profiles p ON p.id=u.id
   LEFT JOIN attendance_employees a ON (a.auth_user_id=u.id OR (a.auth_user_id IS NULL AND lower(a.email)=lower(u.email))) AND a.deleted_at IS NULL
   WHERE NOT EXISTS(SELECT 1 FROM hr_employees WHERE auth_user_id=u.id OR lower(email)=lower(u.email))
    AND u.email_confirmed_at IS NOT NULL
   UNION ALL
   SELECT a.name,jsonb_build_object('auth_user_id',NULL,'attendance_employee_id',a.id,'name',a.name,'email',a.email,'mobile','',
    'enroll_id',a.enroll_id,'enrollment_status',a.enrollment_status,'directory_visible',a.active,
    'department',a.department,'joining_date',a.employment_start,'app_access',CASE WHEN a.department='manager' THEN 'manager' ELSE 'employee' END)
   FROM attendance_employees a WHERE a.auth_user_id IS NULL AND a.deleted_at IS NULL AND a.email IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM hr_employees WHERE attendance_employee_id=a.id OR lower(email)=lower(a.email))
    AND NOT EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=lower(a.email))
  ) x));
END $$;
REVOKE ALL ON FUNCTION public.hr_board() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hr_board() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
