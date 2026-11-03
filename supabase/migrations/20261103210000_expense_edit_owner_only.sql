-- Only the person who submitted an expense can edit it. Hardik and Tarun keep
-- verify / approve / reject / delete, but can no longer edit someone's expense.
BEGIN;
DO $$ DECLARE definition text;
  old_fragment text := 'IF c.id IS NULL OR (c.owner_id<>auth.uid() AND reviewer IS NULL) THEN RAISE EXCEPTION ''Claim not found'' USING ERRCODE=''42501''; END IF;';
BEGIN
  definition := pg_get_functiondef('public.expense_save(uuid,integer,date,text,text,numeric,text,uuid[])'::regprocedure);
  IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Unexpected expense_save definition'; END IF;
  EXECUTE replace(definition, old_fragment,
    'IF c.id IS NULL OR c.owner_id<>auth.uid() THEN RAISE EXCEPTION ''Only the person who submitted this expense can edit it'' USING ERRCODE=''42501''; END IF;');
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
