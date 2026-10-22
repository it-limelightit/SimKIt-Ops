import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export { canManageHr } from "./hr-access";
export type EmploymentType = "internship" | "full_time";
export type OfferTemplate = "software" | "firmware" | "field_associate";
export type HrTerm = {
  id: string;
  employee_id: string;
  revision: number;
  employment_type: EmploymentType;
  monthly_amount: number;
  annual_ctc: number | null;
  internship_months: number | null;
  internship_end: string | null;
  effective_from: string;
  reason: string;
  created_at: string;
};
export type HrEmployee = {
  id: string;
  employee_code: string;
  revision: number;
  name: string;
  email: string;
  mobile: string;
  department: string;
  designation: string;
  mentor_name: string;
  joining_date: string;
  address: string;
  college: string;
  app_access: "employee" | "field_associate" | "manager";
  attendance_method: "office_device" | "field_online";
  status: "onboarding" | "active" | "left";
  auth_user_id: string | null;
  attendance_employee_id: string | null;
  enroll_id?: string | null;
  enrollment_status?: string | null;
  current_term: HrTerm | null;
  directory_source?: HrCandidate;
  attendance_start?: string | null;
};
export type OfferFields = {
  offer_date: string;
  honorific: string;
  greeting_name: string;
  recipient_location: string;
  acceptance_place: string;
  initial_stipend_months: number;
  acceptance_days: number;
  office_timings: string;
  incentive_per_installation: number;
  travel_per_km: number;
  installation_target: number;
  probation_months: number;
  payment_day: number;
  payroll_cutoff_day: number;
};
export type OfferSnapshot = {
  version: 1;
  template: OfferTemplate;
  employee: HrEmployee;
  term: HrTerm;
  fields: OfferFields;
};
export type HrOffer = {
  id: string;
  employee_id: string;
  offer_number: string;
  template: OfferTemplate;
  snapshot: OfferSnapshot;
  created_at: string;
};
export type HrCandidate = {
  auth_user_id: string | null;
  attendance_employee_id: string | null;
  name: string;
  email: string;
  mobile: string;
  department: string | null;
  joining_date: string | null;
  app_access: HrEmployee["app_access"];
  directory_visible?: boolean;
  enroll_id?: string | null;
  enrollment_status?: string | null;
  mentor_name?: string;
};
export type HrBoard = {
  today: string;
  employees: HrEmployee[];
  terms: HrTerm[];
  offers: HrOffer[];
  candidates: HrCandidate[];
};

export function defaultHrMentor(person: { name?: string; email?: string; app_access?: string }) {
  const email = person.email?.trim().toLowerCase() || "";
  const first = person.name?.trim().toLowerCase().split(/\s+/)[0] || "";
  if (person.app_access === "field_associate") return "Raghav Gaur & Hitesh Bhai";
  if (
    [
      "vikashkumavat.limelight@gmail.com",
      "mayankk.limelightit@gmail.com",
      "surajbiswas.limelight@gmail.com",
    ].includes(email) ||
    ["vikash", "vikas", "mayank", "suraj"].includes(first)
  )
    return "Kuldeep Shrimali";
  if (
    [
      "nitsanghani1@gmail.com",
      "kishanvyas308@gmail.com",
      "associatelimelight@gmail.com",
      "info@limelightit.io",
      "kuldeepshrimali.limelight@gmail.com",
    ].includes(email) ||
    ["nit", "kishan", "hitesh", "raghav", "kuldeep"].includes(first)
  )
    return "Tarun Purohit";
  if (email === "aryankadiya2005@gmail.com" || first === "aryan") return "Hitesh Bhai";
  return "";
}

export const mentorSuggestions = [
  "Kuldeep Shrimali",
  "Tarun Purohit",
  "Hitesh Bhai",
  "Raghav Gaur",
  "Raghav Gaur & Hitesh Bhai",
];

