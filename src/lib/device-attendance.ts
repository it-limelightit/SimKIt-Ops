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
  auth_user_id?: string | null;
  email_verified: boolean;
  active: boolean;
  employment_start: string;
  enrollment_status: "pending" | "enrolled" | "failed";
  work_from_home_enabled?: boolean;
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
  time_review_reason?: string | null;
  entry_source?: "scan" | "manager_adjusted";
  adjustment_reason?: string | null;
  request_type?: "leave" | "wfh" | null;
  request_status?: string | null;
  request_reason?: string | null;
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
  request_type?: "leave" | "wfh";
  approver_emails?: string[];
  status: string;
  comment: string | null;
  reviewed_at?: string | null;
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
  employee_id?: string | null;
  enroll_id: string;
  scanned_at: string;
  received_at: string;
  validation_state: string;
  receiver_received_at?: string | null;
  device_time_raw?: string | null;
  time_source?: string;
  time_review_reason?: string | null;
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
  work_from_home: "Work from home",
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
  valid: "Valid entry",
  unknown_employee: "Employee not matched",
  inactive_employee: "Inactive employee",
  failed_recognition: "Face not recognized",
  invalid_time: "Time needs review",
  time_unverified: "Scan time needs review",
};
export const timeReviewLabels: Record<string, string> = {
  device_connection_unverified: "The device connection was not confirmed when this record arrived.",
  device_clock_unverified: "The device clock could not be verified as advancing.",
  buffered_batch: "Several records arrived together and may have been saved during an outage.",
  device_time_missing_or_invalid: "The device supplied no usable scan time.",
  device_time_ahead: "The scan time is ahead of the sampled device clock.",
  delayed_or_clock_changed: "The record was delayed or the device clock changed.",
  receiver_health_missing: "Connection health was not recorded for this scan.",
  outage_affected: "This record arrived during recovery from a confirmed outage.",
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
        ? `Attendance request ${name} failed (${error.code}): ${error.message}`
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
