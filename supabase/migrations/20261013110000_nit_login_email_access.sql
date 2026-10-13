-- Preserve the test account's existing approval access after its Auth email changes.
BEGIN;
DO $$ DECLARE f record; definition text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'attendance_can_manage','attendance_can_review_leave','attendance_submit_my_leave',
      'attendance_submit_my_wfh','is_commissioning_approver'
    ) AND p.prosrc LIKE '%patidarnit21@gmail.com%'
  LOOP
    definition := replace(pg_get_functiondef(f.oid),quote_literal('patidarnit21@gmail.com'),quote_literal('nitsanghani1@gmail.com'));
    EXECUTE definition;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
