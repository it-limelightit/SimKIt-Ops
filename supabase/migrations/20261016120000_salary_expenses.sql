BEGIN;

CREATE FUNCTION public.finance_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE lower(btrim(email)) WHEN 'admin@limelightit.io' THEN 'hardik' WHEN 'tarun@limelightit.io' THEN 'tarun' END
 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL
$$;
CREATE FUNCTION public.finance_assert() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF public.finance_role() IS NULL THEN RAISE EXCEPTION 'Salary manager access required' USING ERRCODE='42501'; END IF;
END $$;

CREATE TABLE public.expense_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES public.profiles(id),
 expense_date date NOT NULL, settlement_month date NOT NULL CHECK(extract(day FROM settlement_month)=1),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
 category text NOT NULL CHECK(category IN ('porter','items','travel','courier')),
 amount numeric(12,2) NOT NULL CHECK(amount>0), description text NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 attachment_ids uuid[] NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'hardik_pending' CHECK(status IN ('hardik_pending','tarun_pending','approved','rejected','cancelled')),
 hardik_decision text, hardik_at timestamptz, hardik_reason text, tarun_decision text, tarun_at timestamptz, tarun_reason text,
 paid_at timestamptz, payment_reference text, paid_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expense_claims_month ON public.expense_claims(settlement_month,owner_id);
CREATE TABLE public.expense_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES public.profiles(id),
 claim_id uuid REFERENCES public.expense_claims(id), object_key text UNIQUE NOT NULL,
 filename text NOT NULL, mime_type text NOT NULL CHECK(mime_type IN ('application/pdf','image/jpeg','image/png')),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 5000000), sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.salary_months (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES public.attendance_employees(id),
 month date NOT NULL CHECK(extract(day FROM month)=1), base_salary numeric(12,2) NOT NULL CHECK(base_salary>=0),
 overrides jsonb NOT NULL DEFAULT '{}', days jsonb NOT NULL, working_days integer NOT NULL,
 payable_days numeric NOT NULL, amount numeric(12,2) NOT NULL CHECK(amount>=0), revision integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','tarun_pending','approved','rejected')),
 hardik_at timestamptz, tarun_at timestamptz, rejection_reason text,
 paid_at timestamptz, payment_reference text, paid_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(employee_id,month)
);
CREATE TABLE public.finance_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_id uuid NOT NULL, entity_type text NOT NULL,
 actor_id uuid NOT NULL, actor_role text, action text NOT NULL, reason text,
 before_data jsonb, after_data jsonb, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX finance_events_entity ON public.finance_events(entity_id,occurred_at);
CREATE TABLE public.field_finance_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), associate_id uuid NOT NULL, period_end date NOT NULL,
 snapshot jsonb NOT NULL, status text NOT NULL CHECK(status IN ('tarun_pending','approved','rejected')),
 hardik_at timestamptz NOT NULL DEFAULT now(), tarun_at timestamptz, reason text, revision integer NOT NULL DEFAULT 1,
 UNIQUE(associate_id,period_end)
);

ALTER TABLE public.expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_finance_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY expense_read ON public.expense_claims FOR SELECT TO authenticated USING(owner_id=auth.uid() OR public.finance_role() IS NOT NULL);
CREATE POLICY expense_file_read ON public.expense_files FOR SELECT TO authenticated USING(owner_id=auth.uid() OR public.finance_role() IS NOT NULL);
CREATE POLICY salary_read ON public.salary_months FOR SELECT TO authenticated USING(public.finance_role() IS NOT NULL);
CREATE POLICY field_review_read ON public.field_finance_reviews FOR SELECT TO authenticated USING(public.finance_role() IS NOT NULL);
CREATE POLICY finance_event_read ON public.finance_events FOR SELECT TO authenticated USING(public.finance_role() IS NOT NULL OR EXISTS(SELECT 1 FROM public.expense_claims c WHERE c.id=entity_id AND c.owner_id=auth.uid()));
REVOKE ALL ON public.expense_claims,public.expense_files,public.salary_months,public.finance_events,public.field_finance_reviews FROM anon,authenticated;
GRANT SELECT ON public.expense_claims,public.expense_files,public.salary_months,public.finance_events,public.field_finance_reviews TO authenticated;
GRANT ALL ON public.expense_claims,public.expense_files,public.salary_months,public.finance_events,public.field_finance_reviews TO service_role;

