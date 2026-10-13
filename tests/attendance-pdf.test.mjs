import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
function moduleUrl(source) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}
const analytics = moduleUrl(
  readFileSync(new URL("../src/lib/attendance-analytics.ts", import.meta.url), "utf8"),
);
const source = readFileSync(new URL("../src/lib/attendance-pdf.ts", import.meta.url), "utf8")
  .replace('"./attendance-analytics"', JSON.stringify(analytics))
  .replace(
    'import("jspdf")',
    `import(${JSON.stringify(pathToFileURL(require.resolve("jspdf")).href)})`,
  )
  .replace(
    'import("jspdf-autotable")',
    `import(${JSON.stringify(pathToFileURL(require.resolve("jspdf-autotable/es")).href)})`,
  );
const { createEmployeeAttendancePdf, createOverallAttendancePdf } = await import(moduleUrl(source));
const employee = {
  id: "sample",
  name: "Sample Employee",
  enroll_id: "00104",
  department: "software",
  email: "sample@example.com",
  employment_start: "2026-10-11",
};
const row = {
  employee_id: "sample",
  name: employee.name,
  enroll_id: employee.enroll_id,
  department: "software",
  status: "needs_review",
  entry_at: "2026-10-12T06:00:00Z",
  late_minutes: 75,
  leave_conflict: true,
};
const generatedAt = new Date("2026-10-12T06:00:00Z");
const logo = `data:image/png;base64,${readFileSync(new URL("../image copy.png", import.meta.url)).toString("base64")}`;

test("employee PDF includes branded attendance analytics, missing dates, conflicts and IST without salary data", async () => {
  const days = [
    { date: "2026-10-12", row },
    { date: "2026-10-11", row: null },
    { date: "2026-10-10", row: null },
  ];
  const doc = await createEmployeeAttendancePdf(
    employee,
    days,
    "2026-10-10",
    "2026-10-12",
    generatedAt,
    logo,
  );
  const pdf = doc.output();
  assert.ok(pdf.startsWith("%PDF-"));
  for (const text of [
    "LimelightIT Research Pvt. Ltd.",
    "00104",
    "Before joining",
    "No record",
    "11:30:00",
    "1h 15m",
    "Scan during leave; review",
    "Punctuality",
    "N/A",
    "Page 1 of",
  ])
    assert.ok(pdf.includes(text), text);
  assert.doesNotMatch(pdf, /salary|net pay|daily rate|payable/i);
  assert.equal(days[0].date, "2026-10-12", "input order remains intact");
  if (process.env.ATTENDANCE_PREVIEW) {
    mkdirSync(".tmp", { recursive: true });
    writeFileSync(".tmp/attendance-report-preview.pdf", Buffer.from(doc.output("arraybuffer")));
  }
});

test("overall PDF paginates many employees with repeated company and table headers, footers and complete records", async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    ...row,
    name: `Employee ${String(i).padStart(3, "0")} with a long display name`,
    enroll_id: `00${i}`,
    department: i % 2 ? "software" : "hardware",
  }));
  const doc = await createOverallAttendancePdf(
    rows,
    "2026-10-12",
    "All employees",
    generatedAt,
    logo,
  );
  assert.ok(doc.getNumberOfPages() > 2);
  const pdf = doc.output();
  assert.ok(pdf.includes("Department comparison"));
  assert.ok(pdf.includes("Employee 099"));
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    const contents = doc.internal.pages[page].join("\n");
    assert.ok(contents.includes("LimelightIT Research Pvt. Ltd."));
    assert.ok(contents.includes(`Page ${page} of ${doc.getNumberOfPages()}`));
    if (contents.includes("Employee 0")) assert.ok(contents.includes("Employee / ID"));
  }
  assert.doesNotMatch(pdf, /salary|net pay|daily rate|payable/i);
  if (process.env.ATTENDANCE_PREVIEW)
    writeFileSync(".tmp/attendance-overall-preview.pdf", Buffer.from(doc.output("arraybuffer")));
});

test("empty PDF has N/A metrics and no invented attendance", async () => {
  const doc = await createOverallAttendancePdf([], "2026-10-12", "No employees", generatedAt);
  const pdf = doc.output();
  assert.ok(pdf.includes("N/A"));
  assert.ok(pdf.includes("No employees"));
  assert.doesNotMatch(pdf, /NaN|Infinity/);
});
