import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const manager = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const tracker = "00000000-0000-4000-8000-000000000003";
const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const restartSql = migration("20261027100000_restart_company_monitoring_cycle.sql");
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const stage = () => scalar("SELECT stage FROM company_tracker_assignments WHERE id=$1", [tracker]);
const day = n => db.query("UPDATE company_tracker_assignments SET stage_changed_at=((now() AT TIME ZONE 'Asia/Kolkata')::date-($2::int-1))::timestamp AT TIME ZONE 'Asia/Kolkata' WHERE id=$1", [tracker, n]);
const complete = (n, outcome = "work") => scalar("SELECT company_tracker_complete_monitoring_day($1,$2,$3)", [tracker, n, outcome]);
const rollback = () => scalar("SELECT company_tracker_move_previous($1,'Restart monitoring after review')", [tracker]);

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES('${manager}'),('${other}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION is_company_tracker_manager() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid()='${manager}'::uuid $$;
    CREATE FUNCTION can_access_company_tracker(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT is_company_tracker_manager() $$;
    CREATE TABLE company_tracker_assignments(id uuid PRIMARY KEY,stage text,stage_changed_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE company_tracker_comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tracker_id uuid,body text,stage text,author_id uuid);
    CREATE TABLE company_tracker_stage_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tracker_id uuid,previous_stage text,new_stage text,changed_by uuid,comment_id uuid,was_manual boolean,changed_at timestamptz DEFAULT now());
    CREATE TABLE company_tracker_monitoring_days(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tracker_id uuid,day_number integer,checklist jsonb,result text,completed_at timestamptz,completed_by uuid,UNIQUE(tracker_id,day_number));`);
  await db.exec(migration("20260922103000_label_previous_stage_comments.sql"));
  await db.exec(migration("20260928130000_mark_monitoring_days_after_midnight.sql"));
  await db.exec(restartSql);
  await db.exec(restartSql);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [manager]);
});
after(() => db.close());
beforeEach(async () => {
  await db.exec("BEGIN");
  await db.query("INSERT INTO company_tracker_assignments(id,stage,stage_changed_at) VALUES($1,'Insights Shared',now()-interval '1 day')", [tracker]);
  await db.query("INSERT INTO company_tracker_stage_history(tracker_id,previous_stage,new_stage,was_manual,changed_at) VALUES($1,'Monitoring','Insights Shared',false,now()-interval '1 day')", [tracker]);
});
afterEach(() => db.exec("ROLLBACK"));

async function seedDays(count, result = "green") {
  await db.query("INSERT INTO company_tracker_monitoring_days(tracker_id,day_number,checklist,result,completed_at,completed_by) SELECT $1,n,'{\"outcome\":\"work\"}'::jsonb,$3,now()-interval '2 days',$4 FROM generate_series(1,$2::int) n", [tracker, count, result, manager]);
}

test("rollback archives the previous cycle and cannot auto-advance the next day", async () => {
  await seedDays(11, "red");
  const previous = await scalar("SELECT jsonb_agg(to_jsonb(d) ORDER BY day_number) FROM company_tracker_monitoring_days d");
  assert.equal(await rollback(), "Monitoring");
  assert.equal(await scalar("SELECT count(*)::int FROM company_tracker_monitoring_days"), 0);
  assert.deepEqual(await scalar("SELECT days FROM company_tracker_monitoring_archives"), previous);
  assert.equal(await scalar("SELECT archived_by FROM company_tracker_monitoring_archives"), manager);
  assert.equal(await scalar("SELECT stage_changed_at=now() FROM company_tracker_assignments"), true);
  assert.equal(await complete(1), "green");
  await day(2);
  await db.exec("SELECT company_tracker_mark_missed_monitoring_days()");
  assert.equal(await stage(), "Monitoring");
  assert.equal(await complete(2), "green");
  assert.equal(await stage(), "Monitoring");
});

test("a restarted all-green cycle needs six new calendar days", async () => {
  await seedDays(11, "red");
  await rollback();
  for (let n = 1; n <= 6; n++) {
    await day(n);
    assert.equal(await complete(n), n === 6 ? "Insights Shared" : "green");
    assert.equal(await stage(), n === 6 ? "Insights Shared" : "Monitoring");
  }
});

test("a restarted cycle with leave needs eleven new days", async () => {
  await seedDays(6);
  await rollback();
  assert.equal(await complete(1, "leave"), "red");
  for (let n = 2; n <= 11; n++) {
    await day(n);
    assert.equal(await complete(n), n === 11 ? "Insights Shared" : "green");
    assert.equal(await stage(), n === 11 ? "Insights Shared" : "Monitoring");
  }
});

test("missed days are counted only in the new cycle and advance after eleven days", async () => {
  await seedDays(11, "red");
  await rollback();
  await day(2);
  await db.exec("SELECT company_tracker_mark_missed_monitoring_days()");
  assert.equal(await stage(), "Monitoring");
  assert.equal(await scalar("SELECT count(*)::int FROM company_tracker_monitoring_days"), 1);
  await day(11);
  await db.exec("SELECT company_tracker_mark_missed_monitoring_days()");
  assert.equal(await stage(), "Monitoring");
  await day(12);
  await db.exec("SELECT company_tracker_mark_missed_monitoring_days()");
  assert.equal(await stage(), "Insights Shared");
});

test("ordinary Monitoring edits retain current progress and other trackers are untouched", async () => {
  await seedDays(6);
  await rollback();
  await complete(1);
  await db.query("UPDATE company_tracker_assignments SET stage='Monitoring',updated_at=now() WHERE id=$1", [tracker]);
  assert.equal(await scalar("SELECT count(*)::int FROM company_tracker_monitoring_days"), 1);
  assert.equal(await scalar("SELECT count(*)::int FROM company_tracker_monitoring_archives"), 1);
  await db.query("INSERT INTO company_tracker_assignments(id,stage) VALUES($1,'Insights Shared')", [other]);
  await db.query("INSERT INTO company_tracker_monitoring_days(tracker_id,day_number,result) VALUES($1,1,'red')", [other]);
  await db.query("UPDATE company_tracker_assignments SET stage='Meeting Planned' WHERE id=$1", [other]);
  assert.equal(await scalar("SELECT result FROM company_tracker_monitoring_days WHERE tracker_id=$1", [other]), "red");
});

test("only managers can roll back; archive reads respect tracker access", async () => {
  await seedDays(6);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [other]);
  await db.exec("SAVEPOINT denied_rollback");
  await assert.rejects(rollback(), /Only commissioning managers/);
  await db.exec("ROLLBACK TO SAVEPOINT denied_rollback");
  assert.equal(await scalar("SELECT count(*)::int FROM company_tracker_monitoring_days"), 6);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [manager]);
  await rollback();
  await db.exec("SET LOCAL ROLE authenticated");
  assert.equal(await scalar("SELECT count(*)::int FROM company_tracker_monitoring_archives"), 1);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [other]);
  assert.equal(await scalar("SELECT count(*)::int FROM company_tracker_monitoring_archives"), 0);
});