CREATE FUNCTION public.finance_log(_type text,_id uuid,_action text,_before jsonb,_after jsonb,_reason text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 INSERT INTO finance_events(entity_type,entity_id,actor_id,actor_role,action,before_data,after_data,reason)
 VALUES(_type,_id,auth.uid(),public.finance_role(),_action,_before,_after,_reason)
$$;

CREATE FUNCTION public.expense_save(_id uuid,_revision integer,_date date,_title text,_category text,_amount numeric,_description text,_files uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c expense_claims; before_row jsonb; result uuid; today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=auth.uid() AND p.is_active AND u.email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Verified active account required' USING ERRCODE='42501'; END IF;
 IF public.finance_role()='hardik' THEN RAISE EXCEPTION 'Hardik does not submit personal expenses'; END IF;
 IF public.finance_role()='tarun' THEN RAISE EXCEPTION 'Your personal expense approval flow is pending configuration'; END IF;
 IF _date IS NULL OR _date>today OR _date<date '2000-01-01' OR _amount IS NULL OR _amount::text IN ('NaN','Infinity','-Infinity') OR _amount<=0 THEN RAISE EXCEPTION 'Enter a valid expense date and positive amount'; END IF;
 IF _title IS NULL OR length(btrim(_title)) NOT BETWEEN 1 AND 160 OR _category IS NULL OR _category NOT IN ('porter','items','travel','courier') OR length(coalesce(_description,''))>4000 THEN RAISE EXCEPTION 'Complete the expense details'; END IF;
 IF _files IS NULL OR cardinality(_files)>5 OR cardinality(_files)<>(SELECT count(DISTINCT x) FROM unnest(_files) x) THEN RAISE EXCEPTION 'Attach up to five different files'; END IF;
 IF _id IS NOT NULL THEN
  SELECT * INTO c FROM expense_claims WHERE id=_id FOR UPDATE;
  IF c.id IS NULL OR c.owner_id<>auth.uid() THEN RAISE EXCEPTION 'Claim not found' USING ERRCODE='42501'; END IF;
  IF c.revision IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Claim changed. Refresh before editing'; END IF;
  IF c.status<>'rejected' OR c.paid_at IS NOT NULL THEN RAISE EXCEPTION 'Only rejected claims can be edited and reapplied'; END IF;
  IF today>=c.settlement_month+interval '1 month 5 days' THEN RAISE EXCEPTION 'Reapplication closed after the following month''s 5th'; END IF;
  before_row:=to_jsonb(c);
 END IF;
 PERFORM 1 FROM expense_files WHERE id=ANY(_files) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM expense_files WHERE id=ANY(_files) AND owner_id=auth.uid() AND (claim_id IS NULL OR claim_id=_id))<>cardinality(_files) THEN RAISE EXCEPTION 'Invalid attachment'; END IF;
 IF _id IS NULL THEN
  INSERT INTO expense_claims(owner_id,expense_date,settlement_month,title,category,amount,description,attachment_ids)
  VALUES(auth.uid(),_date,date_trunc('month',today)::date,btrim(_title),_category,_amount,coalesce(_description,''),_files) RETURNING id INTO result;
 ELSE
  result:=_id;
  UPDATE expense_claims SET expense_date=_date,title=btrim(_title),category=_category,amount=_amount,description=coalesce(_description,''),attachment_ids=_files,
   revision=revision+1,status='hardik_pending',hardik_decision=NULL,hardik_at=NULL,hardik_reason=NULL,tarun_decision=NULL,tarun_at=NULL,tarun_reason=NULL,updated_at=now() WHERE id=result;
 END IF;
 UPDATE expense_files SET claim_id=result WHERE id=ANY(_files);
 PERFORM finance_log('expense',result,CASE WHEN _id IS NULL THEN 'submitted' ELSE 'reapplied' END,before_row,(SELECT to_jsonb(x) FROM expense_claims x WHERE id=result));
 RETURN result;
END $$;

CREATE FUNCTION public.expense_action(_id uuid,_revision integer,_action text,_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c expense_claims; before_row jsonb; reviewer text:=public.finance_role();
BEGIN
 SELECT * INTO c FROM expense_claims WHERE id=_id FOR UPDATE;
 IF c.id IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Claim not found'; END IF;
 IF c.revision IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Claim changed. Refresh before acting'; END IF;
 before_row:=to_jsonb(c);
 IF _action='cancel' THEN
  IF c.owner_id<>auth.uid() OR c.status NOT IN ('hardik_pending','rejected') OR c.paid_at IS NOT NULL THEN RAISE EXCEPTION 'This claim cannot be deleted'; END IF;
  UPDATE expense_claims SET status='cancelled' WHERE id=_id;
 ELSIF _action IN ('approve','reject') THEN
  IF reviewer IS NULL OR c.owner_id=auth.uid() OR (reviewer='hardik' AND c.status<>'hardik_pending') OR (reviewer='tarun' AND c.status<>'tarun_pending') THEN RAISE EXCEPTION 'Claim is not awaiting your review' USING ERRCODE='42501'; END IF;
  IF _action='reject' AND coalesce(length(btrim(_reason)),0)=0 THEN RAISE EXCEPTION 'Rejection reason required'; END IF;
  IF reviewer='hardik' THEN
   UPDATE expense_claims SET hardik_decision=_action,hardik_at=now(),hardik_reason=CASE WHEN _action='reject' THEN btrim(_reason) END,status=CASE WHEN _action='approve' THEN 'tarun_pending' ELSE 'rejected' END WHERE id=_id;
  ELSE
   UPDATE expense_claims SET tarun_decision=_action,tarun_at=now(),tarun_reason=CASE WHEN _action='reject' THEN btrim(_reason) END,status=CASE WHEN _action='approve' THEN 'approved' ELSE 'rejected' END WHERE id=_id;
  END IF;
 ELSIF _action='pay' THEN
  PERFORM finance_assert();
  IF (now() AT TIME ZONE 'Asia/Kolkata')::date<c.settlement_month+interval '1 month 6 days' THEN RAISE EXCEPTION 'Expense payment opens on the following month''s 7th'; END IF;
  IF c.status<>'approved' OR c.paid_at IS NOT NULL OR coalesce(length(btrim(_reason)),0)=0 THEN RAISE EXCEPTION 'Approved unpaid claim and payment reference required'; END IF;
  UPDATE expense_claims SET paid_at=now(),paid_by=auth.uid(),payment_reference=btrim(_reason) WHERE id=_id;
 ELSE RAISE EXCEPTION 'Unknown action'; END IF;
 UPDATE expense_claims SET revision=revision+1,updated_at=now() WHERE id=_id;
 PERFORM finance_log('expense',_id,_action,before_row,(SELECT to_jsonb(x) FROM expense_claims x WHERE id=_id),_reason);
END $$;

CREATE FUNCTION public.expense_review_batch(_claims jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb;
BEGIN
 PERFORM finance_assert();
 IF _claims IS NULL OR jsonb_typeof(_claims)<>'array' OR jsonb_array_length(_claims) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Select between 1 and 100 claims'; END IF;
 -- Stable lock order, one transaction: stale selections roll back the whole confirmation.
 FOR item IN SELECT value FROM jsonb_array_elements(_claims) ORDER BY value->>'id' LOOP
  PERFORM expense_action((item->>'id')::uuid,(item->>'revision')::integer,'approve',NULL);
 END LOOP;
END $$;

-- One server-side calendar feeds both automatic calculation and editable day equivalents.
CREATE FUNCTION public.finance_calendar(_employee uuid,_month date,_overrides jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM finance_assert();
 IF _month IS NULL OR _month<date '2000-01-01' OR _month>date '2100-12-01' OR NOT EXISTS(SELECT 1 FROM attendance_employees WHERE id=_employee AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Choose a valid employee and month'; END IF;
 WITH dates AS (SELECT day::date d FROM generate_series(date_trunc('month',_month),date_trunc('month',_month)+interval '1 month -1 day',interval '1 day') day),
 classified AS (
 SELECT d.d date,r.entry_at,r.late_minutes,
  CASE WHEN p.effective_from IS NULL THEN NULL ELSE extract(dow FROM d.d)::integer=ANY(p.working_days) AND NOT d.d=ANY(p.holidays) END working_day,
  q.request_type,q.day_status request_status,q.reason,
  CASE WHEN d.d<e.employment_start THEN 'not_employed'
   WHEN p.effective_from IS NULL THEN 'not_configured'
   WHEN NOT extract(dow FROM d.d)::integer=ANY(p.working_days) OR d.d=ANY(p.holidays) THEN 'off_day'
   WHEN d.d>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'scheduled'
   WHEN r.id IS NOT NULL AND (r.late_minutes IS NULL OR (q.day_status='approved' AND q.request_type='leave')) THEN 'needs_review'
   WHEN r.id IS NOT NULL AND r.late_minutes>0 THEN 'late'
   WHEN r.id IS NOT NULL THEN 'present'
   WHEN q.day_status='approved' AND q.request_type='wfh' THEN 'work_from_home'
   WHEN q.day_status='approved' THEN 'on_leave'
   WHEN d.d=(now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'awaiting_scan'
   ELSE 'absent' END status
 FROM dates d JOIN attendance_employees e ON e.id=_employee
 LEFT JOIN LATERAL(SELECT * FROM attendance_settings WHERE effective_from<=d.d ORDER BY effective_from DESC LIMIT 1) p ON true
 LEFT JOIN attendance_daily_records r ON r.employee_id=e.id AND r.work_date=d.d
 LEFT JOIN LATERAL(
  SELECT coalesce(l.request_type,'leave') request_type,l.reason,coalesce(x.status,CASE WHEN l.status='partial' THEN 'pending' ELSE l.status END) day_status
  FROM attendance_leave_requests l LEFT JOIN attendance_leave_request_days x ON x.request_id=l.id AND x.leave_date=d.d
  WHERE l.employee_id=e.id AND d.d BETWEEN l.start_date AND l.end_date AND l.status IN ('pending','approved','partial','rejected')
  ORDER BY CASE coalesce(x.status,l.status) WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,l.created_at DESC LIMIT 1
 ) q ON true), units AS(
 SELECT *,CASE WHEN status IN ('present','work_from_home') THEN 1 WHEN status='late' THEN 0.5 WHEN status IN ('needs_review','not_configured','awaiting_scan') THEN NULL ELSE 0 END automatic_units FROM classified)
 SELECT jsonb_agg(to_jsonb(u)||jsonb_build_object('units',CASE WHEN working_day AND status NOT IN ('scheduled','not_employed') AND _overrides ? date::text THEN (_overrides->date::text->>'units')::numeric ELSE automatic_units END,'override_reason',_overrides->date::text->>'reason') ORDER BY date) INTO result FROM units u;
 RETURN result;
END $$;

CREATE FUNCTION public.salary_save(_employee uuid,_month date,_base numeric,_overrides jsonb,_revision integer,_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s salary_months; calendar jsonb; working integer; payable numeric; result uuid; item record; before_row jsonb;
BEGIN
 PERFORM finance_assert();
 _month:=date_trunc('month',_month)::date;
 PERFORM pg_advisory_xact_lock(hashtextextended(_employee::text||_month::text,7));
 SELECT * INTO s FROM salary_months WHERE employee_id=_employee AND month=_month FOR UPDATE;
 IF s.paid_at IS NOT NULL THEN RAISE EXCEPTION 'Paid salary is locked'; END IF;
 IF coalesce(s.revision,0) IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Salary changed. Refresh before saving'; END IF;
 IF _base IS NULL OR _base::text IN ('NaN','Infinity','-Infinity') OR _base<0 OR _base>9999999999 OR _overrides IS NULL OR jsonb_typeof(_overrides)<>'object' OR coalesce(length(btrim(_reason)),0)=0 THEN RAISE EXCEPTION 'Valid salary, overrides and change reason required'; END IF;
 calendar:=finance_calendar(_employee,_month,'{}');
 FOR item IN SELECT key,value FROM jsonb_each(_overrides) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(calendar) d WHERE d->>'date'=item.key AND (d->>'working_day')::boolean AND d->>'status' NOT IN ('scheduled','not_employed'))
   OR jsonb_typeof(item.value->'units')<>'number' OR item.value->>'units' IS NULL OR (item.value->>'units')::numeric NOT IN (0,0.5,1) OR coalesce(length(btrim(item.value->>'reason')),0)=0 THEN RAISE EXCEPTION 'Each override needs a working date, 0/0.5/1 units, and reason'; END IF;
 END LOOP;
 calendar:=finance_calendar(_employee,_month,_overrides);
 SELECT count(*) FILTER(WHERE (d->>'working_day')::boolean),coalesce(sum((d->>'units')::numeric),0) INTO working,payable FROM jsonb_array_elements(calendar) d;
 IF working=0 THEN RAISE EXCEPTION 'No configured working days in this month'; END IF;
 before_row:=CASE WHEN s.id IS NOT NULL THEN to_jsonb(s) END;
 INSERT INTO salary_months(employee_id,month,base_salary,overrides,days,working_days,payable_days,amount)
 VALUES(_employee,_month,_base,_overrides,calendar,working,payable,round(_base*payable/working,2))
 ON CONFLICT(employee_id,month) DO UPDATE SET base_salary=excluded.base_salary,overrides=excluded.overrides,days=excluded.days,working_days=excluded.working_days,payable_days=excluded.payable_days,amount=excluded.amount,revision=salary_months.revision+1,status='draft',hardik_at=NULL,tarun_at=NULL,rejection_reason=NULL,updated_at=now() RETURNING id INTO result;
 PERFORM finance_log('salary',result,'calculation_saved',before_row,(SELECT to_jsonb(x) FROM salary_months x WHERE id=result),_reason);
 RETURN result;
END $$;

CREATE FUNCTION public.salary_action(_id uuid,_revision integer,_action text,_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s salary_months; before_row jsonb;
BEGIN
 PERFORM finance_assert();
 SELECT * INTO s FROM salary_months WHERE id=_id FOR UPDATE;
 IF s.id IS NULL OR s.revision IS DISTINCT FROM _revision OR s.paid_at IS NOT NULL THEN RAISE EXCEPTION 'Salary changed or already paid. Refresh'; END IF;
 before_row:=to_jsonb(s);
 IF _action IN ('forward','approve') THEN
  IF s.month+interval '1 month'>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Wait until the salary month is complete'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(s.days) d WHERE d->>'units' IS NULL) THEN RAISE EXCEPTION 'Resolve all attendance days before approval'; END IF;
  IF s.days IS DISTINCT FROM finance_calendar(s.employee_id,s.month,s.overrides) THEN RAISE EXCEPTION 'Attendance changed. Recalculate and save salary first'; END IF;
 END IF;
 IF _action='forward' AND finance_role()='hardik' AND s.status IN ('draft','rejected') THEN
  UPDATE salary_months SET status='tarun_pending',hardik_at=now(),rejection_reason=NULL WHERE id=_id;
 ELSIF _action='approve' AND finance_role()='tarun' AND s.status='tarun_pending' THEN
  UPDATE salary_months SET status='approved',tarun_at=now(),rejection_reason=NULL WHERE id=_id;
 ELSIF _action='reject' AND finance_role()='tarun' AND s.status='tarun_pending' AND coalesce(length(btrim(_reason)),0)>0 THEN
  UPDATE salary_months SET status='rejected',tarun_at=now(),rejection_reason=btrim(_reason) WHERE id=_id;
 ELSIF _action='pay' AND s.status='approved' AND coalesce(length(btrim(_reason)),0)>0 THEN
  IF (now() AT TIME ZONE 'Asia/Kolkata')::date<s.month+interval '1 month 6 days' THEN RAISE EXCEPTION 'Salary payment opens on the following month''s 7th'; END IF;
  UPDATE salary_months SET paid_at=now(),paid_by=auth.uid(),payment_reference=btrim(_reason) WHERE id=_id;
 ELSE RAISE EXCEPTION 'Action is not allowed in this state, or reason/reference is missing'; END IF;
 UPDATE salary_months SET revision=revision+1,updated_at=now() WHERE id=_id;
 PERFORM finance_log('salary',_id,_action,before_row,(SELECT to_jsonb(x) FROM salary_months x WHERE id=_id),_reason);
END $$;

CREATE FUNCTION public.finance_board(_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE reviewer text:=finance_role();
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 IF _month IS NULL OR _month<date '2000-01-01' OR _month>date '2100-12-01' THEN RAISE EXCEPTION 'Choose a valid month'; END IF;
 _month:=date_trunc('month',_month)::date;
 RETURN jsonb_build_object('role',reviewer,'today',(now() AT TIME ZONE 'Asia/Kolkata')::date,
  'claims',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('owner_name',p.name,'owner_email',u.email) ORDER BY c.created_at DESC),'[]') FROM expense_claims c JOIN profiles p ON p.id=c.owner_id LEFT JOIN auth.users u ON u.id=c.owner_id WHERE c.settlement_month=_month AND (reviewer IS NOT NULL OR c.owner_id=auth.uid())),
  'files',(SELECT coalesce(jsonb_agg(to_jsonb(f)),'[]') FROM expense_files f JOIN expense_claims c ON c.id=f.claim_id WHERE c.settlement_month=_month AND (reviewer IS NOT NULL OR c.owner_id=auth.uid())),
  'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at DESC),'[]') FROM finance_events e WHERE EXISTS(SELECT 1 FROM expense_claims c WHERE c.id=e.entity_id AND c.settlement_month=_month AND (reviewer IS NOT NULL OR c.owner_id=auth.uid())) OR (reviewer IS NOT NULL AND EXISTS(SELECT 1 FROM salary_months s WHERE s.id=e.entity_id AND s.month=_month)) OR (reviewer IS NOT NULL AND EXISTS(SELECT 1 FROM field_finance_reviews f WHERE f.id=e.entity_id AND f.period_end=_month+14)) OR (reviewer IS NOT NULL AND (e.entity_type='field_rates' OR (e.entity_type='field_earning' AND EXISTS(SELECT 1 FROM field_earnings f WHERE f.id=e.entity_id AND public.field_ops_period_end(f.earning_date)=_month+14))))),
  'employees',CASE WHEN reviewer IS NULL THEN '[]'::jsonb ELSE (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.name),'[]') FROM attendance_employees e WHERE e.deleted_at IS NULL) END,
  'people',CASE WHEN reviewer IS NULL THEN '[]'::jsonb ELSE (
   SELECT coalesce(jsonb_agg(to_jsonb(person) ORDER BY person.name),'[]') FROM (
    SELECT p.id,p.name,u.email,public.has_role(p.id,'worker') AND NOT public.is_staff(p.id) AS field
    FROM profiles p LEFT JOIN auth.users u ON u.id=p.id
    WHERE (p.is_active OR EXISTS(SELECT 1 FROM expense_claims c WHERE c.owner_id=p.id) OR EXISTS(SELECT 1 FROM field_earnings e WHERE e.associate_id=p.id AND public.field_ops_period_end(e.earning_date)=_month+14))
     AND coalesce(lower(btrim(u.email)),'')<>'admin@limelightit.io'
    UNION ALL
    SELECT e.associate_id,max(e.associate_name),NULL::text,true FROM field_earnings e
    WHERE public.field_ops_period_end(e.earning_date)=_month+14 AND NOT EXISTS(SELECT 1 FROM profiles p WHERE p.id=e.associate_id)
    GROUP BY e.associate_id
   ) person
  ) END,
  'salaries',CASE WHEN reviewer IS NULL THEN '[]'::jsonb ELSE (SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM salary_months s WHERE s.month=_month) END);
END $$;

-- Field earnings remain in their original tables and 16th–15th cycle.
CREATE FUNCTION public.finance_field_snapshot(_associate uuid,_end date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM finance_assert();
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'date',e.earning_date,'phase',e.phase,'company',e.company_name,'amount',e.amount,'paid',EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id)) ORDER BY e.earning_date,e.id),'[]')
 FROM field_earnings e WHERE e.associate_id=_associate AND public.field_ops_period_end(e.earning_date)=_end AND e.phase IN ('assessment','commissioning')
  AND (EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id) OR (e.eligible AND (e.site_id IS NULL OR public.field_ops_phase_ready(e.site_id,e.phase)))));
