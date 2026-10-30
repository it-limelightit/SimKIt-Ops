import type { AttendanceRow, Scan } from "./device-attendance";

export function scanTimeExplanation(reason?: string | null) {
  const fix = "Open scan history, check reliable attendance evidence, then enter and save the confirmed time. Use device history only if its clock is verified. Automatic late penalties stay paused until this is resolved.";
  switch (reason) {
    case "outage_affected":
      return { title: "Delayed after connection outage", reason: "This scan arrived when the connection recovered. Its original scan time was not saved, so the arrival time cannot be used as the employee's entry time.", fix };
    case "device_clock_unverified":
    case "device_time_missing_or_invalid":
    case "device_time_ahead":
      return { title: "Device time could not be verified", reason: "The machine's clock was missing, stopped or inconsistent. The actual entry time could not be confirmed.", fix: `Check the device clock and connection. ${fix}` };
    case "buffered_batch":
      return { title: "Saved scans arrived together", reason: "The machine uploaded several scans together. They may have happened earlier, so upload time is not a confirmed entry time.", fix };
    case "device_connection_unverified":
      return { title: "Connection was not confirmed", reason: "The device connection was not confirmed when this scan arrived. The record may have been delayed.", fix };
    case "delayed_or_clock_changed":
      return { title: "Scan delayed or device clock changed", reason: "The scan time does not match the machine's current advancing clock. It may be an older record or a clock change.", fix };
    default:
      return { title: "Scan time not confirmed", reason: "A scan was received, but there is not enough reliable timing information to show the actual entry time.", fix };
  }
}

export function withAttendanceReviewReason(row: AttendanceRow, events: Scan[] = []): AttendanceRow {
  if (row.status !== "needs_review") return row;
  const event = events.find((event) => event.validation_state === "time_unverified" &&
    (event.id === row.event_id || event.employee_id === row.employee_id));
  return event?.time_review_reason ? { ...row, time_review_reason: event.time_review_reason } : row;
}

export function attendanceReviewExplanation(row: AttendanceRow) {
  if (row.status !== "needs_review") return null;
  if (row.time_review_reason) return scanTimeExplanation(row.time_review_reason);
  if (row.leave_conflict) return {
    title: "Scan conflicts with approved leave",
    reason: "A face scan and approved leave are recorded for the same day.",
    fix: "Check the scan and leave dates, then correct the leave decision if needed.",
  };
  return {
    title: "Attendance calculation incomplete",
    reason: "The available scan, office timing or leave information is not sufficient to calculate this day's attendance.",
    fix: "Open the employee's scan history and check the office timing and leave records for this date.",
  };
}
