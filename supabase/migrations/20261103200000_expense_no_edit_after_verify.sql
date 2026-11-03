-- Expenses can only be edited while waiting for Hardik or after rejection.
-- Once Hardik verifies a claim (and through Tarun's review, approval and
-- payment) it can no longer be edited. Delete rules are unchanged.
BEGIN;
DO $$ DECLARE definition text;
  old_fragment text := 'IF c.paid_at IS NOT NULL OR c.status=''cancelled'' THEN RAISE EXCEPTION ''Paid or deleted expenses cannot be edited''; END IF;';
BEGIN
  definition := pg_get_functiondef('public.expense_save(uuid,integer,date,text,text,numeric,text,uuid[])'::regprocedure);
  IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Unexpected expense_save definition'; END IF;
  EXECUTE replace(definition, old_fragment,
    'IF c.paid_at IS NOT NULL OR c.status NOT IN (''hardik_pending'',''rejected'') THEN RAISE EXCEPTION ''Verified, approved or paid expenses cannot be edited''; END IF;');
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
