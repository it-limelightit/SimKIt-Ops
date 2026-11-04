import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const fieldOperationsUrl = `data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(
    readFileSync(new URL("../src/lib/field-operations.ts", import.meta.url), "utf8")
      .replace('import { supabase } from "@/integrations/supabase/client";', 'const supabase = {};'),
    { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
).toString("base64")}`;
let source = readFileSync(
  new URL("../src/components/finance/finance-export.ts", import.meta.url),
  "utf8",
)
  .replace('"@/lib/field-operations"', JSON.stringify(fieldOperationsUrl))
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

test("statement summary shows salary, incentives and expenses with a combined total; itemised details follow", () => {
  const logo = `data:image/png;base64,${readFileSync(new URL("../public/brand/simkit-mark.png", import.meta.url)).toString("base64")}`;
  const bytes = statementBytes(fixture(), "2026-10", person, employee, undefined, logo);
  const pdf = Buffer.from(bytes).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-"));
  assert.ok(pdf.includes("SALARY + INCENTIVES + EXPENSES TOTAL"));
  assert.ok(pdf.includes("INR 15,500.00"));
  assert.ok(pdf.includes("Pending review:"));
  assert.ok(pdf.includes("Approved for payment"));
  // Page 1 summary + 1 itemised page for the two active claims.
  assert.equal([...pdf.matchAll(/\/Type\s*\/Page\b/g)].length, 2);
  assert.ok(pdf.includes("Itemised details"));
  assert.ok(pdf.includes("Field incentives"));
  assert.ok(pdf.includes("LimelightIT Research Pvt. Ltd."));
  assert.ok(pdf.includes("/Subtype /Image"));
  assert.ok(pdf.includes("Days in month \\(off days paid\\)"));
  assert.ok(pdf.includes("Payable days \\(pending approval\\)"));
  assert.ok(pdf.includes("24.5 day equivalents"));
  assert.ok(pdf.includes("Salary per day"));
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

test("a month with many expense records keeps a one-page summary and itemises every claim on following pages", () => {
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
  assert.ok([...pdf.matchAll(/\/Type\s*\/Page\b/g)].length > 1);
  assert.ok(pdf.includes("100 claims"));
  assert.ok(pdf.includes("Expense 99"));
  assert.ok(pdf.includes("monthly ZIP"));
  assert.doesNotMatch(pdf, /Detailed monthly attendance adjustment/);
});

test("dual-role statement combines salary, field incentives by phase and expenses", () => {
  const board = fixture();
  const fieldPerson = { ...person, field: true };
  const field = {
    earnings: [
      { id: "a", date: "2026-10-07", phase: "assessment", company: "M/S DEEPAK TECHNOCAST", amount: 1000, paid: false },
      { id: "i", date: "2026-10-07", phase: "installation", company: "M/S DEEPAK TECHNOCAST", amount: 500, paid: false },
      { id: "c", date: "2026-10-10", phase: "commissioning", company: "M/S DEEPAK TECHNOCAST", amount: 0, paid: false },
    ],
    review: null,
    rates: { assessment: 1000, installation: 500, commissioning: 0, all_phases: true },
    payments: [],
    calendar: [],
    leaves: [],
  };
  const pdf = Buffer.from(statementBytes(board, "2026-10", fieldPerson, employee, field)).toString("latin1");
  assert.ok(pdf.includes("Assessment \\(1\\)"));
  assert.ok(pdf.includes("Installation \\(1\\)"));
  assert.ok(pdf.includes("Field incentives earned"));
  assert.ok(pdf.includes("INR 1,500.00"));
  // 14,700 salary + 1,500 incentives + 800 active expenses
  assert.ok(pdf.includes("INR 17,000.00"));
  assert.ok(pdf.includes("M/S DEEPAK TECHNOCAST"));
  assert.doesNotMatch(pdf, /NaN|Infinity/);
});