// Existing people are visible before their missing HR details are completed.
// Reading the directory never provisions accounts, invents pay or changes attendance.
export function hrDirectory(board: HrBoard | null): HrEmployee[] {
  if (!board) return [];
  const employees = board.employees.map((e) => ({
    ...e,
    mentor_name: e.mentor_name || defaultHrMentor(e),
  }));
  const matches = (employee: HrEmployee, source: HrCandidate) =>
    Boolean(source.auth_user_id && employee.auth_user_id === source.auth_user_id) ||
    Boolean(
      source.attendance_employee_id &&
      employee.attendance_employee_id === source.attendance_employee_id,
    ) ||
    Boolean(
      source.email && employee.email.trim().toLowerCase() === source.email.trim().toLowerCase(),
    );
  for (const source of board.candidates) {
    if (
      !(source.directory_visible ?? Boolean(source.attendance_employee_id)) ||
      employees.some((e) => matches(e, source))
    )
      continue;
    employees.push({
      id: `existing:${source.attendance_employee_id || source.auth_user_id || source.email}`,
      employee_code: source.enroll_id ? `Device ${source.enroll_id}` : "Existing account",
      revision: 0,
      name: source.name || source.email,
      email: source.email,
      mobile: source.mobile,
      department:
        source.department ||
        (source.app_access === "field_associate"
          ? "field"
          : source.app_access === "manager"
            ? "manager"
            : "software"),
      designation: "",
      mentor_name: source.mentor_name || defaultHrMentor(source),
      joining_date: "",
      address: "",
      college: "",
      app_access: source.app_access,
      attendance_method: source.app_access === "field_associate" ? "field_online" : "office_device",
      status: "active",
      auth_user_id: source.auth_user_id,
      attendance_employee_id: source.attendance_employee_id,
      enroll_id: source.enroll_id,
      enrollment_status: source.enrollment_status,
      current_term: null,
      attendance_start: source.joining_date,
      directory_source: source,
    });
  }
  return employees.sort((a, b) => a.name.localeCompare(b.name, "en-IN", { sensitivity: "base" }));
}
export const hrDepartments = ["software", "firmware", "field", "logistic", "manager"];
export const employmentLabel = (type?: string | null) =>
  type === "full_time" ? "Full time" : type === "internship" ? "Internship" : "Not set";
export const templateLabel = (template: OfferTemplate) =>
  ({ software: "Software team", firmware: "Firmware team", field_associate: "Field associate" })[
    template
  ];
export const hrMoney = (amount: number | null | undefined) =>
  amount == null
    ? "—"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }).format(amount);

export function suggestedTemplate(
  employee: Pick<HrEmployee, "department" | "app_access">,
): OfferTemplate {
  return employee.app_access === "field_associate" || employee.department === "field"
    ? "field_associate"
    : employee.department === "firmware"
      ? "firmware"
      : "software";
}

// Clamp to the last day of the target month rather than overflowing short months.
export function internshipEnd(start: string, months: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(months) || months < 1) return "";
  const [year, month, day] = start.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  target.setUTCDate(target.getUTCDate() - 1);
  return target.toISOString().slice(0, 10);
}

export type TermDraft = {
  employment_type: EmploymentType;
  monthly_amount: string;
  annual_ctc: string;
  internship_months: string;
  internship_end: string;
  effective_from: string;
};
export function termDraft(term: HrTerm | null | undefined, start: string): TermDraft {
  return {
    employment_type: term?.employment_type || "internship",
    monthly_amount: term ? String(term.monthly_amount) : "",
    annual_ctc: term?.annual_ctc ? String(term.annual_ctc) : "",
    internship_months: String(term?.internship_months || 6),
    internship_end: term?.internship_end || internshipEnd(start, 6),
    effective_from: start,
  };
}
export function termPayload(draft: TermDraft) {
  return {
    ...draft,
    monthly_amount: Number(draft.monthly_amount),
    annual_ctc: draft.employment_type === "full_time" ? Number(draft.annual_ctc) : null,
    internship_months:
      draft.employment_type === "internship" ? Number(draft.internship_months) : null,
    internship_end: draft.employment_type === "internship" ? draft.internship_end : null,
  };
}

export function defaultOfferFields(
  employee: HrEmployee,
  term: HrTerm,
  template: OfferTemplate,
  today: string,
): OfferFields {
  return {
    offer_date: today,
    honorific: "",
    greeting_name: employee.name.trim().split(/\s+/)[0],
    recipient_location: employee.college || employee.address || "Ahmedabad, Gujarat",
    acceptance_place: "Ahmedabad",
    initial_stipend_months: Math.min(
      term.internship_months || 1,
      template === "firmware" ? 3 : template === "field_associate" ? 2 : 1,
    ),
    acceptance_days: 2,
    office_timings: "10:00 AM to 7:00 PM (Monday to Saturday)",
    incentive_per_installation: 2000,
    travel_per_km: 3.5,
    installation_target: 5,
    probation_months: template === "field_associate" ? 5 : 3,
    payment_day: 7,
    payroll_cutoff_day: 30,
  };
}

const client = supabase as unknown as SupabaseClient;
export async function hrRpc<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error(
      error.code === "PGRST202" || error.code === "42883"
        ? "HR setup is pending. Apply the HR / Hiring database migration to enable this section."
        : error.message,
    );
  return data as T;
}
export async function hrAccountRequest(input: Record<string, unknown>) {
  const { data, error } = await client.functions.invoke("hr-employee-account", { body: input });
  if (error) {
    let message = error.message;
    if ("context" in error && error.context instanceof Response) {
      try {
        message = (await error.context.json()).error || message;
      } catch {
        /* Keep transport error. */
      }
    }
    throw new Error(message);
  }
  return data as { employee_id: string; linked: boolean };
}