END $$;

CREATE FUNCTION public.finance_field_board(_associate uuid,_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ending date:=date_trunc('month',_month)::date+14;
BEGIN
 PERFORM finance_assert();
 IF _month IS NULL OR _month<date '2000-01-01' OR _month>date '2100-12-01' THEN RAISE EXCEPTION 'Choose a valid month'; END IF;
 RETURN jsonb_build_object('earnings',finance_field_snapshot(_associate,ending),
  'review',(SELECT to_jsonb(r) FROM field_finance_reviews r WHERE r.associate_id=_associate AND r.period_end=ending),
  'rates',(SELECT to_jsonb(r) FROM field_work_rates r WHERE r.associate_id=_associate),
  'payments',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM field_payment_records p WHERE p.associate_id=_associate AND p.period_end=ending),
  'calendar',(SELECT jsonb_agg(jsonb_build_object('date',d::date,'online',EXISTS(SELECT 1 FROM field_attendance_events a WHERE a.associate_id=_associate AND a.work_date=d::date AND a.online),'last_online',(SELECT a.online FROM field_attendance_events a WHERE a.associate_id=_associate AND a.work_date=d::date ORDER BY a.occurred_at DESC LIMIT 1),'off_day',extract(dow FROM d)=0) ORDER BY d)
    FROM generate_series(date_trunc('month',_month),date_trunc('month',_month)+interval '1 month -1 day',interval '1 day') d),
  'leaves',(SELECT coalesce(jsonb_agg(jsonb_build_object('date',d::date,'status',coalesce(x.status,l.status),'reason',l.reason)),'[]') FROM attendance_leave_requests l CROSS JOIN LATERAL generate_series(greatest(l.start_date,date_trunc('month',_month)::date),least(l.end_date,(date_trunc('month',_month)+interval '1 month -1 day')::date),interval '1 day') d LEFT JOIN attendance_leave_request_days x ON x.request_id=l.id AND x.leave_date=d::date WHERE l.field_associate_id=_associate));
