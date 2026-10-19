BEGIN;
-- Keep account roles and Aryan's existing access; Hardik now has only finance.
CREATE OR REPLACE FUNCTION public.limited_manager_modules(_user_id uuid DEFAULT auth.uid())
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE lower(btrim(email))
  WHEN 'admin@limelightit.io' THEN ARRAY['salary-expense']
  WHEN 'aryankadiya2005@gmail.com' THEN ARRAY['leave','logistic','inventory']
  ELSE NULL::text[] END
 FROM auth.users WHERE id=_user_id
$$;

-- Finance RPCs deliberately read source attendance/earnings as SECURITY DEFINER.
-- Direct requests to Hardik's former modules no longer inherit his supervisor role.
DO $$ DECLARE t record; predicate text;
BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND tablename NOT IN ('expense_claims','expense_files','salary_months','finance_events','field_finance_reviews') LOOP
  predicate:='NOT public.has_scoped_manager_module(''salary-expense'')';
  IF t.tablename='profiles' THEN predicate:=predicate||' OR id=auth.uid()';
  ELSIF t.tablename='user_roles' THEN predicate:=predicate||' OR user_id=auth.uid()'; END IF;
  EXECUTE format('DROP POLICY IF EXISTS salary_manager_workspace_only ON public.%I',t.tablename);
  EXECUTE format('CREATE POLICY salary_manager_workspace_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',t.tablename,predicate,predicate);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
