import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import ExcelJS from "exceljs";

const require = createRequire(import.meta.url);
const source = readFileSync(
  new URL("../src/lib/attendance-excel.ts", import.meta.url),
  "utf8",
).replaceAll(
  'import("exceljs")',
  `import(${JSON.stringify(pathToFileURL(require.resolve("exceljs")).href)})`,
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createEmployeeAttendanceWorkbook, createOverallAttendanceWorkbook } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const employee = {
  id: "test",
  name: '=HYPERLINK("https://example.com")',
  enroll_id: "00104",
  department: "software",
  email: "test@example.com",
};
const row = (status, late_minutes, entry_at = null, leave_conflict = false) => ({
  status,
  late_minutes,
  entry_at,
  leave_conflict,
});

test("Excel download round-trips as a filterable workbook with IST times, accurate summaries and preserved IDs", async () => {
  const days = [
    { date: "2026-10-12", row: row("needs_review", 75, "2026-10-12T06:00:00Z", true) },
    { date: "2026-10-10", row: row("present", 0, "2026-10-10T04:30:00Z") },
    { date: "2026-10-11", row: null },
  ];
  const workbook = await createEmployeeAttendanceWorkbook(
    employee,
    days,
    "2026-10-10",
    "2026-10-12",
  );
  const buffer = await workbook.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  assert.deepEqual(
    restored.worksheets.map((sheet) => sheet.name),
    ["Overview", "Daily records", "Report guide"],
  );
  assert.equal(restored.getWorksheet("Salary review"), undefined);
  const overview = restored.getWorksheet("Overview");
  assert.equal(overview.getCell("B4").value, employee.name);
  assert.equal(overview.getCell("E4").value, "00104");
  assert.equal(overview.getCell("E4").numFmt, "@");
  assert.equal(overview.getCell("B10").result, 3);
  assert.equal(overview.getCell("B11").result, 2);
  assert.equal(overview.getCell("B12").result, 1);
  assert.equal(overview.getCell("B13").result, 1);
  assert.equal(overview.getCell("E10").result, 0);
  assert.equal(overview.getCell("B14").result.toISOString(), "1899-12-30T01:15:00.000Z");
  assert.equal(overview.getCell("B14").numFmt, "[h]:mm");
  const records = restored.getWorksheet("Daily records");
  assert.equal(records.getCell("A6").value.toISOString(), "2026-10-10T00:00:00.000Z");
  assert.equal(records.getCell("C6").value.toISOString(), "1899-12-30T10:00:00.000Z");
  assert.equal(records.getCell("C6").numFmt, "hh:mm AM/PM");
  assert.equal(records.getCell("D7").value, "No record");
  assert.equal(records.getCell("D8").value, "Needs review");
  assert.equal(records.getCell("E8").value, 75);
  assert.equal(records.getCell("F8").value, "Yes");
  assert.ok(records.getCell("H8").value.includes("manager review"));
  assert.equal(records.getCell("G8").numFmt, "[h]:mm");
  assert.equal(records.getColumn(5).hidden, true);
  assert.equal(records.views[0].xSplit, 0);
  assert.equal(records.views[0].topLeftCell, "A6");
  assert.equal(records.views[0].ySplit, 5);
  assert.ok(records.getTable("EmployeeAttendance"));
  assert.ok(records.getCell("E9").formula.includes("SUBTOTAL"));
  assert.equal(records.getCell("C9").numFmt, "0");
  assert.equal(records.pageSetup.printTitlesRow, "1:5");
  assert.ok(records.conditionalFormattings.length >= 6);
  assert.equal(days[0].date, "2026-10-12");
});

test("Excel report supports periods with no employee records without inventing absences", async () => {
  const workbook = await createEmployeeAttendanceWorkbook(
    employee,
    [{ date: "2026-10-12", row: null }],
    "2026-10-12",
    "2026-10-12",
  );
  assert.equal(workbook.getWorksheet("Overview").getCell("E10").result, 0);
  assert.equal(workbook.getWorksheet("Daily records").getCell("D6").value, "No record");
  assert.equal(workbook.getWorksheet("Daily records").getCell("C6").value, null);
});