END $$;

CREATE FUNCTION public.finance_field_rates(_associate uuid,_assessment numeric,_commissioning numeric,_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE before_row jsonb;
BEGIN
 PERFORM finance_assert();
 IF NOT public.field_ops_associate(_associate) OR _assessment IS NULL OR _commissioning IS NULL OR _assessment::text IN ('NaN','Infinity','-Infinity') OR _commissioning::text IN ('NaN','Infinity','-Infinity') OR least(_assessment,_commissioning)<0 OR coalesce(length(btrim(_reason)),0)=0 THEN RAISE EXCEPTION 'Valid associate, rates and change reason required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text,19));
 SELECT to_jsonb(r) INTO before_row FROM field_work_rates r WHERE r.associate_id=_associate;
 INSERT INTO field_work_rates(associate_id,assessment,installation,commissioning,updated_by) VALUES(_associate,_assessment,0,_commissioning,auth.uid())
 ON CONFLICT(associate_id) DO UPDATE SET assessment=excluded.assessment,commissioning=excluded.commissioning,installation=0,updated_by=auth.uid(),updated_at=now();
 UPDATE field_earnings SET amount=CASE phase WHEN 'assessment' THEN _assessment ELSE _commissioning END WHERE associate_id=_associate AND phase IN ('assessment','commissioning') AND amount IS NULL AND NOT EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=field_earnings.id);
 PERFORM finance_log('field_rates',_associate,'rates_saved',before_row,(SELECT to_jsonb(r) FROM field_work_rates r WHERE r.associate_id=_associate),_reason);
