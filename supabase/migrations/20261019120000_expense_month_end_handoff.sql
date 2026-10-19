BEGIN;
ALTER TABLE public.expense_claims ADD COLUMN sent_to_tarun_at timestamptz;
ALTER TABLE public.expense_claims DROP CONSTRAINT expense_claims_status_check;
ALTER TABLE public.expense_claims ADD CONSTRAINT expense_claims_status_check CHECK(status IN ('hardik_pending','hardik_verified','tarun_pending','approved','rejected','cancelled'));
-- Preserve claims already forwarded under the previous approval flow.
UPDATE public.expense_claims SET sent_to_tarun_at=coalesce(hardik_at,updated_at) WHERE status IN ('tarun_pending','approved') OR tarun_decision IS NOT NULL;
CREATE FUNCTION public.finance_expense_visible(_owner uuid,_sent timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT _owner=auth.uid() OR public.finance_role()='hardik' OR (public.finance_role()='tarun' AND _sent IS NOT NULL)
$$;
DROP POLICY expense_read ON public.expense_claims;
CREATE POLICY expense_read ON public.expense_claims FOR SELECT TO authenticated USING(public.finance_expense_visible(owner_id,sent_to_tarun_at));
DROP POLICY expense_file_read ON public.expense_files;
CREATE POLICY expense_file_read ON public.expense_files FOR SELECT TO authenticated USING(owner_id=auth.uid() OR public.finance_role()='hardik' OR EXISTS(SELECT 1 FROM public.expense_claims c WHERE c.id=claim_id AND public.finance_expense_visible(c.owner_id,c.sent_to_tarun_at)));
DROP POLICY finance_event_read ON public.finance_events;
CREATE POLICY finance_event_read ON public.finance_events FOR SELECT TO authenticated USING((entity_type<>'expense' AND public.finance_role() IS NOT NULL) OR EXISTS(SELECT 1 FROM public.expense_claims c WHERE c.id=entity_id AND public.finance_expense_visible(c.owner_id,c.sent_to_tarun_at)));

CREATE OR REPLACE FUNCTION public.expense_action(_id uuid,_revision integer,_action text,_reason text DEFAULT NULL) RETURNS void
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
 ELSIF _action='forward' THEN
  IF reviewer IS DISTINCT FROM 'hardik' OR c.status<>'hardik_verified' OR c.paid_at IS NOT NULL THEN RAISE EXCEPTION 'Only verified expenses can be sent to Tarun' USING ERRCODE='42501'; END IF;
  UPDATE expense_claims SET status='tarun_pending',sent_to_tarun_at=now() WHERE id=_id;
 ELSIF _action IN ('approve','reject') THEN
  IF reviewer IS NULL OR c.owner_id=auth.uid() OR (reviewer='hardik' AND NOT (c.status='hardik_pending' OR (_action='reject' AND c.status='hardik_verified'))) OR (reviewer='tarun' AND (c.status<>'tarun_pending' OR c.sent_to_tarun_at IS NULL)) THEN RAISE EXCEPTION 'Claim is not awaiting your review' USING ERRCODE='42501'; END IF;
  IF _action='reject' AND coalesce(length(btrim(_reason)),0)=0 THEN RAISE EXCEPTION 'Rejection reason required'; END IF;
  IF reviewer='hardik' THEN
   UPDATE expense_claims SET hardik_decision=_action,hardik_at=now(),hardik_reason=CASE WHEN _action='reject' THEN btrim(_reason) END,status=CASE WHEN _action='approve' THEN 'hardik_verified' ELSE 'rejected' END WHERE id=_id;
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
CREATE OR REPLACE FUNCTION public.expense_save(_id uuid,_revision integer,_date date,_title text,_category text,_amount numeric,_description text,_files uuid[]) RETURNS uuid
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
   revision=revision+1,sent_to_tarun_at=NULL,status='hardik_pending',hardik_decision=NULL,hardik_at=NULL,hardik_reason=NULL,tarun_decision=NULL,tarun_at=NULL,tarun_reason=NULL,updated_at=now() WHERE id=result;
 END IF;
 UPDATE expense_files SET claim_id=result WHERE id=ANY(_files);
 PERFORM finance_log('expense',result,CASE WHEN _id IS NULL THEN 'submitted' ELSE 'reapplied' END,before_row,(SELECT to_jsonb(x) FROM expense_claims x WHERE id=result));
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.finance_board(_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE reviewer text:=finance_role();
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 IF _month IS NULL OR _month<date '2000-01-01' OR _month>date '2100-12-01' THEN RAISE EXCEPTION 'Choose a valid month'; END IF;
 _month:=date_trunc('month',_month)::date;
 RETURN jsonb_build_object('role',reviewer,'today',(now() AT TIME ZONE 'Asia/Kolkata')::date,
  'claims',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('owner_name',p.name,'owner_email',u.email) ORDER BY c.created_at DESC),'[]') FROM expense_claims c JOIN profiles p ON p.id=c.owner_id LEFT JOIN auth.users u ON u.id=c.owner_id WHERE c.settlement_month=_month AND public.finance_expense_visible(c.owner_id,c.sent_to_tarun_at)),
  'files',(SELECT coalesce(jsonb_agg(to_jsonb(f)),'[]') FROM expense_files f JOIN expense_claims c ON c.id=f.claim_id WHERE c.settlement_month=_month AND public.finance_expense_visible(c.owner_id,c.sent_to_tarun_at)),
  'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at DESC),'[]') FROM finance_events e WHERE EXISTS(SELECT 1 FROM expense_claims c WHERE c.id=e.entity_id AND c.settlement_month=_month AND public.finance_expense_visible(c.owner_id,c.sent_to_tarun_at)) OR (reviewer IS NOT NULL AND EXISTS(SELECT 1 FROM salary_months s WHERE s.id=e.entity_id AND s.month=_month)) OR (reviewer IS NOT NULL AND EXISTS(SELECT 1 FROM field_finance_reviews f WHERE f.id=e.entity_id AND f.period_end=_month+14)) OR (reviewer IS NOT NULL AND (e.entity_type='field_rates' OR (e.entity_type='field_earning' AND EXISTS(SELECT 1 FROM field_earnings f WHERE f.id=e.entity_id AND public.field_ops_period_end(f.earning_date)=_month+14))))),
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

CREATE FUNCTION public.expense_batch_action(_claims jsonb,_action text,_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb;
BEGIN
 PERFORM finance_assert();
 IF _action IS NULL OR _action NOT IN ('approve','reject','forward') THEN RAISE EXCEPTION 'Unknown batch action'; END IF;
 IF _claims IS NULL OR jsonb_typeof(_claims)<>'array' OR jsonb_array_length(_claims) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Select between 1 and 1000 claims'; END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(_claims))<>jsonb_array_length(_claims) THEN RAISE EXCEPTION 'Select each expense once'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(_claims) ORDER BY value->>'id' LOOP
  PERFORM expense_action((item->>'id')::uuid,(item->>'revision')::integer,_action,_reason);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.expense_review_batch(_claims jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM expense_batch_action(_claims,'approve',NULL);
END $$;
REVOKE ALL ON FUNCTION public.finance_expense_visible(uuid,timestamptz),public.expense_batch_action(jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finance_expense_visible(uuid,timestamptz),public.expense_batch_action(jsonb,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
