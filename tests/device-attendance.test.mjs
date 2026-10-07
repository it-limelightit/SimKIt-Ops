import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
const db = new PGlite();
const manager = "00000000-0000-4000-8000-000000000001";
const worker = "00000000-0000-4000-8000-000000000002";
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const asUser = async (id) => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
let employee, today;
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TYPE public.app_role AS ENUM ('worker','supervisor','owner');
    CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
    CREATE FUNCTION public.has_role(_id uuid,_role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_id AND role=_role) $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    INSERT INTO user_roles VALUES('${manager}','supervisor'),('${worker}','worker');`);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261006150000_manager_device_attendance.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL("../supabase/migrations/20261006160000_attendance_direct_mqtt.sql", import.meta.url),
      "utf8",
    ),
  );
  await asUser(manager);
  today = await scalar("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text");
  employee = await scalar(
    "SELECT attendance_save_employee('Rahul','software','00104','rahul@example.test',true,$1::date)",
    [today],
  );
});
after(() => db.close());
test("direct MQTT migration can be reapplied without changing data or service-only access", async () => {
  const before = await scalar("SELECT count(*)::int FROM attendance_employees");
  await db.exec(
    readFileSync(
      new URL("../supabase/migrations/20261006160000_attendance_direct_mqtt.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_employees"), before);
  for (const role of ["anon", "authenticated"]) {
    assert.equal(
      await scalar(
        "SELECT has_function_privilege($1,'attendance_mqtt_finish_command(uuid,uuid,text,boolean)','EXECUTE')",
        [role],
      ),
      false,
    );
  }
  assert.equal(
    await scalar(
      "SELECT has_function_privilege('service_role','attendance_mqtt_finish_command(uuid,uuid,text,boolean)','EXECUTE')",
    ),
    true,
  );
});
test("employee creation preserves leading zeros and queues enrollment atomically", async () => {
  assert.equal(
    await scalar("SELECT enroll_id FROM attendance_employees WHERE id=$1", [employee]),
    "00104",
  );
  assert.equal(
    await scalar("SELECT count(*)::int FROM attendance_device_commands WHERE employee_id=$1", [
      employee,
    ]),
    1,
  );
  await assert.rejects(
    db.query("SELECT attendance_save_employee('Duplicate','software','00104')"),
    /unique/,
  );
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_employees"), 1);
});
test("department manager grants no application role; nonmanagers cannot invoke management RPCs", async () => {
  await asUser(worker);
  await assert.rejects(
    db.query("SELECT attendance_board($1::date)", [today]),
    /Manager access required/,
  );
  await assert.rejects(
    db.query("SELECT attendance_save_employee('No','manager','009')"),
    /Manager access required/,
  );
  await assert.rejects(
    db.query("SELECT attendance_set_active($1,false)", [employee]),
    /Manager access required/,
  );
  await asUser(manager);
});
test("ingestion and command RPCs are service-only, and tables are not directly writable by users", async () => {
  assert.equal(
    await scalar(
      "SELECT has_function_privilege('authenticated','attendance_ingest_scan(text,text,timestamptz,boolean)','EXECUTE')",
    ),
    false,
  );
  assert.equal(
    await scalar("SELECT has_function_privilege('anon','attendance_board(date)','EXECUTE')"),
    false,
  );
  assert.equal(
    await scalar("SELECT has_table_privilege('authenticated','attendance_employees','INSERT')"),
    false,
  );
  await db.exec("SET ROLE authenticated");
  await asUser(worker);
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_employees"), 0);
  await asUser(manager);
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_employees"), 1);
  await db.exec("RESET ROLE");
});
test("office default is 10 AM with 15 minutes grace and absence remains unconfigured", async () => {
  const board = await scalar("SELECT attendance_board($1::date)", [today]);
  assert.equal(board.settings.shift_start, "10:00:00");
  assert.equal(board.settings.grace_minutes, 15);
  assert.equal(board.settings.absence_cutoff, null);
  assert.equal(board.rows[0].status, "needs_review");
  await db.query("SELECT attendance_save_settings('10:00',15,'18:00',ARRAY[0,1,2,3,4,5,6],'{}')");
});
test("distinct repeated scans keep earliest entry; retries do not duplicate and changed identities fail", async () => {
  // Allow test scans up to 10:30 even when run before 10 AM.
  const d = await scalar("SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date-1)::text");
  await db.query("UPDATE attendance_employees SET employment_start=$1::date", [d]);
  await db.query("UPDATE attendance_settings SET effective_from=$1::date", [d]);
  const stamp = `${d}T10:30:00+05:30`;
  const first = await scalar("SELECT attendance_ingest_scan($1,$2,$3::timestamptz,true)", [
    "late",
    "00104",
    stamp,
  ]);
  const retry = await scalar("SELECT attendance_ingest_scan($1,$2,$3::timestamptz,true)", [
    "late",
    "00104",
    stamp,
  ]);
  assert.equal(retry.id, first.id);
  assert.equal(retry.duplicate, true);
  await assert.rejects(
    db.query("SELECT attendance_ingest_scan($1,$2,$3::timestamptz,true)", [
      "late",
      "00104",
      `${d}T10:31:00+05:30`,
    ]),
    /reused/,
  );
  await db.query("SELECT attendance_ingest_scan($1,$2,$3::timestamptz,true)", [
    "later",
    "00104",
    `${d}T10:45:00+05:30`,
  ]);
  assert.equal(await scalar("SELECT late_minutes FROM attendance_daily_records"), 15);
  await db.query("SELECT attendance_ingest_scan($1,$2,$3::timestamptz,true)", [
    "earlier",
    "00104",
    `${d}T10:15:00+05:30`,
  ]);
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_daily_records"), 1);
  assert.equal(await scalar("SELECT late_minutes FROM attendance_daily_records"), 0);
  assert.equal(
    await scalar(
      "SELECT count(*)::int FROM attendance_audit_logs WHERE action='earlier_scan_received'",
    ),
    1,
  );
  assert.equal((await scalar("SELECT attendance_board($1::date)", [d])).rows[0].status, "present");
});
test("policy snapshots survive later settings changes and late correction uses original threshold", async () => {
  const d = await scalar("SELECT work_date::text FROM attendance_daily_records");
  await db.query("UPDATE attendance_settings SET shift_start='11:00',grace_minutes=10");
  await db.query("SELECT attendance_ingest_scan($1,$2,$3::timestamptz,true)", [
    "earliest",
    "00104",
    `${d}T10:14:00+05:30`,
  ]);
  assert.equal(
    await scalar("SELECT policy_snapshot->>'shift_start' FROM attendance_daily_records"),
    "10:00:00",
  );
  assert.equal(await scalar("SELECT late_minutes FROM attendance_daily_records"), 0);
});
test("unknown users, implausible clocks, and failed recognition remain review events", async () => {
  const now = new Date().toISOString();
  assert.equal(
    (
      await scalar("SELECT attendance_ingest_scan($1,$2,$3::timestamptz,true)", [
        "unknown",
        "999",
        now,
      ])
    ).state,
    "unknown_employee",
  );
  assert.equal(
    (
      await scalar("SELECT attendance_ingest_scan($1,$2,$3::timestamptz,true)", [
        "future",
        "00104",
        new Date(Date.now() + 3600000).toISOString(),
      ])
    ).state,
    "invalid_time",
  );
  assert.equal(
    (
      await scalar("SELECT attendance_ingest_scan($1,$2,$3::timestamptz,false)", [
        "badface",
        "00104",
        now,
      ])
    ).state,
    "failed_recognition",
  );
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_daily_records"), 1);
});
test("commands are leased once, sending alone does not enroll; matching ack completes enrollment", async () => {
  const claims = await scalar("SELECT attendance_claim_commands($1)", [employee]);
  assert.equal(claims.length, 1);
  assert.equal((await scalar("SELECT attendance_claim_commands($1)", [employee])).length, 0);
  const c = claims[0];
  await db.query("SELECT attendance_finish_command($1,$2,true)", [c.id, c.lease_token]);
  assert.equal(
    await scalar("SELECT enrollment_status FROM attendance_employees WHERE id=$1", [employee]),
    "pending",
  );
  await assert.rejects(
    db.query("SELECT attendance_ack_command($1,$2,true)", [c.id, "wrong"]),
    /Unknown/,
  );
  await db.query("SELECT attendance_ack_command($1,$2,true)", [c.id, "00104"]);
  await db.query("SELECT attendance_finish_command($1,$2,false)", [c.id, c.lease_token]);
  assert.equal(
    await scalar("SELECT status FROM attendance_device_commands WHERE id=$1", [c.id]),
    "acknowledged",
  );
  assert.equal(
    await scalar("SELECT enrollment_status FROM attendance_employees WHERE id=$1", [employee]),
    "enrolled",
  );
});
test("pending leave requires explicit review, scans on approved leave are preserved conflicts", async () => {
  const d = await scalar("SELECT work_date::text FROM attendance_daily_records");
  const leave = await scalar("SELECT attendance_create_leave($1,$2::date,$2::date,$3)", [
    employee,
    d,
    "Personal",
  ]);
  assert.equal((await scalar("SELECT attendance_board($1::date)", [d])).rows[0].status, "present");
  await db.query("SELECT attendance_review_leave($1,'approved','OK')", [leave]);
  const row = (await scalar("SELECT attendance_board($1::date)", [d])).rows[0];
  assert.equal(row.status, "needs_review");
  assert.equal(row.leave_conflict, true);
  assert.ok(row.entry_at);
  const overlap = await scalar("SELECT attendance_create_leave($1,$2::date,$2::date,$3)", [
    employee,
    d,
    "Another",
  ]);
  await assert.rejects(
    db.query("SELECT attendance_review_leave($1,'approved')", [overlap]),
    /already covers/,
  );
  await db.query("SELECT attendance_review_leave($1,'cancelled')", [leave]);
  assert.equal(
    (await scalar("SELECT attendance_board($1::date)", [d])).rows[0].leave_conflict,
    false,
  );
});
test("email deduplicates messages and unverified senders require review", async () => {
  const id = await scalar("SELECT attendance_email_leave($1,$2,$3::date,$3::date,$4)", [
    "mail-1",
    "rahul@example.test",
    today,
    "Leave",
  ]);
  assert.equal(
    await scalar("SELECT attendance_email_leave($1,$2,$3::date,$3::date,$4)", [
      "mail-1",
      "rahul@example.test",
      today,
      "Leave",
    ]),
    id,
  );
  assert.equal(
    await scalar("SELECT status FROM attendance_leave_requests WHERE id=$1", [id]),
    "pending",
  );
  const unknown = await scalar("SELECT attendance_email_leave($1,$2,NULL,NULL,$3)", [
    "mail-2",
    "unknown@example.test",
    "Unclear dates",
  ]);
  assert.equal(
    await scalar("SELECT status FROM attendance_leave_requests WHERE id=$1", [unknown]),
    "needs_review",
  );
});
test("absence requires recorded uninterrupted health coverage; missing or gapped coverage stays in review", async () => {
  const d = await scalar("SELECT work_date::text FROM attendance_daily_records");
  const other = await scalar(
    "SELECT attendance_save_employee('Other','hardware','00200',NULL,false,$1::date)",
    [d],
  );
  assert.equal(
    (await scalar("SELECT attendance_board($1::date)", [d])).rows.find(
      (r) => r.employee_id === other,
    ).status,
    "needs_review",
  );
  await db.query(
    "INSERT INTO attendance_device_health VALUES($1::date,($1::date+time '09:00') AT TIME ZONE 'Asia/Kolkata',($1::date+time '18:01') AT TIME ZONE 'Asia/Kolkata',false)",
    [d],
  );
  assert.equal(
    (await scalar("SELECT attendance_board($1::date)", [d])).rows.find(
      (r) => r.employee_id === other,
    ).status,
    "absent",
  );
  await db.query("UPDATE attendance_device_health SET gap_detected=true");
  assert.equal(
    (await scalar("SELECT attendance_board($1::date)", [d])).rows.find(
      (r) => r.employee_id === other,
    ).status,
    "needs_review",
  );
});
test("photo expiry does not delete history; deactivation does not erase records", async () => {
  const event = await scalar("SELECT first_event_id FROM attendance_daily_records");
  await db.query(
    "INSERT INTO attendance_photos(event_id,storage_path,expires_at,status) SELECT id,id||'.jpg',scanned_at+interval '24 hours','available' FROM attendance_scan_events WHERE id=$1",
    [event],
  );
  await db.query(
    "UPDATE attendance_photos SET status='deleted',deleted_at=now() WHERE event_id=$1",
    [event],
  );
  await db.query("SELECT attendance_set_active($1,false)", [employee]);
  assert.equal(
    await scalar("SELECT count(*)::int FROM attendance_daily_records WHERE employee_id=$1", [
      employee,
    ]),
    1,
  );
  const history = await scalar(
    "SELECT attendance_history($1,(SELECT work_date FROM attendance_daily_records WHERE employee_id=$1))",
    [employee],
  );
  assert.ok(history.events.length >= 4);
  assert.equal(history.events.find((e) => e.id === event).photo_status, "deleted");
});
test("direct MQTT confirmation is service-only and updates registration atomically", async () => {
  assert.equal(
    await scalar(
      "SELECT has_function_privilege('authenticated','attendance_mqtt_finish_command(uuid,uuid,text,boolean)','EXECUTE')",
    ),
    false,
  );
  const e = await scalar("SELECT attendance_save_employee('Direct user','hardware','direct-001')");
  const [c] = await scalar("SELECT attendance_claim_commands($1)", [e]);
  await db.query("SELECT attendance_mqtt_finish_command($1,$2,'published',true)", [
    c.id,
    c.lease_token,
  ]);
  assert.equal(
    await scalar("SELECT enrollment_status FROM attendance_employees WHERE id=$1", [e]),
    "enrolled",
  );
  assert.equal(
    await scalar("SELECT status FROM attendance_device_commands WHERE id=$1", [c.id]),
    "acknowledged",
  );
  // A stale publishing result cannot overwrite confirmed device registration.
  await db.query("SELECT attendance_mqtt_finish_command($1,$2,'uncertain',NULL)", [
    c.id,
    c.lease_token,
  ]);
  assert.equal(
    await scalar("SELECT enrollment_status FROM attendance_employees WHERE id=$1", [e]),
    "enrolled",
  );
});
test("uncertain MQTT sends require review and cannot automatically duplicate enrollment", async () => {
  const e = await scalar(
    "SELECT attendance_save_employee('Uncertain user','hardware','direct-002')",
  );
  const [c] = await scalar("SELECT attendance_claim_commands($1)", [e]);
  await db.query("SELECT attendance_mqtt_finish_command($1,$2,'uncertain',NULL)", [
    c.id,
    c.lease_token,
  ]);
  assert.equal(
    await scalar("SELECT status FROM attendance_device_commands WHERE id=$1", [c.id]),
    "failed",
  );
  assert.equal((await scalar("SELECT attendance_claim_commands($1)", [e])).length, 0);
});
test("validation rejects missing timezone, impossible dates, and disguised image content", async () => {
  const source = readFileSync(
    new URL("../supabase/functions/_shared/attendance-validation.ts", import.meta.url),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const validation = await import(
    `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
  );
  assert.throws(() => validation.isoTimestamp("2026-10-06 10:15:00"), /timezone/);
  assert.equal(validation.isoTimestamp("2026-10-06T10:15:00+05:30"), "2026-10-06T04:45:00.000Z");
  assert.equal(validation.dateOrNull("2026-02-30"), null);
  assert.throws(
    () => validation.photoBytes(Buffer.from("not a photo").toString("base64"), "image/jpeg"),
    /content/,
  );
});