END $$;

CREATE FUNCTION public.finance_field_earning(_id uuid,_amount numeric,_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE earning field_earnings; before_row jsonb;
BEGIN
 PERFORM finance_assert();
 SELECT * INTO earning FROM field_earnings WHERE id=_id;
 IF earning.id IS NULL THEN RAISE EXCEPTION 'Earning not found'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(earning.associate_id::text,19));
 PERFORM pg_advisory_xact_lock(hashtextextended(earning.associate_id::text||public.field_ops_period_end(earning.earning_date)::text,0));
 SELECT * INTO earning FROM field_earnings WHERE id=_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=_id) THEN RAISE EXCEPTION 'Paid work is locked'; END IF;
 IF _amount IS NULL OR _amount::text IN ('NaN','Infinity','-Infinity') OR _amount<0 OR _amount>9999999999 OR coalesce(length(btrim(_reason)),0)=0 THEN RAISE EXCEPTION 'Valid amount and adjustment reason required'; END IF;
 before_row:=to_jsonb(earning);
 UPDATE field_earnings SET amount=_amount WHERE id=_id;
 UPDATE field_finance_reviews SET status='rejected',reason='Earning adjusted; verify again',tarun_at=NULL,revision=revision+1 WHERE associate_id=earning.associate_id AND period_end=public.field_ops_period_end(earning.earning_date);
 PERFORM finance_log('field_earning',_id,'amount_adjusted',before_row,(SELECT to_jsonb(e) FROM field_earnings e WHERE id=_id),_reason);
