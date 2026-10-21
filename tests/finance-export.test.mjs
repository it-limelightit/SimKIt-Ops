import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
let source = readFileSync(
  new URL("../src/components/finance/finance-export.ts", import.meta.url),
  "utf8",
)
  .replace(
    /import \{\r?\n  categories,[\s\S]*?from "@\/lib\/finance";/,
  'const categories = { travel: "Travel" }; const financeRpc = () => {}; const expenseFileDownload = () => {};',
  )
  .replace(
    'import { attendanceReportLogo } from "@/lib/attendance-report-logo";',
    'const attendanceReportLogo = async () => "";',
  );
for (const name of ["jspdf", "jspdf-autotable", "fflate"]) {
  source = source.replaceAll(
    `from "${name}"`,
    `from ${JSON.stringify(pathToFileURL(require.resolve(name === "jspdf-autotable" ? "jspdf-autotable/es" : name)).href)}`,
  );
}
const { statementBytes } = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  ).toString("base64")}`
);
const person = {
  id: "staff",
  name: "Example Employee",
  email: "employee@example.test",
  field: false,
};
const employee = { id: "employee", ...person, auth_user_id: "staff", active: true };
const claim = (id, status, value) => ({
  id,
  owner_id: "staff",
  title: `Expense ${id}`,
  expense_date: "2026-10-10",
  category: "travel",
  amount: value,
  status,
  paid_at: null,
});
const fixture = () => ({
  people: [person],
  employees: [employee],
  files: [],
  events: [],
  salaries: [
    {
      id: "salary",
      employee_id: employee.id,
      amount: 14700,
      base_salary: 15000,
      working_days: 25,
      payable_days: 24.5,
      status: "draft",
      days: [],
      paid_at: null,
      hardik_at: null,
      tarun_at: null,
    },
  ],
  claims: [
    claim("pending", "hardik_pending", 500),
    claim("approved", "approved", 300),
    claim("rejected", "rejected", 900),
    claim("cancelled", "cancelled", 800),
    { ...claim("other", "approved", 1000), owner_id: "another-person" },
  ],
});

test("single-page salary statement shows combined totals and separates pending amounts from approval", () => {
  const logo = `data:image/png;base64,${readFileSync(new URL("../image copy.png", import.meta.url)).toString("base64")}`;
  const bytes = statementBytes(fixture(), "2026-10", person, employee, undefined, logo);
  const pdf = Buffer.from(bytes).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-"));
  assert.ok(pdf.includes("SALARY + EXPENSES TOTAL"));
  assert.ok(pdf.includes("INR 15,500.00"));
  assert.ok(pdf.includes("Pending review:"));
  assert.ok(pdf.includes("Approved for payment"));
  assert.equal([...pdf.matchAll(/\/Type\s*\/Page\b/g)].length, 1);
  assert.ok(pdf.includes("LimelightIT Research Pvt. Ltd."));
  assert.ok(pdf.includes("/Subtype /Image"));
  assert.ok(pdf.includes("Working days in month"));
  assert.ok(pdf.includes("Payable days \\(pending approval\\)"));
  assert.ok(pdf.includes("24.5 day equivalents"));
  assert.ok(pdf.includes("Salary per working day"));
  assert.doesNotMatch(pdf, /Approved payable days|Approval & payment details/);
  assert.doesNotMatch(pdf, /NaN|Infinity/);
  mkdirSync(".tmp", { recursive: true });
  writeFileSync(".tmp/finance-statement-preview.pdf", bytes);
});

test("statement preserves paid versus approved amounts and zero-working-day calculations", () => {
  const board = fixture();
  board.salaries[0] = {
    ...board.salaries[0],
    status: "approved",
    paid_at: "2026-11-07",
    working_days: 0,
  };
  const pdf = Buffer.from(statementBytes(board, "2026-10", person, employee)).toString("latin1");
  assert.ok(pdf.includes("INR 15,000.00"));
  assert.ok(pdf.includes("INR 14,700.00"));
  assert.ok(pdf.includes("INR 300.00"));
  assert.ok(pdf.includes("Approved payable days"));
  assert.doesNotMatch(pdf, /NaN|Infinity/);
});

test("a month with many attendance and expense records remains one readable summary page", () => {
  const board = fixture();
  board.claims = Array.from({ length: 100 }, (_, i) => claim(String(i), "approved", 10));
  board.salaries[0].days = Array.from({ length: 31 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, "0")}`,
    working_day: true,
    status: "present",
    units: 1,
    override_reason: "Detailed monthly attendance adjustment".repeat(20),
  }));
  const pdf = Buffer.from(statementBytes(board, "2026-10", person, employee)).toString("latin1");
  assert.ok(pdf.includes("INR 15,700.00"));
  assert.equal([...pdf.matchAll(/\/Type\s*\/Page\b/g)].length, 1);
  assert.ok(pdf.includes("100 claims"));
  assert.ok(pdf.includes("monthly ZIP"));
  assert.doesNotMatch(pdf, /Expense 99|Detailed monthly attendance adjustment/);
});
