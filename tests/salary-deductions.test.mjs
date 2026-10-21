import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/salary-deductions.ts", import.meta.url), "utf8");
const { salaryDeductionGroups, waiveSalaryDays } = await import(
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`
);
const day = (date, status = "late", units = 0.5, working = true) => ({
  date,
  status,
  automatic_units: units,
  units,
  working_day: working,
});
const late = [day("2026-06-03"), day("2026-06-01"), day("2026-06-05")];

test("monthly deduction groups exclude WFH, off days, future days and unresolved attendance", () => {
  const groups = salaryDeductionGroups([
    ...late,
    day("2026-06-02", "absent", 0),
    day("2026-06-04", "on_leave", 0),
    day("2026-06-06", "work_from_home", 1),
    day("2026-06-07", "off_day", 0, false),
    day("2026-06-08", "scheduled", 0),
    day("2026-06-09", "needs_review", null),
    day("2026-06-10", "not_employed", 0),
  ]);
  assert.deepEqual(
    groups.map((group) => group.status),
    ["late", "absent", "on_leave"],
  );
  assert.deepEqual(
    groups[0].days.map((day) => day.date),
    ["2026-06-01", "2026-06-03", "2026-06-05"],
  );
});

test("allowing two late days pays the earliest two in full and retains other deductions", () => {
  const original = { "2026-06-02": { units: 0.5, reason: "Half day approved" } };
  const updated = waiveSalaryDays(late, original, 2);
  assert.equal(updated["2026-06-01"].units, 1);
  assert.equal(updated["2026-06-03"].units, 1);
  assert.match(updated["2026-06-01"].reason, /2 of 3 days/);
  assert.equal(updated["2026-06-05"], undefined);
  assert.deepEqual(updated["2026-06-02"], original["2026-06-02"]);
  assert.equal(Object.keys(original).length, 1);
  assert.equal(
    late.reduce((sum, day) => sum + (updated[day.date]?.units ?? day.units), 0),
    2.5,
  );
});

test("allowance keeps a manually chosen date and reason when increased and resets to automatic at zero", () => {
  const chosen = { "2026-06-05": { units: 1, reason: "Transport delay accepted" } };
  const increased = waiveSalaryDays(late, chosen, 2);
  assert.deepEqual(increased["2026-06-05"], chosen["2026-06-05"]);
  assert.equal(increased["2026-06-01"].units, 1);
  assert.equal(increased["2026-06-03"], undefined);
  assert.deepEqual(waiveSalaryDays(late, increased, 0), {});
});

test("allowance preserves unrelated adjustments and supports all days without deduction", () => {
  const original = { "2026-06-03": { units: 0, reason: "Full deduction" } };
  assert.deepEqual(waiveSalaryDays(late, original, 0), original);
  const updated = waiveSalaryDays(late, original, late.length);
  assert.ok(late.every((day) => updated[day.date].units === 1));
});

test("allowance rejects fractional, negative, non-finite and excessive counts", () => {
  for (const count of [-1, 0.5, 4, NaN, Infinity]) {
    assert.throws(() => waiveSalaryDays(late, {}, count), /whole number/);
  }
});