END $$;

-- Preserve the existing ledger and prevent the previous Earnings screen from bypassing final approval.
CREATE OR REPLACE FUNCTION public.field_ops_record_payment(_associate uuid,_period_end date,_paid_on date,_reference text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r field_finance_reviews; total numeric; payment uuid;
BEGIN
 PERFORM finance_assert();
 IF _period_end IS NULL OR extract(day FROM _period_end)<>15 OR _period_end>=(now() AT TIME ZONE 'Asia/Kolkata')::date OR _paid_on IS NULL OR _paid_on>(now() AT TIME ZONE 'Asia/Kolkata')::date OR coalesce(length(btrim(_reference)),0)=0 THEN RAISE EXCEPTION 'Finished cycle, valid payment date and reference required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text,19));
 PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text||_period_end::text,0));
 PERFORM 1 FROM field_earnings WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end FOR UPDATE;
 SELECT * INTO r FROM field_finance_reviews WHERE associate_id=_associate AND period_end=_period_end FOR UPDATE;
 IF r.id IS NULL OR r.status<>'approved' OR r.snapshot IS DISTINCT FROM finance_field_snapshot(_associate,_period_end) THEN RAISE EXCEPTION 'Tarun approval of current incentives is required before payment'; END IF;
 SELECT sum(e.amount) INTO total FROM field_earnings e WHERE e.associate_id=_associate AND public.field_ops_period_end(e.earning_date)=_period_end AND e.phase IN ('assessment','commissioning') AND e.eligible AND (e.site_id IS NULL OR public.field_ops_phase_ready(e.site_id,e.phase)) AND NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id);
 IF coalesce(total,0)<=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.snapshot) e WHERE e->>'amount' IS NULL) THEN RAISE EXCEPTION 'No fully priced unpaid work'; END IF;
 INSERT INTO field_payment_records(associate_id,period_end,amount,paid_on,reference,recorded_by) VALUES(_associate,_period_end,total,_paid_on,btrim(_reference),auth.uid()) RETURNING id INTO payment;
 INSERT INTO field_payment_items(payment_id,earning_id,amount) SELECT payment,e.id,e.amount FROM field_earnings e WHERE e.associate_id=_associate AND public.field_ops_period_end(e.earning_date)=_period_end AND e.phase IN ('assessment','commissioning') AND e.eligible AND (e.site_id IS NULL OR public.field_ops_phase_ready(e.site_id,e.phase)) AND NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id);
 RETURN payment;
