import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { normalizeMessage as normalizeReceiverMessage } from "../integrations/aiface-attendance-receiver/vendor/protocol.mjs";
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
test("employee edits require a manager and preserve enrollment, commands and history", async () => {
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261010100000_attendance_edit_employee.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const before = (
    await db.query("SELECT enroll_id,enrollment_status FROM attendance_employees WHERE id=$1", [
      employee,
    ])
  ).rows[0];
  const commands = await scalar("SELECT count(*)::int FROM attendance_device_commands");
  await asUser(worker);
  await assert.rejects(
    db.query(
      "SELECT attendance_update_employee($1,'Edited','hardware','edited@example.test',true,$2::date)",
      [employee, today],
    ),
    /Manager access required/,
  );
  await asUser(manager);
  await db.query(
    "SELECT attendance_update_employee($1,'Edited','hardware','edited@example.test',true,$2::date)",
    [employee, today],
  );
  const updated = (
    await db.query(
      "SELECT name,department,email,email_verified,enroll_id,enrollment_status FROM attendance_employees WHERE id=$1",
      [employee],
    )
  ).rows[0];
  assert.equal(updated.name, "Edited");
  assert.equal(updated.department, "hardware");
  assert.equal(updated.email, "edited@example.test");
  assert.equal(updated.email_verified, true);
  assert.equal(updated.enroll_id, before.enroll_id);
  assert.equal(updated.enrollment_status, before.enrollment_status);
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_device_commands"), commands);
  await assert.rejects(
    db.query("SELECT attendance_update_employee($1,'','software',null,false,$2::date)", [
      employee,
      today,
    ]),
    /Name is required/,
  );
  await db.query(
    "SELECT attendance_update_employee($1,'Rahul','software','rahul@example.test',true,$2::date)",
    [employee, today],
  );
});
test("receiver receipt time controls stored timestamp, Indian work date and lateness despite a reset device clock", async () => {
  await db.exec("BEGIN");
  try {
    const d = await scalar("SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date-1)::text");
    await db.query("UPDATE attendance_employees SET employment_start=$1::date", [d]);
    await db.query("UPDATE attendance_settings SET effective_from=$1::date", [d]);
    const topic = "aiface/AYUE22065256/sub/stellar";
    const config = {
      deviceId: "AYUE22065256",
      topics: [topic],
      validModes: ["8"],
      entryValues: ["0"],
    };
    const message = {
      cmd: "sendlog",
      sn: config.deviceId,
      count: 1,
      record: [{ enrollid: "00104", time: "2000-01-01 00:00:00", mode: 8, inout: 0 }],
    };
    const receivedAt = Date.parse(`${d}T10:30:00+05:30`);
    const event = normalizeReceiverMessage(message, topic, config, receivedAt)[0];
    const ingest = await scalar("SELECT attendance_ingest_scan($1,$2,$3::timestamptz,$4)", [
      event.event_id,
      event.enroll_id,
      event.scanned_at,
      event.recognized,
    ]);
    assert.equal(ingest.state, "valid");
    const stored = (
      await db.query("SELECT scanned_at,work_date::text FROM attendance_scan_events WHERE id=$1", [
        ingest.id,
      ])
    ).rows[0];
    assert.equal(new Date(stored.scanned_at).getTime(), receivedAt);
    assert.equal(stored.work_date, d);
    assert.equal(
      await scalar(
        "SELECT late_minutes FROM attendance_daily_records WHERE employee_id=$1 AND work_date=$2::date",
        [employee, d],
      ),
      15,
    );
    // UTC previous evening must belong to the next Indian work day.
    const midnightReceipt = Date.parse(`${d}T00:10:00+05:30`);
    const midnightEvent = normalizeReceiverMessage(
      { ...message, record: [{ ...message.record[0], event_id: "receipt-midnight" }] },
      topic,
      config,
      midnightReceipt,
    )[0];
    const midnight = await scalar("SELECT attendance_ingest_scan($1,$2,$3::timestamptz,true)", [
      midnightEvent.event_id,
      midnightEvent.enroll_id,
      midnightEvent.scanned_at,
    ]);
    assert.equal(
      await scalar("SELECT work_date::text FROM attendance_scan_events WHERE id=$1", [midnight.id]),
      d,
    );
  } finally {
    await db.exec("ROLLBACK");
  }
});
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

