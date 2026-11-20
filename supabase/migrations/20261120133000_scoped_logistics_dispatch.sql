BEGIN;

-- Honor the existing Logistics module grant during the stock deduction
-- triggered by a courier status update. Keep the rest of the trigger intact.
DO $dispatch$
DECLARE
  dispatch_function regprocedure := 'public.inventory_dispatch_deduct_once()'::regprocedure;
  original_body text;
  updated_body text;
  staff_guard constant text := 'IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN';
  logistics_guard constant text := 'IF auth.uid() IS NULL OR NOT (coalesce(public.is_staff(auth.uid()),false) OR public.has_scoped_manager_module(''logistic'')) THEN';
BEGIN
  SELECT prosrc INTO STRICT original_body FROM pg_proc WHERE oid = dispatch_function AND prosecdef;
  IF position(logistics_guard IN original_body) > 0 THEN RETURN; END IF;
  updated_body := replace(original_body, staff_guard, logistics_guard);
  IF updated_body = original_body THEN
    RAISE EXCEPTION 'Unexpected inventory dispatch authorization check';
  END IF;
  EXECUTE replace(pg_get_functiondef(dispatch_function), original_body, updated_body);
END;
$dispatch$;

COMMIT;