END $$;

CREATE FUNCTION public.finance_field_action(_associate uuid,_end date,_revision integer,_action text,_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r field_finance_reviews; snap jsonb; before_row jsonb; result uuid;
BEGIN
 PERFORM finance_assert();
 IF _end IS NULL OR extract(day FROM _end)<>15 OR _end>=(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Select a finished 16th–15th cycle'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text,19));
 PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text||_end::text,0));
 SELECT * INTO r FROM field_finance_reviews WHERE associate_id=_associate AND period_end=_end FOR UPDATE;
 IF coalesce(r.revision,0) IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Review changed. Refresh'; END IF;
 IF EXISTS(SELECT 1 FROM field_payment_records WHERE associate_id=_associate AND period_end=_end) THEN RAISE EXCEPTION 'This incentive cycle is already paid'; END IF;
 PERFORM 1 FROM field_earnings WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_end FOR UPDATE;
 snap:=finance_field_snapshot(_associate,_end); before_row:=CASE WHEN r.id IS NOT NULL THEN to_jsonb(r) END;
 IF _action='forward' AND finance_role()='hardik' THEN
  IF jsonb_array_length(snap)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(snap) e WHERE e->>'amount' IS NULL) THEN RAISE EXCEPTION 'Complete work and set all rates first'; END IF;
  INSERT INTO field_finance_reviews(associate_id,period_end,snapshot,status) VALUES(_associate,_end,snap,'tarun_pending')
   ON CONFLICT(associate_id,period_end) DO UPDATE SET snapshot=excluded.snapshot,status='tarun_pending',hardik_at=now(),tarun_at=NULL,reason=NULL,revision=field_finance_reviews.revision+1 RETURNING id INTO result;
 ELSIF _action IN ('approve','reject') AND finance_role()='tarun' AND r.status='tarun_pending' THEN
  IF r.snapshot IS DISTINCT FROM snap THEN RAISE EXCEPTION 'Earnings changed. Hardik must verify again'; END IF;
  IF _action='reject' AND coalesce(length(btrim(_reason)),0)=0 THEN RAISE EXCEPTION 'Rejection reason required'; END IF;
  result:=r.id;
  UPDATE field_finance_reviews SET status=CASE WHEN _action='approve' THEN 'approved' ELSE 'rejected' END,tarun_at=now(),reason=_reason,revision=revision+1 WHERE id=r.id;
 ELSIF _action='pay' AND r.status='approved' THEN
  IF r.snapshot IS DISTINCT FROM snap OR coalesce(length(btrim(_reason)),0)=0 THEN RAISE EXCEPTION 'Verified earnings and payment reference required'; END IF;
  -- Reuse the original payment ledger rather than introducing a second incentive payment.
  PERFORM public.field_ops_record_payment(_associate,_end,(now() AT TIME ZONE 'Asia/Kolkata')::date,_reason);
  result:=r.id;
  UPDATE field_finance_reviews SET revision=revision+1 WHERE id=r.id;
 ELSE RAISE EXCEPTION 'Action not allowed'; END IF;
 PERFORM finance_log('field_review',result,_action,before_row,(SELECT to_jsonb(x) FROM field_finance_reviews x WHERE id=result),_reason);
