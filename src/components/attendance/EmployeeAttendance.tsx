import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
} from "lucide-react";
import { Button, Card, Input } from "@/components/ui-kit";
import { PunctualityInsights } from "./PunctualityInsights";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-store";
import { canManageAttendance } from "@/lib/attendance-access";
import {
  attendanceRpc,
  attendanceFunction,
  dateLabel,
  indiaDate,
  statusLabels,
  timeLabel,
  type AttendanceBoard,
  type Employee,
  type History,
} from "@/lib/device-attendance";
import { AttendanceEvidenceDialogs, type AttendancePhoto, type AttendanceRecordView } from "./AttendanceEvidenceDialogs";
import { attendanceSummary, formatAttendanceDuration } from "@/lib/attendance-analytics";
import { requestCalendarStyle } from "@/lib/request-calendar";
import { attendanceReviewExplanation, withAttendanceReviewReason } from "@/lib/attendance-review";
import {
  addDays,
  createAttendanceDayCache,
  dateRange,
  monthDates,
  type EmployeeDay,
} from "./attendance-history";

const colors: Record<string, string> = {
  present: "border-mint/30 bg-mint/10 text-mint",
  late: "border-warning/30 bg-warning/10 text-warning",
  absent: "border-coral/30 bg-coral/10 text-coral",
  on_leave: "border-violet/30 bg-violet/10 text-violet",
  work_from_home: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700",
  needs_review: "border-lime/30 bg-lime/10 text-lime",
  awaiting_scan: "border-border bg-surface-raised text-text-secondary",
  off_day: "border-border bg-surface text-text-secondary",
};
type Props = {
  employee: Employee;
  onBack: () => void;
  board: AttendanceBoard | null;
  boardDate: string;
};

