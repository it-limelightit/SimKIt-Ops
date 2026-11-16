import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const db = new PGlite();
const manager = "00000000-0000-4000-8000-000000000001";
const source = readFileSync(new URL("../src/lib/office-off-days.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { inclusiveDays, groupOffDays } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION attendance_assert_manager() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      IF auth.uid() IS DISTINCT FROM '${manager}'::uuid THEN RAISE EXCEPTION 'Attendance access required' USING ERRCODE='42501'; END IF; END $$;
    CREATE FUNCTION assert_manager_module_access(text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM attendance_assert_manager(); END $$;
    CREATE TABLE attendance_settings(effective_from date PRIMARY KEY,shift_start time,grace_minutes integer,absence_cutoff time,
      working_days integer[],holidays date[],updated_by uuid,updated_at timestamptz);
    CREATE TABLE attendance_audit_logs(id uuid DEFAULT gen_random_uuid(),actor_id uuid,action text,details jsonb);
    INSERT INTO attendance_settings VALUES('2026-10-16','10:00',15,NULL,ARRAY[1,2,3,4,5,6],ARRAY[date '2026-10-20'],NULL,now()),
      ('2026-11-10','10:30',10,NULL,ARRAY[1,2,3,4,5],ARRAY[date '2026-12-25'],NULL,now());`);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261116150000_office_holiday_management.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [manager]);
});
after(() => db.close());

test("date ranges are inclusive and reject invalid dates", () => {
  assert.equal(inclusiveDays("2026-11-07", "2026-11-14"), 8);
  assert.equal(inclusiveDays("2026-11-07", "2026-11-07"), 1);
  assert.equal(inclusiveDays("2026-11-14", "2026-11-07"), 0);
  assert.equal(inclusiveDays("2026-02-30", "2026-03-01"), 0);
  assert.equal(inclusiveDays("", "2026-11-14"), 0);
});

test("holiday cards group only consecutive dates with the same reason", () => {
  assert.deepEqual(
    groupOffDays([
      { date: "2026-11-09", reason: "Diwali" },
      { date: "2026-11-07", reason: "Diwali" },
      { date: "2026-11-08", reason: "Diwali" },
      { date: "2026-11-10", reason: "Office closed" },
      { date: "2026-11-12", reason: "Office closed" },
    ]),
    [
      { start: "2026-11-07", end: "2026-11-09", reason: "Diwali", days: 3 },
      { start: "2026-11-10", end: "2026-11-10", reason: "Office closed", days: 1 },
      { start: "2026-11-12", end: "2026-11-12", reason: "Office closed", days: 1 },
    ],
  );
});

test("past vacation updates every effective policy while preserving weekly schedules and other holidays", async () => {
  await db.exec("BEGIN");
  try {
    await db.query("SELECT attendance_save_off_days($1,$2,$3)", [
      "2026-11-07",
      "2026-11-14",
      " Diwali vacation ",
    ]);
    const dates = await scalar("SELECT attendance_office_off_days()");
    assert.equal(dates.filter((d) => d.reason === "Diwali vacation").length, 8);
    assert.ok(dates.some((d) => d.date === "2026-10-20"));
    assert.ok(dates.some((d) => d.date === "2026-12-25"));
    for (const { date } of dates.filter((d) => d.reason === "Diwali vacation")) {
      assert.equal(
        await scalar(
          "SELECT $1::date=ANY(holidays) FROM attendance_settings WHERE effective_from<=$1 ORDER BY effective_from DESC LIMIT 1",
          [date],
        ),
        true,
      );
    }
    const policies = (
      await db.query(
        "SELECT shift_start::text,working_days FROM attendance_settings ORDER BY effective_from",
      )
    ).rows;
    assert.deepEqual(
      policies.map((p) => p.shift_start),
      ["10:00:00", "10:30:00"],
    );
    assert.deepEqual(
      policies.map((p) => p.working_days),
      [
        [1, 2, 3, 4, 5, 6],
        [1, 2, 3, 4, 5],
      ],
    );
    assert.equal(
      await scalar(
        "SELECT count(*)::integer FROM attendance_audit_logs WHERE action='office_off_days_saved'",
      ),
      1,
    );
    await db.query("SELECT attendance_save_off_days($1,$2,$3)", [
      "2026-11-07",
      "2026-11-14",
      "Updated reason",
    ]);
    assert.equal(await scalar("SELECT count(*)::integer FROM attendance_office_holidays"), 8);
    assert.equal(
      (await scalar("SELECT attendance_office_off_days()")).filter(
        (d) => d.reason === "Updated reason",
      ).length,
      8,
    );
    await db.query("SELECT attendance_remove_off_days($1,$2)", ["2026-11-07", "2026-11-14"]);
    assert.deepEqual(
      (await scalar("SELECT attendance_office_off_days()")).map((d) => d.date),
      ["2026-10-20", "2026-12-25"],
    );
    assert.equal(await scalar("SELECT count(*)::integer FROM attendance_office_holidays"), 0);
  } finally {
    await db.exec("ROLLBACK");
  }
});

test("invalid ranges, missing policies, and unauthorized calls cannot change holidays", async () => {
  for (const args of [
    [null, "2026-11-14", "Holiday"],
    ["2026-11-14", "2026-11-07", "Holiday"],
    ["2026-01-01", "2027-12-31", "Holiday"],
    ["2026-11-07", "2026-11-14", "  "],
    ["2025-01-01", "2025-01-02", "Holiday"],
  ]) {
    await assert.rejects(db.query("SELECT attendance_save_off_days($1,$2,$3)", args));
  }
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  try {
    await assert.rejects(
      db.query("SELECT attendance_save_off_days('2026-11-07','2026-11-14','Holiday')"),
      /Attendance access required/,
    );
    await assert.rejects(
      db.query("SELECT attendance_remove_off_days('2026-11-07','2026-11-14')"),
      /Attendance access required/,
    );
    await assert.rejects(
      db.query("SELECT attendance_office_off_days()"),
      /Attendance access required/,
    );
    assert.equal(
      await scalar(
        "SELECT has_function_privilege('anon','attendance_save_off_days(date,date,text)','EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        "SELECT has_table_privilege('authenticated','attendance_office_holidays','INSERT')",
      ),
      false,
    );
  } finally {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [manager]);
  }
  assert.equal(await scalar("SELECT count(*)::integer FROM attendance_office_holidays"), 0);
});
