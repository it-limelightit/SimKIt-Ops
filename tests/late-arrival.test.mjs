import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const source = readFileSync(new URL("../src/lib/leave-request.ts", import.meta.url), "utf8");
const { prepareLeaveSubmission, lateArrivalClosed } = await import(
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString("base64")}`
);
const input = {
  requestType: "late",
  from: "2026-10-23",
  to: "",
  expectedArrival: "11:30",
  category: "Transport delay",
  description: "",
  halfDay: false,
};
test("arrival deadline uses 8 AM IST, allows the exact boundary, and rejects one millisecond later", () => {
  for (const instant of ["2026-10-23T02:29:59Z", "2026-10-23T02:30:00Z"]) {
    assert.equal(lateArrivalClosed(input.from, new Date(instant)), false);
    assert.equal(
      prepareLeaveSubmission(input, input.from, new Date(instant)).name,
      "attendance_submit_my_late_request",
    );
  }
  assert.equal(lateArrivalClosed(input.from, new Date("2026-10-23T02:30:00.001Z")), true);
  assert.throws(
    () => prepareLeaveSubmission(input, input.from, new Date("2026-10-23T02:30:00.001Z")),
    /deadline is 8:00 AM IST/,
  );
  assert.equal(
    prepareLeaveSubmission(input, "2026-10-22", new Date("2026-10-22T18:00:00Z")).args._date,
    input.from,
  );
});
test("late and half-day requests require a valid arrival time and reason, with custom details for Other", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  assert.equal(
    prepareLeaveSubmission({ ...input, halfDay: true }, "2026-10-22", now).args._half_day,
    true,
  );
  assert.equal(
    prepareLeaveSubmission(input, "2026-10-22", now).args._description,
    "Transport delay",
  );
  for (const expectedArrival of ["", "10:00", "09:30", "24:00", "11:75"])
    assert.throws(
      () => prepareLeaveSubmission({ ...input, expectedArrival }, "2026-10-22", now),
      /arrival time/,
    );
  assert.throws(
    () => prepareLeaveSubmission({ ...input, category: "Other" }, "2026-10-22", now),
    /reason between/,
  );
  assert.throws(
    () => prepareLeaveSubmission({ ...input, from: "2026-02-30" }, "2026-10-22", now),
    /arrival date/,
  );
});

const db = new PGlite();
const ids = {
  staff: "00000000-0000-4000-8000-000000000001",
  kuldeep: "00000000-0000-4000-8000-000000000002",
  tarun: "00000000-0000-4000-8000-000000000003",
  raghav: "00000000-0000-4000-8000-000000000004",
  hardik: "00000000-0000-4000-8000-000000000005",
  field: "00000000-0000-4000-8000-000000000006",
};
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const as = (id) => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
let tomorrow;
before(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz DEFAULT now());
    CREATE TABLE profiles(id uuid PRIMARY KEY,name text,is_active boolean DEFAULT true);
    CREATE TABLE attendance_employees(id uuid PRIMARY KEY,auth_user_id uuid,name text,department text,active boolean DEFAULT true,deleted_at timestamptz);
    CREATE TABLE hr_employees(auth_user_id uuid,mentor_name text,status text DEFAULT 'active');
    CREATE TABLE attendance_audit_logs(actor_id uuid,action text,record_id uuid,details jsonb);
    CREATE FUNCTION has_role(_user uuid,_role text) RETURNS boolean LANGUAGE sql AS $$ SELECT _role='employee' AND _user<>'${ids.field}'::uuid $$;
    CREATE FUNCTION field_ops_associate(_user uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT _user='${ids.field}'::uuid $$;
    INSERT INTO auth.users(id,email) VALUES ('${ids.staff}','mayankk.limelightit@gmail.com'),('${ids.kuldeep}','kuldeepshrimali.limelight@gmail.com'),('${ids.tarun}','tarun@limelightit.io'),('${ids.raghav}','info@limelightit.io'),('${ids.hardik}','admin@limelightit.io'),('${ids.field}','field@example.com');
    INSERT INTO profiles SELECT id,split_part(email,'@',1),true FROM auth.users;
    INSERT INTO attendance_employees(id,auth_user_id,name,department) SELECT id,id,split_part(email,'@',1),'firmware' FROM auth.users WHERE id<>'${ids.field}';
  `);
  const access = readFileSync(
    new URL(
      "../supabase/migrations/20261013150000_remove_hardik_leave_access.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(
    access.match(
      /CREATE OR REPLACE FUNCTION public\.attendance_can_review_leave\(\)[\s\S]*?\$\$;/,
    )[0],
  );
  await db.exec(
    readFileSync(
      new URL("../supabase/migrations/20261022160000_late_arrival_requests.sql", import.meta.url),
      "utf8",
    ),
  );
  tomorrow = await scalar("SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date+1)::text");
});
after(() => db.close());
const submit = (date = tomorrow, half = false) =>
  scalar("SELECT attendance_submit_my_late_request($1,$2,$3,$4,$5)", [
    date,
    "11:30",
    "Transport delay",
    "The bus was delayed",
    half,
  ]);
