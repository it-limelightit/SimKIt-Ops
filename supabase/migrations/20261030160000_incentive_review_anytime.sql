BEGIN;

-- Review current-month commissioning as it is completed. Payment still uses
-- the existing approved snapshot and the following month's 7th-day clearance.
CREATE OR REPLACE FUNCTION public.finance_field_action(_associate uuid,_end date,_revision integer,_action text,_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r field_finance_reviews; snap jsonb; before_row jsonb; result uuid;
BEGIN
 PERFORM finance_assert();
 IF _end IS NULL OR _end IS DISTINCT FROM public.field_ops_period_end(_end)
    OR _end > public.field_ops_period_end((now() AT TIME ZONE 'Asia/Kolkata')::date)
 THEN RAISE EXCEPTION 'Select a current or past calendar month'; END IF;
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
  PERFORM public.field_ops_record_payment(_associate,_end,(now() AT TIME ZONE 'Asia/Kolkata')::date,_reason);
  result:=r.id;
  UPDATE field_finance_reviews SET revision=revision+1 WHERE id=r.id;
 ELSE RAISE EXCEPTION 'Action not allowed'; END IF;
 PERFORM finance_log('field_review',result,_action,before_row,(SELECT to_jsonb(x) FROM field_finance_reviews x WHERE id=result),_reason);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
