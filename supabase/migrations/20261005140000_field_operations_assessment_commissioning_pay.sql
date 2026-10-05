BEGIN;
-- Installation stays in the work ledger for activity tracking and earns no payment.
-- Keep already recorded payments/items untouched; remove unpaid installation entitlement.
UPDATE public.field_work_rates SET installation=0 WHERE installation<>0;
UPDATE public.field_earnings e SET amount=0 WHERE phase='installation'
  AND NOT EXISTS(SELECT 1 FROM public.field_payment_items WHERE earning_id=e.id);
ALTER TABLE public.field_work_rates ADD CONSTRAINT field_installation_rate_zero CHECK(installation=0);

CREATE OR REPLACE FUNCTION public.field_ops_capture_earning() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE worker UUID; stamp TIMESTAMPTZ; rate NUMERIC; ready BOOLEAN; previous public.field_earnings;
BEGIN
  ready := public.field_ops_phase_ready(NEW.site_id, TG_TABLE_NAME);
  SELECT * INTO previous FROM field_earnings WHERE site_id = NEW.site_id AND phase = TG_TABLE_NAME FOR UPDATE;
  IF previous.id IS NOT NULL THEN
    -- Paid entries are immutable; live eligibility is still checked before reporting/payment.
    IF NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id = previous.id) THEN
      UPDATE field_earnings SET eligible = ready WHERE id = previous.id;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ready THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM field_existing_completions WHERE site_id=NEW.site_id AND phase=TG_TABLE_NAME) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.data IS NOT DISTINCT FROM OLD.data THEN RETURN NEW; END IF;
  worker := NEW.worker_id;
  IF TG_TABLE_NAME = 'commissioning' THEN
    SELECT requested_by, reviewed_at INTO worker, stamp FROM commissioning_approval_requests WHERE site_id = NEW.site_id AND status = 'approved';
  END IF;
  -- Manager edits must not replace the associate's entitlement with the editing manager.
  IF TG_TABLE_NAME <> 'commissioning' AND NOT public.field_ops_associate(worker) THEN
    IF TG_OP = 'UPDATE' AND public.field_ops_associate(OLD.worker_id) THEN worker := OLD.worker_id;
    ELSE SELECT assigned_worker_id INTO worker FROM sites WHERE id = NEW.site_id;
    END IF;
  END IF;
  IF NOT public.field_ops_associate(worker) THEN RETURN NEW; END IF;
  stamp := coalesce(stamp, now());
  IF TG_TABLE_NAME='installation' THEN rate := 0;
  ELSE
    SELECT CASE TG_TABLE_NAME WHEN 'assessment' THEN assessment ELSE commissioning END
      INTO rate FROM field_work_rates WHERE associate_id=worker;
  END IF;
  INSERT INTO field_earnings(site_id,company_name,associate_id,associate_name,associate_joined,phase,completed_at,earning_date,amount)
    SELECT NEW.site_id,coalesce(s.company_name,s.name),worker,coalesce(p.name,p.email,'Field associate'),p.created_at,TG_TABLE_NAME,stamp,(stamp AT TIME ZONE 'Asia/Kolkata')::date,rate
    FROM sites s JOIN profiles p ON p.id=worker WHERE s.id=NEW.site_id
    ON CONFLICT(site_id,phase) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.field_ops_set_rates(_associate UUID, _assessment NUMERIC, _installation NUMERIC, _commissioning NUMERIC) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) OR NOT public.field_ops_associate(_associate) THEN RAISE EXCEPTION 'Manager access required'; END IF;
  IF _assessment IS NULL OR _commissioning IS NULL OR least(_assessment,_commissioning) < 0 THEN RAISE EXCEPTION 'Enter non-negative rates'; END IF;
  INSERT INTO field_work_rates(associate_id,assessment,installation,commissioning,updated_by)
    VALUES(_associate,_assessment,0,_commissioning,auth.uid())
    ON CONFLICT(associate_id) DO UPDATE SET assessment=EXCLUDED.assessment, installation=EXCLUDED.installation, commissioning=EXCLUDED.commissioning, updated_by=auth.uid(), updated_at=now();
  -- Resolve unpriced work once; never reprice existing amounts.
  UPDATE field_earnings SET amount = CASE phase WHEN 'assessment' THEN _assessment WHEN 'installation' THEN 0 ELSE _commissioning END
    WHERE associate_id = _associate AND amount IS NULL;
END $$;

CREATE OR REPLACE FUNCTION public.field_ops_record_payment(_associate UUID, _period_end DATE, _paid_on DATE, _reference TEXT DEFAULT NULL) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE total NUMERIC; payment UUID;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Manager access required'; END IF;
  IF _period_end IS NULL OR extract(day FROM _period_end) <> 15 OR _period_end >= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Select a finished 16th–15th payment period'; END IF;
  IF _paid_on IS NULL OR _paid_on > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Enter a valid payment date'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text || _period_end::text,0));
  PERFORM 1 FROM field_earnings WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end FOR UPDATE;
  IF EXISTS(SELECT 1 FROM field_earnings WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end AND phase IN ('assessment','commissioning') AND eligible AND amount IS NULL) THEN RAISE EXCEPTION 'Set rates before clearing payment'; END IF;
  SELECT sum(amount) INTO total FROM field_earnings e WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end AND phase IN ('assessment','commissioning') AND eligible
    AND (site_id IS NULL OR public.field_ops_phase_ready(site_id,phase)) AND NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id);
  IF coalesce(total,0) <= 0 THEN RAISE EXCEPTION 'No payable completed work in this period'; END IF;
  INSERT INTO field_payment_records(associate_id,period_end,amount,paid_on,reference,recorded_by) VALUES(_associate,_period_end,total,_paid_on,nullif(trim(_reference),''),auth.uid()) RETURNING id INTO payment;
  INSERT INTO field_payment_items(payment_id,earning_id,amount) SELECT payment,e.id,e.amount FROM field_earnings e WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end AND phase IN ('assessment','commissioning') AND eligible AND (site_id IS NULL OR public.field_ops_phase_ready(site_id,phase)) AND NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id);
  RETURN payment;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
