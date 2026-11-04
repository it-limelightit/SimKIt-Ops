-- Saving a field rate re-prices ALL unpaid work for the affected phases, except
-- work that is paid, in a month Tarun approved, or whose amount was changed by
-- hand with "Edit amount" (logged as finance_events 'amount_adjusted').
-- The previous rule ("only rows still at the old rate") missed rows priced
-- under an earlier rate (e.g. Farid: 2500 -> 0 -> 2000 left rows at 2500).
BEGIN;

CREATE OR REPLACE FUNCTION public.field_earning_hand_edited(_earning uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM finance_events v WHERE v.entity_type='field_earning' AND v.action='amount_adjusted' AND v.entity_id=_earning)
$$;
REVOKE ALL ON FUNCTION public.field_earning_hand_edited(uuid) FROM PUBLIC, anon, authenticated;

DO $$ DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.finance_field_rates_v2(uuid,numeric,numeric,numeric,boolean,text)'::regprocedure); o := d;
  IF position('field_earning_hand_edited(e.id)' IN d) > 0 THEN RETURN; END IF; -- already applied
  d := replace(d,
    'AND (e.amount IS NULL OR e.amount = CASE e.phase WHEN ''assessment'' THEN old.assessment WHEN ''installation'' THEN old.installation ELSE old.commissioning END)',
    'AND NOT public.field_earning_hand_edited(e.id)');
  IF d = o THEN RAISE EXCEPTION 'Unexpected finance_field_rates_v2 definition'; END IF;
  EXECUTE d;
END $$;

-- One-off sync: unpaid, unapproved, not hand-edited work that differs from the
-- person's current rate (today: Farid's 15 commissionings, 2500 -> 2000).
WITH synced AS (
  UPDATE field_earnings e
  SET amount = CASE e.phase WHEN 'assessment' THEN r.assessment WHEN 'installation' THEN r.installation ELSE r.commissioning END
  FROM field_work_rates r
  WHERE r.associate_id=e.associate_id
    AND (e.phase='commissioning' OR r.all_phases)
    AND NOT EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id)
    AND NOT public.field_earning_hand_edited(e.id)
    AND NOT EXISTS(SELECT 1 FROM field_finance_reviews f WHERE f.associate_id=e.associate_id
                   AND f.period_end=public.field_ops_period_end(e.earning_date) AND f.status='approved')
    AND e.amount IS DISTINCT FROM CASE e.phase WHEN 'assessment' THEN r.assessment WHEN 'installation' THEN r.installation ELSE r.commissioning END
  RETURNING e.associate_id, public.field_ops_period_end(e.earning_date) period_end)
UPDATE field_finance_reviews f SET status='rejected', reason='Rates changed — Hardik must verify again'
FROM (SELECT DISTINCT associate_id, period_end FROM synced) s
WHERE f.associate_id=s.associate_id AND f.period_end=s.period_end AND f.status='tarun_pending';

NOTIFY pgrst, 'reload schema';
COMMIT;
