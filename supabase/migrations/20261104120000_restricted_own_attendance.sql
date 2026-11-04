-- Let Aryan (restricted account: leave / logistic / inventory) see his OWN
-- attendance calendar. attendance_my_calendar only ever returns the caller's
-- own days; the manager attendance board keeps its separate allowlist
-- (attendance_assert_manager), so no one else's attendance is exposed.
BEGIN;
CREATE OR REPLACE FUNCTION public.limited_manager_modules(_user_id uuid DEFAULT auth.uid())
 RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
 SELECT CASE lower(btrim(email))
  WHEN 'admin@limelightit.io' THEN ARRAY['salary-expense','hr-hiring']
  WHEN 'aryankadiya2005@gmail.com' THEN ARRAY['leave','logistic','inventory','attendance']
  ELSE NULL::text[] END FROM auth.users WHERE id=_user_id
$function$;
NOTIFY pgrst, 'reload schema';
COMMIT;
