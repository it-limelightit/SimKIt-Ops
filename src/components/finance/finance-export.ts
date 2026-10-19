import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { zip, strToU8 } from "fflate";
import {
  categories,
  expenseFileRequest,
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
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function statementBytes(
  board: FinanceBoard,
  month: string,
  person: FinancePerson,
  employee?: FinanceEmployee,
  field?: FieldFinance,
) {
  const salary = board.salaries.find((s) => s.employee_id === employee?.id);
  const claims = board.claims.filter((c) => c.owner_id === person.id);
  const approved = claims.filter((c) => c.status === "approved");
  const expenses = approved.reduce((s, c) => s + Number(c.amount), 0);
  const expensesPaid = approved.filter((c) => c.paid_at).reduce((s, c) => s + Number(c.amount), 0);
  const salaryAmount = salary?.status === "approved" ? Number(salary.amount) : 0;
  const incentiveAmount =
    field?.review?.status === "approved"
      ? field.earnings.reduce((s, e) => s + Number(e.amount ?? 0), 0)
      : (field?.payments.reduce((s, p) => s + Number(p.amount), 0) ?? 0);
  const paid =
    expensesPaid +
    (salary?.paid_at ? Number(salary.amount) : 0) +
    (field?.payments.reduce((s, p) => s + Number(p.amount), 0) ?? 0);
  const payable = expenses + salaryAmount + incentiveAmount;
  const doc = new jsPDF();
  doc.setFillColor(30, 41, 59);
  doc.rect(0, 0, 210, 40, "F");
  doc.setTextColor(255);
  doc.setFontSize(20);
  doc.text("LIMELIGHT IT | SIM-KIT", 14, 18);
  doc.setFontSize(11);
  doc.text("Salary, incentives & reimbursement statement", 14, 29);
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(15);
  doc.text(person.name || person.email, 14, 52);
  doc.setFontSize(10);
  doc.text(person.email || "", 14, 59);
  doc.text(`Statement: ${month}-${safe(person.id).slice(0, 12)}`, 14, 67);
  doc.text(`Salary / expense month: ${month}`, 14, 73);
  doc.text(
    `Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
    14,
    79,
  );
  const hasDraft =
    (!!salary && salary.status !== "approved") ||
    (!!field?.review && field.review.status !== "approved");
  if (hasDraft) {
    doc.setTextColor(180, 83, 9);
    doc.text("DRAFT: unapproved calculations are excluded from payable totals.", 14, 86);
    doc.setTextColor(30, 41, 59);
  }
  let y = hasDraft ? 93 : 87;
  if (salary) {
    autoTable(doc, {
      startY: y,
      head: [["Office salary", "Working days", "Payable days", "Daily rate", "Calculated"]],
      body: [
        [
          salary.status,
          String(salary.working_days),
          String(salary.payable_days),
          amount(Number(salary.base_salary) / salary.working_days),
          amount(Number(salary.amount)),
        ],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    autoTable(doc, {
      startY: y,
      head: [["Date", "Attendance", "Payable units", "Adjustment reason"]],
      body: salary.days
        .filter((d) => d.working_day)
        .map((d) => [
          d.date,
          d.status.replaceAll("_", " "),
          String(d.units ?? "Needs review"),
          d.override_reason || "",
        ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }
  if (field) {
    autoTable(doc, {
      startY: y,
      head: [["Field incentive cycle ending", "Approval", "Amount"]],
      body: [
        [
          `${month}-15 (previous 16th to this 15th)`,
          field.review?.status ?? "Not verified",
          amount(field.earnings.reduce((s, e) => s + Number(e.amount ?? 0), 0)),
        ],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    autoTable(doc, {
      startY: y,
      head: [["Date", "Work", "Company", "Amount", "Payment"]],
      body: field.earnings.map((e) => [
        e.date,
        e.phase,
        e.company,
        e.amount === null ? "Rate pending" : amount(Number(e.amount)),
        e.paid ? "Paid" : "Remaining",
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }
  autoTable(doc, {
    startY: y,
    head: [["Expense date", "Expense", "Category", "Amount", "Approval", "Payment"]],
    body: claims.map((c) => [
      c.expense_date,
      c.title,
      categories[c.category],
      amount(Number(c.amount)),
      c.status,
      c.paid_at ? "Paid" : c.status === "approved" ? "Remaining" : "Not payable",
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  autoTable(doc, {
    startY: y,
    body: [
      ["Approved office salary", amount(salaryAmount)],
      ["Approved field incentives (16th–15th)", amount(incentiveAmount)],
      ["Approved reimbursements", amount(expenses)],
      ["Total approved payable", amount(payable)],
      ["Recorded payments", amount(paid)],
      ["Remaining payable", amount(Math.max(0, payable - paid))],
    ],
    styles: { fontSize: 10 },
    columnStyles: { 1: { halign: "right" } },
    theme: "striped",
  });
  doc.addPage();
  doc.setFontSize(15);
  doc.text("Approval & payment details", 14, 20);
  autoTable(doc, {
    startY: 28,
    head: [["Item", "Hardik decision / date", "Tarun decision / date", "Reason / reference"]],
    body: [
      ...(salary
        ? [
            [
              "Office salary",
              salary.hardik_at ?? "Pending",
              salary.tarun_at ?? "Pending",
              salary.rejection_reason || salary.payment_reference || "",
            ],
          ]
        : []),
      ...(field?.review
        ? [
            [
              "Field incentives",
              field.review.hardik_at,
              field.review.tarun_at ?? "Pending",
              field.review.reason || field.payments.map((p) => p.reference).join(", "),
            ],
          ]
        : []),
      ...claims.map((c) => [
        c.title,
        `${c.hardik_decision ?? "Pending"} ${c.hardik_at ?? ""}`,
        `${c.tarun_decision ?? "Awaiting Hardik"} ${c.tarun_at ?? ""}`,
        [c.hardik_reason, c.tarun_reason, c.payment_reference].filter(Boolean).join("; "),
      ]),
    ],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`SIM-Kit Ops | Records payments; does not transfer money | ${page}/${pages}`, 14, 290);
  }
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
    statementBytes(board, month, person, employee, field),
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
      statementBytes(board, month, person, employee, field[person.id]),
    );
  }
  for (const file of board.files) {
    const result = await expenseFileRequest({ id: file.id });
    if (!result.url)
      throw new Error(`Attachment ${file.filename} is unavailable; backup incomplete.`);
    const response = await fetch(result.url);
    if (!response.ok) throw new Error(`Could not download ${file.filename}; backup incomplete.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
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
          field_cycle_end: `${month}-15`,
          verified: true,
        },
        null,
        2,
      ),
    ),
  );
  const bytes = await new Promise<Uint8Array>((resolve, reject) =>
    zip(archive, { level: 1 }, (error, data) => (error ? reject(error) : resolve(data))),
  );
  saveBlob(bytes, `SimKit-salary-expense-${month}.zip`, "application/zip");
}