test("device evidence repairs enrollment without inventing command acknowledgments or attendance", async () => {
  const e = await scalar("SELECT attendance_save_employee('Profile user','software','9003')");
  const [command] = await scalar("SELECT attendance_claim_commands($1)", [e]);
  await db.query("SELECT attendance_mqtt_finish_command($1,$2,'published',NULL)", [
    command.id,
    command.lease_token,
  ]);
  await db.query("UPDATE attendance_device_commands SET status='failed' WHERE id=$1", [command.id]);
  await db.query("UPDATE attendance_employees SET enrollment_status='failed' WHERE id=$1", [e]);
  await db.query("SELECT attendance_ingest_scan('profile-evidence','9003',now(),true)");
  const source = readFileSync(
    new URL(
      "../supabase/migrations/20261009110000_attendance_device_profile_confirmation.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(source);
  assert.equal(
    await scalar("SELECT enrollment_status FROM attendance_employees WHERE id=$1", [e]),
    "enrolled",
  );
  assert.equal(
    await scalar("SELECT status FROM attendance_device_commands WHERE id=$1", [command.id]),
    "failed",
  );
  const audits = await scalar(
    "SELECT count(*)::int FROM attendance_audit_logs WHERE action='device_profile_confirmed' AND record_id=$1",
    [e],
  );
  const records = await scalar("SELECT count(*)::int FROM attendance_daily_records");
  await db.exec(source);
  assert.equal(
    await scalar(
      "SELECT count(*)::int FROM attendance_audit_logs WHERE action='device_profile_confirmed' AND record_id=$1",
      [e],
    ),
    audits,
  );
  assert.equal(
    await scalar("SELECT attendance_confirm_device_profile('9003','profile',now())"),
    true,
  );
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_daily_records"), records);
  assert.equal(
    await scalar("SELECT attendance_confirm_device_profile('unknown','profile',now())"),
    false,
  );
  await assert.rejects(
    db.query("SELECT attendance_confirm_device_profile('9003','profile',now()-interval '2 days')"),
    /Fresh profile/,
  );
  await assert.rejects(
    db.query("SELECT attendance_confirm_device_profile('9003','scan',now()-interval '1 hour')"),
    /Validated recognized scan/,
  );
  for (const role of ["anon", "authenticated"])
    assert.equal(
      await scalar(
        "SELECT has_function_privilege($1,'attendance_confirm_device_profile(text,text,timestamptz)','EXECUTE')",
        [role],
      ),
      false,
    );
  assert.equal(
    await scalar(
      "SELECT has_function_privilege('service_role','attendance_confirm_device_profile(text,text,timestamptz)','EXECUTE')",
    ),
    true,
  );
});

test("nightly photo migration preserves entries, applies 02:00 IST expiry and remains idempotent", async () => {
  const records = await scalar("SELECT count(*)::int FROM attendance_daily_records");
  const scans = await scalar("SELECT count(*)::int FROM attendance_scan_events");
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261009180000_attendance_photos_nightly_ist.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  for (const stamp of ["2026-10-09T00:01:00+05:30", "2026-10-09T23:59:59+05:30"]) {
    const expiry = await scalar("SELECT attendance_photo_expires_at($1::timestamptz)", [stamp]);
    assert.equal(new Date(expiry).toISOString(), "2026-10-09T20:30:00.000Z");
  }
  const midnight = await scalar("SELECT attendance_photo_expires_at('2026-10-09T18:30:00Z')");
  assert.equal(new Date(midnight).toISOString(), "2026-10-10T20:30:00.000Z");
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_daily_records"), records);
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_scan_events"), scans);
  assert.equal(await scalar("SELECT status FROM attendance_photos LIMIT 1"), "deleted");
  assert.equal(
    await scalar(
      "SELECT has_function_privilege('authenticated','attendance_ingest_scan(text,text,timestamptz,boolean)','EXECUTE')",
    ),
    false,
  );
  const stamp = await scalar(
    "SELECT scanned_at::text FROM attendance_scan_events WHERE event_id='late'",
  );
  const duplicate = await scalar(
    "SELECT attendance_ingest_scan('late','00104',$1::timestamptz,true)",
    [stamp],
  );
  assert.equal(
    new Date(duplicate.expires_at).getTime(),
    new Date(
      await scalar("SELECT attendance_photo_expires_at($1::timestamptz)", [stamp]),
    ).getTime(),
  );
});

test("directory deletion preserves evidence and rejected requests expire after 24 hours", async () => {
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261012110000_attendance_directory_cleanup.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await asUser(manager);
  const id = await scalar(
    "SELECT attendance_save_employee('Directory test','software','directory-delete',null,false,$1::date)",
    [today],
  );
  await db.query(
    "SELECT attendance_ingest_scan('directory-evidence','directory-delete',now(),true)",
  );
  const leave = await scalar(
    "SELECT attendance_create_leave($1,$2::date,$2::date,'Test request')",
    [id, today],
  );
  await db.query("SELECT attendance_review_leave($1,'rejected')", [leave]);
  let board = await scalar("SELECT attendance_board($1::date)", [today]);
  assert.ok(board.leaves.some((l) => l.id === leave));
  await db.query(
    "UPDATE attendance_leave_requests SET reviewed_at=now()-interval '24 hours' WHERE id=$1",
    [leave],
  );
  board = await scalar("SELECT attendance_board($1::date)", [today]);
  assert.ok(!board.leaves.some((l) => l.id === leave));
  assert.equal(
    await scalar("SELECT count(*)::int FROM attendance_leave_requests WHERE id=$1", [leave]),
    1,
  );
  await asUser(worker);
  await assert.rejects(
    db.query("SELECT attendance_delete_employee($1)", [id]),
    /Manager access required/,
  );
  await asUser(manager);
  await db.query("SELECT attendance_delete_employee($1)", [id]);
  board = await scalar("SELECT attendance_board($1::date)", [today]);
  assert.ok(!board.employees.some((e) => e.id === id));
  assert.ok(board.rows.some((row) => row.employee_id === id));
  const history = await scalar("SELECT attendance_history($1,$2::date)", [id, today]);
  assert.equal(history.events.length, 1);
  assert.equal(await scalar("SELECT active FROM attendance_employees WHERE id=$1", [id]), false);
  assert.equal(
    await scalar(
      "SELECT count(*)::int FROM attendance_device_commands WHERE employee_id=$1 AND status IN ('pending','publishing','published')",
      [id],
    ),
    0,
  );
  assert.equal(
    await scalar(
      "SELECT count(*)::int FROM attendance_audit_logs WHERE record_id=$1 AND action='employee_deleted'",
      [id],
    ),
    1,
  );
  await assert.rejects(
    db.query("SELECT attendance_set_active($1,true)", [id]),
    /cannot be reactivated/,
  );
  await assert.rejects(
    db.query("SELECT attendance_delete_employee($1)", [id]),
    /Employee not found/,
  );
});

test("attendance allowlist grants only verified named accounts and protects direct table reads", async () => {
  await db.exec(
    "CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz)",
  );
  await db.query(
    "INSERT INTO auth.users VALUES ($1,'other-manager@example.com',now()),($2,'patidarnit21@gmail.com',now()),('00000000-0000-4000-8000-000000000003','admin@limelightit.io',now()),('00000000-0000-4000-8000-000000000004','tarun@limelightit.io',now())",
    [manager, worker],
  );
  await db.exec(
    readFileSync(
      new URL("../supabase/migrations/20261012120000_attendance_email_access.sql", import.meta.url),
      "utf8",
    ),
  );
  await asUser(manager);
  assert.equal(await scalar("SELECT attendance_can_manage()"), false);
  await assert.rejects(
    db.query("SELECT attendance_board($1::date)", [today]),
    /Attendance access required/,
  );
  await assert.rejects(
    db.query("SELECT attendance_delete_employee($1)", [employee]),
    /Attendance access required/,
  );
  await db.exec("SET ROLE authenticated");
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_employees"), 0);
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_leave_requests"), 0);
  await db.exec("RESET ROLE");
  for (const id of [
    worker,
    "00000000-0000-4000-8000-000000000003",
    "00000000-0000-4000-8000-000000000004",
  ]) {
    await asUser(id);
    await db.exec("SET ROLE authenticated");
    assert.equal(await scalar("SELECT attendance_can_manage()"), true);
    assert.ok((await scalar("SELECT attendance_board($1::date)", [today])).employees.length > 0);
    assert.ok((await scalar("SELECT count(*)::int FROM attendance_employees")) > 0);
    await db.exec("RESET ROLE");
  }
  assert.equal(await scalar("SELECT has_role($1,'supervisor')", [worker]), false);
  await db.query("UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1", [worker]);
  await asUser(worker);
  assert.equal(await scalar("SELECT attendance_can_manage()"), false);
  await db.query(
    "UPDATE auth.users SET email='patidarnit21@gmail.com.attacker.test',email_confirmed_at=now() WHERE id=$1",
    [worker],
  );
  assert.equal(await scalar("SELECT attendance_can_manage()"), false);
  await db.query("SELECT set_config('request.jwt.claim.email','admin@limelightit.io',false)");
  assert.equal(await scalar("SELECT attendance_can_manage()"), false);
  await asUser(null);
  assert.equal(await scalar("SELECT attendance_can_manage()"), false);
});

test("admin email correction replaces the old address on already migrated projects", async () => {
  await db.exec(`CREATE OR REPLACE FUNCTION public.attendance_can_manage() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL
    AND lower(email) IN ('patidarnit21@gmail.com','admin@limelightit.com','tarun@limelightit.io')) $$`);
  const adminId = "00000000-0000-4000-8000-000000000003";
  await asUser(adminId);
  assert.equal(await scalar("SELECT attendance_can_manage()"), false);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261012130000_attendance_admin_email_correction.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(await scalar("SELECT attendance_can_manage()"), true);
  await db.query("UPDATE auth.users SET email='admin@limelightit.com' WHERE id=$1", [adminId]);
  assert.equal(await scalar("SELECT attendance_can_manage()"), false);
  await assert.rejects(
    db.query("SELECT attendance_board($1::date)", [today]),
    /Attendance access required/,
  );
});

test('office account migrations isolate new roles, preserve field signups and scope attendance to the caller', async () => {
  const office='00000000-0000-4000-8000-000000000020';
  const officeEmployee='00000000-0000-4000-8000-000000000021';
  const field='00000000-0000-4000-8000-000000000022';
  await db.exec("ALTER TABLE auth.users ADD COLUMN raw_app_meta_data jsonb DEFAULT '{}', ADD COLUMN raw_user_meta_data jsonb DEFAULT '{}'; CREATE TABLE profiles(id uuid PRIMARY KEY,name text,email text,is_active boolean);");
  await db.exec(readFileSync(new URL('../supabase/migrations/20261012140000_office_employee_role.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261012141000_attendance_employee_accounts.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261012143000_attendance_employee_profile_activation.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261012144000_attendance_link_existing_managers.sql',import.meta.url),'utf8'));
  await db.exec("CREATE FUNCTION test_signup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO profiles(id,name,email,is_active) VALUES(NEW.id,'User',NEW.email,false); INSERT INTO user_roles VALUES(NEW.id,'worker'); RETURN NEW; END $$; CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION test_signup();");
  await db.query("INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,'office@example.test',$2)",[office,JSON.stringify({office_employee:true,attendance_employee_id:officeEmployee})]);
  assert.equal(await scalar("SELECT has_role($1,'employee')",[office]),true);
  assert.equal(await scalar("SELECT has_role($1,'worker')",[office]),false);
  assert.equal(await scalar('SELECT is_active FROM profiles WHERE id=$1',[office]),true);
  await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'field@example.test',$2)",[field,JSON.stringify({office_employee:true})]);
  assert.equal(await scalar("SELECT has_role($1,'worker')",[field]),true);
  assert.equal(await scalar("SELECT has_role($1,'employee')",[field]),false);
  await asUser('00000000-0000-4000-8000-000000000004');
  await db.query("SELECT attendance_save_employee_account($1,$2,'Office','software','9901','office@example.test',true,$3::date,true)",[officeEmployee,office,today]);
  await asUser(office);
  assert.equal((await scalar('SELECT attendance_my_account()')).id,officeEmployee);
  assert.deepEqual(await scalar('SELECT attendance_my_history()'),[]);
  await assert.rejects(db.query("SELECT attendance_save_employee_account($1,$2,'Unauthorized','software','9901','office@example.test',true,$3::date,false)",[officeEmployee,office,today]),/Attendance access required/);
  await asUser(field);
  await assert.rejects(db.query('SELECT attendance_my_history()'),/Office employee access required/);
  await asUser('00000000-0000-4000-8000-000000000004');
  await assert.rejects(db.query("SELECT attendance_save_employee_account($1,$2,'Field','software','9902','field@example.test',true,$3::date,true)",['00000000-0000-4000-8000-000000000023',field,today]),/Invalid office login account/);

  const managerAccount='00000000-0000-4000-8000-000000000030';
  const managerEmployee='00000000-0000-4000-8000-000000000031';
  await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'manager@example.test',now())",[managerAccount]);
  await db.query("DELETE FROM user_roles WHERE user_id=$1",[managerAccount]);
  await db.query("INSERT INTO user_roles(user_id,role) VALUES($1,'supervisor')",[managerAccount]);
  await db.query("UPDATE profiles SET is_active=true WHERE id=$1",[managerAccount]);
  await asUser('00000000-0000-4000-8000-000000000004');
  await db.query("SELECT attendance_save_employee('Manager Office','manager','9903',NULL,false,$1::date)",[today]);
  const createdManagerEmployee=await scalar("SELECT id FROM attendance_employees WHERE enroll_id='9903'");
  await db.query("UPDATE auth.users SET raw_app_meta_data=$2 WHERE id=$1",[managerAccount,JSON.stringify({office_employee:true,attendance_employee_id:createdManagerEmployee})]);
  await db.query('SELECT attendance_link_manager_login($1,$2,$3)',[createdManagerEmployee,managerAccount,'manager@example.test']);
  assert.equal(await scalar("SELECT role::text FROM user_roles WHERE user_id=$1",[managerAccount]),'supervisor');
  await db.exec("CREATE FUNCTION public.is_staff(_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_id AND role IN ('supervisor','owner')) $$; CREATE FUNCTION public.field_ops_associate(_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM profiles WHERE id=_id AND is_active) AND has_role(_id,'worker') AND NOT is_staff(_id) $$;");
  await db.exec(readFileSync(new URL('../supabase/migrations/20261012160000_employee_leave_portal.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261012170000_leave_day_decisions.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261012180000_attendance_work_from_home.sql',import.meta.url),'utf8'));
  await asUser(managerAccount);
  assert.equal((await scalar('SELECT attendance_my_account()')).id,createdManagerEmployee);
  assert.deepEqual(await scalar('SELECT attendance_my_history()'),[]);
  await db.query("SELECT attendance_submit_my_leave($1::date,$1::date,'Other','Personal request')",[today]);
  assert.equal((await scalar('SELECT attendance_my_leave_requests()')).length,1);
  await assert.rejects(db.query("SELECT attendance_decide_employee_leave_days((attendance_my_leave_requests()->0->>'id')::uuid,$1::jsonb)",[JSON.stringify([{date:today,decision:'approved'}])]),/routed to a different approver/);
  await asUser(office);
  await db.query("SELECT attendance_submit_my_leave($1::date,$1::date,'Family medical','Family appointment')",[today]);
  assert.equal((await scalar('SELECT attendance_my_leave_requests()')).length,1);
  assert.deepEqual(await scalar("SELECT approver_emails FROM attendance_leave_requests WHERE employee_id=$1 AND status='pending'",[officeEmployee]),['tarun@limelightit.io']);
  const tarunAccount='00000000-0000-4000-8000-000000000040';
  await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'tarun@limelightit.io',now())",[tarunAccount]);
  await db.query("INSERT INTO user_roles(user_id,role) VALUES($1,'supervisor')",[tarunAccount]);
  const tarunAlias='00000000-0000-4000-8000-000000000041';
  await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'tarun@limelight.io',now())",[tarunAlias]);
  await db.query("INSERT INTO user_roles(user_id,role) VALUES($1,'supervisor')",[tarunAlias]);
  await asUser(tarunAlias);
  assert.deepEqual(await scalar('SELECT attendance_my_leave_requests()'),[]);
  assert.ok((await scalar('SELECT attendance_leave_review_queue()')).some((request)=>request.employee_id===officeEmployee));
  await assert.rejects(db.query("SELECT attendance_submit_my_leave($1::date,$1::date,'Other','Tarun alias request')",[today]),/Tarun reviewer accounts can review requests but cannot submit leave/);
  await asUser(tarunAccount);
  assert.deepEqual(await scalar('SELECT attendance_my_leave_requests()'),[]);
  await assert.rejects(db.query("SELECT attendance_submit_my_leave($1::date,$1::date,'Other','Tarun request')",[today]),/Tarun reviewer accounts can review requests but cannot submit leave/);
  const reviewQueue=await scalar('SELECT attendance_leave_review_queue()');
  const officeRequest=reviewQueue.find((request)=>request.employee_id===officeEmployee);
  assert.ok(officeRequest);
  await asUser(managerAccount);
  await assert.rejects(db.query("SELECT attendance_decide_employee_leave($1::uuid,'approved')",[officeRequest.id]),/routed to a different approver/);
  await asUser(tarunAccount);
  await db.query("SELECT attendance_decide_employee_leave_days($1::uuid,$2::jsonb,'Approved')",[officeRequest.id,JSON.stringify([{date:today,decision:'approved'}])]);
  await asUser(office);
  assert.equal((await scalar('SELECT attendance_my_leave_requests()'))[0].status,'approved');
  await db.query('UPDATE profiles SET is_active=true WHERE id=$1',[field]);
  await asUser(field);
  await db.query("SELECT attendance_submit_my_leave($1::date,$1::date,'Other','Field associate request')",[today]);
  assert.equal((await scalar('SELECT attendance_my_leave_requests()'))[0].status,'pending');
  assert.deepEqual((await scalar('SELECT attendance_my_leave_requests()'))[0].approver_emails,['associatelimelight@gmail.com','info@limelightit.io','tarun@limelightit.io']);
  await asUser(tarunAccount);
  const fieldQueue=await scalar('SELECT attendance_leave_review_queue()');
  const fieldRequest=fieldQueue.find((request)=>request.field_associate_id===field);
  assert.ok(fieldRequest);
  await db.query("SELECT attendance_decide_employee_leave_days($1::uuid,$2::jsonb)",[fieldRequest.id,JSON.stringify([{date:today,decision:'approved'}])]);
  await asUser(field);
  assert.equal((await scalar('SELECT attendance_my_leave_requests()'))[0].status,'approved');

  const splitStart = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
  const splitEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 3*86400000).toISOString().slice(0,10);
  await asUser(office);
  const splitRequest = await scalar("SELECT attendance_submit_my_leave($1::date,$2::date,'Other','Three day request')",[splitStart,splitEnd]);
  await asUser(tarunAccount);
  const splitQueue = await scalar('SELECT attendance_leave_review_queue()');
  assert.deepEqual(splitQueue.find((request)=>request.id===splitRequest).days.map((day)=>day.status),['pending','pending','pending']);
  await db.query("SELECT attendance_decide_employee_leave_days($1::uuid,$2::jsonb,'Two days approved')",[splitRequest,JSON.stringify([
    {date:splitStart,decision:'approved'},
    {date:new Date(Date.parse(`${today}T00:00:00Z`)+2*86400000).toISOString().slice(0,10),decision:'rejected'},
    {date:splitEnd,decision:'approved'},
  ])]);
  await asUser(office);
  const splitHistory = (await scalar('SELECT attendance_my_leave_requests()')).find((request)=>request.id===splitRequest);
  assert.equal(splitHistory.status,'partial');
  assert.deepEqual(splitHistory.days.map((day)=>day.status),['approved','rejected','approved']);
  await asUser(tarunAccount);
  const approvedDayBoard = await scalar('SELECT attendance_board($1::date)',[splitStart]);
  const rejectedDate = new Date(Date.parse(`${today}T00:00:00Z`)+2*86400000).toISOString().slice(0,10);
  const rejectedDayBoard = await scalar('SELECT attendance_board($1::date)',[rejectedDate]);
  assert.equal(approvedDayBoard.rows.find((row)=>row.employee_id===officeEmployee).status,'on_leave');
  assert.notEqual(rejectedDayBoard.rows.find((row)=>row.employee_id===officeEmployee).status,'on_leave');
  await asUser(office);
  await assert.rejects(db.query("SELECT attendance_submit_my_leave($1::date,$1::date,'Other','Overlap approved day')",[splitStart]),/pending or approved request already covers/);
  const retryRejectedDay = await scalar("SELECT attendance_submit_my_leave($1::date,$1::date,'Other','Retry rejected day')",[rejectedDate]);
  assert.equal((await scalar("SELECT status FROM attendance_leave_requests WHERE id=$1",[retryRejectedDay])),'pending');
  await assert.rejects(db.query("SELECT attendance_set_wfh_eligibility($1,true)",[officeEmployee]),/Only Tarun can change work-from-home eligibility/);
  await asUser(tarunAccount);
  await db.query("SELECT attendance_set_wfh_eligibility($1,true)",[officeEmployee]);
  await asUser(office);
  assert.equal(await scalar('SELECT attendance_my_wfh_eligibility()'),true);
  const wfhDate = new Date(Date.parse(`${today}T00:00:00Z`)+5*86400000).toISOString().slice(0,10);
  const wfhRequest = await scalar("SELECT attendance_submit_my_wfh($1::date,$1::date,'Remote day')",[wfhDate]);
  await asUser(tarunAccount);
  assert.ok((await scalar('SELECT attendance_leave_review_queue()')).some((request)=>request.id===wfhRequest && request.request_type==='wfh'));
  await db.query("SELECT attendance_decide_employee_leave_days($1::uuid,$2::jsonb)",[wfhRequest,JSON.stringify([{date:wfhDate,decision:'approved'}])]);
  const wfhBoard = await scalar('SELECT attendance_board($1::date)',[wfhDate]);
  assert.equal(wfhBoard.rows.find((row)=>row.employee_id===officeEmployee).status,'work_from_home');
  await db.query('UPDATE attendance_employees SET active=false WHERE id=$1',[officeEmployee]);
  await asUser(office);
  await assert.rejects(db.query('SELECT attendance_my_history()'),/inactive or not linked/);
});

