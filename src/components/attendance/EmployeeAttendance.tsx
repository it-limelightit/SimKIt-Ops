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
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-store";
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
import {
  AttendanceEvidenceDialogs,
  type AttendancePhoto,
  type AttendanceRecordView,
} from "./AttendanceEvidenceDialogs";
import { attendanceSummary, formatAttendanceDuration } from "@/lib/attendance-analytics";
import {
  addDays,
  createAttendanceDayCache,
  dateRange,
  employeeHistoryCsv,
  monthDates,
  type EmployeeDay,
} from "./attendance-history";

const colors: Record<string, string> = {
  present: "border-mint/30 bg-mint/10 text-mint",
  late: "border-warning/30 bg-warning/10 text-warning",
  absent: "border-coral/30 bg-coral/10 text-coral",
  on_leave: "border-violet/30 bg-violet/10 text-violet",
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
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordView, setRecordView] = useState<AttendanceRecordView>(null);
  const [photo, setPhoto] = useState<AttendancePhoto | null>(null);
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
      ? calendarDates.at(-1)! < today
        ? calendarDates.at(-1)!
        : today
      : period === "custom"
        ? customEnd
        : today;
  const range = useMemo(() => dateRange(start, end), [start, end]);
  const invalid = !range.length || range.length > 93 || end > today;
  const key = `${userId}:${employeeId}:${month}:${start}:${end}`;
  const data = loaded?.key === key ? loaded : null;
  const days = (data?.days || [])
    .filter((day) => day.date >= start && day.date <= end)
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
    const dates = [...new Set([...calendarDates, ...range])].filter((date) => date <= today);
    const result: EmployeeDay[] = [];
    const failures: string[] = [];
    let index = 0;
    setLoading(true);
    async function worker() {
      while (!cancelled && index < dates.length) {
        const date = dates[index++];
        try {
          const daily = await cache.get(date, date === today ? 14_000 : 60_000);
          result.push({
            date,
            row: daily.rows.find((row) => row.employee_id === employee!.id) || null,
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
  async function record(date: string) {
    setRecordBusy(true);
    try {
      const data = await attendanceRpc<History>("attendance_history", {
        _employee: employee.id,
        _date: date,
      });
      setRecordView({ name: employee.name, date, data });
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not load scan evidence.");
    } finally {
      setRecordBusy(false);
    }
  }
  async function viewPhoto(eventId: string) {
    try {
      setPhoto(
        await attendanceFunction<AttendancePhoto>("attendance-photo-access", { event_id: eventId }),
      );
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not load attendance photo.");
    }
  }
  function exportHistory() {
    const url = URL.createObjectURL(
      new Blob([employeeHistoryCsv(days)], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance-${employee?.enroll_id}-${start}-${end}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const selectedDay = selected ? byDate.get(selected) : null;
  const arrivals = [...days].reverse().filter((day) => day.row?.entry_at);
  const arrivalMinute = (value: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(new Date(value))
      .split(":");
    return Number(parts[0]) * 60 + Number(parts[1]);
  };
  const minuteLabel = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const minArrival = arrivals.length
    ? Math.min(...arrivals.map((day) => arrivalMinute(day.row!.entry_at!)))
    : 0;
  const maxArrival = arrivals.length
    ? Math.max(...arrivals.map((day) => arrivalMinute(day.row!.entry_at!)))
    : 0;
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
              disabled={loading || invalid || !!errors.length || !summary.total}
              onClick={exportHistory}
            >
              <Download size={14} />
              Export
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
                disabled={month >= today.slice(0, 7)}
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
              const unavailable = date > today || !day?.row;
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
                  aria-label={`${dateLabel(date)}: ${label}`}
                  title={`${dateLabel(date)}: ${label}`}
                  onClick={() => setSelected(selected === date ? null : date)}
                  className={`min-h-9 rounded-md border px-0.5 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime sm:min-h-10 ${colors[status || ""] || "border-border text-text-secondary"} ${unavailable ? "opacity-50" : "hover:brightness-110"} ${selected === date ? "ring-2 ring-lime" : ""}`}
                >
                  <span className="block tabular-nums">{Number(date.slice(-2))}</span>
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
            <span className="text-[11px] text-text-secondary">Faded: unavailable / future</span>
          </div>
          <p className="mt-2 text-[11px] text-text-secondary">
            Select a date to inspect its attendance and scan evidence.
          </p>
          {selectedDay?.row && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised p-3 text-sm">
              <div>
                <p className="font-medium">
                  {dateLabel(selectedDay.date)} · {statusLabels[selectedDay.row.status]}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  First valid scan: {timeLabel(selectedDay.row.entry_at)} IST · Late:{" "}
                  {formatAttendanceDuration(selectedDay.row.late_minutes)}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={recordBusy}
                onClick={() => void record(selectedDay.date)}
              >
                View record & scans
              </Button>
            </div>
          )}
        </Card>
        {!invalid && (
          <>
            <Card className={`${detailView === "trends" ? "" : "hidden"} rounded-xl p-3 sm:p-4`}>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <TrendingUp size={15} className="text-lime" />
                Punctuality & arrival trend
              </h3>
              <p className="mt-1 text-xs text-text-secondary">
                {summary.onTime + summary.late
                  ? `${summary.late} late / ${summary.onTime + summary.late} assessed arrivals · Average late duration ${formatAttendanceDuration(summary.averageDelay)}`
                  : "No assessed arrivals in this period."}
              </p>
              {summary.onTime + summary.late > 0 && (
                <div
                  className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-raised"
                  role="img"
                  aria-label={`${summary.onTime} on-time days and ${summary.late} late days`}
                >
                  <span
                    className="bg-mint"
                    style={{
                      width: `${(summary.onTime / (summary.onTime + summary.late)) * 100}%`,
                    }}
                  />
                  <span
                    className="bg-warning"
                    style={{
                      width: `${(summary.late / (summary.onTime + summary.late)) * 100}%`,
                    }}
                  />
                </div>
              )}
              {!!arrivals.length && (
                <>
                  <p className="mt-4 text-xs text-text-secondary">
                    Arrival time (IST) ·{" "}
                    {timeLabel(
                      arrivals.reduce((a, b) =>
                        arrivalMinute(a.row!.entry_at!) < arrivalMinute(b.row!.entry_at!) ? a : b,
                      ).row!.entry_at,
                    )}{" "}
                    –{" "}
                    {timeLabel(
                      arrivals.reduce((a, b) =>
                        arrivalMinute(a.row!.entry_at!) > arrivalMinute(b.row!.entry_at!) ? a : b,
                      ).row!.entry_at,
                    )}
                  </p>
                  <div className="mt-3 grid grid-cols-[42px_1fr] gap-2">
                    <div
                      className="flex h-32 flex-col justify-between py-1 text-[10px] text-text-secondary"
                      aria-hidden="true"
                    >
                      <span>{minuteLabel(Math.min(1439, maxArrival + 30))}</span>
                      <span>{minuteLabel(Math.round((minArrival + maxArrival) / 2))}</span>
                      <span>{minuteLabel(Math.max(0, minArrival - 30))}</span>
                    </div>
                    <div
                      className="relative h-32 rounded-lg bg-surface-raised/60"
                      role="group"
                      aria-label="Arrival time trend. Each point is a first check-in; select a point to view that attendance record."
                    >
                      {["top-1/4", "top-1/2", "top-3/4"].map((position) => (
                        <div
                          key={position}
                          className={`absolute inset-x-0 ${position} border-t border-dashed border-border`}
                        />
                      ))}
                      <svg
                        className="absolute inset-0 h-full w-full overflow-visible"
                        aria-hidden="true"
                      >
                        <polyline
                          fill="none"
                          stroke="var(--violet)"
                          strokeOpacity=".65"
                          strokeWidth="2"
                          points={arrivals
                            .map(
                              (day, index) =>
                                `${arrivals.length === 1 ? 50 : 4 + (index * 92) / (arrivals.length - 1)},${maxArrival === minArrival ? 50 : 90 - ((arrivalMinute(day.row!.entry_at!) - minArrival) / (maxArrival - minArrival)) * 78}`,
                            )
                            .join(" ")}
                        />
                      </svg>
                      {arrivals.map((day, index) => {
                        const x =
                          arrivals.length === 1 ? 50 : 4 + (index * 92) / (arrivals.length - 1);
                        const y =
                          maxArrival === minArrival
                            ? 50
                            : 90 -
                              ((arrivalMinute(day.row!.entry_at!) - minArrival) /
                                (maxArrival - minArrival)) *
                                78;
                        const late = (day.row!.late_minutes || 0) > 0;
                        const timingUnknown = day.row!.late_minutes == null;
                        return (
                          <button
                            key={day.date}
                            type="button"
                            title={`${dateLabel(day.date)} · ${timeLabel(day.row!.entry_at)} IST · ${formatAttendanceDuration(day.row!.late_minutes)} late`}
                            aria-label={`${dateLabel(day.date)}, first arrival ${timeLabel(day.row!.entry_at)} IST, ${timingUnknown ? "lateness unavailable" : late ? `${formatAttendanceDuration(day.row!.late_minutes)} late` : "on time"}. View record.`}
                            onClick={() => {
                              setMonth(day.date.slice(0, 7));
                              setSelected(day.date);
                              setDetailView("calendar");
                            }}
                            className={`absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow-sm focus-visible:outline-2 focus-visible:outline-lime ${timingUnknown ? "bg-violet" : late ? "bg-warning" : "bg-mint"}`}
                            style={{ left: `${x}%`, top: `${y}%` }}
                          />
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-2 flex justify-between pl-12 text-[10px] text-text-secondary">
                    <span>{dateLabel(arrivals[0].date)}</span>
                    <span>{dateLabel(arrivals.at(-1)!.date)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-secondary">
                    <span>
                      <i className="mr-1 inline-block h-2 w-2 rounded-full bg-mint" />
                      On time
                    </span>
                    <span>
                      <i className="mr-1 inline-block h-2 w-2 rounded-full bg-warning" />
                      Late
                    </span>
                    <span>
                      <i className="mr-1 inline-block h-2 w-2 rounded-full bg-violet" />
                      Timing unavailable
                    </span>
                    <span>Vertical position shows arrival time (IST)</span>
                  </div>
                </>
              )}
              <p className="mt-3 text-xs text-text-secondary">
                First scans measure arrival only. Checkout, hours worked and payroll calculations
                are unavailable.
              </p>
            </Card>
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
                                ? statusLabels[day.row.status] || day.row.status
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
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!day.row || recordBusy}
                              onClick={() => void record(day.date)}
                            >
                              Scans & evidence
                            </Button>
                            {day.row?.event_id && (
                              <p className="mt-1 text-[11px] text-text-secondary">
                                {day.row.photo_status === "available" &&
                                day.row.photo_expires_at &&
                                Date.parse(day.row.photo_expires_at) > Date.now()
                                  ? "Photo available"
                                  : "Photo expired / unavailable"}
                              </p>
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
        record={recordView}
        onCloseRecord={() => setRecordView(null)}
        photo={photo}
        onClosePhoto={() => setPhoto(null)}
        onViewPhoto={(eventId) => void viewPhoto(eventId)}
      />
    </section>
  );
}
