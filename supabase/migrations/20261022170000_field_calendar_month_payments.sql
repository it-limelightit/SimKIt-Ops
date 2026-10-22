BEGIN;

-- New settlements use calendar months. Existing payments, payment items and reviews are preserved.
-- The legacy day-15 key is accepted only for stored history; write RPCs require a month-end key.
ALTER TABLE public.field_payment_records DROP CONSTRAINT IF EXISTS field_payment_records_period_end_check;
ALTER TABLE public.field_payment_records ADD CONSTRAINT field_payment_records_period_end_check
  CHECK (extract(day FROM period_end)=15 OR period_end=(date_trunc('month',period_end)+interval '1 month -1 day')::date);

CREATE OR REPLACE FUNCTION public.field_ops_period_end(_date date) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT (date_trunc('month',_date)+interval '1 month -1 day')::date
$$;

CREATE OR REPLACE FUNCTION public.field_ops_payment_due(_period_end date) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT (date_trunc('month',_period_end)+interval '1 month 6 days')::date
$$;
REVOKE ALL ON FUNCTION public.field_ops_payment_due(date) FROM PUBLIC,anon,authenticated;


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
  'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at DESC),'[]') FROM finance_events e WHERE EXISTS(SELECT 1 FROM expense_claims c WHERE c.id=e.entity_id AND c.settlement_month=_month AND public.finance_expense_visible(c.owner_id,c.sent_to_tarun_at)) OR (reviewer IS NOT NULL AND EXISTS(SELECT 1 FROM salary_months s WHERE s.id=e.entity_id AND s.month=_month)) OR (reviewer IS NOT NULL AND EXISTS(SELECT 1 FROM field_finance_reviews f WHERE f.id=e.entity_id AND f.period_end BETWEEN _month AND public.field_ops_period_end(_month))) OR (reviewer IS NOT NULL AND (e.entity_type='field_rates' OR (e.entity_type='field_earning' AND EXISTS(SELECT 1 FROM field_earnings f WHERE f.id=e.entity_id AND public.field_ops_period_end(f.earning_date)=public.field_ops_period_end(_month)))))),
  'employees',CASE WHEN reviewer IS NULL THEN '[]'::jsonb ELSE (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.name),'[]') FROM attendance_employees e WHERE e.deleted_at IS NULL) END,
  'people',CASE WHEN reviewer IS NULL THEN '[]'::jsonb ELSE (
   SELECT coalesce(jsonb_agg(to_jsonb(person) ORDER BY person.name),'[]') FROM (
    SELECT p.id,p.name,u.email,public.has_role(p.id,'worker') AND NOT public.is_staff(p.id) AS field
    FROM profiles p LEFT JOIN auth.users u ON u.id=p.id
    WHERE (p.is_active OR EXISTS(SELECT 1 FROM expense_claims c WHERE c.owner_id=p.id) OR EXISTS(SELECT 1 FROM field_earnings e WHERE e.associate_id=p.id AND public.field_ops_period_end(e.earning_date)=public.field_ops_period_end(_month)))
     AND coalesce(lower(btrim(u.email)),'')<>'admin@limelightit.io'
    UNION ALL
    SELECT e.associate_id,max(e.associate_name),NULL::text,true FROM field_earnings e
    WHERE public.field_ops_period_end(e.earning_date)=public.field_ops_period_end(_month) AND NOT EXISTS(SELECT 1 FROM profiles p WHERE p.id=e.associate_id)
    GROUP BY e.associate_id
   ) person
  ) END,
  'salaries',CASE WHEN reviewer IS NULL THEN '[]'::jsonb ELSE (SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM salary_months s WHERE s.month=_month) END);
END $$;

CREATE OR REPLACE FUNCTION public.finance_field_board(_associate uuid,_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ending date:=public.field_ops_period_end(_month);
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

CREATE OR REPLACE FUNCTION public.field_ops_record_payment(_associate uuid,_period_end date,_paid_on date,_reference text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r field_finance_reviews; total numeric; payment uuid;
BEGIN
 PERFORM finance_assert();
 IF _period_end IS NULL OR _period_end IS DISTINCT FROM public.field_ops_period_end(_period_end) OR _period_end>=(now() AT TIME ZONE 'Asia/Kolkata')::date OR _paid_on IS NULL OR _paid_on>(now() AT TIME ZONE 'Asia/Kolkata')::date OR coalesce(length(btrim(_reference)),0)=0 THEN RAISE EXCEPTION 'Finished calendar month, valid payment date and reference required'; END IF;
 IF (now() AT TIME ZONE 'Asia/Kolkata')::date<public.field_ops_payment_due(_period_end) OR _paid_on<public.field_ops_payment_due(_period_end) THEN RAISE EXCEPTION 'Field incentive payment clearance opens on the following month''s 7th'; END IF;
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

CREATE OR REPLACE FUNCTION public.finance_field_action(_associate uuid,_end date,_revision integer,_action text,_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r field_finance_reviews; snap jsonb; before_row jsonb; result uuid;
BEGIN
 PERFORM finance_assert();
 IF _end IS NULL OR _end IS DISTINCT FROM public.field_ops_period_end(_end) OR _end>=(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Select a finished calendar month'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text,19));
 PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text||_end::text,0));
 SELECT * INTO r FROM field_finance_reviews WHERE associate_id=_associate AND period_end=_end FOR UPDATE;
 IF coalesce(r.revision,0) IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'Review changed. Refresh'; END IF;
 IF EXISTS(SELECT 1 FROM field_payment_records WHERE associate_id=_associate AND period_end=_end) THEN RAISE EXCEPTION 'This incentive month is already paid'; END IF;
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

NOTIFY pgrst,'reload schema';
COMMIT;
