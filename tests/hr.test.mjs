import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const db = new PGlite();
const hardik = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const office = "00000000-0000-4000-8000-000000000003";
const field = "00000000-0000-4000-8000-000000000004";
const attendance = "00000000-0000-4000-8000-000000000005";
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const asUser = (id) => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
const migration = (name) =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const details = (email, extra = {}) => ({
  name: "New Hire",
  email,
  mobile: "9876543210",
  department: "software",
  designation: "Full Stack Developer Intern",
  mentor_name: "Tarun Purohit",
  joining_date: "2020-01-01",
  app_access: "employee",
  attendance_method: "office_device",
  address: "Ahmedabad, Gujarat",
  college: "",
  ...extra,
});
const terms = (extra = {}) => ({
  employment_type: "internship",
  monthly_amount: 8000,
  annual_ctc: null,
  internship_months: 6,
  internship_end: "2099-06-30",
  effective_from: "2020-01-01",
  ...extra,
});
const save = (d, t = terms()) =>
  scalar("SELECT hr_save_employee(NULL,NULL,$1::jsonb,$2::jsonb)", [
    JSON.stringify(d),
    JSON.stringify(t),
  ]);
const row = async (id) => (await db.query("SELECT * FROM hr_employees WHERE id=$1", [id])).rows[0];
let employee;

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TYPE public.app_role AS ENUM ('worker','supervisor','owner','employee');
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text UNIQUE,email_confirmed_at timestamptz,raw_app_meta_data jsonb DEFAULT '{}',raw_user_meta_data jsonb DEFAULT '{}');
    CREATE TABLE profiles(id uuid PRIMARY KEY,email text,name text,mobile text,whatsapp text,is_active boolean DEFAULT false);
    CREATE TABLE user_roles(user_id uuid,role public.app_role,UNIQUE(user_id,role));
    CREATE FUNCTION has_role(_id uuid,_role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_id AND role=_role) $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    GRANT SELECT ON auth.users TO authenticated;
    GRANT SELECT,UPDATE ON profiles TO authenticated;
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY profile_access ON profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
  `);
  for (const name of [
    "20260610064745_f49b7c5e-2959-4de8-8d3a-7174a6e65c82.sql",
    "20261006150000_manager_device_attendance.sql",
    "20261012110000_attendance_directory_cleanup.sql",
    "20261012141000_attendance_employee_accounts.sql",
    "20261012143000_attendance_employee_profile_activation.sql",
    "20261014120000_scoped_manager_module_access.sql",
    "20261016121000_salary_manager_access.sql",
    "20261021120000_hr_hiring.sql",
    "20261022120000_hr_existing_employee_directory.sql",
    "20261022120000_hr_existing_employee_directory.sql",
    "20261022140000_hr_reporting_directory_delete.sql",
    "20261022140000_hr_reporting_directory_delete.sql",
    "20261022180000_office_account_metadata_role_assignment.sql",
  ]) {
    try {
      await db.exec(migration(name));
    } catch (failure) {
      console.error(name, {
        message: failure.message,
        position: failure.position,
        internalPosition: failure.internalPosition,
        internalQuery: failure.internalQuery,
        where: failure.where,
      });
      throw failure;
    }
  }
  await db.exec(`INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
    ('${hardik}','admin@limelightit.io',now(),'{}'),('${other}','tarun@limelightit.io',now(),'{}'),
    ('${office}','office@test.io',now(),'{}'),('${field}','field@test.io',now(),'{}');
    UPDATE profiles SET is_active=true;
    DELETE FROM user_roles WHERE user_id IN ('${hardik}','${other}','${office}');
    INSERT INTO user_roles VALUES('${hardik}','supervisor'),('${other}','supervisor'),('${office}','employee');
    INSERT INTO attendance_employees(id,name,department,enroll_id,email,email_verified,employment_start,created_by,auth_user_id,enrollment_status)
    VALUES('${attendance}','Office Existing','software','00104','office@test.io',true,'2020-01-01','${hardik}','${office}','enrolled');
    UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('office_employee',true,'attendance_employee_id','${attendance}') WHERE id='${office}';
    SET ROLE authenticated;`);
  await asUser(hardik);
});
after(() => db.close());

test("HR is restricted to Hardik by verified Auth identity, including direct table and helper access", async () => {
  await asUser(other);
  assert.equal(await scalar("SELECT hr_can_manage()"), false);
  for (const sql of [
    "SELECT hr_board()",
    "SELECT hr_assert_access()",
    "SELECT hr_save_employee(NULL,NULL,'{}',NULL)",
    `SELECT hr_attach_login('${office}',1)`,
    `SELECT hr_provision_context('${office}',1)`,
  ])
    await assert.rejects(db.query(sql), /HR manager access required/);
  assert.equal(await scalar("SELECT count(*)::int FROM hr_employees"), 0);
  await assert.rejects(
    db.query(`SELECT hr_insert_terms('${office}','{}','bypass')`),
    /permission denied/,
  );
  await asUser(hardik);
  assert.deepEqual(await scalar("SELECT limited_manager_modules()"), [
    "salary-expense",
    "hr-hiring",
  ]);
  await assert.rejects(db.query("SELECT attendance_assert_manager()"), /Module access denied/);
  assert.equal(await scalar("SELECT hr_can_manage()"), true);
});

test("existing office and field employees are available for the HR directory immediately, without writes", async () => {
  const board = await scalar("SELECT hr_board()");
  const existingOffice = board.candidates.find((c) => c.auth_user_id === office);
  const existingField = board.candidates.find((c) => c.auth_user_id === field);
  assert.equal(existingOffice.directory_visible, true);
  assert.equal(existingOffice.enroll_id, "00104");
  assert.equal(existingOffice.enrollment_status, "enrolled");
  assert.equal(existingField.directory_visible, true);
  assert.equal(existingField.app_access, "field_associate");
  assert.equal(board.candidates.find((c) => c.auth_user_id === hardik).directory_visible, false);
  assert.equal(board.candidates.find((c) => c.auth_user_id === other).directory_visible, false);
  assert.equal(board.employees.length, 0);
  assert.equal(board.terms.length, 0);
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_device_commands"), 0);
});

test("adding an HR employee creates initial terms without creating a login or starting enrollment", async () => {
  employee = await save(details("new@test.io"));
  const e = await row(employee);
  assert.match(e.employee_code, /^LL-\d+$/);
  assert.equal(e.auth_user_id, null);
  assert.equal(e.attendance_employee_id, null);
  assert.equal(e.status, "onboarding");
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_device_commands"), 0);
  assert.equal(
    await scalar("SELECT count(*)::int FROM hr_employment_terms WHERE employee_id=$1", [employee]),
    1,
  );
  await assert.rejects(save(details("NEW@test.io")), /duplicate key/);
  await assert.rejects(save(details("invalid@test.io", { mobile: "letters" })), /valid employee/);
  await assert.rejects(
    db.query("UPDATE hr_employees SET name='direct edit' WHERE id=$1", [employee]),
    /permission denied/,
  );
});

test("deleting an existing directory entry hides it across reloads and Undo preserves its login and device", async () => {
  await db.exec("RESET ROLE");
  const before = await scalar("SELECT to_jsonb(a) FROM attendance_employees a WHERE id=$1", [
    attendance,
  ]);
  await db.exec("SET ROLE authenticated");
  const deleted = await scalar(
    "SELECT hr_delete_employee(NULL,NULL,$1,$2,'Duplicate directory entry')",
    [office, attendance],
  );
  assert.equal(
    (await scalar("SELECT hr_board()")).candidates.some((c) => c.auth_user_id === office),
    false,
  );
  await db.exec("RESET ROLE");
  assert.deepEqual(
    await scalar("SELECT to_jsonb(a) FROM attendance_employees a WHERE id=$1", [attendance]),
    before,
  );
  assert.equal(await scalar("SELECT is_active FROM profiles WHERE id=$1", [office]), true);
  await db.exec("SET ROLE authenticated");
  await assert.rejects(
    scalar("SELECT hr_delete_employee(NULL,NULL,$1,$2,NULL)", [office, attendance]),
    /changed/,
  );
  await assert.rejects(save(details("office@test.io")), /deleted from HR/);
  await asUser(other);
  await assert.rejects(
    scalar("SELECT hr_restore_employee($1)", [deleted]),
    /HR manager access required/,
  );
  await assert.rejects(
    scalar("SELECT hr_delete_employee(NULL,NULL,$1,$2,NULL)", [office, attendance]),
    /HR manager access required/,
  );
  assert.equal(await scalar("SELECT count(*)::int FROM hr_directory_deletions"), 0);
  await asUser(hardik);
  await scalar("SELECT hr_restore_employee($1)", [deleted]);
  assert.equal(
    (await scalar("SELECT hr_board()")).candidates.some((c) => c.auth_user_id === office),
    true,
  );
  await scalar("SELECT hr_restore_employee($1)", [deleted]); // Idempotent Undo.
  await assert.rejects(db.query("DELETE FROM hr_directory_deletions"), /permission denied/);
});

test("salary revisions preserve history, use effective dates and reject stale edits", async () => {
  const revise = (revision, t) =>
    scalar("SELECT hr_revise_employment($1,$2,$3::jsonb,'Performance review')", [
      employee,
      revision,
      JSON.stringify(t),
    ]);
  await revise(1, terms({ monthly_amount: 12000, effective_from: "2021-01-01" }));
  await assert.rejects(revise(1, terms({ monthly_amount: 9000 })), /Employee changed/);
  await revise(
    2,
    terms({
      employment_type: "full_time",
      monthly_amount: 30000,
      annual_ctc: 400000,
      internship_months: null,
      internship_end: null,
      effective_from: "2099-01-01",
    }),
  );
  let board = await scalar("SELECT hr_board()");
  assert.equal(board.employees.find((e) => e.id === employee).current_term.monthly_amount, 12000);
  assert.equal(board.terms.filter((t) => t.employee_id === employee).length, 3);
  await revise(
    3,
    terms({
      employment_type: "full_time",
      monthly_amount: 25000,
      annual_ctc: 350000,
      internship_months: null,
      internship_end: null,
      effective_from: "2022-01-01",
    }),
  );
  board = await scalar("SELECT hr_board()");
  assert.equal(
    board.employees.find((e) => e.id === employee).current_term.employment_type,
    "full_time",
  );
  assert.equal((await row(employee)).revision, 4);
  await assert.rejects(revise(4, terms({ effective_from: "2019-01-01" })), /effective date/);
  await assert.rejects(revise(4, terms({ monthly_amount: "NaN" })), /compensation/);
  await assert.rejects(
    revise(4, terms({ employment_type: "full_time", annual_ctc: 0 })),
    /positive annual CTC/,
  );
});

test("importing an office account retains its roles, device ID and enrolled status", async () => {
  const id = await save(
    details("office@test.io", {
      source_auth_user_id: office,
      source_attendance_employee_id: attendance,
      name: "Office Existing",
    }),
  );
  const e = await row(id);
  assert.equal(e.auth_user_id, office);
  assert.equal(e.attendance_employee_id, attendance);
  assert.equal(e.status, "active");
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_device_commands"), 0);
  // Attendance is not directly readable by Hardik; the constrained HR board exposes the link.
  const b = await scalar("SELECT hr_board()");
  const imported = b.employees.find((e) => e.id === id);
  assert.equal(imported.enroll_id, "00104");
  assert.equal(imported.enrollment_status, "enrolled");
  assert.equal(
    b.candidates.some((c) => c.auth_user_id === office),
    false,
  );
  await assert.rejects(
    scalar("SELECT hr_save_employee($1,$2,$3::jsonb,NULL)", [
      id,
      e.revision,
      JSON.stringify(details("different@test.io")),
    ]),
    /linked login email/,
  );
});

test("field associates link the field login without an office record or role changes", async () => {
  const id = await save(
    details("field@test.io", {
      source_auth_user_id: field,
      department: "field",
      designation: "Business Consultant",
      app_access: "field_associate",
      attendance_method: "field_online",
    }),
  );
  const e = await row(id);
  assert.equal(e.auth_user_id, field);
  assert.equal(e.attendance_employee_id, null);
  assert.equal(await scalar("SELECT hr_can_manage()"), true);
  await assert.rejects(
    scalar("SELECT hr_request_enrollment($1,$2)", [id, e.revision]),
    /office employee/,
  );
  await assert.rejects(
    save(details("tarun@limelightit.io", { source_auth_user_id: other })),
    /different workspace permissions/,
  );
  assert.equal(
    (await scalar("SELECT hr_board()")).employees.some((e) => e.email === "tarun@limelightit.io"),
    false,
    "failed imports are atomic",
  );
});

test("offer snapshots keep the original employee and salary after later changes", async () => {
  const e = await row(employee);
  const board = await scalar("SELECT hr_board()");
  const term = board.terms.find((t) => t.employee_id === employee && t.monthly_amount === 12000);
  const fields = {
    offer_date: board.today,
    honorific: "Mr.",
    greeting_name: "New",
    recipient_location: "Ahmedabad",
    acceptance_place: "Ahmedabad",
    initial_stipend_months: 3,
    acceptance_days: 2,
    office_timings: "10 AM to 7 PM",
    incentive_per_installation: 2000,
    travel_per_km: 3.5,
    installation_target: 5,
    probation_months: 5,
    payment_day: 7,
    payroll_cutoff_day: 30,
  };
  const offer = await scalar("SELECT hr_save_offer($1,$2,$3,'software',$4::jsonb)", [
    employee,
    e.revision,
    term.id,
    JSON.stringify(fields),
  ]);
  assert.match(offer.offer_number, /^LL-OFFER-\d{4}-\d+$/);
  assert.equal(offer.snapshot.term.monthly_amount, 12000);
  await scalar("SELECT hr_save_employee($1,$2,$3::jsonb,NULL)", [
    employee,
    e.revision,
    JSON.stringify(details("new@test.io", { name: "New Name" })),
  ]);
  const saved = await scalar("SELECT snapshot FROM hr_offer_letters WHERE id=$1", [offer.id]);
  assert.equal(saved.employee.name, "New Hire");
  assert.equal(saved.term.monthly_amount, 12000);
  await assert.rejects(
    db.query("UPDATE hr_offer_letters SET snapshot='{}' WHERE id=$1", [offer.id]),
    /permission denied/,
  );
});

test("new office login links without enrollment, and enrollment is queued only once on explicit request", async () => {
  const e = await row(employee);
  const context = await scalar("SELECT hr_provision_context($1,$2)", [employee, e.revision]);
  assert.equal(context.email, "new@test.io");
  const newAuth = "00000000-0000-4000-8000-000000000009";
  await db.exec("RESET ROLE");
  await db.query(
    "INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) VALUES($1,$2,now(),$3::jsonb)",
    [
      newAuth,
      context.email,
      JSON.stringify({
        office_employee: true,
        attendance_employee_id: context.attendance_employee_id,
      }),
    ],
  );
  await db.exec("SET ROLE authenticated");
  await scalar("SELECT hr_attach_login($1,$2)", [employee, e.revision]);
  let linked = await row(employee);
  assert.equal(linked.auth_user_id, newAuth);
  assert.equal(linked.attendance_employee_id, employee);
  const b = await scalar("SELECT hr_board()");
  assert.match(b.employees.find((v) => v.id === employee).enroll_id, /^\d+$/);
  assert.equal(await scalar("SELECT count(*)::int FROM attendance_device_commands"), 0);
  await scalar("SELECT hr_request_enrollment($1,$2)", [employee, linked.revision]);
  await scalar("SELECT hr_request_enrollment($1,$2)", [employee, linked.revision]);
  await db.exec("RESET ROLE");
  assert.equal(
    await scalar("SELECT count(*)::int FROM attendance_device_commands WHERE employee_id=$1", [
      employee,
    ]),
    1,
  );
  assert.deepEqual(
    (await db.query("SELECT role::text FROM user_roles WHERE user_id=$1", [newAuth])).rows,
    [{ role: "employee" }],
  );
  await db.exec("SET ROLE authenticated");
  await scalar("SELECT hr_mark_left($1,$2,'Employment ended')", [employee, linked.revision]);
  linked = await row(employee);
  assert.equal(linked.status, "left");
  await assert.rejects(
    scalar("SELECT hr_request_enrollment($1,$2)", [employee, linked.revision]),
    /office employee/,
  );
  assert.equal(
    (await scalar("SELECT hr_board()")).offers.some((o) => o.employee_id === employee),
    true,
  );
  await db.exec("RESET ROLE");
  assert.equal(await scalar("SELECT is_active FROM profiles WHERE id=$1", [newAuth]), false);
  assert.equal(
    await scalar("SELECT active FROM attendance_employees WHERE id=$1", [employee]),
    false,
  );
  await db.exec("SET ROLE authenticated");
});

test("upcoming hires retain HR records and offers while login activation waits for joining", async () => {
  const id = await save(
    details("future@test.io", { joining_date: "2099-01-01" }),
    terms({ effective_from: "2099-01-01" }),
  );
  await assert.rejects(scalar("SELECT hr_provision_context($1,1)", [id]), /joining date/);
  assert.equal(
    (await scalar("SELECT hr_board()")).employees.find((e) => e.id === id).current_term
      .effective_from,
    "2099-01-01",
  );
});

test("saved employee deletion preserves terms and letters, blocks mutations, checks revisions, and can be undone", async () => {
  const e = await row(employee);
  await assert.rejects(
    scalar("SELECT hr_delete_employee($1,$2)", [employee, e.revision - 1]),
    /changed/,
  );
  const termsBefore = await scalar(
    "SELECT count(*)::int FROM hr_employment_terms WHERE employee_id=$1",
    [employee],
  );
  const offersBefore = await scalar(
    "SELECT count(*)::int FROM hr_offer_letters WHERE employee_id=$1",
    [employee],
  );
  assert.ok(offersBefore > 0);
  const deleted = await scalar("SELECT hr_delete_employee($1,$2)", [employee, e.revision]);
  const board = await scalar("SELECT hr_board()");
  for (const collection of [board.employees, board.terms, board.offers])
    assert.equal(
      collection.some((item) => (item.employee_id || item.id) === employee),
      false,
    );
  assert.equal(
    board.candidates.some((c) => c.email === e.email),
    false,
  );
  assert.equal(
    await scalar("SELECT count(*)::int FROM hr_employment_terms WHERE employee_id=$1", [employee]),
    termsBefore,
  );
  assert.equal(
    await scalar("SELECT count(*)::int FROM hr_offer_letters WHERE employee_id=$1", [employee]),
    offersBefore,
  );
  assert.equal((await row(employee)).status, e.status);
  const rev = (await row(employee)).revision;
  for (const [sql, args] of [
    [
      "SELECT hr_save_employee($1,$2,$3::jsonb,NULL)",
      [employee, rev, JSON.stringify(details(e.email))],
    ],
    [
      "SELECT hr_revise_employment($1,$2,$3::jsonb,'Test')",
      [employee, rev, JSON.stringify(terms())],
    ],
    ["SELECT hr_attach_login($1,$2)", [employee, rev]],
    ["SELECT hr_request_enrollment($1,$2)", [employee, rev]],
    ["SELECT hr_mark_left($1,$2,'Test')", [employee, rev]],
    ["SELECT hr_provision_context($1,$2)", [employee, rev]],
    [
      "SELECT hr_save_offer($1,$2,$3,'software','{}'::jsonb)",
      [employee, rev, board.terms[0]?.id || employee],
    ],
  ])
    await assert.rejects(db.query(sql, args), /deleted from HR/);
  await scalar("SELECT hr_restore_employee($1)", [deleted]);
  assert.ok((await scalar("SELECT hr_board()")).employees.some((item) => item.id === employee));
  assert.equal((await row(employee)).deleted_at, null);
  assert.equal((await row(employee)).revision, e.revision + 2);
  await assert.rejects(
    scalar("SELECT hr_delete_employee($1,$2)", [employee, e.revision]),
    /changed/,
  );
});

test("reporting hierarchy migration updates existing saved mentors, including Kuldeep, and audits the change", async () => {
  const ids = [];
  for (const [name, email, access, expected] of [
    ["Vikash", "vikashkumavat.limelight@gmail.com", "employee", "Kuldeep Shrimali"],
    ["Mayank", "mayankk.limelightit@gmail.com", "employee", "Kuldeep Shrimali"],
    ["Suraj", "surajbiswas.limelight@gmail.com", "employee", "Kuldeep Shrimali"],
    ["Kuldeep", "kuldeepshrimali.limelight@gmail.com", "employee", "Tarun Purohit"],
    ["Nit", "nitsanghani1@gmail.com", "employee", "Tarun Purohit"],
    ["Kishan", "kishanvyas308@gmail.com", "employee", "Tarun Purohit"],
    ["Hitesh", "associatelimelight@gmail.com", "employee", "Tarun Purohit"],
    ["Raghav", "info@limelightit.io", "employee", "Tarun Purohit"],
    ["Aryan", "aryankadiya2005@gmail.com", "employee", "Hitesh Bhai"],
    ["Farid", "farid@test.io", "field_associate", "Raghav Gaur & Hitesh Bhai"],
  ]) {
    const id = await save(
      details(email, {
        name,
        mentor_name: "Old mentor",
        app_access: access,
        attendance_method: access === "field_associate" ? "field_online" : "office_device",
      }),
    );
    ids.push([id, expected]);
  }
  await db.exec("RESET ROLE");
  await db.exec(migration("20261022140000_hr_reporting_directory_delete.sql"));
  await db.exec("SET ROLE authenticated");
  for (const [id, expected] of ids) {
    const e = await row(id);
    assert.equal(e.mentor_name, expected);
    assert.equal(e.revision, 2);
    assert.equal(
      await scalar(
        "SELECT count(*)::int FROM hr_events WHERE employee_id=$1 AND action='reporting_manager_updated'",
        [id],
      ),
      1,
    );
  }
});

test("HR route access is email-specific and internship end calculations handle short months", async () => {
  const encode = (source) =>
    `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
  const { canManageHr } = await import(
    encode(readFileSync(new URL("../src/lib/hr-access.ts", import.meta.url), "utf8"))
  );
  assert.equal(canManageHr(" ADMIN@LIMELIGHTIT.IO "), true);
  assert.equal(canManageHr("admin@limelight.io"), false);
  assert.equal(canManageHr("tarun@limelightit.io"), false);
  let source = readFileSync(new URL("../src/lib/hr.ts", import.meta.url), "utf8");
  source = source
    .replace('import { supabase } from "@/integrations/supabase/client";', "const supabase = {};")
    .replace('export { canManageHr } from "./hr-access";', "");
  const { internshipEnd, hrDirectory, defaultHrMentor } = await import(encode(source));
  for (const name of ["vikash", "vikas", "Mayank", "Suraj Biswas"])
    assert.equal(defaultHrMentor({ name }), "Kuldeep Shrimali");
  for (const name of ["Nit Sanghani", "Kishan vyas", "Hitesh Bhai", "Raghav Gaur", "Kuldeep"])
    assert.equal(defaultHrMentor({ name }), "Tarun Purohit");
  assert.equal(defaultHrMentor({ name: "Aryan Kadiya" }), "Hitesh Bhai");
  assert.equal(
    defaultHrMentor({ name: "Farid Garana", app_access: "field_associate" }),
    "Raghav Gaur & Hitesh Bhai",
  );
  assert.equal(defaultHrMentor({ name: "New employee" }), "");
  assert.equal(internshipEnd("2026-01-31", 1), "2026-02-27");
  assert.equal(internshipEnd("2026-08-05", 4), "2026-12-04");
  const candidates = [
    {
      name: "Existing Office",
      email: "office@example.com",
      mobile: "",
      department: "software",
      app_access: "employee",
      auth_user_id: "office-account",
      attendance_employee_id: "office-record",
      joining_date: "2026-10-01",
      directory_visible: true,
      enroll_id: "00104",
      enrollment_status: "enrolled",
    },
    {
      name: "Existing Field",
      email: "field@example.com",
      mobile: "",
      department: null,
      app_access: "field_associate",
      auth_user_id: "field-account",
      attendance_employee_id: null,
      joining_date: null,
      directory_visible: true,
    },
    {
      name: "Inactive Field",
      email: "inactive@example.com",
      mobile: "",
      department: null,
      app_access: "field_associate",
      auth_user_id: "inactive-account",
      attendance_employee_id: null,
      joining_date: null,
      directory_visible: false,
    },
  ];
  let directory = hrDirectory({ employees: [], candidates });
  assert.equal(directory.length, 2);
  assert.equal(directory.find((e) => e.name === "Existing Office").enroll_id, "00104");
  assert.equal(directory.find((e) => e.name === "Existing Field").department, "field");
  for (const e of directory) {
    assert.equal(e.current_term, null);
    assert.equal(e.joining_date, "");
    assert.equal(e.designation, "");
    assert.equal(
      e.mentor_name,
      e.app_access === "field_associate" ? "Raghav Gaur & Hitesh Bhai" : "",
    );
  }
  directory = hrDirectory({
    employees: [
      {
        ...directory.find((e) => e.name === "Existing Office"),
        id: "hr-record",
        directory_source: undefined,
      },
    ],
    candidates,
  });
  assert.equal(
    directory.length,
    2,
    "completing HR details replaces the existing row instead of duplicating it",
  );
});
