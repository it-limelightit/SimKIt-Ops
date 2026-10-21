import { supabase } from "@/integrations/supabase/client";

export const dateTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
export const readable = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

export const FINANCE_EMAILS = ["admin@limelightit.io", "tarun@limelightit.io"] as const;
export const canManageFinance = (email?: string | null) =>
  FINANCE_EMAILS.some((e) => e === email?.trim().toLowerCase());
export const isSalaryManager = (email?: string | null) =>
  email?.trim().toLowerCase() === FINANCE_EMAILS[0];
export const categories: Record<string, string> = {
  porter: "Porter / labour",
  items: "Order / items",
  travel: "Petrol / travelling",
  courier: "Courier",
};
export const MAX_EXPENSE_FILE_BYTES = 5_000_000;
export const EXPENSE_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"];
export type FinanceRole = "hardik" | "tarun" | null;
export type ExpenseFile = {
  id: string;
  claim_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
};
export type ExpenseClaim = {
  id: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  expense_date: string;
  settlement_month: string;
  title: string;
  category: string;
  amount: number;
  description: string;
  attachment_ids: string[];
  revision: number;
  status:
    "hardik_pending" | "hardik_verified" | "tarun_pending" | "approved" | "rejected" | "cancelled";
  hardik_decision: string | null;
  hardik_at: string | null;
  hardik_reason: string | null;
  tarun_decision: string | null;
  tarun_at: string | null;
  tarun_reason: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  created_at: string;
  updated_at: string;
};
export type FinanceDay = {
  date: string;
  working_day: boolean | null;
  status: string;
  late_minutes: number | null;
  automatic_units: number | null;
  units: number | null;
  override_reason?: string;
  request_type?: string;
  request_status?: string;
  reason?: string;
};
export type DayOverrides = Record<string, { units: number; reason: string }>;
export type Salary = {
  id: string;
  employee_id: string;
  month: string;
  base_salary: number;
  amount: number;
  working_days: number;
  payable_days: number;
  days: FinanceDay[];
  overrides: DayOverrides;
  revision: number;
  status: string;
  hardik_at: string | null;
  tarun_at: string | null;
  rejection_reason: string | null;
  paid_at: string | null;
  payment_reference: string | null;
};
export type FinanceEvent = {
  id: string;
  entity_id: string;
  entity_type: string;
  actor_id: string;
  actor_role: string | null;
  action: string;
  reason: string | null;
  occurred_at: string;
  before_data: unknown;
  after_data: unknown;
};
export type FinancePerson = { id: string; name: string; email: string; field: boolean };

export function expenseReapplication(
  claimId: string,
  events: FinanceEvent[],
  viewer: FinanceRole = null,
) {
  const latest = events
    .filter(
      (event) =>
        event.entity_type === "expense" &&
        event.entity_id === claimId &&
        event.action === "reapplied",
    )
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
  if (!latest) return null;
  const before =
    latest.before_data &&
    typeof latest.before_data === "object" &&
    !Array.isArray(latest.before_data)
      ? (latest.before_data as Record<string, unknown>)
      : {};
  const rejections = (["hardik", "tarun"] as const).flatMap((reviewer) => {
    const reason = before[`${reviewer}_reason`];
    if (typeof reason !== "string" || !reason.trim()) return [];
    const at = before[`${reviewer}_at`];
    return [
      {
        reviewer: reviewer === "hardik" ? "Hardik" : "Tarun",
        reason,
        at: typeof at === "string" ? at : null,
      },
    ];
  });
  if (viewer === "tarun") {
    const ownRejections = rejections.filter((rejection) => rejection.reviewer === "Tarun");
    if (!ownRejections.length && before.tarun_decision !== "reject") return null;
    return { reappliedAt: latest.occurred_at, rejections: ownRejections };
  }
  return { reappliedAt: latest.occurred_at, rejections };
}
export type FinanceEmployee = {
  id: string;
  name: string;
  email: string;
  auth_user_id: string | null;
  active: boolean;
};
export type FinanceBoard = {
  role: FinanceRole;
  today: string;
  claims: ExpenseClaim[];
  files: ExpenseFile[];
  events: FinanceEvent[];
  employees: FinanceEmployee[];
  people: FinancePerson[];
  salaries: Salary[];
};
export type FieldFinance = {
  earnings: {
    id: string;
    date: string;
    phase: string;
    company: string;
    amount: number | null;
    paid: boolean;
  }[];
  review: {
    id: string;
    revision: number;
    status: string;
    hardik_at: string;
    tarun_at: string | null;
    reason: string | null;
    snapshot: unknown;
  } | null;
  rates: { assessment: number; commissioning: number } | null;
  payments: { id: string; amount: number; paid_on: string; reference: string }[];
  calendar: { date: string; online: boolean; last_online: boolean | null; off_day: boolean }[];
  leaves: { date: string; status: string; reason: string }[];
};
export async function financeRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (
    supabase as unknown as {
      rpc: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: T; error: { message: string } | null }>;
    }
  ).rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
export function settlementDates(month: string) {
  const [year, number] = month.slice(0, 7).split("-").map(Number);
  const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
  return { deadline: `${next}-05`, due: `${next}-07` };
}
export function canReapply(
  claim: Pick<ExpenseClaim, "status" | "settlement_month">,
  today: string,
) {
  return claim.status === "rejected" && today <= settlementDates(claim.settlement_month).deadline;
}
export function salaryTotals(base: number, days: FinanceDay[], overrides: DayOverrides = {}) {
  const working = days.filter((d) => d.working_day === true).length;
  const units = days.map((d) =>
    d.working_day && !["scheduled", "not_employed"].includes(d.status)
      ? (overrides[d.date]?.units ?? d.units)
      : d.units,
  );
  const payable = units.reduce<number>((sum, unit) => sum + Number(unit ?? 0), 0);
  return {
    working,
    payable,
    unresolved: units.filter((u) => u === null).length,
    daily: working ? base / working : 0,
    amount: working ? Math.round(((base * payable) / working + Number.EPSILON) * 100) / 100 : 0,
  };
}
async function invokeExpenseFiles(body: FormData | Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("expense-files", { body });
  if (error) {
    let message = error.message;
    if (error.context instanceof Response) {
      try {
        message = (await error.context.json()).error || message;
      } catch {
        /* retain transport error */
      }
    }
    throw new Error(message);
  }
  return data as unknown;
}
export async function expenseFileRequest(body: FormData | Record<string, unknown>) {
  return (await invokeExpenseFiles(body)) as { id?: string; url?: string };
}
export async function expenseFileDownload(id: string) {
  const result = await invokeExpenseFiles({ id, download: true });
  if (!(result instanceof Blob))
    throw new Error("Receipt download could not be prepared. Please retry.");
  return new Uint8Array(await result.arrayBuffer());
}
export function validateExpenseFile(file: Pick<File, "size" | "type">) {
  if (file.size < 1 || file.size > MAX_EXPENSE_FILE_BYTES)
    throw new Error("Each attachment must be between 1 byte and 5 MB.");
  if (!EXPENSE_FILE_TYPES.includes(file.type)) throw new Error("Use PDF, JPG or PNG attachments.");
}