END $$;

-- All writes go through the checked RPCs. Helpers are never callable by clients.
REVOKE ALL ON FUNCTION public.finance_log(text,uuid,text,jsonb,jsonb,text), public.finance_assert() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_role(),public.expense_save(uuid,integer,date,text,text,numeric,text,uuid[]),public.expense_action(uuid,integer,text,text),public.expense_review_batch(jsonb),public.finance_calendar(uuid,date,jsonb),public.salary_save(uuid,date,numeric,jsonb,integer,text),public.salary_action(uuid,integer,text,text),public.finance_board(date),public.finance_field_snapshot(uuid,date),public.finance_field_board(uuid,date),public.finance_field_rates(uuid,numeric,numeric,text),public.finance_field_earning(uuid,numeric,text),public.finance_field_action(uuid,date,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finance_role(),public.expense_save(uuid,integer,date,text,text,numeric,text,uuid[]),public.expense_action(uuid,integer,text,text),public.expense_review_batch(jsonb),public.finance_calendar(uuid,date,jsonb),public.salary_save(uuid,date,numeric,jsonb,integer,text),public.salary_action(uuid,integer,text,text),public.finance_board(date),public.finance_field_snapshot(uuid,date),public.finance_field_board(uuid,date),public.finance_field_rates(uuid,numeric,numeric,text),public.finance_field_earning(uuid,numeric,text),public.finance_field_action(uuid,date,integer,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
