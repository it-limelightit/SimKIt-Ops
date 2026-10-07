import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Isolate additive RPCs until types are regenerated from the deployed schema.
const attendanceClient = supabase as unknown as SupabaseClient;
export const departments = ["firmware", "hardware", "logistic", "software", "manager"] as const;
export type Department = (typeof departments)[number];
export type Employee = {
  id: string;
  name: string;
  department: Department;
  enroll_id: string;
  email: string | null;
  email_verified: boolean;
  active: boolean;
  employment_start: string;
  enrollment_status: "pending" | "enrolled" | "failed";
};
export type AttendanceRow = {
  employee_id: string;
  name: string;
  department: Department;
  enroll_id: string;
  entry_at: string | null;
  late_minutes: number | null;
  event_id: string | null;
  photo_expires_at: string | null;
  photo_status: string | null;
  leave_conflict: boolean;
  status: string;
};
export type Leave = {
  id: string;
  employee_id: string | null;
  employee_name: string | null;
  sender_email: string | null;
  start_date: string | null;
  end_date: string | null;
  reason: string;
  source: string;
  status: string;
  comment: string | null;
};
export type Settings = {
  shift_start: string;
  grace_minutes: number;
  absence_cutoff: string | null;
  working_days: number[];
  holidays: string[];
};
export type Scan = {
  id: string;
  enroll_id: string;
  scanned_at: string;
  received_at: string;
  validation_state: string;
  photo_status?: string;
  photo_expires_at?: string;
};
export type History = {
  events: Scan[];
  audit: { id: string; action: string; occurred_at: string; details: Record<string, unknown> }[];
};
export type AttendanceBoard = {
  settings: Settings | null;
  device: { state: string; last_heartbeat_at: string | null; last_scan_at: string | null };
  employees: Employee[];
  rows: AttendanceRow[];
  leaves: Leave[];
  review_events: Scan[];
  server_time: string;
};
export const statusLabels: Record<string, string> = {
  present: "Present",
  late: "Late",
  on_leave: "On leave",
  awaiting_scan: "Awaiting scan",
  absent: "Absent",
  off_day: "Off day",
  needs_review: "Needs review",
  pending: "Pending",
  enrolled: "Enrolled",
  failed: "Failed",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
export function indiaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function timeLabel(value: string | null) {
  return value
    ? new Date(value).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
export function dateLabel(value: string | null) {
  return value
    ? new Date(`${value}T12:00:00+05:30`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      })
    : "Date needs review";
}
export async function attendanceRpc<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await attendanceClient.rpc(name, args);
  if (error)
    throw new Error(
      error.code === "PGRST202" || error.code === "42883"
        ? "Attendance is not set up yet. Apply the attendance database migration first."
        : error.message,
    );
  return data as T;
}
export async function attendanceFunction<T = unknown>(
  name: string,
  input: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await attendanceClient.functions.invoke(name, { body: input });
  if (error) {
    let message = error.message;
    if ("context" in error && error.context instanceof Response) {
      try {
        const result = await error.context.json();
        message = result.error || message;
      } catch {
        /* Preserve transport error. */
      }
    }
    throw new Error(message);
  }
  return data as T;
}