test("linked software supervisors apply for their own leave and WFH without changing roles",async()=>{
  const account='00000000-0000-4000-8000-000000000050';
  const staff='00000000-0000-4000-8000-000000000051';
  const unlinked='00000000-0000-4000-8000-000000000052';
  await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'nit@example.test',now()),($2,'unlinked@example.test',now())",[account,unlinked]);
  await db.query("INSERT INTO user_roles(user_id,role) VALUES($1,'supervisor'),($2,'supervisor')",[account,unlinked]);
  const originalRoles=(await db.query('SELECT role FROM user_roles WHERE user_id=$1 ORDER BY role',[account])).rows.map(r=>r.role);
  await db.query("INSERT INTO attendance_employees(id,name,department,enroll_id,email,auth_user_id,employment_start,work_from_home_enabled,created_by) VALUES($1,'Nit','software','nit-link-test','nit@example.test',$2,$3::date,true,$2)",[staff,account,today]);
  await asUser(account);
  await assert.rejects(db.query("SELECT attendance_submit_my_leave($1::date,$1::date,'Other','Office leave test')",[today]),/Active office account is not linked/);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261013100000_linked_office_supervisor_requests.sql',import.meta.url),'utf8'));
  assert.equal((await scalar('SELECT attendance_my_account()')).id,staff);
  assert.deepEqual(await scalar('SELECT attendance_my_history()'),[]);
  const request=await scalar("SELECT attendance_submit_my_leave($1::date,$1::date,'Other','Office leave test')",[today]);
  assert.equal(await scalar('SELECT employee_id FROM attendance_leave_requests WHERE id=$1',[request]),staff);
  assert.deepEqual(await scalar('SELECT approver_emails FROM attendance_leave_requests WHERE id=$1',[request]),['tarun@limelightit.io']);
  assert.equal((await scalar('SELECT attendance_my_leave_requests()')).length,1);
  const wfhDate=new Date(Date.parse(`${today}T00:00:00Z`)+86400000).toISOString().slice(0,10);
  assert.ok(await scalar("SELECT attendance_submit_my_wfh($1::date,$1::date,'Office remote test')",[wfhDate]));
  assert.deepEqual((await db.query('SELECT role FROM user_roles WHERE user_id=$1 ORDER BY role',[account])).rows.map(r=>r.role),originalRoles);
  await asUser(unlinked);
  await assert.rejects(db.query("SELECT attendance_submit_my_leave($1::date,$1::date,'Other','Unlinked request')",[today]),/Active office account is not linked/);
  await db.query('UPDATE attendance_employees SET active=false WHERE id=$1',[staff]);
  await asUser(account);
  await assert.rejects(db.query("SELECT attendance_submit_my_leave($1::date,$1::date,'Other','Inactive request')",[today]),/Active office account is not linked/);
  await db.query("UPDATE auth.users SET email='patidarnit21@gmail.com' WHERE id=$1",[account]);
  assert.equal(await scalar('SELECT attendance_can_manage()'),true);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261013110000_nit_login_email_access.sql',import.meta.url),'utf8'));
  assert.equal(await scalar('SELECT attendance_can_manage()'),false);
  await db.query("UPDATE auth.users SET email='nitsanghani1@gmail.com' WHERE id=$1",[account]);
  assert.equal(await scalar('SELECT attendance_can_manage()'),true);
});

