import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const roles = async (id) => (await db.query("SELECT role FROM user_roles WHERE user_id=$1 ORDER BY role::text", [id])).rows.map(row => row.role);
const active = async (id) => (await db.query("SELECT is_active FROM profiles WHERE id=$1", [id])).rows[0].is_active;

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TYPE app_role AS ENUM ('worker','supervisor','owner','employee');
    CREATE TABLE auth.users(id text PRIMARY KEY, raw_app_meta_data jsonb DEFAULT '{}');
    CREATE TABLE profiles(id text PRIMARY KEY, is_active boolean DEFAULT false);
    CREATE TABLE user_roles(user_id text, role app_role, UNIQUE(user_id,role));
    CREATE FUNCTION handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO profiles(id) VALUES(NEW.id);
      INSERT INTO user_roles VALUES(NEW.id,'worker'); RETURN NEW;
    END $$;
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION handle_new_user();`);
  const original = migration("20261012141000_attendance_employee_accounts.sql");
  await db.exec(original.slice(original.indexOf("CREATE OR REPLACE FUNCTION public.attendance_office_auth_created"), original.indexOf("CREATE OR REPLACE FUNCTION public.attendance_save_employee_account")));
  // Reproduce the actual Admin API ordering: INSERT first, app metadata UPDATE later.
  await db.exec(`INSERT INTO auth.users(id) VALUES('existing');
    UPDATE auth.users SET raw_app_meta_data='{"office_employee":true}' WHERE id='existing';`);
  assert.deepEqual(await roles("existing"), ["worker"]);
  const repair = migration("20261022180000_office_account_metadata_role_assignment.sql");
  await db.exec(repair);
  await db.exec(repair);
});
after(() => db.close());

test("migration is repeatable and leaves existing accounts untouched", async () => {
  assert.deepEqual(await roles("existing"), ["worker"]);
  assert.equal(await active("existing"), false);
});

test("delayed office app metadata replaces the default worker role and activates the profile", async () => {
  await db.exec(`INSERT INTO auth.users(id) VALUES('delayed');`);
  assert.deepEqual(await roles("delayed"), ["worker"]);
  await db.exec(`UPDATE auth.users SET raw_app_meta_data='{"office_employee":true,"attendance_employee_id":"new-office"}' WHERE id='delayed';`);
  assert.deepEqual(await roles("delayed"), ["employee"]);
  assert.equal(await active("delayed"), true);
});

test("office metadata already present at insert still assigns the employee role", async () => {
  await db.exec(`INSERT INTO auth.users VALUES('immediate','{"office_employee":true}');`);
  assert.deepEqual(await roles("immediate"), ["employee"]);
  assert.equal(await active("immediate"), true);
});

test("field and manager accounts retain their permissions", async () => {
  await db.exec(`INSERT INTO auth.users(id) VALUES('field'),('manager');
    UPDATE auth.users SET raw_app_meta_data='{"provider":"email"}' WHERE id='field';
    INSERT INTO user_roles VALUES('manager','supervisor');
    UPDATE auth.users SET raw_app_meta_data='{"office_employee":true}' WHERE id='manager';`);
  assert.deepEqual(await roles("field"), ["worker"]);
  assert.equal(await active("field"), false);
  assert.deepEqual(await roles("manager"), ["supervisor", "worker"]);
});

test("later metadata changes do not reassign roles or reactivate a disabled office account", async () => {
  await db.exec(`INSERT INTO auth.users VALUES('disabled','{"office_employee":true}');
    UPDATE profiles SET is_active=false WHERE id='disabled';
    UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data || '{"attendance_employee_id":"changed"}' WHERE id='disabled';`);
  assert.equal(await active("disabled"), false);
  assert.deepEqual(await roles("disabled"), ["employee"]);
});
