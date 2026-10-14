BEGIN;

-- Preserve existing roles and employee links. Hardik remains a supervisor;
-- Aryan remains an employee with scoped access to the logistics workspace.
-- Read Auth email rather than the user-editable profiles.email field.
CREATE OR REPLACE FUNCTION public.limited_manager_modules(_user_id uuid DEFAULT auth.uid())
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE lower(btrim(email))
    WHEN 'admin@limelightit.io' THEN ARRAY['attendance', 'field-visit-tracker', 'logistic', 'inventory']
    WHEN 'aryankadiya2005@gmail.com' THEN ARRAY['leave', 'logistic', 'inventory']
    ELSE NULL::text[] END
  FROM auth.users WHERE id = _user_id
$$;

CREATE OR REPLACE FUNCTION public.has_limited_manager_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.limited_manager_modules() IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.has_scoped_manager_module(_module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(_module = ANY(public.limited_manager_modules()), false)
$$;

CREATE OR REPLACE FUNCTION public.assert_manager_module_access(_module text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_limited_manager_access() AND NOT public.has_scoped_manager_module(_module) THEN
    RAISE EXCEPTION 'Module access denied for this account: %', _module
      USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.limited_manager_modules(uuid), public.has_limited_manager_access(), public.has_scoped_manager_module(text), public.assert_manager_module_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.limited_manager_modules(uuid), public.has_limited_manager_access(), public.has_scoped_manager_module(text), public.assert_manager_module_access(text) TO authenticated, service_role;

-- Restrictive policies intersect the existing permissive policies. They do not
-- change unrelated users' access. Inventory grants below add Aryan's requested
-- logistics access without promoting his employee account to supervisor.
-- Sites, profiles, assessment and contacts are shared read dependencies for
-- field scheduling and logistics recipient details; writes stay restricted.
DO $policies$
DECLARE t record; operation text; predicate text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    IF t.tablename = 'settings' THEN
      CONTINUE;
    END IF;

    IF t.tablename LIKE 'inventory\_%' ESCAPE '\' THEN
      IF t.tablename IN ('inventory_parcels', 'inventory_materials', 'inventory_stock', 'inventory_bom_items', 'inventory_bulk_order_plans') THEN
        EXECUTE format('DROP POLICY IF EXISTS scoped_inventory_management ON public.%I', t.tablename);
        EXECUTE format('CREATE POLICY scoped_inventory_management ON public.%I FOR ALL TO authenticated USING (public.has_scoped_manager_module(''inventory'')) WITH CHECK (public.has_scoped_manager_module(''inventory''))', t.tablename);
      END IF;
      CONTINUE;
    END IF;

    IF t.tablename IN ('sites', 'profiles', 'assessment', 'contacts', 'user_roles') THEN
      FOREACH operation IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
        predicate := 'NOT public.has_limited_manager_access()';
        IF t.tablename = 'profiles' AND operation = 'UPDATE' THEN
          predicate := predicate || ' OR id = auth.uid()';
        END IF;
        EXECUTE format('DROP POLICY IF EXISTS operations_module_limit_%s ON public.%I', lower(operation), t.tablename);
        EXECUTE format('CREATE POLICY operations_module_limit_%s ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',
          lower(operation), t.tablename, operation,
          CASE operation
            WHEN 'INSERT' THEN 'WITH CHECK (' || predicate || ')'
            WHEN 'UPDATE' THEN 'USING (' || predicate || ') WITH CHECK (' || predicate || ')'
            ELSE 'USING (' || predicate || ')'
          END);
      END LOOP;
      IF t.tablename = 'user_roles' THEN
        EXECUTE 'DROP POLICY IF EXISTS operations_module_limit_read ON public.user_roles';
        EXECUTE 'CREATE POLICY operations_module_limit_read ON public.user_roles AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.has_limited_manager_access() OR user_id = auth.uid())';
      ELSIF t.tablename <> 'profiles' THEN
        EXECUTE format('DROP POLICY IF EXISTS scoped_logistics_read ON public.%I', t.tablename);
        EXECUTE format('CREATE POLICY scoped_logistics_read ON public.%I FOR SELECT TO authenticated USING (public.has_scoped_manager_module(''logistic''))', t.tablename);
      END IF;
    ELSE
      predicate := 'NOT public.has_limited_manager_access()';
      IF t.tablename LIKE 'field\_%' ESCAPE '\' THEN
        predicate := predicate || ' OR public.has_scoped_manager_module(''field-visit-tracker'')';
      ELSIF t.tablename LIKE 'attendance\_%' ESCAPE '\' AND t.tablename NOT IN ('attendance_leave_requests', 'attendance_leave_request_days') THEN
        predicate := predicate || ' OR public.has_scoped_manager_module(''attendance'')';
      END IF;
      IF t.tablename = 'activity_logs' THEN
        -- Logging one's own allowed actions does not grant access to Reports.
        EXECUTE 'DROP POLICY IF EXISTS operations_module_limit ON public.activity_logs';
        EXECUTE 'CREATE POLICY operations_module_limit ON public.activity_logs AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.has_limited_manager_access())';
      ELSE
        EXECUTE format('DROP POLICY IF EXISTS operations_module_limit ON public.%I', t.tablename);
        EXECUTE format('CREATE POLICY operations_module_limit ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)', t.tablename, predicate, predicate);
      END IF;
    END IF;
  END LOOP;
END;
$policies$;

-- SECURITY DEFINER RPCs bypass RLS. Add an entry guard to the existing blocked
-- module RPCs, preserving their deployed bodies, signatures, defaults and grants.
-- Existing authorization inside each RPC stays in place. Background triggers
-- are excluded; the dispatch trigger receives its separate scoped check below.
DO $rpc_guards$
DECLARE f record; guarded_body text; definition text; module_name text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, p.prosrc, p.prorettype, l.lanname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.prorettype <> 'trigger'::regtype
      AND (
        p.proname LIKE 'company_tracker\_%' ESCAPE '\'
        OR p.proname LIKE 'field_ops\_%' ESCAPE '\'
        OR p.proname LIKE 'field_visit_schedule\_%' ESCAPE '\'
        OR p.proname IN (
          'toggle_user_manager_role', 'admin_update_user_password', 'delete_worker',
          'save_client_invitation', 'get_client_form_site_by_token', 'save_client_form_by_token',
          'set_consultant_site_stage', 'set_consultant_site_status',
          'submit_commissioning_approval_request', 'review_commissioning_approval_request',
          'attendance_create_leave', 'attendance_review_leave', 'attendance_leave_review_queue',
          'attendance_decide_employee_leave_days', 'attendance_submit_my_leave',
          'attendance_decide_employee_leave', 'attendance_submit_my_wfh', 'attendance_my_leave_requests',
          'attendance_set_wfh_eligibility', 'attendance_assert_manager',
          'attendance_my_history', 'attendance_my_calendar'
        )
      )
  LOOP
    IF position('PERFORM public.assert_manager_module_access(' IN f.prosrc) > 0 THEN
      CONTINUE;
    END IF;
    module_name := CASE
      WHEN f.proname LIKE 'field\_%' ESCAPE '\' THEN 'field-visit-tracker'
      WHEN f.proname IN ('attendance_submit_my_leave', 'attendance_submit_my_wfh', 'attendance_my_leave_requests') THEN 'leave'
      WHEN f.proname IN ('attendance_assert_manager', 'attendance_my_history', 'attendance_my_calendar') THEN 'attendance'
      ELSE 'restricted' END;
    definition := pg_get_functiondef(f.oid);
    IF f.lanname = 'plpgsql' THEN
      guarded_body := regexp_replace(f.prosrc, '(^|;|\n)([ \t]*)BEGIN\M',
        E'\\1\\2BEGIN\n  PERFORM public.assert_manager_module_access(' || quote_literal(module_name) || ');', 'i');
      IF guarded_body = f.prosrc THEN
        RAISE EXCEPTION 'Cannot safely guard function %', f.proname;
      END IF;
    ELSIF f.lanname = 'sql' AND f.prorettype = 'jsonb'::regtype THEN
      guarded_body := E'BEGIN\n  PERFORM public.assert_manager_module_access(' || quote_literal(module_name) || E');\n  RETURN ('
        || regexp_replace(btrim(f.prosrc), ';\s*$', '') || E');\nEND;';
      definition := replace(definition, 'LANGUAGE sql', 'LANGUAGE plpgsql');
    ELSE
      RAISE EXCEPTION 'Unexpected function language or result type for %', f.proname;
    END IF;
    EXECUTE replace(definition, f.prosrc, guarded_body);
  END LOOP;
END;
$rpc_guards$;

-- The dispatch trigger has an additional staff check. Permit scoped inventory
-- operators there while retaining its stock locks, validation and deductions.
DO $dispatch$
DECLARE f record; body text;
BEGIN
  FOR f IN SELECT oid, prosrc FROM pg_proc WHERE oid = to_regprocedure('public.inventory_dispatch_deduct_once()') LOOP
    IF position('public.has_scoped_manager_module(' IN f.prosrc) = 0 THEN
      body := replace(f.prosrc, 'NOT public.is_staff(auth.uid())', 'NOT (public.is_staff(auth.uid()) OR public.has_scoped_manager_module(''inventory''))');
      IF body = f.prosrc THEN RAISE EXCEPTION 'Inventory dispatch access check could not be updated'; END IF;
      EXECUTE replace(pg_get_functiondef(f.oid), f.prosrc, body);
    END IF;
  END LOOP;
END;
$dispatch$;

COMMIT;
