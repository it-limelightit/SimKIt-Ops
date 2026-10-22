-- Apply after the HR hiring migration. Keeps account/attendance data when removing HR entries.
BEGIN;

ALTER TABLE public.hr_employees ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.hr_employees ADD COLUMN IF NOT EXISTS deleted_by uuid;

CREATE TABLE IF NOT EXISTS public.hr_directory_deletions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid REFERENCES public.hr_employees(id),
 auth_user_id uuid, attendance_employee_id uuid, email text NOT NULL, name text NOT NULL,
 reason text NOT NULL, deleted_by uuid NOT NULL, deleted_at timestamptz NOT NULL DEFAULT now(),
 restored_at timestamptz, restored_by uuid
);
ALTER TABLE public.hr_directory_deletions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_directory_deletions_read ON public.hr_directory_deletions;
CREATE POLICY hr_directory_deletions_read ON public.hr_directory_deletions FOR SELECT TO authenticated USING (public.hr_can_manage());
REVOKE ALL ON public.hr_directory_deletions FROM anon,authenticated;
GRANT SELECT ON public.hr_directory_deletions TO authenticated;
GRANT ALL ON public.hr_directory_deletions TO service_role;
CREATE INDEX IF NOT EXISTS hr_directory_deletions_active_email ON public.hr_directory_deletions(lower(email)) WHERE restored_at IS NULL;

CREATE OR REPLACE FUNCTION public.hr_default_mentor(_email text,_name text,_access text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE
 WHEN _access='field_associate' THEN 'Raghav Gaur & Hitesh Bhai'
 WHEN lower(trim(_email)) IN ('vikashkumavat.limelight@gmail.com','mayankk.limelightit@gmail.com','surajbiswas.limelight@gmail.com')
   OR split_part(lower(trim(_name)),' ',1) IN ('vikash','vikas','mayank','suraj') THEN 'Kuldeep Shrimali'
 WHEN lower(trim(_email)) IN ('nitsanghani1@gmail.com','kishanvyas308@gmail.com','associatelimelight@gmail.com','info@limelightit.io','kuldeepshrimali.limelight@gmail.com')
   OR split_part(lower(trim(_name)),' ',1) IN ('nit','kishan','hitesh','raghav','kuldeep') THEN 'Tarun Purohit'
 WHEN lower(trim(_email))='aryankadiya2005@gmail.com' OR split_part(lower(trim(_name)),' ',1)='aryan' THEN 'Hitesh Bhai'
 ELSE '' END
$$;

-- Apply the requested reporting hierarchy once to existing saved HR records, preserving the audit trail.
DO $$ DECLARE e public.hr_employees; mentor text; BEGIN
 FOR e IN SELECT * FROM public.hr_employees WHERE deleted_at IS NULL LOOP
  mentor:=public.hr_default_mentor(e.email,e.name,e.app_access);
  IF mentor<>'' AND e.mentor_name IS DISTINCT FROM mentor THEN
   UPDATE public.hr_employees SET mentor_name=mentor,revision=revision+1,updated_at=now() WHERE id=e.id;
   INSERT INTO public.hr_events(employee_id,action,actor_id,before_data,after_data)
    VALUES(e.id,'reporting_manager_updated',e.created_by,to_jsonb(e),jsonb_build_object('mentor_name',mentor,'source','requested_reporting_hierarchy'));
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.hr_directory_hidden(_auth uuid,_attendance uuid,_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM hr_directory_deletions d WHERE d.restored_at IS NULL AND
  (d.auth_user_id=_auth OR d.attendance_employee_id=_attendance OR lower(d.email)=lower(_email)))
$$;

CREATE OR REPLACE FUNCTION public.hr_assert_directory_available(_email text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('hr-directory:'||lower(trim(_email)),0));
 IF hr_directory_hidden(NULL,NULL,trim(_email)) THEN RAISE EXCEPTION 'Employee was deleted from HR. Restore the entry before adding it again'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.hr_board() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date; BEGIN
 PERFORM hr_assert_access();
 RETURN jsonb_build_object('today',today,
  'employees',(SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('current_term',t.data,'enroll_id',a.enroll_id,'enrollment_status',a.enrollment_status) ORDER BY e.name),'[]')
   FROM hr_employees e LEFT JOIN attendance_employees a ON a.id=e.attendance_employee_id
   LEFT JOIN LATERAL(SELECT to_jsonb(v) data FROM hr_employment_terms v WHERE v.employee_id=e.id
    ORDER BY (v.effective_from<=today) DESC,CASE WHEN v.effective_from<=today THEN v.effective_from END DESC,
     CASE WHEN v.effective_from>today THEN v.effective_from END ASC,v.revision DESC LIMIT 1) t ON true
   WHERE e.deleted_at IS NULL),
  'terms',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.effective_from DESC,t.revision DESC),'[]') FROM hr_employment_terms t JOIN hr_employees e ON e.id=t.employee_id WHERE e.deleted_at IS NULL),
  'offers',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.created_at DESC),'[]') FROM hr_offer_letters o JOIN hr_employees e ON e.id=o.employee_id WHERE e.deleted_at IS NULL),
  'candidates',(SELECT coalesce(jsonb_agg(x.data||jsonb_build_object('mentor_name',hr_default_mentor(x.data->>'email',x.name,x.data->>'app_access')) ORDER BY x.name),'[]') FROM (
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
    AND u.email_confirmed_at IS NOT NULL AND NOT hr_directory_hidden(u.id,a.id,u.email)
   UNION ALL
   SELECT a.name,jsonb_build_object('auth_user_id',NULL,'attendance_employee_id',a.id,'name',a.name,'email',a.email,'mobile','',
    'enroll_id',a.enroll_id,'enrollment_status',a.enrollment_status,'directory_visible',a.active,
    'department',a.department,'joining_date',a.employment_start,'app_access',CASE WHEN a.department='manager' THEN 'manager' ELSE 'employee' END)
   FROM attendance_employees a WHERE a.auth_user_id IS NULL AND a.deleted_at IS NULL AND a.email IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM hr_employees WHERE attendance_employee_id=a.id OR lower(email)=lower(a.email))
    AND NOT EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=lower(a.email))
    AND NOT hr_directory_hidden(NULL,a.id,a.email)
  ) x));
