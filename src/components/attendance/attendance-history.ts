import type { AttendanceBoard, AttendanceRow } from "@/lib/device-attendance";
import { attendanceCsv } from "@/lib/attendance-analytics";

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function monthDates(month: string) {
  const start = `${month}-01`;
  const next = new Date(`${start}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return dateRange(start, addDays(next.toISOString().slice(0, 10), -1));
}

export function dateRange(start: string, end: string) {
  const dates: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return dates;
  for (let date = start; date <= end && dates.length <= 93; date = addDays(date, 1))
    dates.push(date);
  return dates;
}

export type EmployeeDay = { date: string; row: AttendanceRow | null };

export function employeeHistoryCsv(days: EmployeeDay[]) {
  // Reuse the daily export's escaping, timestamps and raw late minutes.
  const lines = days
    .filter((day) => day.row)
    .map((day) => attendanceCsv([day.row!], day.date).split("\r\n").slice(1).join("\r\n"));
  return attendanceCsv([], "") + (lines.length ? "\r\n" + lines.join("\r\n") : "");
}

/** Per-view cache: successful reads only, shared across employee selections. */
export function createAttendanceDayCache(read: (date: string) => Promise<AttendanceBoard>) {
  const cache = new Map<string, { board: AttendanceBoard; at: number }>();
  const pending = new Map<string, Promise<AttendanceBoard>>();
  return {
    seed(date: string, board: AttendanceBoard) {
      cache.set(date, { board, at: Date.now() });
    },
    get(date: string, maxAge = 60_000) {
      const existing = cache.get(date);
      if (existing && Date.now() - existing.at < maxAge) return Promise.resolve(existing.board);
      const request = pending.get(date);
      if (request) return request;
      const previous = cache.get(date);
      const next = read(date)
        .then((board) => {
          // A live dashboard response seeded during this request is newer.
          const current = cache.get(date);
          if (current && current !== previous) return current.board;
          cache.set(date, { board, at: Date.now() });
          // Bound memory when browsing many months.
          if (cache.size > 128) cache.delete(cache.keys().next().value!);
          return board;
        })
        .finally(() => pending.delete(date));
      pending.set(date, next);
      return next;
    },
    clear() {
      cache.clear();
    },
  };
}
