import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/finance.ts", import.meta.url), "utf8").replace(
  'import { supabase } from "@/integrations/supabase/client";',
  "const supabase = {};",
);
const { settlementDates, canReapply, salaryTotals, validateExpenseFile, canManageFinance } =
  await import(
    `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`
  );
const db = new PGlite();
const hardik = "00000000-0000-4000-8000-000000000001",
  tarun = "00000000-0000-4000-8000-000000000002",
  staff = "00000000-0000-4000-8000-000000000003",
  other = "00000000-0000-4000-8000-000000000004",
  associate = "00000000-0000-4000-8000-000000000005";
const employee = "00000000-0000-4000-8000-000000000006";
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const as = async (id) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
const claim = async (title = "Travel") =>
  scalar("select expense_save(null,0,current_date,$1,'travel',500,'Site visit','{}')", [title]);
const revision = async (id) => scalar("select revision from expense_claims where id=$1", [id]);
const action = async (id, what, reason = null) =>
  db.query("select expense_action($1,$2,$3,$4)", [id, await revision(id), what, reason]);
let salaryId;
before(async () => {
  await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
 CREATE TABLE profiles(id uuid PRIMARY KEY,name text,is_active boolean DEFAULT true);
 CREATE TABLE user_roles(user_id uuid,role text);
 CREATE FUNCTION has_role(_id uuid,_role text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_id AND role=_role) $$;
 CREATE FUNCTION is_staff(_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT has_role(_id,'supervisor') OR has_role(_id,'employee') $$;
 CREATE TABLE attendance_employees(id uuid PRIMARY KEY,name text,email text,auth_user_id uuid,active boolean DEFAULT true,deleted_at timestamptz,employment_start date);
 CREATE TABLE attendance_settings(effective_from date PRIMARY KEY,working_days integer[],holidays date[]);
 CREATE TABLE attendance_daily_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_id uuid,work_date date,entry_at timestamptz,late_minutes integer);
 CREATE TABLE attendance_leave_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_id uuid,field_associate_id uuid,start_date date,end_date date,request_type text,status text,reason text,created_at timestamptz DEFAULT now());
 CREATE TABLE attendance_leave_request_days(request_id uuid,leave_date date,status text);
 CREATE TABLE field_attendance_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),associate_id uuid,work_date date,online boolean,occurred_at timestamptz DEFAULT now());
 CREATE TABLE field_work_rates(associate_id uuid PRIMARY KEY,assessment numeric,installation numeric,commissioning numeric,updated_by uuid,updated_at timestamptz DEFAULT now());
 CREATE TABLE field_earnings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid,company_name text,associate_id uuid,associate_name text DEFAULT 'Field Associate',phase text,earning_date date,amount numeric,eligible boolean DEFAULT true);
 CREATE TABLE field_payment_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),associate_id uuid,period_end date,amount numeric,paid_on date,reference text,recorded_by uuid,UNIQUE(associate_id,period_end));
 CREATE TABLE field_payment_items(payment_id uuid,earning_id uuid PRIMARY KEY,amount numeric);
 CREATE FUNCTION field_ops_associate(_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT has_role(_id,'worker') $$;
 CREATE FUNCTION field_ops_phase_ready(_id uuid,_phase text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
 CREATE FUNCTION field_ops_period_end(_date date) RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT (date_trunc('month',_date)+CASE WHEN extract(day FROM _date)>15 THEN interval '1 month' ELSE interval '0 month' END+interval '14 days')::date $$;
 INSERT INTO auth.users VALUES('${hardik}','admin@limelightit.io',now()),('${tarun}','tarun@limelightit.io',now()),('${staff}','staff@test.io',now()),('${other}','other@test.io',now()),('${associate}','field@test.io',now());
 INSERT INTO profiles SELECT id,split_part(email,'@',1),true FROM auth.users;
 INSERT INTO user_roles VALUES('${hardik}','supervisor'),('${tarun}','worker'),('${staff}','employee'),('${other}','employee'),('${associate}','worker');
 INSERT INTO attendance_employees VALUES('${employee}','Staff','staff@test.io','${staff}',true,null,'2020-01-01');
 INSERT INTO attendance_settings VALUES('2020-01-01',ARRAY[1,2,3,4,5,6],ARRAY[date '2020-06-02']);
 INSERT INTO attendance_daily_records(employee_id,work_date,entry_at,late_minutes)
 SELECT '${employee}',d::date,d+interval '4 hours 30 minutes',CASE WHEN d::date='2020-06-03' THEN 10 ELSE 0 END FROM generate_series(timestamp '2020-06-01',timestamp '2020-06-30',interval '1 day') d WHERE extract(dow FROM d)<>0 AND d::date<>'2020-06-02';
 `);
  for (const migration of [
    "20261014120000_scoped_manager_module_access.sql",
    "20261016120000_salary_expenses.sql",
    "20261016121000_salary_manager_access.sql",
    "20261019120000_expense_month_end_handoff.sql",
  ])
    await db.exec(
      readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"),
    );
});
after(() => db.close());

test("month boundaries, year rollover and inclusive fifth-day deadline", () => {
  assert.deepEqual(settlementDates("2026-12"), { deadline: "2027-01-05", due: "2027-01-07" });
  assert.equal(
    canReapply({ status: "rejected", settlement_month: "2026-10-01" }, "2026-11-05"),
    true,
  );
  assert.equal(
    canReapply({ status: "rejected", settlement_month: "2026-10-01" }, "2026-11-06"),
    false,
  );
  assert.equal(
    canReapply({ status: "approved", settlement_month: "2026-10-01" }, "2026-11-01"),
    false,
  );
  assert.equal(canManageFinance("admin@limelight.io"), false);
});
test("salary preview matches working-day example and half-day adjustment", () => {
  const days = Array.from({ length: 25 }, (_, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    working_day: true,
    status: "present",
    units: 1,
  }));
  assert.equal(salaryTotals(15000, days).daily, 600);
  assert.equal(salaryTotals(15000, days).amount, 15000);
  assert.equal(
    salaryTotals(15000, days, { [days[0].date]: { units: 0.5, reason: "Half day" } }).amount,
    14700,
  );
  assert.equal(salaryTotals(15000, []).amount, 0);
  assert.throws(() => validateExpenseFile({ size: 5000001, type: "application/pdf" }), /5 MB/);
  assert.throws(() => validateExpenseFile({ size: 100, type: "image/svg+xml" }), /PDF/);
});
test("personal claim access and deferred reviewer submissions", async () => {
  await as(hardik);
  await assert.rejects(claim(), /does not submit/);
  await as(tarun);
  await assert.rejects(claim(), /pending configuration/);
  await as(staff);
  const id = await claim();
  const month = await scalar(
    "select date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata')::date::text",
  );
  assert.equal(
    await scalar("select settlement_month::text from expense_claims where id=$1", [id]),
    month,
  );
  await as(other);
  const own = await scalar("select finance_board($1::date)", [month]);
  assert.equal(
    own.claims.some((c) => c.id === id),
    false,
  );
  await assert.rejects(action(id, "cancel"), /cannot be deleted/);
});
test("Hardik then Tarun approval, rejection history, resubmit and paid lock", async () => {
  await as(staff);
  const id = await claim("Approval flow");
  await as(tarun);
  await assert.rejects(action(id, "approve"), /awaiting your review/);
  await as(hardik);
  await assert.rejects(action(id, "reject", " "), /reason required/);
  await action(id, "approve");
  assert.equal(
    await scalar("select status from expense_claims where id=$1", [id]),
    "hardik_verified",
  );
  await as(tarun);
  await assert.rejects(action(id, "approve"), /awaiting your review/);
  const month = await scalar("select settlement_month::text from expense_claims where id=$1", [id]);
  assert.equal(
    (await scalar("select finance_board($1::date)", [month])).claims.some((c) => c.id === id),
    false,
  );
  await db.exec("SET ROLE authenticated");
  assert.equal(await scalar("select count(*)::int from expense_claims where id=$1", [id]), 0);
  await db.exec("RESET ROLE");
  await as(hardik);
  await action(id, "forward");
  await as(tarun);
  assert.equal(
    (await scalar("select finance_board($1::date)", [month])).claims.some((c) => c.id === id),
    true,
  );
  await action(id, "reject", "Receipt unclear");
  await as(staff);
  await db.query(
    "select expense_save($1,$2,current_date,'Corrected','travel',600,'Updated','{}')",
    [id, await revision(id)],
  );
  const updated = (await db.query("select * from expense_claims where id=$1", [id])).rows[0];
  assert.equal(updated.status, "hardik_pending");
  assert.equal(updated.hardik_at, null);
  assert.equal(updated.tarun_at, null);
  assert.equal(updated.sent_to_tarun_at, null);
  assert.equal(
    await scalar(
      "select count(*)::int from finance_events where entity_id=$1 and action='reject' and reason='Receipt unclear'",
      [id],
    ),
    1,
  );
  await as(hardik);
  await action(id, "approve");
  await action(id, "forward");
  await as(tarun);
  await action(id, "approve");
  assert.equal(await scalar("select paid_at is null from expense_claims where id=$1", [id]), true);
  await assert.rejects(action(id, "pay", "Too early"), /following month's 7th/);
  await db.query(
    "update expense_claims set settlement_month=(date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata')-interval '2 months')::date where id=$1",
    [id],
  );
  await action(id, "pay", "UTR-123");
  await assert.rejects(action(id, "pay", "UTR-123"), /unpaid claim/);
  await as(staff);
  await assert.rejects(
    db.query("select expense_save($1,$2,current_date,'Edit','travel',600,'','{}')", [
      id,
      await revision(id),
    ]),
    /Only rejected/,
  );
});
test("server blocks expired reapplication even when expense date changes", async () => {
  await as(staff);
  const id = await claim("Expired");
  await as(hardik);
  await action(id, "reject", "Wrong amount");
  await db.query(
    "update expense_claims set settlement_month=(date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata')-interval '2 months')::date where id=$1",
    [id],
  );
  await as(staff);
  await assert.rejects(
    db.query("select expense_save($1,$2,current_date,'Move month','travel',700,'','{}')", [
      id,
      await revision(id),
    ]),
    /Reapplication closed/,
  );
});
test("atomic bulk verification rolls back if any selected revision is stale", async () => {
  await as(staff);
  const first = await claim("Bulk one"),
    second = await claim("Bulk two");
  await as(hardik);
  await assert.rejects(
    db.query("select expense_review_batch($1)", [
      JSON.stringify([
        { id: first, revision: 1 },
        { id: second, revision: 0 },
      ]),
    ]),
    /Claim changed/,
  );
  assert.equal(
    await scalar(
      "select count(*)::int from expense_claims where id=ANY($1::uuid[]) and status='hardik_pending'",
      [[first, second]],
    ),
    2,
  );
  await db.query("select expense_review_batch($1)", [
    JSON.stringify([
      { id: first, revision: 1 },
      { id: second, revision: 1 },
    ]),
  ]);
  assert.equal(
    await scalar(
      "select count(*)::int from expense_claims where id=ANY($1::uuid[]) and status='hardik_verified'",
      [[first, second]],
    ),
    2,
  );
  const rows = [
    { id: first, revision: 2 },
    { id: second, revision: 2 },
  ];
  await as(tarun);
  await assert.rejects(
    db.query("select expense_batch_action($1,'forward')", [JSON.stringify(rows)]),
    /Only verified/,
  );
  await as(hardik);
  await assert.rejects(
    db.query("select expense_batch_action($1,'forward')", [
      JSON.stringify([rows[0], { id: second, revision: 1 }]),
    ]),
    /Claim changed/,
  );
  assert.equal(
    await scalar("select status from expense_claims where id=$1", [first]),
    "hardik_verified",
  );
  await db.query("select expense_batch_action($1,'forward')", [JSON.stringify(rows)]);
  await as(tarun);
  await assert.rejects(
    db.query("select expense_batch_action($1,'reject','')", [
      JSON.stringify(rows.map((c) => ({ ...c, revision: 3 }))),
    ]),
    /reason required/,
  );
  await db.query("select expense_batch_action($1,'approve')", [
    JSON.stringify(rows.map((c) => ({ ...c, revision: 3 }))),
  ]);
  assert.equal(
    await scalar(
      "select count(*)::int from expense_claims where id=ANY($1::uuid[]) and status='approved'",
      [[first, second]],
    ),
    2,
  );
});
test("attachments cannot be stolen or exceed the configured count", async () => {
  const file = "00000000-0000-4000-8000-000000000010";
  await db.query(
    "insert into expense_files(id,owner_id,object_key,filename,mime_type,size_bytes,sha256) values($1,$2,'secret','a.pdf','application/pdf',10,'abc')",
    [file, other],
  );
  await as(staff);
  await assert.rejects(
    db.query("select expense_save(null,0,current_date,'File','travel',100,'',$1::uuid[])", [
      [file],
    ]),
    /Invalid attachment/,
  );
  await assert.rejects(
    db.query("select expense_action($1,null,'cancel',null)", [await claim("Null revision")]),
    /Claim changed/,
  );
});

test("month-end batches isolate people and retain rejection reasons", async () => {
  await as(staff);
  const first = await claim("Person one travel"),
    second = await claim("Person one hotel");
  await as(other);
  const third = await claim("Person two travel");
  const rows = [first, second, third].map((id) => ({ id, revision: 1 }));
  await as(hardik);
  await assert.rejects(action(first, "forward"), /Only verified/);
  await db.query("select expense_batch_action($1,'approve')", [JSON.stringify(rows)]);
  await db.query("select expense_batch_action($1,'forward')", [
    JSON.stringify(rows.map((c) => ({ ...c, revision: 2 }))),
  ]);
  await as(tarun);
  await db.query("select expense_batch_action($1,'approve')", [
    JSON.stringify(rows.slice(0, 2).map((c) => ({ ...c, revision: 3 }))),
  ]);
  assert.equal(
    await scalar("select status from expense_claims where id=$1", [third]),
    "tarun_pending",
  );
  await db.query("select expense_batch_action($1,'reject','Receipt does not match')", [
    JSON.stringify([{ id: third, revision: 3 }]),
  ]);
  assert.equal(
    await scalar("select tarun_reason from expense_claims where id=$1", [third]),
    "Receipt does not match",
  );
  assert.equal(
    await scalar(
      "select count(*)::int from finance_events where entity_id=$1 and action='reject' and reason='Receipt does not match'",
      [third],
    ),
    1,
  );
  await assert.rejects(
    db.query("select expense_batch_action($1,'approve')", [
      JSON.stringify([{ id: first, revision: 4 }]),
    ]),
    /awaiting your review/,
  );
});
test("server salary calendar, divisor, automatic late half-day and edit history", async () => {
  await as(hardik);
  const days = await scalar("select finance_calendar($1,'2020-06-01')", [employee]);
  assert.equal(days.filter((d) => d.working_day).length, 25);
  assert.equal(days.find((d) => d.date === "2020-06-03").units, 0.5);
  assert.equal(days.find((d) => d.date === "2020-06-07").units, 0);
  salaryId = await scalar("select salary_save($1,'2020-06-01',15000,'{}',0,'Monthly salary')", [
    employee,
  ]);
  assert.equal(
    Number(await scalar("select amount from salary_months where id=$1", [salaryId])),
    14700,
  );
  await as(staff);
  await assert.rejects(
    db.query("select finance_calendar($1,'2020-06-01')", [employee]),
    /manager access/,
  );
  await as(tarun);
  await db.query("select salary_save($1,'2020-06-01',15000,$2,1,'Corrected day')", [
    employee,
    JSON.stringify({ "2020-06-03": { units: 1, reason: "Approved full day" } }),
  ]);
  assert.equal(
    Number(await scalar("select amount from salary_months where id=$1", [salaryId])),
    15000,
  );
  assert.equal(
    await scalar(
      "select actor_role from finance_events where entity_id=$1 and reason='Corrected day'",
      [salaryId],
    ),
    "tarun",
  );
});
test("salary approval resets on either reviewer edit and locks after payment", async () => {
  await as(hardik);
  await db.query("select salary_action($1,2,'forward')", [salaryId]);
  await as(tarun);
  await db.query("select salary_action($1,3,'approve')", [salaryId]);
  await db.query("select salary_save($1,'2020-06-01',15000,'{}',4,'Review correction')", [
    employee,
  ]);
  assert.equal(await scalar("select status from salary_months where id=$1", [salaryId]), "draft");
  await as(hardik);
  await db.query("select salary_action($1,5,'forward')", [salaryId]);
  await as(tarun);
  await db.query("select salary_action($1,6,'approve')", [salaryId]);
  await db.query("select salary_action($1,7,'pay','BANK-456')", [salaryId]);
  await assert.rejects(
    db.query("select salary_save($1,'2020-06-01',16000,'{}',8,'Edit paid')", [employee]),
    /Paid salary is locked/,
  );
});
test("field incentives keep 16th–15th, require final approval and reuse existing payments", async () => {
  await db.query(
    "insert into field_earnings(associate_id,company_name,phase,earning_date,amount) values($1,'Company','assessment','2020-06-16',1000),($1,'Company','commissioning','2020-07-15',2000),($1,'Next','assessment','2020-07-16',3000)",
    [associate],
  );
  await as(hardik);
  const board = await scalar("select finance_field_board($1,'2020-07-01')", [associate]);
  assert.equal(board.earnings.length, 2);
  await assert.rejects(
    db.query("select field_ops_record_payment($1,'2020-07-15',current_date,'BANK')", [associate]),
    /Tarun approval/,
  );
  await db.query("select finance_field_action($1,'2020-07-15',0,'forward')", [associate]);
  await as(tarun);
  await db.query("select finance_field_action($1,'2020-07-15',1,'approve')", [associate]);
  await db.query("select finance_field_action($1,'2020-07-15',2,'pay','BANK-789')", [associate]);
  assert.equal(await scalar("select count(*)::int from field_payment_items"), 2);
  assert.equal(
    Number(
      await scalar("select amount from field_payment_records where associate_id=$1", [associate]),
    ),
    3000,
  );
  await assert.rejects(
    db.query("select finance_field_earning($1,50,'Change paid')", [board.earnings[0].id]),
    /Paid work is locked/,
  );
  await db.query("update field_earnings set eligible=false where id=$1", [board.earnings[0].id]);
  const paidHistory = await scalar("select finance_field_board($1,'2020-07-01')", [associate]);
  assert.equal(paidHistory.earnings.length, 2, "Paid work remains visible if the site is reopened");
});
test("financial tables reject direct client writes and hide other owners' records", async () => {
  await db.exec("GRANT USAGE ON SCHEMA auth TO authenticated");
  await as(staff);
  await db.exec("SET ROLE authenticated");
  try {
    assert.equal(
      await scalar("select count(*)::int from expense_claims where owner_id<>auth.uid()"),
      0,
    );
    await assert.rejects(
      db.query("update expense_claims set status='approved'"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select finance_log('expense',gen_random_uuid(),'forged',null,null,null)"),
      /permission denied/,
    );
  } finally {
    await db.exec("RESET ROLE");
  }
});
