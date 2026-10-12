import type { AttendanceRow } from "./device-attendance";

export function formatAttendanceDuration(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const total = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ""}` : `${remainder}m`;
}

export function attendanceSummary(rows: AttendanceRow[]) {
  const recorded = rows.filter((row) => row.entry_at);
  const late = recorded.filter((row) => row.late_minutes != null && row.late_minutes > 0);
  const onTime = recorded.filter((row) => row.late_minutes === 0);
  const expected = rows.filter((row) => !["off_day", "on_leave"].includes(row.status));
  const assessed = late.length + onTime.length;
  const totalDelay = late.reduce((sum, row) => sum + row.late_minutes!, 0);
  return {
    total: rows.length,
    expected: expected.length,
    recorded: recorded.length,
    onTime: onTime.length,
    late: late.length,
    onLeave: rows.filter((row) => row.status === "on_leave").length,
    absent: rows.filter((row) => row.status === "absent").length,
    awaiting: rows.filter((row) => row.status === "awaiting_scan").length,
    review: rows.filter((row) => row.status === "needs_review").length,
    offDay: rows.filter((row) => row.status === "off_day").length,
    unassessed: recorded.length - assessed,
    totalDelay,
    averageDelay: late.length ? Math.round(totalDelay / late.length) : null,
    longestDelay: late.length ? Math.max(...late.map((row) => row.late_minutes!)) : null,
    coverage: expected.length
      ? Math.round((expected.filter((row) => row.entry_at).length / expected.length) * 100)
      : null,
    punctuality: assessed ? Math.round((onTime.length / assessed) * 100) : null,
  };
}

export function matchesAttendanceStatus(row: AttendanceRow, status: string) {
  if (status === "all") return true;
  if (status === "recorded") return !!row.entry_at;
  if (status === "on_time") return !!row.entry_at && row.late_minutes === 0;
  if (status === "late_arrivals")
    return !!row.entry_at && row.late_minutes != null && row.late_minutes > 0;
  // Keep review conflicts visible as review, even when they also arrived late.
  return row.status === status;
}

export function attendanceCsv(rows: AttendanceRow[], date: string) {
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    const safe = /^\s*[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const data = [
    [
      "Date (IST)",
      "Employee",
      "Enrollment ID",
      "Department",
      "Entry time (IST)",
      "Entry timestamp (UTC)",
      "Status",
      "Late minutes",
      "Late duration",
      "Leave conflict",
    ],
    ...rows.map((row) => [
      date,
      row.name,
      row.enroll_id,
      row.department,
      row.entry_at
        ? new Date(row.entry_at).toLocaleTimeString("en-GB", {
            timeZone: "Asia/Kolkata",
            hour12: false,
          })
        : "",
      row.entry_at ? new Date(row.entry_at).toISOString() : "",
      row.status,
      row.late_minutes,
      row.late_minutes == null ? "" : formatAttendanceDuration(row.late_minutes),
      row.leave_conflict ? "Yes" : "No",
    ]),
  ];
  return "\uFEFF" + data.map((row) => row.map(cell).join(",")).join("\r\n");
}