test('employee calendar tracks per-day leave, WFH, schedule and evidence-backed absence without exposing other employees',async()=>{
  await db.exec(readFileSync(new URL('../supabase/migrations/20261013120000_employee_attendance_calendar.sql',import.meta.url),'utf8'));
  const account='00000000-0000-4000-8000-000000000050';
  const staff='00000000-0000-4000-8000-000000000051';
  const tarun='00000000-0000-4000-8000-000000000040';
  const unlinked='00000000-0000-4000-8000-000000000052';
  await db.query("UPDATE attendance_employees SET active=true,employment_start='2026-01-01' WHERE id=$1",[staff]);
  const future=await scalar("SELECT (date_trunc('month',$1::date)+interval '1 month')::date::text",[today]);
  const monday=await scalar("SELECT d::date::text FROM generate_series($1::date::timestamp,($1::date+6)::timestamp,interval '1 day') d WHERE extract(dow FROM d)=1 LIMIT 1",[future]);
  const add=(date,n)=>new Date(Date.parse(`${date}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);
  await db.query("INSERT INTO attendance_settings(effective_from,shift_start,grace_minutes,absence_cutoff,working_days,holidays) VALUES($1::date,'10:00',15,'18:00',ARRAY[1,2,3,4,5],ARRAY[$2::date]) ON CONFLICT(effective_from) DO UPDATE SET working_days=excluded.working_days,holidays=excluded.holidays,absence_cutoff=excluded.absence_cutoff",[future,add(monday,2)]);
  await asUser(account);
  const leave=await scalar("SELECT attendance_submit_my_leave($1::date,$2::date,'Other','Calendar test leave')",[monday,add(monday,1)]);
  const wfh=await scalar("SELECT attendance_submit_my_wfh($1::date,$1::date,'Calendar test WFH')",[add(monday,3)]);
  await asUser(tarun);
  await db.query("SELECT attendance_decide_employee_leave_days($1,$2::jsonb)",[leave,JSON.stringify([{date:monday,decision:'approved'},{date:add(monday,1),decision:'rejected'}])]);
  await db.query("SELECT attendance_decide_employee_leave_days($1,$2::jsonb)",[wfh,JSON.stringify([{date:add(monday,3),decision:'approved'}])]);
  await asUser(account);
  const board=await scalar('SELECT attendance_my_calendar($1::date)',[future]);
  const day=date=>board.days.find(d=>d.date===date);
  assert.equal(day(monday).status,'on_leave');
  assert.equal(day(add(monday,1)).status,'scheduled');
  assert.equal(day(add(monday,1)).request_status,'rejected');
  assert.equal(day(add(monday,2)).status,'off_day');
  assert.equal(day(add(monday,2)).working_day,false);
  assert.equal(day(add(monday,3)).status,'work_from_home');
  await db.exec(readFileSync(new URL('../supabase/migrations/20261013130000_manager_calendar_request_decisions.sql',import.meta.url),'utf8'));
  await asUser(tarun);
  for(const date of [monday,add(monday,1),add(monday,3)]){
    const managerBoard=await scalar('SELECT attendance_board($1::date)',[date]);
    const row=managerBoard.rows.find(r=>r.employee_id===staff);
    assert.equal(row.request_status,day(date).request_status);
    assert.equal(row.request_type,day(date).request_type);
  }
  await asUser(account);
  assert.equal(day(add(monday,5)).status,'off_day');
  assert.equal(board.days.length,new Date(`${future}T12:00:00Z`).getUTCMonth()===1?28:new Date(Number(future.slice(0,4)),Number(future.slice(5,7)),0).getDate());
  await db.exec("INSERT INTO attendance_settings(effective_from,shift_start,grace_minutes,absence_cutoff,working_days,holidays) VALUES('2026-01-01','10:00',15,'18:00',ARRAY[1,2,3,4,5],ARRAY[]::date[]) ON CONFLICT(effective_from) DO UPDATE SET absence_cutoff='18:00',working_days=ARRAY[1,2,3,4,5]");
  await db.exec("INSERT INTO attendance_device_health VALUES('2026-01-05','2026-01-05T04:00:00Z','2026-01-05T13:00:00Z',false) ON CONFLICT(work_date) DO UPDATE SET gap_detected=false,last_heartbeat_at=excluded.last_heartbeat_at");
  const january=await scalar("SELECT attendance_my_calendar('2026-01-01')");
  assert.equal(january.days.find(d=>d.date==='2026-01-05').status,'absent');
  assert.equal(january.days.find(d=>d.date==='2026-01-06').status,'needs_review');
  await asUser('00000000-0000-4000-8000-000000000030');
  const another=await scalar('SELECT attendance_my_calendar($1::date)',[future]);
  assert.equal(another.days.some(d=>d.reason?.includes('Calendar test')),false);
  await asUser(unlinked);
  await assert.rejects(db.query('SELECT attendance_my_calendar($1::date)',[future]),/Active office account is not linked/);
  await asUser(null);
  await assert.rejects(db.query('SELECT attendance_my_calendar($1::date)',[future]),/Office employee access required/);
});

test('field leave calendar preserves individual decisions and isolates associates',async()=>{
 await db.exec(readFileSync(new URL('../supabase/migrations/20261013140000_field_leave_calendar.sql',import.meta.url),'utf8'));
 const associate='00000000-0000-4000-8000-000000000060';
 const other='00000000-0000-4000-8000-000000000061';
 const tarun='00000000-0000-4000-8000-000000000040';
 await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'field-calendar@example.test',now()),($2,'field-other@example.test',now())",[associate,other]);
 await db.query('UPDATE profiles SET is_active=true WHERE id=ANY($1::uuid[])',[[associate,other]]);
 const tomorrow=new Date(Date.parse(`${today}T00:00:00Z`)+86400000).toISOString().slice(0,10);
 await asUser(associate);
 const request=await scalar("SELECT attendance_submit_my_leave($1::date,$2::date,'Other','Field calendar test')",[today,tomorrow]);
 assert.equal((await scalar('SELECT field_ops_leave_calendar($1,$2::date)',[associate,today]))[0].request_status,'pending');
 await asUser(tarun);
 await db.query('SELECT attendance_decide_employee_leave_days($1,$2::jsonb)',[request,JSON.stringify([{date:today,decision:'approved'},{date:tomorrow,decision:'rejected'}])]);
 const manager=await scalar('SELECT field_ops_leave_calendar($1,$2::date)',[associate,today]);
 await asUser(associate);
 const own=await scalar('SELECT field_ops_leave_calendar($1,$2::date)',[associate,today]);
 assert.deepEqual(own,manager);
 assert.equal(own.find(day=>day.date===today).request_status,'approved');
 if(tomorrow.slice(0,7)===today.slice(0,7))assert.equal(own.find(day=>day.date===tomorrow).request_status,'rejected');
 assert.ok((await scalar('SELECT field_ops_leave_calendar($1,$2::date)',[associate,tomorrow])).some(day=>day.date===tomorrow&&day.request_status==='rejected'));
 await asUser(other);
 assert.deepEqual(await scalar('SELECT field_ops_leave_calendar($1,$2::date)',[other,today]),[]);
 await assert.rejects(db.query('SELECT field_ops_leave_calendar($1,$2::date)',[associate,today]),/Access denied/);
 await asUser(null);
 await assert.rejects(db.query('SELECT field_ops_leave_calendar($1,$2::date)',[associate,today]),/Access denied/);
});

test('Hardik cannot review leave through routed or legacy APIs and retains attendance access', async () => {
  await db.exec(readFileSync(new URL('../supabase/migrations/20261013150000_remove_hardik_leave_access.sql', import.meta.url), 'utf8'));
  const hardik = '00000000-0000-4000-8000-000000000003';
  const tarun = '00000000-0000-4000-8000-000000000004';
  await db.query("UPDATE auth.users SET email='admin@limelightit.io',email_confirmed_at=now() WHERE id=$1", [hardik]);
  await db.query("INSERT INTO user_roles(user_id,role) SELECT $1,'supervisor' WHERE NOT EXISTS(SELECT 1 FROM user_roles WHERE user_id=$1 AND role='supervisor')", [hardik]);
  const date = await scalar("SELECT ($1::date + 1000)::text", [today]);
  const routed = await scalar(`INSERT INTO attendance_leave_requests(employee_id,start_date,end_date,reason,source,approver_emails)
    VALUES($1,$2::date,$2::date,'Hardik permission regression','manual',ARRAY['admin@limelightit.io','tarun@limelightit.io']) RETURNING id`, [employee, date]);
  await db.query('INSERT INTO attendance_leave_request_days(request_id,leave_date) VALUES($1,$2::date)', [routed, date]);
  const legacy = await scalar(`INSERT INTO attendance_leave_requests(employee_id,start_date,end_date,reason,source)
    VALUES($1,$2::date,$2::date,'Legacy permission regression','manual') RETURNING id`, [employee, date]);

  await asUser(hardik);
  assert.equal(await scalar("SELECT has_role(auth.uid(),'supervisor')"), true);
  assert.equal(await scalar('SELECT attendance_can_manage()'), true);
  assert.equal(await scalar('SELECT attendance_can_review_leave()'), false);
  await assert.rejects(db.query('SELECT attendance_leave_review_queue()'), /Manager access required/);
  for (const decision of ['approved', 'rejected']) {
    await assert.rejects(db.query('SELECT attendance_decide_employee_leave_days($1,$2::jsonb)', [routed, JSON.stringify([{date, decision}])]), /Manager access required/);
    await assert.rejects(db.query('SELECT attendance_decide_employee_leave($1,$2)', [routed, decision]), /Manager access required/);
    await assert.rejects(db.query('SELECT attendance_review_leave($1,$2)', [legacy, decision]), /Leave review access required/);
  }
  assert.equal(await scalar('SELECT status FROM attendance_leave_requests WHERE id=$1', [routed]), 'pending');
  assert.equal(await scalar('SELECT status FROM attendance_leave_request_days WHERE request_id=$1', [routed]), 'pending');
  assert.equal(await scalar('SELECT status FROM attendance_leave_requests WHERE id=$1', [legacy]), 'pending');

  await asUser(tarun);
  assert.equal(await scalar('SELECT attendance_can_review_leave()'), true);
  assert.ok((await scalar('SELECT attendance_leave_review_queue()')).some(request => request.id === routed));
  await db.query('SELECT attendance_decide_employee_leave_days($1,$2::jsonb)', [routed, JSON.stringify([{date, decision:'approved'}])]);
  await db.query("SELECT attendance_review_leave($1,'rejected')", [legacy]);
  assert.equal(await scalar('SELECT status FROM attendance_leave_requests WHERE id=$1', [routed]), 'approved');
  assert.equal(await scalar('SELECT status FROM attendance_leave_requests WHERE id=$1', [legacy]), 'rejected');
  await asUser(null);
  assert.equal(await scalar('SELECT attendance_can_review_leave()'), false);
});

test("full-day absence agrees across manager and employee calendars and preserves scan, leave and access rules", async () => {
  const migration = readFileSync(new URL(
    "../supabase/migrations/20261014100000_attendance_full_working_day_absence.sql", import.meta.url,
  ), "utf8");
  await db.exec(migration);
  await db.exec(migration); // Reapplying the policy must preserve records and permissions.
  await db.exec("BEGIN");
  try {
    const account = "00000000-0000-4000-8000-000000000070";
    const staff = "00000000-0000-4000-8000-000000000071";
    const tarun = "00000000-0000-4000-8000-000000000040";
    const yesterday = await scalar("SELECT ($1::date-1)::text", [today]);
    const tomorrow = await scalar("SELECT ($1::date+1)::text", [today]);
    await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'full-day@example.test',now())", [account]);
    await db.query("INSERT INTO user_roles(user_id,role) VALUES($1,'employee')", [account]);
    await db.query(`INSERT INTO attendance_employees(id,name,department,enroll_id,auth_user_id,employment_start,created_by)
      VALUES($1,'Full day','software','full-day',$2,$3::date-2,$2)`, [staff, account, today]);
    await db.exec("DELETE FROM attendance_settings");
    await db.exec(`INSERT INTO attendance_settings(effective_from,shift_start,grace_minutes,absence_cutoff,working_days)
      VALUES('2000-01-01','10:00',15,'18:00',ARRAY[0,1,2,3,4,5,6])`);

    const managerRow = async (date) => {
      await asUser(tarun);
      return (await scalar("SELECT attendance_board($1::date)", [date])).rows.find(r => r.employee_id === staff);
    };
    const employeeDay = async (date) => {
      await asUser(account);
      return (await scalar("SELECT attendance_my_calendar($1::date)", [date])).days.find(d => d.date === date);
    };
    const checkStatus = async (date, expected) => {
      assert.equal((await managerRow(date)).status, expected);
      assert.equal((await employeeDay(date)).status, expected);
    };

    // Entire current IST day stays open, even with an old cutoff and no heartbeats.
    await checkStatus(today, "awaiting_scan");
    assert.equal((await managerRow(tomorrow)).status, "awaiting_scan");
    assert.equal((await employeeDay(tomorrow)).status, "scheduled");
    await db.query("DELETE FROM attendance_device_health WHERE work_date=$1::date", [yesterday]);
    await checkStatus(yesterday, "absent");
    await db.query(`INSERT INTO attendance_device_health VALUES($1::date,$1::date::timestamptz,$1::date::timestamptz,true)`, [yesterday]);
    await checkStatus(yesterday, "absent");

    // A failed face match is evidence for review, but does not establish attendance.
    await scalar("SELECT attendance_ingest_scan('full-day-failed','full-day',$1::timestamptz,false)", [`${yesterday}T10:30:00+05:30`]);
    await checkStatus(yesterday, "absent");
    await asUser(tarun);
    assert.ok((await scalar("SELECT attendance_board($1::date)", [yesterday])).review_events.some(e => e.event_id === "full-day-failed"));

    // A valid scan at the very end of the date is still late, never absent.
    await scalar("SELECT attendance_ingest_scan('full-day-late','full-day',$1::timestamptz,true)", [`${yesterday}T23:59:00+05:30`]);
    await checkStatus(yesterday, "late");
    assert.equal((await managerRow(yesterday)).late_minutes, 824);
    assert.equal((await employeeDay(yesterday)).late_minutes, 824);
    await scalar("SELECT attendance_ingest_scan('full-day-earlier','full-day',$1::timestamptz,true)", [`${yesterday}T10:30:00+05:30`]);
    await checkStatus(yesterday, "late");
    assert.equal((await managerRow(yesterday)).late_minutes, 15);

    // Scan-on-leave conflicts still need review; approved WFH preserves a real scan.
    const request = await scalar(`INSERT INTO attendance_leave_requests(employee_id,start_date,end_date,reason,source,status,request_type)
      VALUES($1,$2::date,$2::date,'Full-day regression','manual','approved','leave') RETURNING id`, [staff, yesterday]);
    await checkStatus(yesterday, "needs_review");
    await db.query("UPDATE attendance_leave_requests SET request_type='wfh' WHERE id=$1", [request]);
    await checkStatus(yesterday, "late");
    await db.query("UPDATE attendance_daily_records SET late_minutes=NULL WHERE employee_id=$1", [staff]);
    await checkStatus(yesterday, "needs_review");
    await db.query("DELETE FROM attendance_daily_records WHERE employee_id=$1", [staff]);
    await checkStatus(yesterday, "work_from_home");
    await db.query("UPDATE attendance_leave_requests SET request_type='leave' WHERE id=$1", [request]);
    await checkStatus(yesterday, "on_leave");
    await db.query("DELETE FROM attendance_leave_requests WHERE id=$1", [request]);

    await db.query("UPDATE attendance_settings SET holidays=ARRAY[$1::date]", [yesterday]);
    await checkStatus(yesterday, "off_day");
    await db.query("UPDATE attendance_settings SET holidays='{}',working_days=ARRAY[(extract(dow FROM $1::date)::integer+1)%7]", [yesterday]);
    await checkStatus(yesterday, "off_day");
    await db.exec("UPDATE attendance_settings SET working_days=ARRAY[0,1,2,3,4,5,6]");

    await asUser(tarun);
    await db.query("SELECT attendance_save_settings('10:00',15,NULL,ARRAY[1,2,3,4,5],'{}')");
    const saved = await scalar("SELECT attendance_board($1::date)", [today]);
    assert.equal(saved.settings.absence_cutoff, null);
    assert.deepEqual(saved.settings.working_days, [1,2,3,4,5]);
    await db.query("SELECT attendance_save_settings('10:00',15,'09:00',ARRAY[0,1,2,3,4,5,6],'{}')");
    assert.equal((await scalar("SELECT attendance_board($1::date)", [today])).settings.absence_cutoff, null);
    await checkStatus(today, "awaiting_scan");
    await db.exec("SAVEPOINT denied_settings");
    await assert.rejects(db.query("SELECT attendance_save_settings('10:00',15,NULL,ARRAY[1],'{}')"), /Attendance access required/);
    await db.exec("ROLLBACK TO SAVEPOINT denied_settings");
    await db.exec("SAVEPOINT denied_board");
    await assert.rejects(db.query("SELECT attendance_board($1::date)", [today]), /Attendance access required/);
    await db.exec("ROLLBACK TO SAVEPOINT denied_board");

    await db.exec("DELETE FROM attendance_settings");
    assert.equal((await managerRow(yesterday)).status, "needs_review");
    assert.equal((await employeeDay(yesterday)).status, "not_configured");
    for (const role of ["anon", "authenticated"]) {
      assert.equal(await scalar("SELECT has_function_privilege($1,'attendance_ingest_scan(text,text,timestamptz,boolean)','EXECUTE')", [role]), false);
    }
    assert.equal(await scalar("SELECT has_function_privilege('anon','attendance_board(date)','EXECUTE')"), false);
    assert.equal(await scalar("SELECT has_function_privilege('anon','attendance_my_calendar(date)','EXECUTE')"), false);
  } finally {
    await db.exec("ROLLBACK");
  }
});
