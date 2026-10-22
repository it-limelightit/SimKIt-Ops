import { jsPDF } from "jspdf";
import { zipSync, strToU8 } from "fflate";
import { attendanceReportLogo } from "@/lib/attendance-report-logo";
import { paymentPeriod } from "@/lib/field-operations";
import {
  categories,
  expenseFileDownload,
  financeRpc,
  type FinanceBoard,
  type FinanceEmployee,
  type FinancePerson,
  type FieldFinance,
} from "@/lib/finance";

const amount = (value: number) =>
  `INR ${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safe = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
function saveBlob(bytes: Uint8Array, filename: string, type: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function statementBytes(
  board: FinanceBoard,
  month: string,
  person: FinancePerson,
  employee?: FinanceEmployee,
  field?: FieldFinance,
  logo?: string,
) {
  const salary = board.salaries.find((s) => s.employee_id === employee?.id);
  const claims = board.claims.filter((c) => c.owner_id === person.id);
  const approved = claims.filter((c) => c.status === "approved");
  const expenses = approved.reduce((s, c) => s + Number(c.amount), 0);
  const expensesPaid = approved.filter((c) => c.paid_at).reduce((s, c) => s + Number(c.amount), 0);
  const calculatedSalary = Number(salary?.amount ?? 0);
  const activeExpenses = claims
    .filter((claim) => !["rejected", "cancelled"].includes(claim.status))
    .reduce((sum, claim) => sum + Number(claim.amount), 0);
  const salaryAmount = salary?.status === "approved" ? Number(salary.amount) : 0;
  const incentiveAmount =
    field?.review?.status === "approved"
      ? field.earnings.reduce((s, e) => s + Number(e.amount ?? 0), 0)
      : (field?.earnings
          .filter((earning) => earning.paid)
          .reduce((s, earning) => s + Number(earning.amount ?? 0), 0) ?? 0);
  const paid =
    expensesPaid +
    (salary?.paid_at ? Number(salary.amount) : 0) +
    (field?.earnings
      .filter((earning) => earning.paid)
      .reduce((s, earning) => s + Number(earning.amount ?? 0), 0) ?? 0);
  const payable = expenses + salaryAmount + incentiveAmount;
  const doc = new jsPDF();
  doc.setProperties({
    title: `Salary statement - ${person.name || person.email} - ${month}`,
    author: "LimelightIT Research Pvt. Ltd.",
  });
  const short = (value: string, width: number) => {
    let text = value;
    while (text.length && doc.getTextWidth(text) > width) text = text.slice(0, -1);
    return text === value ? text : `${text.slice(0, -3)}...`;
  };
  const date = (value: string | null | undefined) =>
    value
      ? new Date(value).toLocaleDateString("en-GB", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "Pending";
  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
  const row = (label: string, value: string, y: number, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 11 : 10);
    doc.setTextColor(35);
    doc.text(label, 18, y);
    doc.text(value, 192, y, { align: "right" });
  };
  const rule = (y: number) => {
    doc.setDrawColor(210);
    doc.setLineWidth(0.2);
    doc.line(18, y, 192, y);
  };
  const heading = (label: string, y: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(35);
    doc.text(label, 18, y);
    rule(y + 3);
  };
  doc.setFillColor(31, 51, 71);
  doc.rect(0, 0, 210, 30, "F");
  doc.setFillColor(99, 102, 241);
  doc.rect(0, 30, 210, 1.2, "F");
  if (logo) doc.addImage(logo, "PNG", 18, 7, 16, 16);
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("LimelightIT Research Pvt. Ltd.", logo ? 40 : 18, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("SIM-Kit | Monthly salary & expenses", logo ? 40 : 18, 22);
  doc.setTextColor(25);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(person.field ? "Monthly statement" : "Salary statement", 18, 43);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(monthLabel, 192, 43, { align: "right" });
  rule(49);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(short(person.name || person.email || "Employee", 174), 18, 59);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(short(person.email || "", 115), 18, 66);
  const status = salary?.paid_at ? "Paid" : (salary?.status ?? field?.review?.status);
  if (status) {
    const label = status === "tarun_pending" ? "Awaiting Tarun" : status.replaceAll("_", " ");
    doc.text(`Status: ${label.charAt(0).toUpperCase()}${label.slice(1)}`, 192, 66, {
      align: "right",
    });
  }

  heading("Salary calculation", 79);
  row("Monthly salary", salary ? amount(Number(salary.base_salary)) : "Not recorded", 91);
  row("Working days in month", salary ? String(salary.working_days) : "-", 100);
  row(
    salary?.status === "approved" ? "Approved payable days" : "Payable days (pending approval)",
    salary ? `${salary.payable_days} day equivalents` : "-",
    109,
  );
  row(
    "Non-payable day equivalents",
    salary ? String(Math.max(0, salary.working_days - salary.payable_days)) : "-",
    118,
  );
  row(
    "Salary per working day",
    salary
      ? amount(salary.working_days ? Number(salary.base_salary) / salary.working_days : 0)
      : "-",
    127,
  );
  row(
    "Attendance deduction",
    salary ? amount(Math.max(0, Number(salary.base_salary) - calculatedSalary)) : "-",
    136,
  );
  row("Salary earned", amount(calculatedSalary), 145, true);

  heading("Expense reimbursement", 159);
  const activeCount = claims.filter(
    (claim) => !["rejected", "cancelled"].includes(claim.status),
  ).length;
  row(
    `Expenses submitted (${activeCount} ${activeCount === 1 ? "claim" : "claims"})`,
    amount(activeExpenses),
    171,
  );
  row("Approved expenses", amount(expenses), 180);
  row("Expenses awaiting approval", amount(Math.max(0, activeExpenses - expenses)), 189);
  rule(195);
  row("SALARY + EXPENSES TOTAL", amount(calculatedSalary + activeExpenses), 205, true);
  if (field) row("Approved field incentives", amount(incentiveAmount), 214);
  row("Approved for payment", amount(payable), field ? 223 : 218);
  row("Payments recorded", amount(paid), field ? 232 : 227);
  rule(236);
  row("Remaining approved payable", amount(Math.max(0, payable - paid)), 245, true);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(90);
  const hasDraft =
    (!!salary && salary.status !== "approved") ||
    (!!field?.review && field.review.status !== "approved") ||
    claims.some((claim) => !["approved", "rejected", "cancelled"].includes(claim.status));
  if (hasDraft)
    doc.text(
      "Pending review: the salary + expenses total includes amounts awaiting approval.",
      18,
      254,
    );
  if (salary || field?.review) {
    const review = salary ?? field?.review;
    doc.text(
      `Hardik verified: ${date(review?.hardik_at)}     Tarun reviewed: ${date(review?.tarun_at)}`,
      18,
      262,
    );
  }
  doc.text(
    "Payable days include full days, half days and approved paid adjustments. Itemised records: monthly ZIP.",
    18,
    270,
  );
  rule(275);
  doc.setFontSize(7);
  doc.text(
    `Generated ${date(new Date().toISOString())} | ${month}-${safe(person.id).slice(0, 12)}`,
    18,
    282,
  );
  doc.text("1 / 1", 192, 282, { align: "right" });
  return new Uint8Array(doc.output("arraybuffer"));
}

export async function downloadStatement(
  board: FinanceBoard,
  month: string,
  person: FinancePerson,
  employee?: FinanceEmployee,
) {
  const field = person.field
    ? await financeRpc<FieldFinance>("finance_field_board", {
        _associate: person.id,
        _month: `${month}-01`,
      })
    : undefined;
  saveBlob(
    statementBytes(board, month, person, employee, field, await attendanceReportLogo()),
    `SimKit-${safe(person.name || person.id)}-${month}.pdf`,
    "application/pdf",
  );
}
export async function downloadFinanceBackup(board: FinanceBoard, month: string) {
  // All original revisions are retained; fail the entire export if any evidence is unavailable.
  const archive: Record<string, Uint8Array> = {};
  let total = 0;
  const manifest: { id: string; path: string; size: number; sha256: string }[] = [];
  const add = (path: string, bytes: Uint8Array) => {
    total += bytes.byteLength;
    if (total > 200_000_000)
      throw new Error(
        "This month exceeds the 200 MB download limit. Request a server archive before removing any files.",
      );
    archive[path] = bytes;
  };
  const field: Record<string, FieldFinance> = {};
  for (const person of board.people.filter((p) => p.field))
    field[person.id] = await financeRpc<FieldFinance>("finance_field_board", {
      _associate: person.id,
      _month: `${month}-01`,
    });
  add(
    "records.json",
    strToU8(JSON.stringify({ ...board, field_incentive_cycles: field }, null, 2)),
  );
  const csvCell = (value: unknown) =>
    `"${String(value ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  const csv = [
    [
      "Claim ID",
      "Person",
      "Expense date",
      "Submitted",
      "Settlement month",
      "Expense",
      "Category",
      "Amount INR",
      "Status",
      "Hardik decision",
      "Hardik date",
      "Hardik reason",
      "Tarun decision",
      "Tarun date",
      "Tarun reason",
      "Paid date",
      "Payment reference",
    ],
    ...board.claims.map((c) => [
      c.id,
      c.owner_name,
      c.expense_date,
      c.created_at,
      c.settlement_month,
      c.title,
      categories[c.category],
      c.amount,
      c.status,
      c.hardik_decision,
      c.hardik_at,
      c.hardik_reason,
      c.tarun_decision,
      c.tarun_at,
      c.tarun_reason,
      c.paid_at,
      c.payment_reference,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  add("expenses.csv", strToU8("\ufeff" + csv));
  const statementPeople = [...board.people];
  const logo = await attendanceReportLogo();
  for (const employee of board.employees) {
    if (!statementPeople.some((p) => p.id === employee.auth_user_id))
      statementPeople.push({
        id: employee.auth_user_id ?? `employee:${employee.id}`,
        name: employee.name,
        email: employee.email,
        field: false,
      });
  }
  for (const person of statementPeople) {
    const employee = board.employees.find(
      (e) => e.auth_user_id === person.id || `employee:${e.id}` === person.id,
    );
    add(
      `statements/${safe(person.id)}.pdf`,
      statementBytes(board, month, person, employee, field[person.id], logo),
    );
  }
  for (const file of board.files) {
    const bytes = await expenseFileDownload(file.id);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (bytes.byteLength !== file.size_bytes || hash !== file.sha256)
      throw new Error(`Attachment verification failed: ${file.filename}`);
    const path = `receipts/${safe(file.claim_id)}/${file.id}-${safe(file.filename)}`;
    add(path, bytes);
    manifest.push({ id: file.id, path, size: bytes.length, sha256: hash });
  }
  add(
    "manifest.json",
    strToU8(
      JSON.stringify(
        {
          month,
          exported_at: new Date().toISOString(),
          claims: board.claims.length,
          salaries: board.salaries.length,
          files: manifest,
          events: board.events.length,
          field_cycle_start: paymentPeriod(`${month}-01`).start,
          field_cycle_end: paymentPeriod(`${month}-01`).end,
          field_payment_due: paymentPeriod(`${month}-01`).due,
          verified: true,
        },
        null,
        2,
      ),
    ),
  );
  // Receipts/PDFs are already compressed. Store them directly, avoiding blob workers
  // that may be blocked by browser security settings during asynchronous compression.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const bytes = zipSync(archive, { level: 0 });
  saveBlob(bytes, `SimKit-salary-expense-${month}.zip`, "application/zip");
}