test("attendance report separates pre-employment dates and missing records without salary sections", async () => {
  const workbook = await createEmployeeAttendanceWorkbook(
    { ...employee, employment_start: "2026-10-11" },
    [
      { date: "2026-10-10", row: null },
      { date: "2026-10-11", row: null },
      { date: "2026-10-12", row: row("late", 870, "2026-10-12T18:00:00Z") },
    ],
    "2026-10-10",
    "2026-10-12",
  );
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.equal(restored.getWorksheet("Salary review"), undefined);
  const overview = restored.getWorksheet("Overview");
  const daily = restored.getWorksheet("Daily records");
  assert.equal(overview.getCell("E14").result, 1);
  assert.equal(overview.getCell("E15").result, 1);
  assert.equal(daily.getCell("D6").value, "Before joining");
  assert.equal(daily.getCell("D7").value, "No record");
  assert.equal(daily.getCell("G8").result.toISOString(), "1899-12-30T14:30:00.000Z");
  assert.equal(overview.views[0].showRowColHeaders, false);
  assert.ok(overview.getColumn(2).width <= 18);
  assert.ok(daily.getRow(8).height <= 25);
});

test("overall Excel report preserves review conflicts, exports department analytics and handles zero denominators", async () => {
  const rows = [
    { ...row("present", 0, "2026-10-12T04:30:00Z"), department: "software" },
    { ...row("needs_review", 75, "2026-10-12T06:00:00Z", true), department: "software" },
    { ...row("needs_review", null, "2026-10-12T04:35:00Z"), department: "software" },
    { ...row("absent", null), department: "software" },
    { ...row("awaiting_scan", null), department: "software" },
    { ...row("on_leave", null), department: "hardware" },
    { ...row("off_day", null), department: "hardware" },
  ].map((record, index) => ({
    ...record,
    employee_id: String(index),
    name: index === 0 ? '=HYPERLINK("https://example.com")' : `Employee ${index}`,
    enroll_id: `000${index}`,
  }));
  const workbook = await createOverallAttendanceWorkbook(rows, "2026-10-12", "All employees");
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.deepEqual(
    restored.worksheets.map((sheet) => sheet.name),
    ["Summary", "Department analytics", "Attendance records", "Report guide"],
  );
  const summary = restored.getWorksheet("Summary");
  for (const [address, expected] of [
    ["E8", 7],
    ["E9", 3],
    ["E10", 1],
    ["E11", 1],
    ["E15", 2],
    ["E17", 0.6],
    ["E18", 0.5],
    ["E19", 75],
    ["E20", 75],
  ])
    assert.equal(summary.getCell(address).result, expected);
  const departments = restored.getWorksheet("Department analytics");
  assert.equal(departments.getCell("A6").value, "hardware");
  assert.equal(departments.getCell("I6").result, "N/A");
  assert.equal(departments.getCell("J6").result, "N/A");
  assert.equal(departments.getCell("B7").result, 5);
  assert.equal(departments.getCell("D7").result, 1);
  assert.equal(departments.getCell("E7").result, 1);
  assert.equal(departments.getCell("I7").result, 0.6);
  assert.equal(departments.getCell("J7").result, 0.5);
  assert.equal(departments.conditionalFormattings.length, 2);
  const records = restored.getWorksheet("Attendance records");
  assert.ok(records.getTable("OverallAttendance"));
  assert.equal(records.getCell("A12").value, "software");
  assert.equal(records.views[0].ySplit, 5);
  assert.equal(records.getCell("F13").numFmt, "0");
  assert.ok(records.getCell("G13").formula.includes("SUBTOTAL"));
  const nameRow = [...Array(7)]
    .map((_, index) => index + 6)
    .find((index) => records.getCell(index, 2).value === rows[0].name);
  assert.equal(records.getCell(nameRow, 3).value, "0000");
  assert.equal(records.getCell(nameRow, 6).value.toISOString(), "1899-12-30T10:00:00.000Z");
  assert.equal(records.getCell(nameRow, 2).type, ExcelJS.ValueType.String);
  assert.equal(summary.getCell("A23").value.hyperlink, "#'Department analytics'!A1");
});
