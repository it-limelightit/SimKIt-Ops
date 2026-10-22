BEGIN;

-- Extend Hardik's workspace without granting access to the attendance/admin modules.
CREATE OR REPLACE FUNCTION public.limited_manager_modules(_user_id uuid DEFAULT auth.uid())
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE lower(btrim(email))
  WHEN 'admin@limelightit.io' THEN ARRAY['salary-expense','hr-hiring']
  WHEN 'aryankadiya2005@gmail.com' THEN ARRAY['leave','logistic','inventory']
  ELSE NULL::text[] END FROM auth.users WHERE id=_user_id
$$;

CREATE FUNCTION public.hr_can_manage() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u JOIN profiles p ON p.id=u.id
  WHERE u.id=auth.uid() AND lower(btrim(u.email))='admin@limelightit.io'
   AND u.email_confirmed_at IS NOT NULL AND p.is_active)
$$;
CREATE FUNCTION public.hr_assert_access() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT public.hr_can_manage() THEN RAISE EXCEPTION 'HR manager access required' USING ERRCODE='42501'; END IF;
END $$;

CREATE SEQUENCE public.hr_employee_code_seq;
CREATE SEQUENCE public.hr_offer_number_seq;
CREATE SEQUENCE public.hr_device_enroll_seq START 10000;
CREATE TABLE public.hr_employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_code text UNIQUE NOT NULL DEFAULT 'LL-'||lpad(nextval('public.hr_employee_code_seq')::text,5,'0'),
 revision integer NOT NULL DEFAULT 1,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 email text NOT NULL CHECK(length(email)<=254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 mobile text NOT NULL CHECK(mobile ~ '^\+?[0-9 ()-]{7,25}$'),
 department text NOT NULL CHECK(department IN ('software','firmware','hardware','field','logistic','manager')),
 designation text NOT NULL CHECK(length(btrim(designation)) BETWEEN 1 AND 120),
 mentor_name text NOT NULL CHECK(length(btrim(mentor_name)) BETWEEN 1 AND 120),
 joining_date date NOT NULL CHECK(joining_date BETWEEN date '2000-01-01' AND date '2100-12-31'),
 address text NOT NULL DEFAULT '' CHECK(length(address)<=500),
 college text NOT NULL DEFAULT '' CHECK(length(college)<=300),
 app_access text NOT NULL CHECK(app_access IN ('employee','field_associate','manager')),
 attendance_method text NOT NULL CHECK(attendance_method IN ('office_device','field_online')),
 status text NOT NULL DEFAULT 'onboarding' CHECK(status IN ('onboarding','active','left')),
 auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
 attendance_employee_id uuid UNIQUE REFERENCES public.attendance_employees(id),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((app_access='field_associate')=(attendance_method='field_online'))
);
CREATE UNIQUE INDEX hr_employee_email_unique ON public.hr_employees(lower(email));
CREATE TABLE public.hr_employment_terms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES public.hr_employees(id),
 revision integer NOT NULL,
 employment_type text NOT NULL CHECK(employment_type IN ('internship','full_time')),
 monthly_amount numeric(12,2) NOT NULL CHECK(monthly_amount>=0 AND monthly_amount<1000000000),
 annual_ctc numeric(12,2) CHECK(annual_ctc>0 AND annual_ctc<1000000000),
 internship_months integer CHECK(internship_months BETWEEN 1 AND 60), internship_end date,
 effective_from date NOT NULL CHECK(effective_from BETWEEN date '2000-01-01' AND date '2100-12-31'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(employee_id,revision),
 CHECK((employment_type='internship' AND internship_months IS NOT NULL AND internship_end IS NOT NULL AND annual_ctc IS NULL)
  OR (employment_type='full_time' AND annual_ctc IS NOT NULL AND internship_months IS NULL AND internship_end IS NULL))
);
CREATE INDEX hr_terms_effective ON public.hr_employment_terms(employee_id,effective_from DESC,revision DESC);
CREATE TABLE public.hr_offer_letters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES public.hr_employees(id),
 offer_number text UNIQUE NOT NULL DEFAULT 'LL-OFFER-'||to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY')||'-'||lpad(nextval('public.hr_offer_number_seq')::text,5,'0'),
 template text NOT NULL CHECK(template IN ('software','firmware','field_associate')),
 snapshot jsonb NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.hr_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES public.hr_employees(id),
 action text NOT NULL, actor_id uuid NOT NULL, before_data jsonb, after_data jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['hr_employees','hr_employment_terms','hr_offer_letters','hr_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  EXECUTE format('CREATE POLICY hr_manager_read ON public.%I FOR SELECT TO authenticated USING (public.hr_can_manage())',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE public.hr_employee_code_seq,public.hr_offer_number_seq,public.hr_device_enroll_seq TO service_role;

-- Internal helper. All callers hold the employee lock and assert HR access.
CREATE FUNCTION public.hr_insert_terms(_employee uuid,_terms jsonb,_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e hr_employees; result uuid; kind text; monthly numeric; ctc numeric; months integer; ending date; starting date;
BEGIN
 SELECT * INTO e FROM hr_employees WHERE id=_employee FOR UPDATE;
 kind:=_terms->>'employment_type'; monthly:=(_terms->>'monthly_amount')::numeric;
 starting:=(_terms->>'effective_from')::date;
 IF e.id IS NULL OR kind IS NULL OR kind NOT IN ('internship','full_time') OR starting IS NULL OR starting<e.joining_date
  OR monthly IS NULL OR monthly::text IN ('NaN','Infinity','-Infinity') OR monthly<0 OR monthly>=1000000000
  OR coalesce(length(btrim(_reason)),0) NOT BETWEEN 1 AND 2000 THEN
  RAISE EXCEPTION 'Complete employment type, effective date, compensation and revision reason';
 END IF;
 IF kind='internship' THEN
  months:=(_terms->>'internship_months')::integer; ending:=(_terms->>'internship_end')::date;
  IF months IS NULL OR months NOT BETWEEN 1 AND 60 OR ending IS NULL OR ending<starting OR ending>date '2100-12-31' THEN
   RAISE EXCEPTION 'Enter internship duration and an end date on or after the effective date';
  END IF;
 ELSE
  ctc:=(_terms->>'annual_ctc')::numeric;
  IF ctc IS NULL OR ctc::text IN ('NaN','Infinity','-Infinity') OR ctc<=0 OR ctc>=1000000000 THEN RAISE EXCEPTION 'Enter a positive annual CTC'; END IF;
 END IF;
 INSERT INTO hr_employment_terms(employee_id,revision,employment_type,monthly_amount,annual_ctc,internship_months,internship_end,effective_from,reason,created_by)
 VALUES(_employee,(SELECT coalesce(max(revision),0)+1 FROM hr_employment_terms WHERE employee_id=_employee),kind,round(monthly,2),round(ctc,2),months,ending,starting,btrim(_reason),auth.uid())
 RETURNING id INTO result;
 INSERT INTO hr_events(employee_id,action,actor_id,after_data) VALUES(_employee,'employment_terms_added',auth.uid(),(SELECT to_jsonb(t) FROM hr_employment_terms t WHERE id=result));
 RETURN result;
END $$;

CREATE FUNCTION public.hr_save_employee(_id uuid,_revision integer,_details jsonb,_initial_terms jsonb DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e hr_employees; result uuid; source_auth uuid; source_attendance uuid; account auth.users; a attendance_employees;
 name_value text:=btrim(_details->>'name'); email_value text:=lower(btrim(_details->>'email'));
 mobile_value text:=btrim(_details->>'mobile'); dept text:=_details->>'department'; access_value text:=_details->>'app_access';
 attendance_value text:=_details->>'attendance_method'; joining date:=(_details->>'joining_date')::date;
BEGIN
 PERFORM hr_assert_access();
 IF name_value IS NULL OR length(name_value) NOT BETWEEN 1 AND 120 OR email_value IS NULL
  OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(email_value)>254
  OR mobile_value IS NULL OR mobile_value !~ '^\+?[0-9 ()-]{7,25}$'
  OR coalesce(length(btrim(_details->>'designation')),0) NOT BETWEEN 1 AND 120
  OR coalesce(length(btrim(_details->>'mentor_name')),0) NOT BETWEEN 1 AND 120
  OR joining IS NULL OR joining NOT BETWEEN date '2000-01-01' AND date '2100-12-31'
  OR dept IS NULL OR dept NOT IN ('software','firmware','hardware','field','logistic','manager')
  OR access_value IS NULL OR access_value NOT IN ('employee','field_associate','manager')
  OR attendance_value IS NULL OR attendance_value NOT IN ('office_device','field_online')
  OR (access_value='field_associate')<>(attendance_value='field_online')
  OR (access_value<>'field_associate' AND dept='field') THEN RAISE EXCEPTION 'Complete valid employee, contact, joining and workspace details'; END IF;
 IF _id IS NULL THEN
  result:=gen_random_uuid();
  source_auth:=nullif(_details->>'source_auth_user_id','')::uuid;
  source_attendance:=nullif(_details->>'source_attendance_employee_id','')::uuid;
  IF source_attendance IS NOT NULL THEN
   SELECT * INTO a FROM attendance_employees WHERE id=source_attendance AND deleted_at IS NULL FOR UPDATE;
   IF a.id IS NULL OR lower(a.email) IS DISTINCT FROM email_value OR attendance_value<>'office_device'
    OR (source_auth IS NOT NULL AND a.auth_user_id IS DISTINCT FROM source_auth) THEN RAISE EXCEPTION 'Existing attendance employee does not match this email or workspace'; END IF;
   source_auth:=a.auth_user_id;
  END IF;
  IF source_auth IS NOT NULL THEN
   SELECT * INTO account FROM auth.users WHERE id=source_auth;
   IF account.id IS NULL OR lower(account.email) IS DISTINCT FROM email_value THEN RAISE EXCEPTION 'Existing account does not match this employee email'; END IF;
  END IF;
  INSERT INTO hr_employees(id,name,email,mobile,department,designation,mentor_name,joining_date,address,college,app_access,attendance_method,attendance_employee_id,created_by)
   VALUES(result,name_value,email_value,mobile_value,dept,btrim(_details->>'designation'),btrim(_details->>'mentor_name'),joining,
    btrim(coalesce(_details->>'address','')),btrim(coalesce(_details->>'college','')),access_value,attendance_value,source_attendance,auth.uid());
  IF _initial_terms IS NULL THEN RAISE EXCEPTION 'Initial employment and compensation details required'; END IF;
  PERFORM hr_insert_terms(result,_initial_terms,'Initial employment terms');
  IF source_auth IS NOT NULL THEN PERFORM hr_attach_login(result,1); END IF;
  INSERT INTO hr_events(employee_id,action,actor_id,after_data) VALUES(result,'employee_created',auth.uid(),(SELECT to_jsonb(h) FROM hr_employees h WHERE h.id=result));
 ELSE
  SELECT * INTO e FROM hr_employees WHERE id=_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF e.revision IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Employee changed. Refresh before saving'; END IF;
  IF e.status='left' THEN RAISE EXCEPTION 'Former employee records are read only'; END IF;
  IF (e.auth_user_id IS NOT NULL OR e.attendance_employee_id IS NOT NULL) AND
   (email_value<>e.email OR access_value<>e.app_access OR attendance_value<>e.attendance_method) THEN
   RAISE EXCEPTION 'Keep the linked login email, workspace and attendance method unchanged';
  END IF;
  IF EXISTS(SELECT 1 FROM hr_employment_terms WHERE employee_id=e.id AND effective_from<joining) THEN RAISE EXCEPTION 'Joining date cannot be later than an existing employment revision'; END IF;
  result:=e.id;
  UPDATE hr_employees SET name=name_value,email=email_value,mobile=mobile_value,department=dept,
   designation=btrim(_details->>'designation'),mentor_name=btrim(_details->>'mentor_name'),joining_date=joining,
   address=btrim(coalesce(_details->>'address','')),college=btrim(coalesce(_details->>'college','')),
   app_access=access_value,attendance_method=attendance_value,revision=revision+1,updated_at=now() WHERE id=result;
  IF e.auth_user_id IS NOT NULL THEN UPDATE profiles SET name=name_value,mobile=mobile_value WHERE id=e.auth_user_id; END IF;
  IF e.attendance_employee_id IS NOT NULL THEN
   UPDATE attendance_employees SET name=name_value,department=CASE WHEN access_value='manager' THEN 'manager' ELSE dept END,employment_start=joining WHERE id=e.attendance_employee_id;
  END IF;
  INSERT INTO hr_events(employee_id,action,actor_id,before_data,after_data)
   VALUES(result,'employee_updated',auth.uid(),to_jsonb(e),(SELECT to_jsonb(h) FROM hr_employees h WHERE h.id=result));
 END IF;
 RETURN result;
END $$;

-- Link by verified Auth email, preserving all existing roles and passwords.
CREATE FUNCTION public.hr_attach_login(_employee uuid,_revision integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e hr_employees; account auth.users; a attendance_employees; aid uuid; enroll_value text; required_role text; today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
 PERFORM hr_assert_access();
 SELECT * INTO e FROM hr_employees WHERE id=_employee FOR UPDATE;
 IF e.id IS NULL OR e.status='left' THEN RAISE EXCEPTION 'Current employee not found'; END IF;
 IF e.revision IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Employee changed. Refresh before linking'; END IF;
 IF e.joining_date>today THEN RAISE EXCEPTION 'Activate login on or after the joining date'; END IF;
 SELECT * INTO account FROM auth.users WHERE lower(email)=e.email FOR UPDATE;
 IF account.id IS NULL OR account.email_confirmed_at IS NULL THEN RAISE EXCEPTION 'No verified existing login matches this email. Create a new login or confirm the existing account first'; END IF;
 IF EXISTS(SELECT 1 FROM hr_employees WHERE auth_user_id=account.id AND id<>e.id) THEN RAISE EXCEPTION 'Login already belongs to another HR record'; END IF;
 required_role:=CASE e.app_access WHEN 'field_associate' THEN 'worker' WHEN 'manager' THEN 'supervisor' ELSE 'employee' END;
 IF NOT EXISTS(SELECT 1 FROM user_roles WHERE user_id=account.id AND role::text=required_role)
  OR (e.app_access<>'manager' AND EXISTS(SELECT 1 FROM user_roles WHERE user_id=account.id AND role::text<>required_role)) THEN
  RAISE EXCEPTION 'Existing login has different workspace permissions. Its roles have not been changed';
 END IF;
 IF e.attendance_method='office_device' THEN
  SELECT * INTO a FROM attendance_employees WHERE id=e.attendance_employee_id OR auth_user_id=account.id OR lower(email)=e.email ORDER BY (id=e.attendance_employee_id) DESC NULLS LAST LIMIT 1 FOR UPDATE;
  IF a.id IS NOT NULL THEN
   IF a.deleted_at IS NOT NULL OR NOT a.active OR (a.auth_user_id IS NOT NULL AND a.auth_user_id<>account.id) THEN RAISE EXCEPTION 'Attendance record is inactive, deleted or linked to another login'; END IF;
   IF EXISTS(SELECT 1 FROM hr_employees WHERE attendance_employee_id=a.id AND id<>e.id) THEN RAISE EXCEPTION 'Attendance record already belongs to another HR employee'; END IF;
   aid:=a.id;
   UPDATE attendance_employees SET auth_user_id=account.id,name=e.name,email=e.email,email_verified=true,employment_start=e.joining_date,
    department=CASE WHEN e.app_access='manager' THEN 'manager' ELSE e.department END WHERE id=aid;
  ELSE
   aid:=e.id;
   LOOP
    enroll_value:=nextval('public.hr_device_enroll_seq')::text;
    EXIT WHEN NOT EXISTS(SELECT 1 FROM attendance_employees WHERE device_id='office'
     AND (enroll_id=enroll_value OR (enroll_id ~ '^[0-9]+$' AND ltrim(enroll_id,'0')=enroll_value)));
   END LOOP;
   INSERT INTO attendance_employees(id,name,department,enroll_id,email,email_verified,employment_start,created_by,auth_user_id)
    VALUES(aid,e.name,CASE WHEN e.app_access='manager' THEN 'manager' ELSE e.department END,
     enroll_value,e.email,true,e.joining_date,auth.uid(),account.id);
  END IF;
  IF account.raw_app_meta_data->>'office_employee'='true' AND nullif(account.raw_app_meta_data->>'attendance_employee_id','') IS NOT NULL
   AND account.raw_app_meta_data->>'attendance_employee_id'<>aid::text THEN RAISE EXCEPTION 'Login metadata belongs to a different office employee'; END IF;
  UPDATE auth.users SET raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('office_employee',true,'attendance_employee_id',aid) WHERE id=account.id;
 END IF;
 UPDATE profiles SET is_active=true,name=e.name,mobile=e.mobile WHERE id=account.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Login profile not found'; END IF;
 UPDATE hr_employees SET auth_user_id=account.id,attendance_employee_id=aid,status='active',revision=revision+1,updated_at=now() WHERE id=e.id;
 INSERT INTO hr_events(employee_id,action,actor_id,after_data) VALUES(e.id,'login_linked',auth.uid(),jsonb_build_object('auth_user_id',account.id,'attendance_employee_id',aid,'roles_changed',false));
 RETURN account.id;
END $$;

CREATE FUNCTION public.hr_provision_context(_employee uuid,_revision integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e hr_employees; BEGIN
 PERFORM hr_assert_access(); SELECT * INTO e FROM hr_employees WHERE id=_employee;
 IF e.id IS NULL OR e.status='left' THEN RAISE EXCEPTION 'Current employee not found'; END IF;
 IF e.revision IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Employee changed. Refresh before creating a login'; END IF;
 IF e.joining_date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Activate login on or after the joining date'; END IF;
 IF e.auth_user_id IS NOT NULL THEN RAISE EXCEPTION 'Employee already has a linked login'; END IF;
 IF e.app_access='manager' THEN RAISE EXCEPTION 'Link an existing manager account to preserve manager permissions'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=e.email) THEN RAISE EXCEPTION 'This email already has a login. Use Link existing login'; END IF;
 RETURN jsonb_build_object('id',e.id,'email',e.email,'name',e.name,'mobile',e.mobile,'app_access',e.app_access,'attendance_employee_id',coalesce(e.attendance_employee_id,e.id));
END $$;

CREATE FUNCTION public.hr_revise_employment(_employee uuid,_revision integer,_terms jsonb,_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e hr_employees; result uuid; BEGIN
 PERFORM hr_assert_access(); SELECT * INTO e FROM hr_employees WHERE id=_employee FOR UPDATE;
 IF e.id IS NULL OR e.status='left' THEN RAISE EXCEPTION 'Current employee not found'; END IF;
 IF e.revision IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Employee changed. Refresh before revising'; END IF;
 result:=hr_insert_terms(e.id,_terms,_reason);
 UPDATE hr_employees SET revision=revision+1,updated_at=now() WHERE id=e.id;
 RETURN result;
END $$;

CREATE FUNCTION public.hr_request_enrollment(_employee uuid,_revision integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e hr_employees; a attendance_employees; BEGIN
 PERFORM hr_assert_access(); SELECT * INTO e FROM hr_employees WHERE id=_employee FOR UPDATE;
 IF e.id IS NULL OR e.status<>'active' OR e.auth_user_id IS NULL OR e.attendance_method<>'office_device'
  OR e.joining_date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Activate an office employee login before device enrollment'; END IF;
 IF e.revision IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Employee changed. Refresh before enrolling'; END IF;
 SELECT * INTO a FROM attendance_employees WHERE id=e.attendance_employee_id AND active AND deleted_at IS NULL FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Active attendance record not found'; END IF;
 IF a.enrollment_status='enrolled' THEN RETURN 'enrolled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM attendance_device_commands WHERE employee_id=a.id AND status IN ('pending','publishing','published')) THEN
  INSERT INTO attendance_device_commands(employee_id) VALUES(a.id);
  UPDATE attendance_employees SET enrollment_status='pending' WHERE id=a.id;
  INSERT INTO hr_events(employee_id,action,actor_id,after_data) VALUES(e.id,'device_enrollment_requested',auth.uid(),jsonb_build_object('attendance_employee_id',a.id));
 END IF;
 RETURN 'pending';
END $$;

CREATE FUNCTION public.hr_mark_left(_employee uuid,_revision integer,_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e hr_employees; BEGIN
 PERFORM hr_assert_access(); SELECT * INTO e FROM hr_employees WHERE id=_employee FOR UPDATE;
 IF e.id IS NULL OR e.status='left' THEN RAISE EXCEPTION 'Current employee not found'; END IF;
 IF e.revision IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Employee changed. Refresh before updating'; END IF;
 IF e.auth_user_id=auth.uid() OR e.app_access='manager' THEN RAISE EXCEPTION 'Manager access must be managed separately'; END IF;
 IF coalesce(length(btrim(_reason)),0) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Leaving reason required'; END IF;
 UPDATE hr_employees SET status='left',revision=revision+1,updated_at=now() WHERE id=e.id;
 UPDATE profiles SET is_active=false WHERE id=e.auth_user_id;
 UPDATE attendance_employees SET active=false,deactivated_at=clock_timestamp() WHERE id=e.attendance_employee_id;
 UPDATE attendance_device_commands SET status='failed',error='Employee left; unsent enrollment cancelled' WHERE employee_id=e.attendance_employee_id AND status='pending';
 INSERT INTO hr_events(employee_id,action,actor_id,before_data,after_data)
  VALUES(e.id,'employee_left',auth.uid(),to_jsonb(e),jsonb_build_object('reason',btrim(_reason)));
END $$;

CREATE FUNCTION public.hr_save_offer(_employee uuid,_revision integer,_term uuid,_template text,_fields jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e hr_employees; t hr_employment_terms; result hr_offer_letters; k text; amount numeric; count_value integer; clean jsonb;
BEGIN
 PERFORM hr_assert_access(); SELECT * INTO e FROM hr_employees WHERE id=_employee FOR UPDATE;
 IF e.id IS NULL OR e.status='left' THEN RAISE EXCEPTION 'Current employee not found'; END IF;
 IF e.revision IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Employee changed. Refresh before creating the offer'; END IF;
 SELECT * INTO t FROM hr_employment_terms WHERE id=_term AND employee_id=e.id;
 IF t.id IS NULL OR _template IS NULL OR _template NOT IN ('software','firmware','field_associate') THEN RAISE EXCEPTION 'Select valid employment terms and an offer template'; END IF;
 IF jsonb_typeof(_fields) IS DISTINCT FROM 'object' OR (_fields->>'offer_date')::date IS NULL
  OR (_fields->>'offer_date')::date NOT BETWEEN date '2000-01-01' AND date '2100-12-31' THEN RAISE EXCEPTION 'Valid offer date required'; END IF;
 FOREACH k IN ARRAY ARRAY['honorific','greeting_name','recipient_location','acceptance_place','office_timings'] LOOP
  IF _fields->>k IS NULL OR length(btrim(_fields->>k))>500 OR (k<>'honorific' AND length(btrim(_fields->>k))=0)
   OR (k IN ('honorific','greeting_name','acceptance_place') AND length(btrim(_fields->>k))>120) THEN RAISE EXCEPTION 'Complete the offer letter details: %',k; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['incentive_per_installation','travel_per_km'] LOOP
  amount:=(_fields->>k)::numeric;
  IF amount IS NULL OR amount::text IN ('NaN','Infinity','-Infinity') OR amount<0 OR amount>=1000000000 THEN RAISE EXCEPTION 'Invalid offer amount: %',k; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['initial_stipend_months','acceptance_days','installation_target','probation_months','payment_day','payroll_cutoff_day'] LOOP
  count_value:=(_fields->>k)::integer;
  IF count_value IS NULL OR count_value<1 OR count_value>(CASE WHEN k IN ('payment_day','payroll_cutoff_day') THEN 31 ELSE 60 END) THEN RAISE EXCEPTION 'Invalid offer period: %',k; END IF;
 END LOOP;
 IF t.employment_type='internship' AND (_fields->>'initial_stipend_months')::integer>t.internship_months THEN RAISE EXCEPTION 'Initial stipend period cannot exceed internship duration'; END IF;
 clean:=jsonb_build_object('offer_date',(_fields->>'offer_date')::date,'honorific',btrim(_fields->>'honorific'),
  'greeting_name',btrim(_fields->>'greeting_name'),'recipient_location',btrim(_fields->>'recipient_location'),
  'acceptance_place',btrim(_fields->>'acceptance_place'),'office_timings',btrim(_fields->>'office_timings'),
  'initial_stipend_months',(_fields->>'initial_stipend_months')::integer,'acceptance_days',(_fields->>'acceptance_days')::integer,
  'incentive_per_installation',(_fields->>'incentive_per_installation')::numeric,'travel_per_km',(_fields->>'travel_per_km')::numeric,
  'installation_target',(_fields->>'installation_target')::integer,'probation_months',(_fields->>'probation_months')::integer,
  'payment_day',(_fields->>'payment_day')::integer,'payroll_cutoff_day',(_fields->>'payroll_cutoff_day')::integer);
 INSERT INTO hr_offer_letters(employee_id,template,snapshot,created_by)
  VALUES(e.id,_template,jsonb_build_object('version',1,'template',_template,'employee',to_jsonb(e),'term',to_jsonb(t),'fields',clean),auth.uid()) RETURNING * INTO result;
 INSERT INTO hr_events(employee_id,action,actor_id,after_data) VALUES(e.id,'offer_generated',auth.uid(),jsonb_build_object('offer_id',result.id,'offer_number',result.offer_number));
 RETURN to_jsonb(result);
END $$;

CREATE FUNCTION public.hr_board() RETURNS jsonb
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

REVOKE ALL ON FUNCTION public.hr_can_manage(),public.hr_assert_access(),public.hr_insert_terms(uuid,jsonb,text),
 public.hr_save_employee(uuid,integer,jsonb,jsonb),public.hr_attach_login(uuid,integer),public.hr_provision_context(uuid,integer),
 public.hr_revise_employment(uuid,integer,jsonb,text),public.hr_request_enrollment(uuid,integer),public.hr_mark_left(uuid,integer,text),
 public.hr_save_offer(uuid,integer,uuid,text,jsonb),public.hr_board() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hr_can_manage(),public.hr_assert_access(),public.hr_save_employee(uuid,integer,jsonb,jsonb),
 public.hr_attach_login(uuid,integer),public.hr_provision_context(uuid,integer),public.hr_revise_employment(uuid,integer,jsonb,text),
 public.hr_request_enrollment(uuid,integer),public.hr_mark_left(uuid,integer,text),public.hr_save_offer(uuid,integer,uuid,text,jsonb),public.hr_board() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
