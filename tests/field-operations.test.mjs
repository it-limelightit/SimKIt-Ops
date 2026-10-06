import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const db = new PGlite();
const manager = "00000000-0000-4000-8000-000000000001";
const worker = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";
const dual = "00000000-0000-4000-8000-000000000004";
const site = "00000000-0000-4000-8000-000000000011";
const site2 = "00000000-0000-4000-8000-000000000012";
const historicSite = "00000000-0000-4000-8000-000000000013";
const orderSite = "00000000-0000-4000-8000-000000000014";
const asUser = async (id) => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
let today;
before(async () => {
  // Minimal existing application schema. Run the actual migrations, not rewritten RPCs.
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TYPE public.app_role AS ENUM ('worker','supervisor','owner');
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),name text,email text,is_active boolean DEFAULT true,created_at timestamptz DEFAULT now()-interval '1 year');
    CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
    CREATE FUNCTION public.has_role(_id uuid,_role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_id AND role=_role) $$;
    CREATE FUNCTION public.is_staff(_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_id AND role IN ('supervisor','owner')) $$;
    CREATE TABLE public.sites(id uuid PRIMARY KEY,name text,company_name text,city text,assigned_worker_id uuid,task_notes text);
    CREATE TABLE public.assessment(site_id uuid PRIMARY KEY REFERENCES sites(id),worker_id uuid,data jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now());
    CREATE TABLE public.installation(LIKE assessment INCLUDING ALL);
    CREATE TABLE public.commissioning(LIKE assessment INCLUDING ALL);
    CREATE TABLE public.inventory_materials(id uuid DEFAULT gen_random_uuid(),material_name text,submitted boolean);
    CREATE TABLE public.commissioning_approval_requests(site_id uuid PRIMARY KEY,status text,requested_by uuid,reviewed_at timestamptz);
    INSERT INTO auth.users VALUES('${manager}'),('${worker}'),('${other}'),('${dual}');
    INSERT INTO profiles(id,name,email) VALUES('${manager}','Manager','manager@example.test'),('${worker}','Associate A','a@example.test'),('${other}','Associate B','b@example.test'),('${dual}','Dual manager','dual@example.test');
    INSERT INTO user_roles VALUES('${manager}','supervisor'),('${worker}','worker'),('${other}','worker'),('${dual}','worker'),('${dual}','supervisor');
    INSERT INTO sites VALUES('${site}','Factory A','Factory A','Surat','${worker}','[METADATA:{"worker_ids":["${worker}","${other}"],"note":"a } bracket"}] normal [notes]'),('${site2}','Factory B','Factory B','Surat','${worker}',null);
    INSERT INTO assessment VALUES('${site}','${worker}','{"assessment_phase_submitted":true,"media_uploaded":true,"factory_operations_done":true,"device_order_completed":true}',now());
    INSERT INTO sites VALUES('${historicSite}','Historical Factory','Historical Factory','Surat','${worker}',null);
    INSERT INTO assessment VALUES('${historicSite}','${worker}','{"assessment_phase_submitted":true,"media_uploaded":true,"factory_operations_done":true,"device_order_completed":true,"mom_uploaded":true}',now()-interval '1 month');
    ALTER TABLE sites ADD COLUMN consultant_stage text;`);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20260925090000_add_field_visit_scheduler.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261005120000_field_operations_attendance_earnings.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261005130000_field_operations_company_stages.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261005140000_field_operations_assessment_commissioning_pay.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  today = await scalar("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text");
});
after(async () => {
  await db.close();
});

test("payment boundaries do not overlap, including year and leap-month transitions", async () => {
  assert.equal(await scalar("SELECT field_ops_period_end('2026-08-15')::text"), "2026-08-15");
  assert.equal(await scalar("SELECT field_ops_period_end('2026-08-16')::text"), "2026-09-15");
  assert.equal(await scalar("SELECT field_ops_period_end('2026-12-31')::text"), "2027-01-15");
  assert.equal(await scalar("SELECT field_ops_period_end('2028-02-29')::text"), "2028-03-15");
});
test("migration does not backfill payroll or include dual-role managers", async () => {
  assert.equal(await scalar("SELECT count(*)::int FROM field_earnings"), 0);
  assert.equal(await scalar("SELECT field_ops_associate($1)", [dual]), false);
  await asUser(manager);
  const board = await scalar("SELECT field_ops_board()");
  assert.deepEqual(board.users.map((u) => u.id).sort(), [worker, other].sort());
  assert.deepEqual(board.sites.find((s) => s.site_id === site).worker_ids, [worker, other]);
});
test("associates cannot read others rates, earnings or attendance, or change manager controls", async () => {
  await asUser(worker);
  await assert.rejects(
    db.query("SELECT field_ops_set_rates($1,100,200,300)", [worker]),
    /Manager access required/,
  );
  await assert.rejects(db.query("SELECT field_ops_attendance($1,true)", [other]), /Access denied/);
  await assert.rejects(
    db.query("SELECT field_ops_attendance($1,false)", [worker]),
    /Access denied/,
  );
  const board = await scalar("SELECT field_ops_board()");
  assert.deepEqual(
    board.users.map((u) => u.id),
    [worker],
  );
});
test("online/offline/online creates visible history; duplicate check-in is idempotent and earns nothing", async () => {
  await asUser(worker);
  await db.query("SELECT field_ops_attendance($1,true)", [worker]);
  await db.query("SELECT field_ops_attendance($1,true)", [worker]);
  await asUser(manager);
  await db.query("SELECT field_ops_attendance($1,false)", [worker]);
  await asUser(worker);
  await db.query("SELECT field_ops_attendance($1,true)", [worker]);
  const board = await scalar("SELECT field_ops_board()");
  assert.equal(board.users[0].online, true);
  assert.equal(board.attendance.length, 3);
  assert.deepEqual(
    board.attendance.map((a) => a.online),
    [true, false, true],
  );
  assert.equal(board.earnings.length, 0);
});
let visit;
test("required timing, assignment and overlaps are checked on the server; shift bounds are flexible", async () => {
  await asUser(worker);
  await assert.rejects(
    db.query("SELECT field_ops_schedule($1,$2,'installation',$3,null,'09:00','13:00')", [
      site,
      worker,
      today,
    ]),
    /shift/,
  );
  visit = await scalar(
    "SELECT field_ops_schedule($1,$2,'installation',$3,'10:00-12:00','09:00','13:00')",
    [site, worker, today],
  );
  await assert.rejects(
    db.query("SELECT field_ops_schedule($1,$2,'installation',$3,'10:00-12:00','09:00','13:00')", [
      site,
      worker,
      today,
    ]),
    /already scheduled/,
  );
  await assert.rejects(
    db.query("SELECT field_ops_schedule($1,$2,'assessment',$3,'12:00-14:00','12:00','14:00')", [
      site2,
      worker,
      today,
    ]),
    /overlap/,
  );
  await assert.rejects(
    db.query("SELECT field_ops_schedule($1,$2,'assessment',$3,'12:00-14:00','14:00','13:00')", [
      site2,
      worker,
      today,
    ]),
    /end must follow/,
  );
  await asUser(other);
  await db.query("SELECT field_ops_attendance($1,true)", [other]);
  await assert.rejects(
    db.query("SELECT field_ops_schedule($1,$2,'assessment',$3,'12:00-14:00','14:00','15:00')", [
      site2,
      other,
      today,
    ]),
    /not assigned/,
  );
  const board = await scalar("SELECT field_ops_board()");
  assert.ok(
    board.visits.some((v) => v.id === visit),
    "collaborator sees the visit",
  );
});
test("manager can add another company when visits already exist", async () => {
  await asUser(manager);
  await db.query(
    "SELECT field_ops_schedule($1,$2,'assessment',$3,'14:00-16:00','14:00','16:00','high')",
    [site2, worker, today],
  );
  assert.equal(
    await scalar("SELECT count(*)::int FROM field_visit_schedules WHERE assignee_id=$1", [worker]),
    2,
  );
});
test("incomplete assessment never earns; final MOM completion earns once with a price snapshot", async () => {
  await asUser(manager);
  await db.query("SELECT field_ops_set_rates($1,100,200,300)", [worker]);
  assert.equal(await scalar("SELECT field_ops_phase_ready($1,'assessment')", [site]), false);
  await db.query(
    "UPDATE assessment SET data=data || '{\"mom_uploaded\":true}'::jsonb WHERE site_id=$1",
    [site],
  );
  assert.equal(await scalar("SELECT count(*)::int FROM field_earnings"), 1);
  assert.equal(
    Number(await scalar("SELECT amount FROM field_earnings WHERE phase='assessment'")),
    100,
  );
  await db.query("SELECT field_ops_set_rates($1,150,250,350)", [worker]);
  await db.query(
    'UPDATE assessment SET data=data || \'{"note":"updated"}\'::jsonb WHERE site_id=$1',
    [site],
  );
  assert.equal(await scalar("SELECT count(*)::int FROM field_earnings"), 1);
  assert.equal(
    Number(await scalar("SELECT amount FROM field_earnings WHERE phase='assessment'")),
    100,
  );
});
test("visit completion blocks incomplete installation and retains completed history", async () => {
  await asUser(worker);
  await assert.rejects(
    db.query("SELECT field_ops_complete_visit($1)", [visit]),
    /required phase work/,
  );
  await assert.rejects(
    db.query("SELECT field_visit_schedule_update_status($1,'completed')", [visit]),
    /required phase work/,
  );
  await db.query(
    'INSERT INTO installation(site_id,worker_id,data) VALUES($1,$2,\'{"installation_phase_submitted":true,"coordination_done":true,"photos_uploaded":true}\')',
    [site, worker],
  );
  await db.query("SELECT field_ops_complete_visit($1)", [visit]);
  await db.query("SELECT field_ops_complete_visit($1)", [visit]);
  assert.equal(
    await scalar("SELECT status FROM field_visit_schedules WHERE id=$1", [visit]),
    "completed",
  );
  assert.equal(
    Number(await scalar("SELECT amount FROM field_earnings WHERE phase='installation'")),
    0,
  );
});
let commission;
test("commissioning needs approval; editing its earning date preserves approval timestamp and audits the change", async () => {
  await db.query(
    "INSERT INTO commissioning(site_id,worker_id,data) VALUES($1,$2,'{\"commissioning_phase_submitted\":true}')",
    [site, worker],
  );
  assert.equal(
    await scalar("SELECT count(*)::int FROM field_earnings WHERE phase='commissioning'"),
    0,
  );
  await asUser(manager);
  await db.query("INSERT INTO commissioning_approval_requests VALUES($1,'approved',$2,now())", [
    site,
    worker,
  ]);
  await db.query(
    "UPDATE commissioning SET data=data || jsonb_build_object('commissioning_phase_submitted',true,'commissioning_phase_submitted_at',now()) WHERE site_id=$1",
    [site],
  );
  commission = (await db.query("SELECT * FROM field_earnings WHERE phase='commissioning'")).rows[0];
  assert.equal(commission.earning_date.toISOString().slice(0, 10), today);
  await assert.rejects(
    db.query("SELECT field_ops_edit_commissioning_date($1,'2099-01-01','reason')", [commission.id]),
    /work date/,
  );
  await db.query(
    "SELECT field_ops_edit_commissioning_date($1,(now() AT TIME ZONE 'Asia/Kolkata')::date-2,'Actual site work')",
    [commission.id],
  );
  const correctedDate = await scalar("SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date-2)::text");
  await db.exec("SET ROLE authenticated");
  try {
    await assert.rejects(db.query("SELECT * FROM field_earnings"), /permission denied/);
    const board = await scalar("SELECT field_ops_board()");
    const reported = board.earnings.find((entry) => entry.id === commission.id);
    assert.equal(reported.earning_date, correctedDate);
    assert.equal(
      new Date(reported.completed_at).getTime(),
      new Date(commission.completed_at).getTime(),
    );
  } finally {
    await db.exec("RESET ROLE");
  }
  assert.equal(await scalar("SELECT count(*)::int FROM field_earning_date_changes"), 1);
  assert.equal(
    String(await scalar("SELECT completed_at FROM field_earnings WHERE id=$1", [commission.id])),
    String(commission.completed_at),
  );
  const assessmentId = await scalar("SELECT id FROM field_earnings WHERE phase='assessment'");
  await assert.rejects(
    db.query("SELECT field_ops_edit_commissioning_date($1,$2,'reason')", [assessmentId, today]),
    /approved commissioning/,
  );
});
test("reopened phase is excluded from payable totals; worker cannot edit dates or record payment", async () => {
  await db.query("UPDATE assessment SET data=data || '{\"mom_uploaded\":false}' WHERE site_id=$1", [
    site,
  ]);
  await asUser(worker);
  const board = await scalar("SELECT field_ops_board()");
  assert.equal(board.earnings.find((e) => e.phase === "assessment").eligible, false);
  await assert.rejects(
    db.query("SELECT field_ops_record_payment($1,$2,$2)", [worker, today]),
    /Manager access/,
  );
  await assert.rejects(
    db.query("SELECT field_ops_edit_commissioning_date($1,$2,'reason')", [commission.id, today]),
    /Manager access/,
  );
});
test("settlement uses unique payment items, blocks duplicate settlement and locks paid commissioning dates", async () => {
  await asUser(manager);
  // Fixture a finished period using the real recognized entries; no live DB is touched.
  await db.query(
    "UPDATE field_earnings SET earning_date=(date_trunc('month',now())-interval '1 month'+interval '14 days')::date WHERE phase IN ('installation','commissioning')",
  );
  const period = await scalar(
    "SELECT earning_date::text FROM field_earnings WHERE phase='commissioning'",
  );
  await db.query("SELECT field_ops_record_payment($1,$2,$3,$4)", [
    worker,
    period,
    today,
    "bank-reference",
  ]);
  assert.equal(Number(await scalar("SELECT amount FROM field_payment_records")), 350);
  assert.equal(await scalar("SELECT count(*)::int FROM field_payment_items"), 1);
  assert.equal(
    await scalar(
      "SELECT count(*)::int FROM field_payment_items p JOIN field_earnings e ON e.id=p.earning_id WHERE e.phase='installation'",
    ),
    0,
  );
  await assert.rejects(
    db.query("SELECT field_ops_record_payment($1,$2,$3)", [worker, period, today]),
    /No payable/,
  );
  await assert.rejects(
    db.query("SELECT field_ops_edit_commissioning_date($1,$2,'reason')", [commission.id, today]),
    /Paid earnings/,
  );
});
test("historical edits never create payroll and a final external device order recognizes assessment", async () => {
  await asUser(manager);
  await db.query(
    'UPDATE assessment SET data=data || \'{"note":"updated historical details"}\' WHERE site_id=$1',
    [historicSite],
  );
  assert.equal(
    await scalar("SELECT count(*)::int FROM field_earnings WHERE site_id=$1", [historicSite]),
    0,
  );
  await db.query(
    "INSERT INTO sites(id,name,company_name,assigned_worker_id) VALUES($1,'M/S Factory C Pvt Ltd','M/S Factory C Pvt Ltd',$2)",
    [orderSite, worker],
  );
  await db.query(
    'INSERT INTO assessment(site_id,worker_id,data) VALUES($1,$2,\'{"assessment_phase_submitted":true,"mom_uploaded":true,"media_uploaded":true,"factory_operations_done":true}\')',
    [orderSite, manager],
  );
  assert.equal(
    await scalar("SELECT count(*)::int FROM field_earnings WHERE site_id=$1", [orderSite]),
    0,
  );
  await db.query(
    "INSERT INTO inventory_materials(material_name,submitted) VALUES('Factory C sensor panel',true)",
  );
  assert.equal(
    await scalar("SELECT count(*)::int FROM field_earnings WHERE site_id=$1", [orderSite]),
    1,
  );
  assert.equal(
    Number(await scalar("SELECT amount FROM field_earnings WHERE site_id=$1", [orderSite])),
    150,
  );
});
test("dropped companies are excluded from scheduling", async () => {
  await asUser(manager);
  await db.query(
    'UPDATE sites SET task_notes=\'[METADATA:{"status":"Dropped / Rejected"}]\' WHERE id=$1',
    [orderSite],
  );
  const board = await scalar("SELECT field_ops_board()");
  assert.equal(board.sites.find((s) => s.site_id === orderSite).active, false);
  await assert.rejects(
    db.query("SELECT field_ops_schedule($1,$2,'installation',$3,'10:00-12:00','10:00','12:00')", [
      orderSite,
      worker,
      today,
    ]),
    /Dropped or rejected/,
  );
});
test("existing company and profile deletion can proceed while earned and paid history stays available", async () => {
  await asUser(manager);
  const before = Number(await scalar("SELECT sum(amount) FROM field_earnings WHERE eligible"));
  await db.query("DELETE FROM assessment WHERE site_id IN ($1,$2)", [orderSite, historicSite]);
  await db.query("DELETE FROM sites WHERE id IN ($1,$2)", [orderSite, historicSite]);
  assert.equal(
    await scalar("SELECT count(*)::int FROM field_existing_completions WHERE site_id=$1", [
      historicSite,
    ]),
    0,
  );
  await db.query("DELETE FROM profiles WHERE id=$1", [worker]);
  assert.equal(
    await scalar("SELECT count(*)::int FROM field_work_rates WHERE associate_id=$1", [worker]),
    0,
  );
  assert.equal(
    Number(await scalar("SELECT sum(amount) FROM field_earnings WHERE eligible")),
    before,
  );
  const board = await scalar("SELECT field_ops_board()");
  const archive = board.users.find((u) => u.id === worker);
  assert.equal(archive.active, false);
  assert.equal(archive.name, "Associate A");
  const deletedCompany = board.earnings.find((e) => e.company_name === "M/S Factory C Pvt Ltd");
  assert.equal(deletedCompany.site_id, null);
  assert.equal(deletedCompany.eligible, true);
  assert.equal(board.payments.length, 1);
  assert.equal(board.earnings.filter((e) => e.paid).length, 1);
});
test("anonymous and direct authenticated table writes are denied", async () => {
  await asUser("");
  await assert.rejects(db.query("SELECT field_ops_board()"), /Access denied/);
  await db.exec("SET ROLE authenticated");
  await assert.rejects(db.query("SELECT * FROM field_earnings"), /permission denied/);
  await assert.rejects(
    db.query(
      "INSERT INTO field_attendance_events(associate_id,actor_id,online) VALUES($1,$1,true)",
      [worker],
    ),
    /permission denied/,
  );
  await db.exec("RESET ROLE");
});
test("frontend payment dates, India midnight and five-day warning follow the same rules", async () => {
  // Transpile the actual helper module with only its unused network dependency stubbed.
  const source = readFileSync(
    new URL("../src/lib/field-operations.ts", import.meta.url),
    "utf8",
  ).replace(/import \{ supabase \} from [^;]+;/, "const supabase = {};");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const utils = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  assert.deepEqual(utils.paymentPeriod("2026-08-15"), {
    start: "2026-07-16",
    end: "2026-08-15",
    due: "2026-09-07",
  });
  assert.deepEqual(utils.paymentPeriod("2026-08-16"), {
    start: "2026-08-16",
    end: "2026-09-15",
    due: "2026-10-07",
  });
  assert.equal(utils.indiaDate(new Date("2026-08-15T19:00:00Z")), "2026-08-16");
  assert.equal(utils.monthDays("2028-02").length, 29);
  assert.equal(
    utils.earningsTotal([
      { phase: "assessment", amount: 100, eligible: true },
      { phase: "installation", amount: 999, eligible: true, paid: true },
      { phase: "commissioning", amount: 50, eligible: true },
    ]),
    150,
  );
  const company = {
    assessment_ready: true,
    installation_ready: false,
    commissioning_ready: false,
    assessment_completed_at: "2026-08-01T08:00:00Z",
  };
  const datesWork = [
    { associate_id: "a", phase: "assessment", earning_date: "2026-08-01", eligible: true },
    { associate_id: "a", phase: "installation", earning_date: "2026-08-02", eligible: true },
    { associate_id: "a", phase: "commissioning", earning_date: "2026-08-03", eligible: true },
    { associate_id: "a", phase: "commissioning", earning_date: "2026-08-04", eligible: false },
    { associate_id: "b", phase: "commissioning", earning_date: "2026-08-05", eligible: true },
  ];
  const attendance = [{ associate_id: "a", work_date: "2026-08-01", online: true }];
  assert.deepEqual(utils.visibleWorkDates(datesWork, attendance, "a"), [
    "2026-08-01",
    "2026-08-03",
  ]);
  const moved = datesWork.map((entry) =>
    entry.phase === "commissioning" && entry.eligible && entry.associate_id === "a"
      ? { ...entry, earning_date: "2026-07-31" }
      : entry,
  );
  assert.deepEqual(utils.visibleWorkDates(moved, attendance, "a"), ["2026-07-31", "2026-08-01"]);
  assert.deepEqual(
    utils.visibleWorkDates(
      moved.filter((entry) => entry.earning_date >= "2026-08-01"),
      attendance,
      "a",
    ),
    ["2026-08-01"],
  );
  assert.equal(utils.installationOverdue(company, "2026-08-05"), false);
  assert.equal(utils.installationOverdue(company, "2026-08-06"), true);
  assert.equal(
    utils.installationOverdue({ ...company, phase: "commissioning" }, "2026-08-10"),
    false,
  );
  assert.equal(utils.installationOverdue({ ...company, phase: "assessment" }, "2026-08-10"), false);
  assert.equal(
    utils.installationOverdue({ ...company, installation_ready: true }, "2026-08-10"),
    false,
  );
});

test("scheduling stages match existing company statuses, respect assignment and preserve earning requirements", async () => {
  const worker = "00000000-0000-4000-8000-000000000098";
  await db.query("INSERT INTO auth.users VALUES($1)", [worker]);
  await db.query(
    "INSERT INTO profiles(id,name,email) VALUES($1,'Stage associate','stage@example.test')",
    [worker],
  );
  await db.query("INSERT INTO user_roles VALUES($1,'worker')", [worker]);
  const compile = (source) =>
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  const uri = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const metadata = compile(
    readFileSync(new URL("../src/lib/site-metadata.ts", import.meta.url), "utf8")
      .replace(/import \{ supabase \} from [^;]+;/, "const supabase = {};")
      .replace(
        /import \{ recordActivityLog \} from [^;]+;/,
        "const recordActivityLog = async () => {};",
      ),
  );
  const source = readFileSync(new URL("../src/utils/status.ts", import.meta.url), "utf8").replace(
    '"@/lib/site-metadata"',
    JSON.stringify(uri(metadata)),
  );
  const { getCanonicalStatus } = await import(uri(compile(source)));
  const id = "00000000-0000-4000-8000-000000000099";
  await db.query(
    "INSERT INTO sites(id,name,company_name,assigned_worker_id) VALUES($1,'Stage Factory','Stage Factory',$2)",
    [id, worker],
  );
  await db.exec("ALTER TABLE inventory_materials ADD COLUMN notes text, ADD COLUMN state text");
  const cases = [
    { meta: {}, a: {}, i: {}, c: {}, phase: "assessment" },
    {
      meta: {},
      a: { media_uploaded: true, factory_operations_done: true },
      i: {},
      c: {},
      phase: "installation",
    },
    {
      meta: { status: "Assessed", status_source: "manager" },
      a: {},
      i: {},
      c: {},
      phase: "installation",
    },
    {
      meta: { status: "Installed", status_source: "manager" },
      a: {},
      i: {},
      c: {},
      phase: "commissioning",
    },
    {
      meta: {},
      a: {},
      i: { coordination_done: true, photos_uploaded: true },
      c: {},
      phase: "commissioning",
    },
    {
      meta: { status: "Not Started Yet", status_source: "manager" },
      a: { assessment_phase_submitted: true },
      i: { installation_phase_submitted: true },
      c: {},
      phase: "assessment",
    },
    {
      meta: {
        status: "Installed",
        activity_logs: [{ type: "status_change", to_status: "Installed" }],
      },
      a: {},
      i: {},
      c: { commissioning_phase_submitted: true },
      phase: "commissioning",
    },
    {
      meta: { status: "Installed", status_source: "associate" },
      a: {},
      i: {},
      c: { commissioning_phase_submitted: true },
      phase: "complete",
    },
    { meta: {}, a: {}, i: {}, c: { commissioning_phase_submitted: true }, phase: "complete" },
    { meta: { status: "Dropped / Rejected" }, a: {}, i: {}, c: {}, phase: "complete" },
    {
      meta: { status: "Assessed", worker_ids: [other] },
      a: {},
      i: {},
      c: {},
      phase: "installation",
    },
    {
      meta: {},
      a: {},
      i: {},
      c: {},
      phase: "installation",
      logistics: { notes: JSON.stringify({ logistics_status: "Delivered" }), state: "Pending" },
    },
  ];
  for (const item of cases) {
    const notes = `[METADATA:${JSON.stringify(item.meta)}]`;
    await db.query("UPDATE sites SET task_notes=$2 WHERE id=$1", [id, notes]);
    for (const table of ["assessment", "installation", "commissioning"]) {
      const data = item[table === "assessment" ? "a" : table === "installation" ? "i" : "c"];
      await db.query(
        `INSERT INTO ${table}(site_id,worker_id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(site_id) DO UPDATE SET data=excluded.data`,
        [id, worker, JSON.stringify(data)],
      );
    }
    await db.query("DELETE FROM inventory_materials WHERE material_name='Stage Factory'");
    if (item.logistics)
      await db.query(
        "INSERT INTO inventory_materials(material_name,submitted,notes,state) VALUES('Stage Factory',true,$1,$2)",
        [item.logistics.notes, item.logistics.state],
      );
    const expected = getCanonicalStatus(
      {
        id,
        name: "Stage Factory",
        company_name: "Stage Factory",
        assigned_worker_id: worker,
        task_notes: notes,
      },
      new Map([[id, { data: item.a }]]),
      new Map([[id, { data: item.i }]]),
      new Map([[id, { data: item.c }]]),
      item.logistics
        ? [{ material_name: "Stage Factory", submitted: true, ...item.logistics }]
        : [],
    );
    assert.equal(
      await scalar("SELECT field_ops_company_status(s) FROM sites s WHERE id=$1", [id]),
      expected,
    );
    assert.equal(
      await scalar("SELECT field_ops_company_phase(s) FROM sites s WHERE id=$1", [id]),
      item.phase,
    );
    await asUser(manager);
    const board = await scalar("SELECT field_ops_board()");
    const company = board.sites.find((s) => s.site_id === id);
    assert.equal(company.phase, item.phase);
    assert.equal(company.status, expected);
    if (item.meta.worker_ids) {
      assert.deepEqual(company.worker_ids, [other]);
      await asUser(worker);
      assert.equal(
        (await scalar("SELECT field_ops_board()")).sites.some((s) => s.site_id === id),
        false,
      );
      await asUser(manager);
      await assert.rejects(
        db.query(
          "SELECT field_ops_schedule($1,$2,'installation',$3,'10:00-12:00','10:00','12:00')",
          [id, worker, today],
        ),
        /not assigned/,
      );
    }
  }
  // A manager's Assessed lifecycle status does not manufacture completed work or earnings.
  await db.query("UPDATE sites SET task_notes=$2 WHERE id=$1", [
    id,
    '[METADATA:{"status":"Assessed","status_source":"manager"}]',
  ]);
  await asUser(manager);
  await db.query(
    "SELECT field_ops_schedule($1,$2,'installation',$3,'18:00-20:00','20:00','21:00')",
    [id, worker, today],
  );
  assert.equal(await scalar("SELECT field_ops_phase_ready($1,'assessment')", [id]), false);
  assert.equal(await scalar("SELECT count(*)::int FROM field_earnings WHERE site_id=$1", [id]), 0);
});

test("pay policy migration zeros unpaid installation, preserves recorded payments and rejects installation-only settlement", async () => {
  await asUser(manager);
  await db.exec("ALTER TABLE field_work_rates DROP CONSTRAINT field_installation_rate_zero");
  await db.query("INSERT INTO field_work_rates VALUES($1,100,77,300,$2,now())", [other, manager]);
  const paid = "00000000-0000-4000-8000-000000000201";
  const unpaid = "00000000-0000-4000-8000-000000000202";
  const payment = "00000000-0000-4000-8000-000000000203";
  await db.query(
    "INSERT INTO field_earnings(id,company_name,associate_id,associate_name,associate_joined,phase,completed_at,earning_date,amount) VALUES($1,'Paid install',$3,'Associate B',now()-interval '1 year','installation',now(),'2020-01-15',200),($2,'Unpaid install',$3,'Associate B',now()-interval '1 year','installation',now(),'2020-02-15',300)",
    [paid, unpaid, other],
  );
  await db.query(
    "INSERT INTO field_payment_records(id,associate_id,period_end,amount,paid_on,recorded_by) VALUES($1,$2,'2020-01-15',200,$3,$4)",
    [payment, other, today, manager],
  );
  await db.query("INSERT INTO field_payment_items VALUES($1,$2,200)", [payment, paid]);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261005140000_field_operations_assessment_commissioning_pay.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    Number(
      await scalar("SELECT installation FROM field_work_rates WHERE associate_id=$1", [other]),
    ),
    0,
  );
  assert.equal(Number(await scalar("SELECT amount FROM field_earnings WHERE id=$1", [unpaid])), 0);
  assert.equal(Number(await scalar("SELECT amount FROM field_earnings WHERE id=$1", [paid])), 200);
  assert.equal(
    Number(await scalar("SELECT amount FROM field_payment_records WHERE id=$1", [payment])),
    200,
  );
  assert.equal(
    Number(await scalar("SELECT amount FROM field_payment_items WHERE earning_id=$1", [paid])),
    200,
  );
  await db.query("SELECT field_ops_set_rates($1,100,999,300)", [other]);
  assert.equal(
    Number(
      await scalar("SELECT installation FROM field_work_rates WHERE associate_id=$1", [other]),
    ),
    0,
  );
  await assert.rejects(
    db.query("SELECT field_ops_record_payment($1,'2020-02-15',$2)", [other, today]),
    /No payable/,
  );
  const installSite = "00000000-0000-4000-8000-000000000204";
  await db.query(
    "INSERT INTO sites(id,name,company_name,assigned_worker_id) VALUES($1,'Unpriced install','Unpriced install',$2)",
    [installSite, other],
  );
  await db.query("DELETE FROM field_work_rates WHERE associate_id=$1", [other]);
  await db.query("INSERT INTO installation(site_id,worker_id,data) VALUES($1,$2,$3::jsonb)", [
    installSite,
    other,
    JSON.stringify({
      installation_phase_submitted: true,
      coordination_done: true,
      photos_uploaded: true,
    }),
  ]);
  assert.equal(
    Number(await scalar("SELECT amount FROM field_earnings WHERE site_id=$1", [installSite])),
    0,
  );
});
