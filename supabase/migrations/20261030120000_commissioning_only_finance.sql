BEGIN;

-- Only approved commissioning earns new incentives. Historical payment items remain untouched.
-- Paid commissioning stays visible if its site is later reopened.
CREATE OR REPLACE FUNCTION public.finance_field_snapshot(_associate uuid,_end date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM finance_assert();
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'date',e.earning_date,'phase',e.phase,'company',e.company_name,'amount',e.amount,'paid',EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id)) ORDER BY e.earning_date,e.id),'[]')
 FROM field_earnings e WHERE e.associate_id=_associate AND public.field_ops_period_end(e.earning_date)=_end AND e.phase='commissioning'
  AND (EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id) OR (e.eligible AND (e.site_id IS NOT NULL AND public.field_ops_phase_ready(e.site_id,'commissioning')))));
END $$;

CREATE OR REPLACE FUNCTION public.finance_field_rates(_associate uuid,_assessment numeric,_commissioning numeric,_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE before_row jsonb;
BEGIN
 PERFORM finance_assert();
 -- Retain the RPC signature for older clients. Assessment earns no incentive.
 _assessment:=0;
 IF NOT public.field_ops_associate(_associate) OR _assessment IS NULL OR _commissioning IS NULL OR _assessment::text IN ('NaN','Infinity','-Infinity') OR _commissioning::text IN ('NaN','Infinity','-Infinity') OR least(_assessment,_commissioning)<0 OR coalesce(length(btrim(_reason)),0)=0 THEN RAISE EXCEPTION 'Valid associate, rates and change reason required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text,19));
 SELECT to_jsonb(r) INTO before_row FROM field_work_rates r WHERE r.associate_id=_associate;
 INSERT INTO field_work_rates(associate_id,assessment,installation,commissioning,updated_by) VALUES(_associate,_assessment,0,_commissioning,auth.uid())
 ON CONFLICT(associate_id) DO UPDATE SET assessment=excluded.assessment,commissioning=excluded.commissioning,installation=0,updated_by=auth.uid(),updated_at=now();
 UPDATE field_earnings SET amount=_commissioning WHERE associate_id=_associate AND phase='commissioning' AND amount IS NULL AND NOT EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=field_earnings.id);
 PERFORM finance_log('field_rates',_associate,'rates_saved',before_row,(SELECT to_jsonb(r) FROM field_work_rates r WHERE r.associate_id=_associate),_reason);
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
 SELECT sum(e.amount) INTO total FROM field_earnings e WHERE e.associate_id=_associate AND public.field_ops_period_end(e.earning_date)=_period_end AND e.phase='commissioning' AND e.eligible AND (e.site_id IS NOT NULL AND public.field_ops_phase_ready(e.site_id,'commissioning')) AND NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id);
 IF coalesce(total,0)<=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.snapshot) e WHERE e->>'amount' IS NULL) THEN RAISE EXCEPTION 'No fully priced unpaid work'; END IF;
 INSERT INTO field_payment_records(associate_id,period_end,amount,paid_on,reference,recorded_by) VALUES(_associate,_period_end,total,_paid_on,btrim(_reference),auth.uid()) RETURNING id INTO payment;
 INSERT INTO field_payment_items(payment_id,earning_id,amount) SELECT payment,e.id,e.amount FROM field_earnings e WHERE e.associate_id=_associate AND public.field_ops_period_end(e.earning_date)=_period_end AND e.phase='commissioning' AND e.eligible AND (e.site_id IS NOT NULL AND public.field_ops_phase_ready(e.site_id,'commissioning')) AND NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id);
 RETURN payment;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
