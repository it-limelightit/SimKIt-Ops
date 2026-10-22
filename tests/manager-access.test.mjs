import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const source = readFileSync(new URL("../src/lib/manager-access.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { canAccessManagerPath, managerHomePath } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const allowed = ["salary-expense", "hr-hiring"];
test("Hardik can open salary/expense, HR/hiring and their child pages", () => {
  for (const email of ["admin@limelightit.io", " ADMIN@LIMELIGHTIT.IO "]) {
    for (const module of allowed) {
      assert.equal(canAccessManagerPath(email, `/manager/${module}`), true);
      assert.equal(canAccessManagerPath(email, `/manager/${module}/details`), true);
      assert.equal(canAccessManagerPath(email, `/manager/${module}-other`), false);
    }
    for (const module of ["", "/", "/sites", "/business-consultants", "/factory-data", "/performance", "/drive-links", "/company-tracker", "/leave", "/reports", "/tasks", "/attendance", "/field-visit-tracker", "/logistic", "/inventory"])
      assert.equal(canAccessManagerPath(email, `/manager${module}`), false);
    assert.equal(managerHomePath(email), "/manager/salary-expense");
  }
  assert.equal(canAccessManagerPath("other@example.test", "/manager/sites"), true);
  assert.equal(managerHomePath("other@example.test"), "/manager");
});

const db = new PGlite();
const hardik = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const aryan = "00000000-0000-4000-8000-000000000003";
const migration = readFileSync(new URL("../supabase/migrations/20261014120000_scoped_manager_module_access.sql", import.meta.url), "utf8");
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const asUser = async (id) => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
    INSERT INTO auth.users VALUES('${hardik}',' ADMIN@LIMELIGHTIT.IO '),('${other}','other@example.test'),('${aryan}','aryankadiya2005@gmail.com');
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,email text);
    INSERT INTO profiles SELECT * FROM auth.users;
    CREATE TABLE public.user_roles(user_id uuid,role text);
    INSERT INTO user_roles VALUES('${hardik}','supervisor'),('${other}','supervisor'),('${aryan}','employee');
    CREATE TABLE public.sites(id int); CREATE TABLE public.assessment(id int); CREATE TABLE public.contacts(id int);
    CREATE TABLE public.company_tracker_assignments(id int); CREATE TABLE public.activity_logs(id int);
    CREATE TABLE public.inventory_stock(id int); CREATE TABLE public.field_visit_schedules(id int); CREATE TABLE public.attendance_employees(id int);
    CREATE TABLE public.inventory_materials(id int);
    CREATE TABLE public.attendance_leave_requests(id int);
    INSERT INTO sites VALUES(1); INSERT INTO company_tracker_assignments VALUES(1);
    INSERT INTO inventory_stock VALUES(1); INSERT INTO field_visit_schedules VALUES(1); INSERT INTO attendance_employees VALUES(1);
    DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t.tablename);
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t.tablename);
      EXECUTE format('CREATE POLICY existing_access ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',t.tablename);
    END LOOP; END $$;
    CREATE FUNCTION public.company_tracker_board() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT '{"original":true}'::jsonb; $$;
    CREATE FUNCTION public.company_tracker_add_comment(_body text DEFAULT 'test') RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE result text; BEGIN result:=_body; RETURN result; END $$;
    CREATE FUNCTION public.toggle_user_manager_role(_target_user_id uuid,_make_manager boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN UPDATE user_roles SET role='owner' WHERE user_id=_target_user_id; END $$;
    CREATE FUNCTION public.field_ops_board() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN '{"field":true}'::jsonb; END $$;`);
  await db.exec(`CREATE FUNCTION public.attendance_my_leave_requests() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN '[]'::jsonb; END $$;
    CREATE FUNCTION public.attendance_assert_manager() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$ BEGIN RETURN; END $$;
    CREATE FUNCTION public.attendance_my_history() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN '[]'::jsonb; END $$;
    CREATE FUNCTION public.inventory_dispatch_deduct_once() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
      IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Manager required'; END IF; RETURN NEW; END $$;
    CREATE FUNCTION public.is_staff(_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_id AND role='supervisor') $$;
    CREATE TRIGGER dispatch_check BEFORE INSERT ON inventory_materials FOR EACH ROW EXECUTE FUNCTION inventory_dispatch_deduct_once();
    DROP POLICY existing_access ON inventory_materials;
    CREATE POLICY staff_write ON inventory_materials FOR ALL TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));`);
  await db.exec(migration);
  // A second application must neither duplicate guards nor break RPC signatures.
  await db.exec(migration);
  await db.exec("SET ROLE authenticated");
});
after(() => db.close());

test("database blocks unrelated tables and site writes while allowed modules still work", async () => {
  await asUser(hardik);
  assert.equal(await scalar("SELECT count(*) FROM company_tracker_assignments"), 0);
  assert.equal(await scalar("SELECT count(*) FROM user_roles"), 1);
  assert.equal(await scalar("SELECT count(*) FROM sites"), 1);
  await assert.rejects(db.query("INSERT INTO sites VALUES(2)"), /row-level security/);
  await assert.rejects(db.query("INSERT INTO attendance_leave_requests VALUES(1)"), /row-level security/);
  for (const table of ["inventory_stock", "field_visit_schedules", "attendance_employees"]) {
    assert.equal(await scalar(`SELECT count(*) FROM ${table}`), 1);
    await db.query(`INSERT INTO ${table} VALUES(2)`);
  }
  assert.deepEqual(await scalar("SELECT field_ops_board()"), { field: true });
  assert.equal(await scalar("SELECT role FROM user_roles"), "supervisor");
});

test("SECURITY DEFINER RPC guards reject bypasses and preserve other managers' behavior", async () => {
  await asUser(hardik);
  for (const sql of ["SELECT company_tracker_board()", "SELECT company_tracker_add_comment()", `SELECT toggle_user_manager_role('${hardik}',true)`])
    await assert.rejects(db.query(sql), /Module access denied/);
  await asUser(other);
  assert.deepEqual(await scalar("SELECT company_tracker_board()"), { original: true });
  assert.equal(await scalar("SELECT company_tracker_add_comment()"), "test");
  assert.equal(await scalar("SELECT count(*) FROM company_tracker_assignments"), 1);
  await db.query("INSERT INTO sites VALUES(2)");
});

test("changing a profile email cannot remove the Auth-based restriction", async () => {
  await asUser(hardik);
  await db.query("UPDATE profiles SET email='other@example.test' WHERE id=$1", [hardik]);
  assert.equal(await scalar("SELECT has_limited_manager_access()"), true);
  await assert.rejects(db.query("SELECT company_tracker_board()"), /Module access denied/);
});

test("Aryan sees only Leave Requests, Logistics and Inventory", () => {
  for (const email of ["aryankadiya2005@gmail.com", " ARYANKADIYA2005@GMAIL.COM "]) {
    for (const module of ["leave", "logistic", "inventory"]) {
      assert.equal(canAccessManagerPath(email, `/manager/${module}`), true);
      assert.equal(canAccessManagerPath(email, `/manager/${module}/details`), true);
    }
    for (const module of ["attendance", "field-visit-tracker", "sites", "reports", "factory-data", "business-consultants", "company-tracker"])
      assert.equal(canAccessManagerPath(email, `/manager/${module}`), false);
    assert.equal(canAccessManagerPath(email, "/manager"), false);
    assert.equal(managerHomePath(email), "/manager/leave");
  }
});

test("Aryan retains his employee role and personal leave, can dispatch, and cannot access attendance or field operations", async () => {
  await asUser(aryan);
  assert.equal(await scalar("SELECT role FROM user_roles"), "employee");
  assert.deepEqual(await scalar("SELECT attendance_my_leave_requests()"), []);
  await db.query("INSERT INTO inventory_materials VALUES(1)");
  assert.equal(await scalar("SELECT count(*) FROM inventory_materials"), 1);
  for (const sql of ["SELECT field_ops_board()", "SELECT attendance_assert_manager()", "SELECT attendance_my_history()", "SELECT company_tracker_board()"])
    await assert.rejects(db.query(sql), /Module access denied/);
  assert.equal(await scalar("SELECT count(*) FROM field_visit_schedules"), 0);
  assert.equal(await scalar("SELECT count(*) FROM attendance_employees"), 0);
  await assert.rejects(db.query("INSERT INTO sites VALUES(3)"), /row-level security/);
  await asUser(hardik);
  await assert.rejects(db.query("SELECT attendance_my_leave_requests()"), /Module access denied/);
  await db.query("SELECT attendance_assert_manager()");
});

test("finance migration removes Hardik's old database access and preserves Aryan", async()=>{
 await db.exec("RESET ROLE");
 await db.exec(readFileSync(new URL("../supabase/migrations/20261016121000_salary_manager_access.sql",import.meta.url),"utf8"));
 await db.exec("SET ROLE authenticated");
 await asUser(hardik);
 assert.deepEqual(await scalar("SELECT limited_manager_modules()"),["salary-expense"]);
 for(const table of ["sites","inventory_stock","field_visit_schedules","attendance_employees"]){assert.equal(await scalar(`SELECT count(*) FROM ${table}`),0);await assert.rejects(db.query(`INSERT INTO ${table} VALUES(99)`),/row-level security/);}
 await assert.rejects(db.query("SELECT field_ops_board()"),/Module access denied/);
 await assert.rejects(db.query("SELECT attendance_assert_manager()"),/Module access denied/);
 assert.equal(await scalar("SELECT role FROM user_roles"),"supervisor");
 await asUser(aryan);await db.query("INSERT INTO inventory_materials VALUES(99)");assert.deepEqual(await scalar("SELECT attendance_my_leave_requests()"),[]);
});