test("server routes pending arrival requests to the respective manager and Tarun, never auto-approves", async () => {
  await as(ids.staff);
  const request = await submit();
  const own = await scalar("SELECT attendance_late_requests(false)");
  assert.equal(own[0].status, "pending");
  assert.equal(own[0].expected_arrival, "11:30:00");
  assert.deepEqual(
    own[0].approver_emails.sort(),
    ["kuldeepshrimali.limelight@gmail.com", "tarun@limelightit.io"].sort(),
  );
  await assert.rejects(submit(), /already exists/);
  await assert.rejects(scalar("SELECT attendance_late_requests(true)"), /review access/);
  await as(ids.raghav);
  assert.deepEqual(await scalar("SELECT attendance_late_requests(true)"), []);
  await assert.rejects(
    db.query("SELECT attendance_decide_late_request($1,$2)", [request, "approved"]),
    /different approver/,
  );
  await as(ids.kuldeep);
  assert.equal((await scalar("SELECT attendance_late_requests(true)"))[0].id, request);
  await db.query("SELECT attendance_decide_late_request($1,$2)", [request, "approved"]);
  await as(ids.tarun);
  assert.deepEqual(await scalar("SELECT attendance_late_requests(true)"), []);
  await assert.rejects(
    db.query("SELECT attendance_decide_late_request($1,$2)", [request, "rejected"]),
    /no longer pending/,
  );
  await as(ids.staff);
  assert.equal((await scalar("SELECT attendance_late_requests(false)"))[0].status, "approved");
});
test("saved reporting manager overrides team defaults and can reject; applicant cannot decide own request", async () => {
  await db.query("INSERT INTO hr_employees(auth_user_id,mentor_name) VALUES($1,$2)", [
    ids.kuldeep,
    "Tarun Purohit",
  ]);
  await as(ids.kuldeep);
  const request = await submit(tomorrow, true);
  await assert.rejects(
    db.query("SELECT attendance_decide_late_request($1,$2)", [request, "approved"]),
    /different approver/,
  );
  await as(ids.tarun);
  const pending = await scalar("SELECT attendance_late_requests(true)");
  assert.equal(pending[0].is_half_day, true);
  await db.query("SELECT attendance_decide_late_request($1,$2)", [request, "rejected"]);
  await as(ids.kuldeep);
  assert.equal((await scalar("SELECT attendance_late_requests(false)"))[0].status, "rejected");
});
test("database rejects submissions after 8 AM IST even when the client bypasses validation", async () => {
  const base = [
    ids.field,
    "2027-01-02",
    "11:00",
    "Other",
    "Custom explanation",
    ["tarun@limelightit.io"],
  ];
  for (const time of ["2027-01-02T02:29:59Z", "2027-01-02T02:30:00Z"])
    await db.query(
      "INSERT INTO attendance_late_requests(owner_id,arrival_date,expected_arrival,category,reason,approver_emails,created_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,'rejected')",
      [...base, time],
    );
  await assert.rejects(
    db.query(
      "INSERT INTO attendance_late_requests(owner_id,arrival_date,expected_arrival,category,reason,approver_emails,created_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,'rejected')",
      [...base, "2027-01-02T02:30:00.001Z"],
    ),
    /late_request_before_deadline/,
  );
  await as(ids.field);
  const localTime = await scalar(
    "SELECT (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::time > time '08:00'",
  );
  if (localTime) {
    const today = await scalar(
      "SELECT (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date::text",
    );
    await assert.rejects(submit(today), /deadline is 8:00 AM IST/);
  }
  await as(ids.hardik);
  await assert.rejects(submit(), /Active employee account/);
  await db.exec("SET ROLE authenticated");
  await assert.rejects(db.query("SELECT * FROM attendance_late_requests"), /permission denied/);
  await db.exec("RESET ROLE");
});