export function EmployeeAttendance({ employee, board, boardDate, onBack }: Props) {
  const employeeId = employee.id;
  const userId = useAuth((state) => state.userId);
  const cache = useMemo(
    () =>
      createAttendanceDayCache((date) => {
        if (useAuth.getState().userId !== userId)
          return Promise.reject(new Error("Session changed. Reopen attendance history."));
        return attendanceRpc<AttendanceBoard>("attendance_board", { _date: date });
      }),
    [userId],
  );
  const today = indiaDate();
  const [period, setPeriod] = useState("monthly");
  const [detailView, setDetailView] = useState<"calendar" | "trends">("calendar");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{
    key: string;
    days: EmployeeDay[];
    errors: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [photo, setPhoto] = useState<AttendancePhoto | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [record, setRecord] = useState<AttendanceRecordView>(null);
  const [recordBusy, setRecordBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const lastRevision = useRef(0);
  useEffect(() => {
    setMonth(boardDate.slice(0, 7));
    setPeriod("monthly");
    setSelected(boardDate);
    setCustomStart(boardDate);
    setCustomEnd(boardDate);
  }, [employeeId, boardDate]);
  const calendarDates = useMemo(() => monthDates(month), [month]);
  const start =
    period === "today"
      ? today
      : period === "weekly"
        ? addDays(today, -6)
        : period === "custom"
          ? customStart
          : calendarDates[0];
  const end =
    period === "monthly"
      ? calendarDates[0] > today
        ? calendarDates.at(-1)!
        : calendarDates.at(-1)! < today
          ? calendarDates.at(-1)!
          : today
      : period === "custom"
        ? customEnd
        : today;
  const range = useMemo(() => dateRange(start, end), [start, end]);
  const invalid = period !== "monthly" && (!range.length || range.length > 93 || end > today);
  const key = `${userId}:${employeeId}:${month}:${start}:${end}`;
  const data = loaded?.key === key ? loaded : null;
  const days = (data?.days || [])
    .filter((day) => day.date >= start && day.date <= end && day.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  const summary = attendanceSummary(days.flatMap((day) => (day.row ? [day.row] : [])));
  const byDate = new Map((data?.days || []).map((day) => [day.date, day]));
  const errors = data?.errors || [];

  useEffect(() => {
    if (!employee || invalid) return;
    let cancelled = false;
    const manualRefresh = lastRevision.current !== revision;
    lastRevision.current = revision;
    if (board && !manualRefresh) cache.seed(boardDate, board);
    const dates = [...new Set([...calendarDates, ...range])];
    const result: EmployeeDay[] = [];
    const failures: string[] = [];
    let index = 0;
    setLoading(true);
    async function worker() {
      while (!cancelled && index < dates.length) {
        const date = dates[index++];
        try {
          const daily = await cache.get(date, manualRefresh ? 0 : date === today ? 14_000 : 60_000);
          const row = daily.rows.find((row) => row.employee_id === employee!.id);
          result.push({
            date,
            row: row ? withAttendanceReviewReason(row, daily.review_events) : null,
          });
        } catch (failure) {
          failures.push(
            `${dateLabel(date)}: ${failure instanceof Error ? failure.message : "Attendance unavailable"}`,
          );
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, dates.length) }, worker)).then(() => {
      if (!cancelled) {
        setLoaded({ key, days: result, errors: failures });
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [employee, invalid, board, boardDate, cache, calendarDates, range, today, key, revision]);

  function changePeriod(value: string) {
    setPeriod(value);
    setSelected(null);
    if (value !== "custom") setMonth(today.slice(0, 7));
  }
  function moveMonth(offset: number) {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    setMonth(date.toISOString().slice(0, 7));
    setSelected(null);
  }
  async function viewPhoto(eventId: string) {
    if (photoBusy) return;
    setPhotoBusy(true);
    try {
      setPhoto(
        await attendanceFunction<AttendancePhoto>("attendance-photo-access", { event_id: eventId }),
      );
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not load attendance photo.");
    } finally {
      setPhotoBusy(false);
    }
  }
  async function viewScans(date: string) {
    setRecordBusy(true);
    try {
      const result = await attendanceRpc<History>("attendance_history", { _employee: employeeId, _date: date });
      if (useAuth.getState().userId === userId) setRecord({ name: employee.name, date, data: result });
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : "Could not load scan history."); }
    finally { setRecordBusy(false); }
  }
  async function exportHistory(format: "xlsx" | "pdf" = "xlsx") {
    if (exporting || loading || invalid || errors.length || !data || !summary.total) return;
    setExporting(true);
    try {
      let buffer: ArrayBuffer | Uint8Array;
      if (format === "pdf") {
        const [{ createEmployeeAttendancePdf }, { attendanceReportLogo }] = await Promise.all([
          import("@/lib/attendance-pdf"),
          import("@/lib/attendance-report-logo"),
        ]);
        const pdf = await createEmployeeAttendancePdf(
          employee,
          days,
          start,
          end,
          new Date(),
          await attendanceReportLogo(),
        );
        buffer = pdf.output("arraybuffer");
      } else {
        const { createEmployeeAttendanceWorkbook } = await import("@/lib/attendance-excel");
        const workbook = await createEmployeeAttendanceWorkbook(employee, days, start, end);
        buffer = new Uint8Array(await workbook.xlsx.writeBuffer());
      }
      const session = useAuth.getState();
      if (session.userId !== userId || !canManageAttendance(session.email))
        throw new Error("Session changed. Reopen attendance history.");
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(buffer)], {
          type:
            format === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `attendance-${employee.enroll_id.replace(/[^a-zA-Z0-9_-]/g, "_")}-${start}-${end}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`${format === "pdf" ? "PDF" : "Excel"} attendance report downloaded.`);
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not export attendance.");
    } finally {
      setExporting(false);
    }
  }
  const selectedDay = selected ? byDate.get(selected) : null;
  return (
    <section className="attendance-page mx-auto max-w-[1440px] space-y-4 p-3 font-sans text-text-primary sm:p-5 lg:p-6">
      <header className="sticky top-0 z-20 space-y-2 border-b border-border bg-background/95 px-3 pt-3 pb-3 shadow-sm backdrop-blur sm:px-5 sm:pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <Button size="sm" variant="ghost" className="mt-0.5 min-h-8 px-2" onClick={onBack}>
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Attendance</span>
            </Button>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                Employee attendance history
              </p>
              <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
                {employee.name}
              </h1>
              <p className="truncate text-xs capitalize text-text-secondary">
                {employee.department} · ID {employee.enroll_id} ·{" "}
                {employee.active ? "Active" : "Inactive"}
              </p>
            </div>
          </div>
          <span className="hidden text-right text-[11px] leading-relaxed text-text-secondary md:block">
            {employee.email || "Email unavailable"}
            {employee.email ? ` · ${employee.email_verified ? "verified" : "unverified"}` : ""}
            <br />
            Device · {employee.enrollment_status} · From {dateLabel(employee.employment_start)}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            className="flex flex-wrap gap-0.5 rounded-lg bg-surface-raised p-1"
            aria-label="Attendance history period"
          >
            {[
              ["today", "Today"],
              ["weekly", "Week"],
              ["monthly", "Month"],
              ["custom", "Custom"],
            ].map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                className="min-h-8 px-2.5"
                variant={period === value ? "primary" : "ghost"}
                aria-pressed={period === value}
                onClick={() => changePeriod(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              className="min-h-8 px-2"
              variant="ghost"
              disabled={loading}
              aria-label="Refresh employee history"
              onClick={() => {
                cache.clear();
                setRevision((value) => value + 1);
              }}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </Button>
            <Button
              size="sm"
              className="min-h-8 px-2.5"
              variant="secondary"
              disabled={exporting || loading || invalid || !!errors.length || !summary.total}
              title="Employee summary and daily attendance (.xlsx)"
              onClick={() => void exportHistory()}
            >
              <Download size={14} />
              {exporting ? "Preparing report…" : "Download Excel"}
            </Button>
            <Button
              size="sm"
              className="min-h-8 px-2.5"
              variant="secondary"
              disabled={exporting || loading || invalid || !!errors.length || !summary.total}
              title="Branded attendance summary, analytics and daily records (.pdf)"
              onClick={() => void exportHistory("pdf")}
            >
              <Download size={14} />
              {exporting ? "Preparing report…" : "Download PDF"}
            </Button>
          </div>
        </div>
        {period === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            {[
              ["From", customStart, setCustomStart],
              ["To", customEnd, setCustomEnd],
            ].map(([label, value, setter]) => (
              <label
                className="flex items-center gap-2 text-[11px] text-text-secondary"
                key={label as string}
              >
                {label as string}
                <Input
                  type="date"
                  value={value as string}
                  max={today}
                  onChange={(event) => {
                    (setter as (value: string) => void)(event.target.value);
                    setSelected(null);
                  }}
                />
              </label>
            ))}
          </div>
        )}
      </header>
      <div className="space-y-3">
        {invalid && (
          <p role="alert" className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
            Choose a valid range of up to 93 days, ending today or earlier.
          </p>
        )}
        {!invalid && (
          <>
            <p className="text-xs text-text-secondary">
              {dateLabel(start)} – {dateLabel(end)} · Asia/Kolkata ·{" "}
              {period === "weekly"
                ? "Last 7 days"
                : period === "monthly"
                  ? "Selected month"
                  : period === "today"
                    ? "Today"
                    : "Custom range"}
              .{loading && data && " Refreshing…"}
            </p>
            {errors.length > 0 && (
              <div
                role="alert"
                className="rounded-lg border border-coral/20 bg-coral/10 p-3 text-sm"
              >
                <p>
                  {errors.length} dates could not be loaded. Totals and charts include available
                  dates only; export is disabled.
                </p>
                <details className="mt-2 text-xs">
                  <summary>View errors</summary>
                  {errors.map((error) => (
                    <p key={error} className="mt-1">
                      {error}
                    </p>
                  ))}
                </details>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-busy={loading}>
              {[
                ["Present days", summary.recorded],
                ["On-time days", summary.onTime],
                ["Late days", summary.late],
                ["Confirmed absent", summary.absent],
              ].map(([label, value]) => (
                <Card key={label} className="rounded-lg p-2.5 sm:p-3">
                  <p className="text-xs text-text-secondary">{label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{!data ? "—" : value}</p>
                </Card>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-text-secondary">
              {!data
                ? "Loading attendance…"
                : `${summary.punctuality == null ? "Punctuality unavailable" : `${summary.punctuality}% on time across ${summary.onTime + summary.late} assessed arrivals`} · ${summary.onLeave} leave · ${summary.awaiting} awaiting scan · ${summary.review} need review. On-time and late days are included in present days.`}
            </p>
          </>
        )}
        <div
          role="tablist"
          aria-label="Employee attendance views"
          className="inline-flex rounded-lg bg-surface-raised p-1"
        >
          <button
            role="tab"
            aria-selected={detailView === "calendar"}
            onClick={() => setDetailView("calendar")}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium ${detailView === "calendar" ? "bg-surface text-lime shadow-sm" : "text-text-secondary hover:text-text-primary"}`}
          >
            <CalendarDays size={14} />
            Calendar & History
          </button>
          <button
            role="tab"
            aria-selected={detailView === "trends"}
            onClick={() => setDetailView("trends")}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium ${detailView === "trends" ? "bg-surface text-lime shadow-sm" : "text-text-secondary hover:text-text-primary"}`}
          >
            <TrendingUp size={14} />
            Punctuality Trends
          </button>
        </div>
        <Card className={`${detailView === "calendar" ? "" : "hidden"} rounded-xl p-3 sm:p-4`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarDays size={16} />
              {new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-IN", {
                month: "long",
                year: "numeric",
                timeZone: "Asia/Kolkata",
              })}
            </h3>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Previous calendar month"
                onClick={() => moveMonth(-1)}
              >
                <ChevronLeft size={16} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={month >= "2100-12"}
                aria-label="Next calendar month"
                onClick={() => moveMonth(1)}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <span key={day} className="py-1 text-[10px] font-medium text-text-secondary">
                {day}
              </span>
            ))}
            {Array.from({ length: new Date(`${month}-01T12:00:00Z`).getUTCDay() }, (_, index) => (
              <span key={`blank-${index}`} />
            ))}
            {calendarDates.map((date) => {
              const day = byDate.get(date);
              const status = day?.row?.status;
              const requestStyle = requestCalendarStyle(
                day?.row?.request_type,
                day?.row?.request_status,
              );
              const unavailable = !day?.row;
              const label =
                date > today
                  ? "Future date"
                  : !day?.row && date < (employee?.employment_start || "")
                    ? "Before employment"
                    : status
                      ? statusLabels[status] || status
                      : loading
                        ? "Loading"
                        : "Unavailable";
              return (
                <button
                  key={date}
                  type="button"
                  disabled={unavailable}
                  aria-pressed={selected === date}
                  aria-label={`${dateLabel(date)}: ${label}${requestStyle ? `, ${requestStyle.label}` : ""}`}
                  title={`${dateLabel(date)}: ${label}`}
                  onClick={() => setSelected(selected === date ? null : date)}
                  className={`min-h-9 rounded-md border px-0.5 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime sm:min-h-10 ${requestStyle?.tone || colors[status || ""] || "border-border text-text-secondary"} ${unavailable ? "opacity-50" : "hover:brightness-110"} ${selected === date ? "ring-2 ring-lime" : ""}`}
                >
                  <span className="block tabular-nums">{Number(date.slice(-2))}</span>
                  {requestStyle && (
                    <span className="mt-0.5 block truncate text-[8px] font-semibold sm:text-[9px]">
                      {requestStyle.label}
                    </span>
                  )}
                  {status && (
                    <span className="mt-0.5 hidden truncate text-[9px] sm:block">
                      {statusLabels[status] || status}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {Object.entries(colors).map(([status, color]) => (
              <span
                key={status}
                className="flex items-center gap-1 text-[10px] text-text-secondary"
              >
                <span className={`h-2 w-2 rounded-full border ${color}`} />
                {statusLabels[status]}
              </span>
            ))}
            <span className="text-[11px] text-text-secondary">
              Request colors: purple leave approved · indigo WFH approved · red rejected · amber
              pending. Faded: unavailable.
            </span>
          </div>
          <p className="mt-2 text-[11px] text-text-secondary">
            Select a date to inspect its attendance.
          </p>
          {selectedDay?.row && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised p-3 text-sm">
              <div>
                <p className="font-medium">
                  {dateLabel(selectedDay.date)} · {attendanceReviewExplanation(selectedDay.row)?.title || statusLabels[selectedDay.row.status]}
                </p>
                {selectedDay.row.entry_source === "manager_adjusted" && <p className="mt-1 text-xs text-text-secondary">Entry time adjusted by manager · Late penalty waived</p>}
                {selectedDay.row.request_status && (
                  <p
                    className={`mt-1 inline-flex rounded-full border px-2 py-1 text-xs ${requestCalendarStyle(selectedDay.row.request_type, selectedDay.row.request_status)?.tone || ""}`}
                  >
                    {
                      requestCalendarStyle(
                        selectedDay.row.request_type,
                        selectedDay.row.request_status,
                      )?.label
                    }
                  </p>
                )}
                <p className="mt-1 text-xs text-text-secondary">
                  Entry time: {timeLabel(selectedDay.row.entry_at)} IST · Late:{" "}
                  {selectedDay.row.time_review_reason ? "Not calculated until scan time is confirmed" : formatAttendanceDuration(selectedDay.row.late_minutes)}
                </p>
              </div>
              <Button size="sm" variant="secondary" disabled={recordBusy} onClick={() => void viewScans(selectedDay.date)}>
                {recordBusy ? "Loading…" : "View scans / review time"}
              </Button>
            </div>
          )}
        </Card>
        {!invalid && (
          <>
            <div className={detailView === "trends" ? "" : "hidden"}>
              <PunctualityInsights
                days={days}
                onSelect={(date) => {
                  setMonth(date.slice(0, 7));
                  setSelected(date);
                  setDetailView("calendar");
                }}
              />
            </div>
            <Card
              className={`${detailView === "calendar" ? "" : "hidden"} overflow-hidden rounded-xl p-0`}
            >
              <h3 className="px-4 pt-3 text-sm font-semibold">Attendance history</h3>
              <p className="border-b border-border px-4 py-2 text-xs text-text-secondary">
                {data
                  ? `${summary.total} of ${range.length} dates have an available attendance status. `
                  : ""}
                Export includes available records only. Missing statuses are never inferred as
                absence.
              </p>
              {loading && !data ? (
                <p role="status" className="p-6 text-sm text-text-secondary">
                  Loading attendance history…
                </p>
              ) : !days.some((day) => day.row) ? (
                <p className="p-6 text-sm text-text-secondary">
                  No attendance records are available in this period.
                </p>
              ) : (
                <div className="max-h-[42vh] overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-surface-raised text-text-secondary">
                      <tr>
                        {[
                          "Date",
                          "First valid scan (IST)",
                          "Status",
                          "Late duration",
                          "Scan evidence",
                        ].map((label) => (
                          <th key={label} className="px-3 py-2 font-medium whitespace-nowrap">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((day) => (
                        <tr
                          key={day.date}
                          className="border-t border-border hover:bg-surface-raised/50"
                        >
                          <td className="px-3 py-2 whitespace-nowrap">{dateLabel(day.date)}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {timeLabel(day.row?.entry_at || null)}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 whitespace-nowrap ${colors[day.row?.status || ""] || "border-border text-text-secondary"}`}
                            >
                              {day.row
                                ? attendanceReviewExplanation(day.row)?.title || statusLabels[day.row.status] || day.row.status
                                : "Unavailable"}
                            </span>
                            {day.row?.leave_conflict && (
                              <p className="mt-1 text-violet">Leave conflict</p>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatAttendanceDuration(day.row?.late_minutes)}
                          </td>
                          <td className="px-3 py-2">
                            {day.row?.event_id &&
                            day.row.photo_status === "available" &&
                            day.row.photo_expires_at &&
                            Date.parse(day.row.photo_expires_at) > Date.now() ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={photoBusy}
                                onClick={() => void viewPhoto(day.row!.event_id!)}
                              >
                                View photo
                              </Button>
                            ) : (
                              <span className="text-xs text-text-secondary">Photo expired</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
      <AttendanceEvidenceDialogs
        record={record}
        onCloseRecord={() => setRecord(null)}
        onResolved={() => { cache.clear(); setRevision((value) => value + 1); toast.success("Scan time verified. Attendance recalculated."); }}
        photo={photo}
        onClosePhoto={() => setPhoto(null)}
        onViewPhoto={(eventId) => void viewPhoto(eventId)}
      />
    </section>
  );
}
