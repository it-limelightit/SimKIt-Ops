-- Expense settlement-month grace period.
-- Previously a new claim's settlement_month was always date_trunc('month', today),
-- so an expense added on e.g. 2 November landed in November even though it was
-- really for October's cycle. Business rule: the first 3 days of a month are a
-- grace window for closing the previous month, so claims submitted on the 1st,
-- 2nd or 3rd settle into the PREVIOUS month. From the 4th onward they settle in
-- the current month as before. Only the INSERT's settlement_month changes; all
-- validation, editing and deadline logic is unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION public.expense_save(_id uuid,_revision integer,_date date,_title text,_category text,_amount numeric,_description text,_files uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c expense_claims; before_row jsonb; result uuid; today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date; _settlement date;
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
  -- Grace period: claims submitted on the 1st-3rd settle into the previous month.
  _settlement:=CASE WHEN extract(day FROM today)<=3
    THEN (date_trunc('month',today)-interval '1 month')::date
    ELSE date_trunc('month',today)::date END;
  INSERT INTO expense_claims(owner_id,expense_date,settlement_month,title,category,amount,description,attachment_ids)
  VALUES(auth.uid(),_date,_settlement,btrim(_title),_category,_amount,coalesce(_description,''),_files) RETURNING id INTO result;
 ELSE
  result:=_id;
  UPDATE expense_claims SET expense_date=_date,title=btrim(_title),category=_category,amount=_amount,description=coalesce(_description,''),attachment_ids=_files,
   revision=revision+1,sent_to_tarun_at=NULL,status='hardik_pending',hardik_decision=NULL,hardik_at=NULL,hardik_reason=NULL,tarun_decision=NULL,tarun_at=NULL,tarun_reason=NULL,updated_at=now() WHERE id=result;
 END IF;
 UPDATE expense_files SET claim_id=result WHERE id=ANY(_files);
 PERFORM finance_log('expense',result,CASE WHEN _id IS NULL THEN 'submitted' ELSE 'reapplied' END,before_row,(SELECT to_jsonb(x) FROM expense_claims x WHERE id=result));
 RETURN result;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
