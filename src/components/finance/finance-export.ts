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
  // ----- Figures -----
  const salary = board.salaries.find((s) => s.employee_id === employee?.id);
  const claims = board.claims.filter((c) => c.owner_id === person.id);
  const activeClaims = claims.filter((claim) => !["rejected", "cancelled"].includes(claim.status));
  const approved = claims.filter((c) => c.status === "approved");
  const expenses = approved.reduce((s, c) => s + Number(c.amount), 0);
  const expensesPaid = approved.filter((c) => c.paid_at).reduce((s, c) => s + Number(c.amount), 0);
  const activeExpenses = activeClaims.reduce((sum, claim) => sum + Number(claim.amount), 0);
  const calculatedSalary = Number(salary?.amount ?? 0);
  const salaryAmount = salary?.status === "approved" ? Number(salary.amount) : 0;

  const earnings = field?.earnings ?? [];
  const priced = (list: typeof earnings) => list.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const incentiveTotal = priced(earnings);
  const incentivePaid = priced(earnings.filter((e) => e.paid));
  const incentiveApproved = field?.review?.status === "approved" ? incentiveTotal : incentivePaid;
  const unpriced = earnings.filter((e) => e.amount === null).length;

  const paid = expensesPaid + (salary?.paid_at ? Number(salary.amount) : 0) + incentivePaid;
  const payable = expenses + salaryAmount + incentiveApproved;
  const grandTotal = calculatedSalary + incentiveTotal + activeExpenses;

  // ----- Drawing helpers -----
  const doc = new jsPDF();
  doc.setProperties({
    title: `Monthly statement - ${person.name || person.email} - ${month}`,
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
    doc.setFontSize(bold ? 10.5 : 9.5);
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
    rule(y + 2.5);
  };
  const header = () => {
    doc.setFillColor(31, 51, 71);
    doc.rect(0, 0, 210, 30, "F");
    doc.setFillColor(99, 102, 241);
    doc.rect(0, 30, 210, 1.2, "F");
    // Same alias on every page so the logo is embedded once.
    if (logo) doc.addImage(logo, "PNG", 18, 7, 16, 16, "simkit-logo", "FAST");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("LimelightIT Research Pvt. Ltd.", logo ? 40 : 18, 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("SIM-Kit | Monthly salary, incentives & expenses", logo ? 40 : 18, 22);
  };
  const phaseLabel = (phase: string) => `${phase.charAt(0).toUpperCase()}${phase.slice(1)}`;

  // ----- Page 1: complete summary -----
  header();
  doc.setTextColor(25);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Monthly statement", 18, 43);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(monthLabel, 192, 43, { align: "right" });
  rule(48);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(short(person.name || person.email || "Employee", 174), 18, 56);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(short(person.email || "", 115), 18, 62);
  const status = salary?.paid_at ? "Paid" : (salary?.status ?? field?.review?.status);
  if (status) {
    const label = status === "tarun_pending" ? "Awaiting Tarun" : status.replaceAll("_", " ");
    doc.text(`Status: ${label.charAt(0).toUpperCase()}${label.slice(1)}`, 192, 62, {
      align: "right",
    });
  }

  const step = 6.6;
  let y = 72;
  // 1. Salary
  heading("1. Salary", y);
  y += 8;
  if (salary) {
    row("Monthly salary", amount(Number(salary.base_salary)), y);
    row("Days in month (off days paid)", String(salary.working_days), (y += step));
    row(
      salary.status === "approved" ? "Approved payable days" : "Payable days (pending approval)",
      `${salary.payable_days} day equivalents`,
      (y += step),
    );
    row(
      "Non-payable day equivalents",
      String(Math.max(0, salary.working_days - salary.payable_days)),
      (y += step),
    );
    row(
      "Salary per day",
      amount(salary.working_days ? Number(salary.base_salary) / salary.working_days : 0),
      (y += step),
    );
    row(
      "Attendance deduction",
      amount(Math.max(0, Number(salary.base_salary) - calculatedSalary)),
      (y += step),
    );
  } else {
    row(
      employee ? "Salary for this month" : "Salary",
      employee ? "Not saved yet" : "Not applicable",
      y,
    );
  }
  row("Salary earned", amount(calculatedSalary), (y += step), true);

  // 2. Field incentives
  y += 10;
  heading("2. Field incentives", y);
  y += 8;
  if (field) {
    for (const phase of ["assessment", "installation", "commissioning"]) {
      const items = earnings.filter((e) => e.phase === phase);
      if (!items.length) continue;
      row(`${phaseLabel(phase)} (${items.length})`, amount(priced(items)), y);
      y += step;
    }
    if (!earnings.length) {
      row("Completed work this month", "None", y);
      y += step;
    }
    if (unpriced) {
      row(`Work awaiting a rate (${unpriced})`, "Not priced", y);
      y += step;
    }
    row("Field incentives earned", amount(incentiveTotal), y, true);
  } else {
    row("Field incentives", "Not applicable", y);
  }

  // 3. Expenses
  y += 10;
  heading("3. Expense reimbursement", y);
  y += 8;
  row(
    `Expenses submitted (${activeClaims.length} ${activeClaims.length === 1 ? "claim" : "claims"})`,
    amount(activeExpenses),
    y,
  );
  row("Approved expenses", amount(expenses), (y += step));
  row(
    "Expenses awaiting approval",
    amount(Math.max(0, activeExpenses - expenses)),
    (y += step),
    true,
  );

  // Total
  y += 9;
  rule(y - 5);
  doc.setFillColor(238, 242, 255);
  doc.rect(18, y - 4.5, 174, 8, "F");
  row("SALARY + INCENTIVES + EXPENSES TOTAL", amount(grandTotal), (y += 1), true);
  row("Approved for payment", amount(payable), (y += step + 2));
  row("Payments recorded", amount(paid), (y += step));
  rule(y + 3);
  row("Remaining approved payable", amount(Math.max(0, payable - paid)), (y += step + 3), true);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(90);
  const hasDraft =
    (!!salary && salary.status !== "approved") ||
    (!!field?.review && field.review.status !== "approved") ||
    (!!field && earnings.length > 0 && !field.review) ||
    claims.some((claim) => !["approved", "rejected", "cancelled"].includes(claim.status));
  let note = Math.max(y + 9, 255);
  if (hasDraft) {
    doc.text("Pending review: the total includes amounts awaiting approval.", 18, note);
    note += 6;
  }
  const review = salary ?? field?.review;
  if (review) {
    doc.text(
      `Hardik verified: ${date(review.hardik_at)}     Tarun reviewed: ${date(review.tarun_at)}`,
      18,
      note,
    );
    note += 6;
  }
  doc.text(
    "Payable days include full days, half days and approved paid adjustments. Itemised records follow; files: monthly ZIP.",
    18,
    Math.min(note, 271),
  );

  // ----- Following pages: itemised field incentives and expenses -----
  const detailRows: { section: string; cells: string[] }[] = [
    ...earnings
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({
        section: "Field incentives",
        cells: [
          date(e.date),
          phaseLabel(e.phase),
          e.company,
          e.amount === null ? "Not priced" : amount(Number(e.amount)),
          e.paid ? "Paid" : "Remaining",
        ],
      })),
    ...activeClaims
      .slice()
      .sort((a, b) => a.expense_date.localeCompare(b.expense_date))
      .map((c) => ({
        section: "Expenses",
        cells: [
          date(c.expense_date),
          categories[c.category as keyof typeof categories] ?? c.category,
          c.title,
          amount(Number(c.amount)),
          c.paid_at ? "Paid" : c.status === "approved" ? "Approved" : "Awaiting approval",
        ],
      })),
  ];
  const columns = [
    { x: 18, w: 24 },
    { x: 44, w: 28 },
    { x: 74, w: 66 },
    { x: 165, w: 26, right: true },
    { x: 168, w: 24 },
  ];
  if (detailRows.length) {
    let page = 0;
    let current = "";
    const startPage = () => {
      doc.addPage();
      header();
      page += 1;
      doc.setTextColor(25);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("Itemised details", 18, 42);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(
        `${short(person.name || person.email || "Employee", 110)} | ${monthLabel}`,
        192,
        42,
        {
          align: "right",
        },
      );
      return 52;
    };
    const tableHead = (section: string, top: number) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(35);
      doc.text(section, 18, top);
      doc.setFillColor(241, 245, 249);
      doc.rect(18, top + 2.5, 174, 6.5, "F");
      doc.setFontSize(8);
      doc.setTextColor(70);
      const labels =
        section === "Expenses"
          ? ["Date", "Category", "Expense", "Amount", "Status"]
          : ["Date", "Phase", "Company", "Amount", "Payment"];
      labels.forEach((label, i) =>
        i === 3
          ? doc.text(label, columns[3].x, top + 7, { align: "right" })
          : doc.text(label, columns[i].x, top + 7),
      );
      return top + 14;
    };
    let cursor = startPage();
    for (const item of detailRows) {
      if (item.section !== current) {
        if (cursor > 255) cursor = startPage();
        if (current) cursor += 4;
        cursor = tableHead(item.section, cursor);
        current = item.section;
      }
      if (cursor > 278) {
        cursor = tableHead(item.section, startPage());
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(35);
      item.cells.forEach((cell, i) => {
        if (i === 3) doc.text(cell, columns[3].x, cursor, { align: "right" });
        else if (i === 4) doc.text(short(cell, columns[4].w), columns[4].x, cursor);
        else doc.text(short(cell, columns[i].w), columns[i].x, cursor);
      });
      doc.setDrawColor(235);
      doc.line(18, cursor + 2, 192, cursor + 2);
      cursor += 6.2;
    }
    void page;
  }

  // ----- Footers -----
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    rule(276);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(90);
    doc.text(
      `Generated ${date(new Date().toISOString())} | ${month}-${safe(person.id).slice(0, 12)}`,
      18,
      282,
    );
    doc.text(`${i} / ${pages}`, 192, 282, { align: "right" });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

export async function downloadStatement(
  board: FinanceBoard,
  month: string,
  person: FinancePerson,
  employee?: FinanceEmployee,
) {
  // Dual-role people (office staff with field incentives) get salary AND incentives.
  const staffRecord =
    employee ?? board.employees.find((e) => e.auth_user_id && e.auth_user_id === person.id);
  const field = person.field
    ? await financeRpc<FieldFinance>("finance_field_board", {
        _associate: person.id,
        _month: `${month}-01`,
      })
    : undefined;
  saveBlob(
    statementBytes(board, month, person, staffRecord, field, await attendanceReportLogo()),
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
