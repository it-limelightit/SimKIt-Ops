-- One-time backfill for the expense grace period (companion to
-- 20261102130000_expense_month_grace_period.sql).
-- Claims submitted on the 1st-3rd of a month before the grace rule existed were
-- stored in the CURRENT month. Move those into the PREVIOUS month so existing
-- entries match the new rule. Idempotent: after running, settlement_month no
-- longer equals date_trunc('month', created_at), so re-running changes nothing.
BEGIN;
UPDATE public.expense_claims c
SET settlement_month = (date_trunc('month', (c.created_at AT TIME ZONE 'Asia/Kolkata')) - interval '1 month')::date
WHERE extract(day FROM (c.created_at AT TIME ZONE 'Asia/Kolkata')) <= 3
  AND c.settlement_month = date_trunc('month', (c.created_at AT TIME ZONE 'Asia/Kolkata'))::date;
COMMIT;
