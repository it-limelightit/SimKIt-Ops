import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/attendance-analytics.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { attendanceSummary, formatAttendanceDuration, matchesAttendanceStatus, attendanceCsv } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const row = (status, late, entry = null) => ({
  employee_id: status,
  name: "Employee",
  enroll_id: "00104",
  department: "software",
  status,
  late_minutes: late,
  entry_at: entry,
  leave_conflict: false,
});

test("lateness uses hours and minutes without decimal-hour ambiguity", () => {
  for (const [minutes, expected] of [
    [0, "0m"],
    [15, "15m"],
    [60, "1h"],
    [75, "1h 15m"],
    [135, "2h 15m"],
    [null, "—"],
  ]) {
    assert.equal(formatAttendanceDuration(minutes), expected);
  }
});

test("daily analytics exclude leave and off days from expectations and do not count unknown timing as on time", () => {
  const stamp = "2026-10-09T05:00:00Z";
  const rows = [
    row("present", 0, stamp),
    row("late", 75, stamp),
    row("needs_review", null, stamp),
    row("on_leave", null),
    row("off_day", null),
    row("absent", null),
    row("awaiting_scan", null),
  ];
  const summary = attendanceSummary(rows);
  assert.equal(summary.expected, 5);
  assert.equal(summary.recorded, 3);
  assert.equal(summary.coverage, 60);
  assert.equal(summary.punctuality, 50);
  assert.equal(summary.unassessed, 1);
  assert.equal(summary.totalDelay, 75);
  assert.equal(summary.averageDelay, 75);
  assert.equal(summary.review, 1);
  assert.equal(summary.absent, 1);
  assert.equal(attendanceSummary([]).coverage, null);
  assert.equal(attendanceSummary([]).punctuality, null);
});

test("timing card filters include conflicts without changing their review status", () => {
  const conflict = { ...row("needs_review", 75, "2026-10-09T05:00:00Z"), leave_conflict: true };
  assert.equal(matchesAttendanceStatus(conflict, "late_arrivals"), true);
  assert.equal(matchesAttendanceStatus(conflict, "late"), false);
  assert.equal(matchesAttendanceStatus(conflict, "needs_review"), true);
  assert.equal(
    matchesAttendanceStatus(row("needs_review", null, "2026-10-09T05:00:00Z"), "on_time"),
    false,
  );
});

test("CSV exports exact late minutes and IST time, escapes names and neutralizes spreadsheet formulas", () => {
  const csv = attendanceCsv(
    [{ ...row("late", 75, "2026-10-09T05:00:00Z"), name: '=SUM(1,2) "Name"' }],
    "2026-10-09",
  );
  assert.ok(csv.includes('"\'=SUM(1,2) ""Name"""'));
  assert.ok(csv.includes('"10:30:00"'));
  assert.ok(csv.includes('"00104"'));
  assert.ok(csv.includes('"75","1h 15m"'));
});

const analyticsUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const historySource = readFileSync(
  new URL("../src/components/attendance/attendance-history.ts", import.meta.url),
  "utf8",
);
const historyCompiled = ts
  .transpileModule(historySource, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  })
  .outputText.replace('"@/lib/attendance-analytics"', JSON.stringify(analyticsUrl));
const { addDays, monthDates, dateRange, employeeHistoryCsv, createAttendanceDayCache } =
  await import(`data:text/javascript;base64,${Buffer.from(historyCompiled).toString("base64")}`);

test("history calendar handles leap days, year boundaries and bounded custom ranges", () => {
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(monthDates("2024-02").length, 29);
  assert.equal(monthDates("2026-02").length, 28);
  assert.deepEqual(dateRange("2026-10-09", "2026-10-08"), []);
  assert.deepEqual(dateRange("", "2026-10-08"), []);
  assert.equal(dateRange("2026-01-01", "2026-12-31").length, 94);
});

test("history export uses the same raw records and escaping as daily export", () => {
  const first = { ...row("late", 75, "2026-10-09T05:00:00Z"), name: "=Employee" };
  const second = row("awaiting_scan", null);
  const csv = employeeHistoryCsv([
    { date: "2026-10-09", row: first },
    { date: "2026-10-08", row: second },
    { date: "2026-10-07", row: null },
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], attendanceCsv([first], "2026-10-09").split("\r\n")[1]);
  assert.equal(lines[2], attendanceCsv([second], "2026-10-08").split("\r\n")[1]);
  assert.ok(csv.includes("awaiting_scan"));
  assert.ok(!csv.includes("absent"));
});

test("history cache deduplicates concurrent dates, reuses dashboard data and retries errors", async () => {
  let calls = 0;
  const board = { rows: [] };
  const cache = createAttendanceDayCache(async (date) => {
    calls++;
    if (date === "fail") throw new Error("unavailable");
    return board;
  });
  cache.seed("2026-10-09", board);
  assert.equal(await cache.get("2026-10-09"), board);
  assert.equal(calls, 0);
  const results = await Promise.all([cache.get("2026-10-08"), cache.get("2026-10-08")]);
  assert.equal(calls, 1);
  assert.equal(results[0], results[1]);
  await assert.rejects(cache.get("fail"));
  await assert.rejects(cache.get("fail"));
  assert.equal(calls, 3);
  cache.clear();
  await cache.get("2026-10-08");
  assert.equal(calls, 4);
});

test("live dashboard data wins over an older in-flight history response", async () => {
  let resolve;
  const cache = createAttendanceDayCache(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const request = cache.get("2026-10-09");
  const latest = { rows: [{ status: "late" }] };
  cache.seed("2026-10-09", latest);
  resolve({ rows: [] });
  assert.equal(await request, latest);
  assert.equal(await cache.get("2026-10-09"), latest);
});
