import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const manager = "00000000-0000-4000-8000-000000000001";
const account = "00000000-0000-4000-8000-000000000002";
let employee, date;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const user = (id) => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TYPE public.app_role AS ENUM ('worker','supervisor','employee');
    CREATE TABLE user_roles(user_id uuid,role app_role);
    CREATE FUNCTION has_role(_id uuid,_role app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_id AND role=_role) $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    INSERT INTO user_roles VALUES('${manager}','supervisor'),('${account}','employee');`);
  await db.exec(migration("20261006150000_manager_device_attendance"));
  await db.exec(migration("20261009180000_attendance_photos_nightly_ist"));
  await db.exec(`ALTER TABLE attendance_employees ADD COLUMN deleted_at timestamptz, ADD COLUMN auth_user_id uuid;
    ALTER TABLE attendance_leave_requests ADD COLUMN request_type text DEFAULT 'leave';
    CREATE TABLE attendance_leave_request_days(request_id uuid,leave_date date,status text);
    CREATE FUNCTION finance_assert() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM attendance_assert_manager(); END $$;`);
  await db.exec(migration("20261014100000_attendance_full_working_day_absence"));
  const finance = migration("20261016120000_salary_expenses");
  await db.exec(finance.slice(finance.indexOf("CREATE FUNCTION public.finance_calendar("), finance.indexOf("CREATE FUNCTION public.salary_save(")));
  await db.exec(migration("20261029120000_attendance_time_confidence"));
  await user(manager);
  date = await scalar("SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date-1)::text");
  await db.exec("UPDATE attendance_settings SET effective_from='2000-01-01'");
  employee = await scalar("SELECT attendance_save_employee('Clock test','software','clock',NULL,false,'2000-01-01')");
  await db.query("UPDATE attendance_employees SET auth_user_id=$1 WHERE id=$2", [account, employee]);
});
after(() => db.close());
test("off-day migration corrects historical Sunday and holiday arrivals without changing scan evidence", async () => {
  await db.exec("BEGIN");
  try {
    await db.exec(migration("20261029140000_attendance_manager_day_adjustments").replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, ""));
    await user(manager);
    const sunday = await scalar("SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date-extract(dow FROM now() AT TIME ZONE 'Asia/Kolkata')::int-7)::text");
    const monday = await scalar("SELECT ($1::date+1)::text", [sunday]);
    const holiday = await scalar("SELECT ($1::date+2)::text", [sunday]);
    await db.query("UPDATE attendance_settings SET working_days=ARRAY[1,2,3,4,5,6],holidays=ARRAY[$1::date]", [holiday]);
    for (const day of [sunday, monday, holiday]) await ingest(`off-day-${day}`, `${day}T19:01:07+05:30`, "receiver_live");
    assert.equal((await scalar("SELECT attendance_board($1::date)", [sunday])).rows[0].status, "late");
    const evidence = await scalar("SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM attendance_scan_events s");
    const daily = await scalar("SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM attendance_daily_records r");

    await db.exec(migration("20261031120000_attendance_off_day_classification").replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, ""));
    for (const day of [sunday, holiday]) {
      const row = (await scalar("SELECT attendance_board($1::date)", [day])).rows[0];
      assert.equal(row.status, "off_day");
      assert.equal(row.late_minutes, null);
      assert.ok(row.entry_at);
      await user(account);
      const employeeDay = (await scalar("SELECT attendance_my_calendar($1::date)", [day])).days.find((r) => r.date === day);
      assert.equal(employeeDay.status, "off_day");
      assert.equal(employeeDay.working_day, false);
      assert.equal(employeeDay.late_minutes, null);
      await user(manager);
    }
    assert.equal((await scalar("SELECT attendance_board($1::date)", [monday])).rows[0].status, "late");
    assert.deepEqual(await scalar("SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM attendance_scan_events s"), evidence);
    assert.deepEqual(await scalar("SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM attendance_daily_records r"), daily);

    await ingest("off-day-uncertain", `${sunday}T19:02:00+05:30`);
    assert.equal((await scalar("SELECT attendance_board($1::date)", [sunday])).rows[0].status, "needs_review");
    await db.query("SELECT attendance_adjust_day($1,$2::date,$3::timestamptz,'Administrative adjustment preserves Sunday policy')", [employee, sunday, `${sunday}T10:00:00+05:30`]);
    const adjusted = (await scalar("SELECT attendance_board($1::date)", [sunday])).rows[0];
    assert.equal(adjusted.status, "off_day");
    assert.equal(adjusted.entry_source, "manager_adjusted");
    assert.equal(adjusted.late_minutes, null);
    for (const signature of ["attendance_board_before_time_guard(date)", "attendance_my_calendar_before_time_guard(date)"]) {
      assert.equal(await scalar("SELECT has_function_privilege('authenticated',$1,'EXECUTE')", [signature]), false);
    }
    await user(account);
    await db.exec("SAVEPOINT denied_board");
    await assert.rejects(db.query("SELECT attendance_board($1::date)", [sunday]), /Manager access required/);
    await db.exec("ROLLBACK TO SAVEPOINT denied_board");
  } finally { await db.exec("ROLLBACK"); }
});
test("manager day adjustment preserves raw scans, waives lateness and survives subsequent scans", async () => {
  await db.exec("BEGIN");
  try {
    await db.exec(migration("20261029140000_attendance_manager_day_adjustments").replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, ""));
    await user(manager);
    const day = await scalar("SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date-2)::text");
    await ingest("administrative-day", `${day}T11:00:00+05:30`);
    const before = await scalar("SELECT to_jsonb(s) FROM attendance_scan_events s WHERE event_id='administrative-day'");
    await user(account);
    await db.exec("SAVEPOINT denied_adjustment");
    await assert.rejects(db.query("SELECT attendance_adjust_day($1,$2::date,$3::timestamptz,'User requested outage adjustment')", [employee, day, `${day}T10:20:00+05:30`]), /Manager access required/);
    await db.exec("ROLLBACK TO SAVEPOINT denied_adjustment");
    await user(manager);
    await db.query("SELECT attendance_adjust_day($1,$2::date,$3::timestamptz,'User requested outage adjustment; assigned time is not a verified scan time')", [employee, day, `${day}T10:20:00+05:30`]);
    assert.deepEqual(await scalar("SELECT to_jsonb(s) FROM attendance_scan_events s WHERE event_id='administrative-day'"), before);
    let row = (await scalar("SELECT attendance_board($1::date)", [day])).rows[0];
    assert.equal(row.status, "present"); assert.equal(row.late_minutes, 0); assert.equal(row.entry_source, "manager_adjusted");
    await ingest("administrative-later-replay", `${day}T09:00:00+05:30`, "receiver_live");
    row = (await scalar("SELECT attendance_board($1::date)", [day])).rows[0];
    assert.equal(new Date(row.entry_at).toISOString(), new Date(`${day}T10:20:00+05:30`).toISOString());
    const finance = await scalar("SELECT finance_calendar($1,$2::date)", [employee, day]);
    assert.equal(finance.find((r) => r.date === day).automatic_units, 1);
  } finally { await db.exec("ROLLBACK"); }
});
const ingest = (id, time, source = "unverified") => scalar(
  "SELECT attendance_ingest_scan_v2($1,'clock',$2::timestamptz,true,$2::timestamptz,'2000-01-01 10:00:00',$3,$4)",
  [id, time, source, source === "unverified" ? "delayed_or_clock_changed" : null],
);
test("uncertain scans create review evidence without a fake daily entry or salary deduction", async () => {
  const event = await ingest("uncertain", `${date}T11:30:00+05:30`);
  assert.equal(event.state, "time_unverified");
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_daily_records"), 0);
  const board = await scalar("SELECT attendance_board($1::date)", [date]);
  assert.equal(board.rows[0].status, "needs_review");
  assert.equal(board.rows[0].entry_at, null);
  assert.equal(board.rows[0].late_minutes, null);
  assert.equal(board.review_events[0].device_time_raw, "2000-01-01 10:00:00");
  await user(account);
  const calendar = await scalar("SELECT attendance_my_calendar($1::date)", [date]);
  assert.equal(calendar.days.find((day) => day.date === date).status, "needs_review");
  await user(manager);
  const finance = await scalar("SELECT finance_calendar($1,$2::date)", [employee, date]);
  assert.equal(finance.find((day) => day.date === date).units, null);
  assert.equal(finance.find((day) => day.date === date).automatic_units, null);
});
test("replayed events preserve their original timestamp and confidence even after receiver restart", async () => {
  const first = await ingest("retry", `${date}T10:00:00+05:30`, "receiver_live");
  const duplicate = await ingest("retry", `${date}T12:00:00+05:30`);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.state, "valid");
  assert.equal(await scalar("SELECT time_source FROM attendance_scan_events WHERE id=$1", [first.id]), "receiver_live");
  assert.equal(await scalar("SELECT late_minutes FROM attendance_daily_records"), 0);
  // The unresolved old record may predate the live scan, so the day stays under review.
  assert.equal((await scalar("SELECT attendance_board($1::date)", [date])).rows[0].status, "needs_review");
});
test("verified correction requires manager access and evidence, preserves receipt, and recalculates entry", async () => {
  const id = await scalar("SELECT id FROM attendance_scan_events WHERE event_id='uncertain'");
  await user(account);
  await assert.rejects(db.query("SELECT attendance_resolve_scan_time($1,$2::timestamptz,'Verified device history')", [id, `${date}T09:55:00+05:30`]), /Manager access required/);
  await user(manager);
  await assert.rejects(db.query("SELECT attendance_resolve_scan_time($1,$2::timestamptz,'guess')", [id, `${date}T09:55:00+05:30`]), /supporting evidence required/);
  await db.query("SELECT attendance_resolve_scan_time($1,$2::timestamptz,'Verified against independent device history')", [id, `${date}T09:55:00+05:30`]);
  const scan = (await db.query("SELECT * FROM attendance_scan_events WHERE id=$1", [id])).rows[0];
  assert.equal(scan.time_source, "manager_verified");
  assert.equal(scan.device_time_raw, "2000-01-01 10:00:00");
  assert.equal(new Date(scan.receiver_received_at).toISOString(), new Date(`${date}T11:30:00+05:30`).toISOString());
  const row = (await scalar("SELECT attendance_board($1::date)", [date])).rows[0];
  assert.equal(row.status, "present"); assert.equal(row.late_minutes, 0);
  assert.equal(new Date(row.entry_at).toISOString(), new Date(`${date}T09:55:00+05:30`).toISOString());
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_audit_logs WHERE action='scan_time_verified'"), 1);
});
test("health observations are durable, deduplicated and cannot bypass ingestion access controls", async () => {
  const id = "00000000-0000-4000-8000-000000000010";
  for (let i = 0; i < 2; i++) await db.query("SELECT attendance_record_receiver_health($1,'mqtt',false,'connection_closed',now())", [id]);
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_receiver_health_events"), 1);
  const board = await scalar("SELECT attendance_board($1::date)", [date]);
  assert.equal(board.device.connection_health.mqtt.healthy, false);
  for (const role of ["anon", "authenticated"]) {
    for (const signature of ["attendance_ingest_scan_v2(text,text,timestamptz,boolean,timestamptz,text,text,text)",
      "attendance_record_receiver_health(uuid,text,boolean,text,timestamptz)", "attendance_board_before_time_guard(date)",
      "attendance_my_calendar_before_time_guard(date)", "finance_calendar_before_time_guard(uuid,date,jsonb)"]) {
      assert.equal(await scalar("SELECT has_function_privilege($1,$2,'EXECUTE')", [role, signature]), false);
    }
  }
});
test("specific legacy outage records can be quarantined with an audit trail and corrected across dates", async () => {
  await user(manager);
  const nextDate = await scalar("SELECT ($1::date+1)::text", [date]);
  const stamp = await scalar("SELECT now()-interval '1 minute'");
  const legacy = await scalar("SELECT attendance_ingest_scan('legacy-recovery','clock',$1::timestamptz,true)", [stamp]);
  const oldDaily = await scalar("SELECT to_jsonb(r) FROM attendance_daily_records r WHERE employee_id=$1 AND work_date=$2::date", [employee, nextDate]);
  assert.equal(await scalar("SELECT attendance_flag_outage_scans(ARRAY[$1::uuid],'User-reported outage and clustered recovery receipts')", [legacy.id]), 1);
  assert.equal(await scalar("SELECT attendance_flag_outage_scans(ARRAY[$1::uuid],'User-reported outage and clustered recovery receipts')", [legacy.id]), 0);
  assert.equal((await scalar("SELECT attendance_board($1::date)", [nextDate])).rows[0].status, "needs_review");
  assert.equal(await scalar("SELECT late_minutes FROM attendance_daily_records WHERE id=$1", [oldDaily.id]), null);
  const audit = await scalar("SELECT details FROM attendance_audit_logs WHERE action='outage_scan_flagged'");
  assert.equal(audit.before_daily.entry_at, oldDaily.entry_at);
  assert.equal(audit.before_scan.validation_state, "valid");
  // Independent evidence places this scan on yesterday, not on its upload day.
  await db.query("SELECT attendance_resolve_scan_time($1,$2::timestamptz,'Verified independent dated device record')", [legacy.id, `${date}T09:50:00+05:30`]);
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_daily_records WHERE work_date=$1::date", [nextDate]), 0);
  const corrected = (await scalar("SELECT attendance_board($1::date)", [date])).rows[0];
  assert.equal(corrected.status, "present");
  assert.equal(new Date(corrected.entry_at).toISOString(), new Date(`${date}T09:50:00+05:30`).toISOString());
});