END $$;

CREATE OR REPLACE FUNCTION public.hr_delete_employee(
 _employee uuid DEFAULT NULL,_revision integer DEFAULT NULL,_source_auth uuid DEFAULT NULL,
 _source_attendance uuid DEFAULT NULL,_reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e hr_employees; source jsonb; result uuid; reason_value text:=coalesce(nullif(trim(_reason),''),'Removed from HR directory'); BEGIN
 PERFORM hr_assert_access();
 IF length(reason_value)>2000 THEN RAISE EXCEPTION 'Reason must be at most 2000 characters'; END IF;
 IF _employee IS NOT NULL THEN
  SELECT * INTO e FROM hr_employees WHERE id=_employee FOR UPDATE;
  IF NOT FOUND OR e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Employee is no longer in the HR directory'; END IF;
  IF e.revision IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Employee changed. Refresh and try again'; END IF;
  INSERT INTO hr_directory_deletions(employee_id,auth_user_id,attendance_employee_id,email,name,reason,deleted_by)
   VALUES(e.id,e.auth_user_id,e.attendance_employee_id,e.email,e.name,reason_value,auth.uid()) RETURNING id INTO result;
  UPDATE hr_employees SET deleted_at=now(),deleted_by=auth.uid(),revision=revision+1,updated_at=now() WHERE id=e.id;
  INSERT INTO hr_events(employee_id,action,actor_id,before_data,after_data)
   VALUES(e.id,'employee_deleted_from_directory',auth.uid(),to_jsonb(e),jsonb_build_object('deletion_id',result,'reason',reason_value));
 ELSE
  IF _source_auth IS NULL AND _source_attendance IS NULL THEN RAISE EXCEPTION 'An existing employee is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(_source_auth::text,_source_attendance::text),0));
  SELECT c INTO source FROM jsonb_array_elements(hr_board()->'candidates') c
   WHERE (c->>'directory_visible')::boolean IS TRUE
    AND (_source_auth IS NULL OR c->>'auth_user_id'=_source_auth::text)
    AND (_source_attendance IS NULL OR c->>'attendance_employee_id'=_source_attendance::text) LIMIT 1;
  IF source IS NULL THEN RAISE EXCEPTION 'Employee changed. Refresh and try again'; END IF;
  -- Serialize deletion of an existing source with completion of that person's HR record.
  PERFORM pg_advisory_xact_lock(hashtextextended('hr-directory:'||lower(source->>'email'),0));
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(hr_board()->'candidates') c WHERE c->>'email'=source->>'email') THEN
   RAISE EXCEPTION 'Employee changed. Refresh and try again';
  END IF;
  INSERT INTO hr_directory_deletions(auth_user_id,attendance_employee_id,email,name,reason,deleted_by)
   VALUES((source->>'auth_user_id')::uuid,(source->>'attendance_employee_id')::uuid,source->>'email',source->>'name',reason_value,auth.uid()) RETURNING id INTO result;
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.hr_restore_employee(_deletion uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d hr_directory_deletions; BEGIN
 PERFORM hr_assert_access();
 SELECT * INTO d FROM hr_directory_deletions WHERE id=_deletion FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Deleted entry not found'; END IF;
 IF d.restored_at IS NOT NULL THEN RETURN; END IF;
 IF d.employee_id IS NOT NULL THEN
  UPDATE hr_employees SET deleted_at=NULL,deleted_by=NULL,revision=revision+1,updated_at=now() WHERE id=d.employee_id;
  INSERT INTO hr_events(employee_id,action,actor_id,after_data) VALUES(d.employee_id,'employee_restored_to_directory',auth.uid(),jsonb_build_object('deletion_id',d.id));
 END IF;
 UPDATE hr_directory_deletions SET restored_at=now(),restored_by=auth.uid() WHERE id=d.id;
END $$;

-- Serialize edits with deletion; stable provisioning reads cannot take a row lock.
CREATE OR REPLACE FUNCTION public.hr_assert_employee_current(_employee uuid,_lock boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE removed timestamptz; BEGIN
 IF _employee IS NULL THEN RETURN; END IF;
 IF _lock THEN SELECT deleted_at INTO removed FROM hr_employees WHERE id=_employee FOR UPDATE;
 ELSE SELECT deleted_at INTO removed FROM hr_employees WHERE id=_employee; END IF;
 IF removed IS NOT NULL THEN RAISE EXCEPTION 'Employee has been deleted from HR. Restore the employee before making changes'; END IF;
END $$;

-- Preserve the original, reviewed validation in the existing HR RPCs while adding the deletion guard.
DO $$ DECLARE f record; definition text; guard text; BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('hr_save_employee','hr_attach_login','hr_provision_context','hr_revise_employment','hr_request_enrollment','hr_mark_left','hr_save_offer') LOOP
  definition:=pg_get_functiondef(f.oid);
  IF position('hr_assert_employee_current' IN definition)>0 THEN CONTINUE; END IF;
  guard:=CASE WHEN f.proname='hr_save_employee' THEN E'\n PERFORM public.hr_assert_employee_current(_id);\n IF _id IS NULL THEN PERFORM public.hr_assert_directory_available(_details->>''email''); END IF;'
   WHEN f.proname='hr_provision_context' THEN E'\n PERFORM public.hr_assert_employee_current(_employee,false);'
   ELSE E'\n PERFORM public.hr_assert_employee_current(_employee);' END;
  IF position('PERFORM hr_assert_access();' IN definition)=0 THEN RAISE EXCEPTION 'Missing access guard in %',f.proname; END IF;
  EXECUTE replace(definition,'PERFORM hr_assert_access();','PERFORM hr_assert_access();'||guard);
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.hr_default_mentor(text,text,text),public.hr_directory_hidden(uuid,uuid,text),public.hr_assert_employee_current(uuid,boolean),public.hr_assert_directory_available(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hr_delete_employee(uuid,integer,uuid,uuid,text),public.hr_restore_employee(uuid),public.hr_board() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hr_delete_employee(uuid,integer,uuid,uuid,text),public.hr_restore_employee(uuid),public.hr_board() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
