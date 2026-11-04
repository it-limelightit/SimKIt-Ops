-- Saving a new field rate re-prices unpaid work that is still at the OLD rate
-- (or unpriced). Work that is paid, in an approved month, or whose amount was
-- changed by hand ("Edit amount", i.e. differs from the old rate) is untouched.
-- If a month was waiting for Tarun and its amounts change, it goes back to
-- Hardik to verify again.
BEGIN;

CREATE OR REPLACE FUNCTION public.finance_field_rates_v2(_associate uuid, _assessment numeric, _installation numeric,
  _commissioning numeric, _all_phases boolean, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE before_row jsonb; old field_work_rates; was_on boolean; bad boolean; changed_periods date[];
BEGIN
  PERFORM finance_assert();
  IF _associate IS NULL OR coalesce(length(btrim(_reason)),0)=0 THEN RAISE EXCEPTION 'Associate and change reason required'; END IF;
  IF NOT coalesce(_all_phases,false) AND NOT public.field_ops_associate(_associate) THEN
    RAISE EXCEPTION 'This person is not a field associate. Turn on "all phases" to pay their field work.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=_associate AND is_active) THEN RAISE EXCEPTION 'Active account required'; END IF;
  IF NOT coalesce(_all_phases,false) THEN _assessment:=0; _installation:=0; END IF;
  SELECT bool_or(v IS NOT NULL AND (v::text IN ('NaN','Infinity','-Infinity') OR v<0)) INTO bad
    FROM unnest(ARRAY[_assessment,_installation,_commissioning]) v;
  IF bad THEN RAISE EXCEPTION 'Rates must be zero or more'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text,19));
  SELECT * INTO old FROM field_work_rates r WHERE r.associate_id=_associate;
  before_row := CASE WHEN old.associate_id IS NOT NULL THEN to_jsonb(old) END;
  was_on := coalesce(old.all_phases,false);
  INSERT INTO field_work_rates(associate_id,assessment,installation,commissioning,all_phases,updated_by)
    VALUES(_associate,_assessment,_installation,_commissioning,coalesce(_all_phases,false),auth.uid())
  ON CONFLICT(associate_id) DO UPDATE SET assessment=excluded.assessment,installation=excluded.installation,
    commissioning=excluded.commissioning,all_phases=excluded.all_phases,updated_by=auth.uid(),updated_at=now();

  -- Re-price unpaid work still at the old rate (or unpriced), outside approved months.
  WITH repriced AS (
    UPDATE field_earnings e SET amount = CASE e.phase WHEN 'assessment' THEN _assessment WHEN 'installation' THEN _installation ELSE _commissioning END
    WHERE e.associate_id=_associate
      AND (e.phase='commissioning' OR coalesce(_all_phases,false))
      AND NOT EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id)
      AND NOT EXISTS(SELECT 1 FROM field_finance_reviews r WHERE r.associate_id=_associate
                     AND r.period_end=public.field_ops_period_end(e.earning_date) AND r.status='approved')
      AND (e.amount IS NULL OR e.amount = CASE e.phase WHEN 'assessment' THEN old.assessment WHEN 'installation' THEN old.installation ELSE old.commissioning END)
      AND e.amount IS DISTINCT FROM CASE e.phase WHEN 'assessment' THEN _assessment WHEN 'installation' THEN _installation ELSE _commissioning END
    RETURNING public.field_ops_period_end(e.earning_date) period_end)
  SELECT array_agg(DISTINCT period_end) INTO changed_periods FROM repriced;

  -- A month waiting for Tarun whose amounts changed goes back to Hardik.
  UPDATE field_finance_reviews SET status='rejected', reason='Rates changed — Hardik must verify again'
  WHERE associate_id=_associate AND status='tarun_pending' AND period_end = ANY(coalesce(changed_periods,'{}'));

  IF coalesce(_all_phases,false) AND NOT was_on THEN
    PERFORM field_backfill_all_phases(_associate, greatest(date '2026-11-01', date_trunc('month',(now() AT TIME ZONE 'Asia/Kolkata')::date)::date));
  END IF;
  PERFORM finance_log('field_rates',_associate,'rates_saved',before_row,(SELECT to_jsonb(r) FROM field_work_rates r WHERE r.associate_id=_associate),_reason);
END $$;

-- One-off: Hitesh bhai's October commissionings were priced at the first rate
-- (500) before it was corrected to the saved rate; bring unpaid, unreviewed
-- rows to his current rates.
UPDATE field_earnings e
SET amount = CASE e.phase WHEN 'assessment' THEN r.assessment WHEN 'installation' THEN r.installation ELSE r.commissioning END
FROM field_work_rates r JOIN auth.users u ON u.id=r.associate_id
WHERE lower(u.email)='associatelimelight@gmail.com' AND e.associate_id=r.associate_id
  AND NOT EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM field_finance_reviews f WHERE f.associate_id=e.associate_id
                 AND f.period_end=public.field_ops_period_end(e.earning_date) AND f.status IN ('approved','tarun_pending'));

NOTIFY pgrst, 'reload schema';
COMMIT;
