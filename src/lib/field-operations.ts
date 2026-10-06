import { supabase } from "@/integrations/supabase/client";

export type Phase = "assessment" | "installation" | "commissioning";
export type VisitType = Phase | "follow_up";
export type Associate = {
  id: string;
  name: string;
  joined: string;
  online: boolean;
  active?: boolean;
};
export type Attendance = {
  id: string;
  associate_id: string;
  actor_name: string;
  online: boolean;
  occurred_at: string;
  work_date: string;
};
export type WorkRate = {
  associate_id: string;
  assessment: number;
  installation: number;
  commissioning: number;
};
export type Earning = {
  id: string;
  site_id: string | null;
  associate_id: string;
  phase: Phase;
  company_name: string;
  completed_at: string;
  earning_date: string;
  amount: number | null;
  eligible: boolean;
  paid: boolean;
};
export type Visit = {
  id: string;
  site_id: string;
  assignee_id: string;
  company_name: string;
  visit_type: VisitType;
  scheduled_for: string;
  shift: string | null;
  expected_arrival: string | null;
  expected_end: string | null;
  priority: string;
  manager_due_date?: string | null;
  manager_note?: string | null;
  status: string;
  completed_at: string | null;
  note: string | null;
  delay_reason: string | null;
};
export type Company = {
  site_id: string;
  active?: boolean;
  company_name: string;
  worker_ids: string[];
  status?: string;
  phase: Phase | "complete";
  assessment_ready: boolean;
  installation_ready: boolean;
  commissioning_ready: boolean;
  assessment_completed_at: string | null;
};
export type Payment = {
  id: string;
  associate_id: string;
  period_end: string;
  amount: number;
  paid_on: string;
  reference: string | null;
};
export type FieldBoard = {
  today: string;
  tracking_started: string;
  users: Associate[];
  attendance: Attendance[];
  rates: WorkRate[];
  earnings: Earning[];
  sites: Company[];
  visits: Visit[];
  payments: Payment[];
  date_changes: {
    earning_id: string;
    old_date: string;
    new_date: string;
    reason: string;
    changed_at: string;
  }[];
};

type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};
export const fieldRpc = (name: string, args?: Record<string, unknown>) =>
  (supabase as unknown as RpcClient).rpc(name, args);
export const phaseLabel: Record<Phase, string> = {
  assessment: "Assessment",
  installation: "Installation",
  commissioning: "Commissioning",
};
export const stageLabel: Record<Phase, string> = {
  assessment: "Not started yet → Assessed",
  installation: "Assessed → Installed",
  commissioning: "Installed → Commissioned",
};
export const shifts = ["10:00-12:00", "12:00-14:00", "14:00-16:00", "16:00-18:00", "18:00-20:00"];
export const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
export const indiaDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export const indiaTime = (stamp: string) =>
  new Date(stamp).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
const key = (date: Date) => date.toISOString().slice(0, 10);
export function paymentPeriod(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1 + (day > 15 ? 1 : 0), 15));
  return {
    start: key(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 16))),
    end: key(end),
    due: key(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 7))),
  };
}
export function monthDays(month: string) {
  const [year, number] = month.split("-").map(Number);
  return Array.from(
    { length: new Date(Date.UTC(year, number, 0)).getUTCDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}
export function installationOverdue(company: Company, today: string) {
  if (
    company.active === false ||
    (company.phase !== undefined && company.phase !== "installation") ||
    !company.assessment_ready ||
    company.installation_ready ||
    company.commissioning_ready ||
    !company.assessment_completed_at
  )
    return false;
  return (
    Date.parse(`${today}T00:00:00+05:30`) -
      Date.parse(`${indiaDate(new Date(company.assessment_completed_at))}T00:00:00+05:30`) >=
    5 * 86400000
  );
}
export function earningsTotal(rows: Earning[]) {
  return rows
    .filter((e) => e.phase !== "installation" && (e.eligible || e.paid))
    .reduce((total, e) => total + Number(e.amount ?? 0), 0);
}

export function visibleWorkDates(rows: Earning[], attendance: Attendance[], associateId: string) {
  const online = new Set(
    attendance
      .filter((event) => event.associate_id === associateId && event.online)
      .map((event) => event.work_date),
  );
  const work = rows.filter(
    (entry) => entry.associate_id === associateId && (entry.eligible || entry.paid),
  );
  const commissioning = new Set(
    work.filter((entry) => entry.phase === "commissioning").map((entry) => entry.earning_date),
  );
  return Array.from(new Set(work.map((entry) => entry.earning_date)))
    .filter((date) => online.has(date) || commissioning.has(date))
    .sort();
}
