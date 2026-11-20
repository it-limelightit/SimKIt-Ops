BEGIN;

-- Use the authenticated login, independent of the editable profile email.
CREATE OR REPLACE FUNCTION public.inventory_read_only_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE id = auth.uid() AND lower(email) = 'mayankk.limelightit@gmail.com'
  );
$$;
REVOKE ALL ON FUNCTION public.inventory_read_only_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_read_only_access() TO authenticated, service_role;

-- Keep permissive read and write policies for other accounts. The restrictive
-- policies also cover earlier inventory tables with permissive write policies.
DO $policies$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'inventory_stock', 'inventory_logs', 'inventory_bom_items', 'inventory_bulk_order_plans',
    'inventory_materials', 'inventory_parcels'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.' || relation_name) AND relrowsecurity) THEN
      RAISE EXCEPTION 'Expected RLS-enabled inventory table: %', relation_name;
    END IF;
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', relation_name);
    EXECUTE format('DROP POLICY IF EXISTS inventory_read_only_select ON public.%I', relation_name);
    EXECUTE format('DROP POLICY IF EXISTS inventory_read_only_no_insert ON public.%I', relation_name);
    EXECUTE format('DROP POLICY IF EXISTS inventory_read_only_no_update ON public.%I', relation_name);
    EXECUTE format('DROP POLICY IF EXISTS inventory_read_only_no_delete ON public.%I', relation_name);
    EXECUTE format('CREATE POLICY inventory_read_only_select ON public.%I FOR SELECT TO authenticated USING (public.inventory_read_only_access())', relation_name);
    EXECUTE format('CREATE POLICY inventory_read_only_no_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.inventory_read_only_access())', relation_name);
    EXECUTE format('CREATE POLICY inventory_read_only_no_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.inventory_read_only_access()) WITH CHECK (NOT public.inventory_read_only_access())', relation_name);
    EXECUTE format('CREATE POLICY inventory_read_only_no_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.inventory_read_only_access())', relation_name);
  END LOOP;
END;
$policies$;

-- Extend only the five stable read RPCs. Leave inventory manager authorization
-- on dispatch, packing, checkout and other mutation RPCs as it is.
DO $read_rpcs$
DECLARE
  entry record;
  routine_oid oid;
  original text;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('public.inventory_history(text,text,text,date,date,text,integer,integer)',
     'public.has_scoped_manager_module(''inventory'')',
     '(public.has_scoped_manager_module(''inventory'') OR public.inventory_read_only_access())'),
    ('public.field_associate_extra_inventory()', 'public.field_inventory_manager()',
     '(public.field_inventory_manager() OR public.inventory_read_only_access())'),
    ('public.firmware_inventory_data(boolean)', 'public.field_inventory_manager()',
     '(public.field_inventory_manager() OR public.inventory_read_only_access())'),
    ('public.device_test_devices(text,integer)', 'public.field_inventory_manager()',
     '(public.field_inventory_manager() OR public.inventory_read_only_access())'),
    ('public.device_test_history(text,integer)', 'public.field_inventory_manager()',
     '(public.field_inventory_manager() OR public.inventory_read_only_access())')
  ) AS patch(signature, old_check, new_check) LOOP
    SELECT oid, prosrc INTO STRICT routine_oid, original
      FROM pg_proc WHERE oid = to_regprocedure(entry.signature) AND provolatile = 's' AND prosecdef;
    IF position(entry.new_check IN original) > 0 THEN CONTINUE; END IF;
    IF position(entry.old_check IN original) = 0 THEN
      RAISE EXCEPTION 'Unexpected access check in %', entry.signature;
    END IF;
    EXECUTE replace(pg_get_functiondef(routine_oid), original, replace(original, entry.old_check, entry.new_check));
  END LOOP;
END;
$read_rpcs$;

NOTIFY pgrst, 'reload schema';
COMMIT;
