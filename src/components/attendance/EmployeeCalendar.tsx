import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  House,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, Card, Select } from "@/components/ui-kit";
import { attendanceRpc, dateLabel, indiaDate, timeLabel } from "@/lib/device-attendance";
import { useAuth } from "@/lib/auth-store";
import { requestCalendarStyle } from "@/lib/request-calendar";
import {
  calendarStatuses,
  calendarSummary,
  calendarWeeks,
  type EmployeeCalendar as CalendarData,
} from "@/lib/employee-calendar";

export function EmployeeCalendar() {
  const userId = useAuth((state) => state.userId);
  const [month, setMonth] = useState(indiaDate().slice(0, 7));
  const [data, setData] = useState<CalendarData | null>(null);
  const [selected, setSelected] = useState(indiaDate());
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    const update = () => setRefresh((value) => value + 1);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") update();
    }, 15000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [userId]);
  useEffect(() => {
    let cancelled = false;
    if (loadedKey.current !== `${userId}:${month}`) {
      setLoading(true);
      setData(null);
    }
    setError(null);
    void attendanceRpc<CalendarData>("attendance_my_calendar", { _month: `${month}-01` })
      .then((next) => {
        if (cancelled) return;
        setData(next);
        loadedKey.current = `${userId}:${month}`;
        setSelected((current) =>
          current.startsWith(month)
            ? current
            : next.today.startsWith(month)
              ? next.today
              : `${month}-01`,
        );
      })
      .catch((failure) => {
        if (!cancelled)
          setError(failure instanceof Error ? failure.message : "Could not load your calendar.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, refresh, userId]);
  const days = data?.days ?? [];
  const summary = calendarSummary(days, data?.today ?? indiaDate());
  const weeks = useMemo(
    () =>
      calendarWeeks(data?.days ?? []).filter(
        (week) => week.office + week.wfh + week.leave + week.absent + week.review > 0,
      ),
    [data],
  );
  const chosen = days.find((day) => day.date === selected);
  const scanDays = days.filter((day) => day.entry_at);
  const timedScans = scanDays.filter((day) => day.late_minutes !== null);
  const onTimeScans = timedScans.filter((day) => day.late_minutes === 0).length;
  const averageDelay = timedScans.length
    ? Math.round(
        timedScans.reduce((sum, day) => sum + (day.late_minutes ?? 0), 0) / timedScans.length,
      )
    : null;
  const records = days.filter((day) =>
    filter === "all"
      ? day.entry_at || day.request_status || ["absent", "needs_review"].includes(day.status)
      : filter === "office"
        ? ["present", "late"].includes(day.status)
        : day.status === filter,
  );
  const offset = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  const label = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  function moveMonth(step: number) {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + step);
    setMonth(date.toISOString().slice(0, 7));
    setFilter("all");
  }
  const categories = [
    { key: "office", label: "Office", color: "#059669" },
    { key: "work_from_home", label: "WFH", color: "#4f46e5" },
    { key: "on_leave", label: "Leave", color: "#7c3aed" },
    { key: "late", label: "Late", color: "#d97706" },
    { key: "absent", label: "Absent", color: "#dc2626" },
    { key: "off_day", label: "Off day", color: "#94a3b8" },
    { key: "scheduled", label: "Working day", color: "#cbd5e1" },
    { key: "needs_review", label: "Needs review", color: "#be185d" },
  ];
  return (
    <main id="employee-attendance" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>My work calendar</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Office attendance, approved leave, and WFH in one monthly view.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-xl border border-border bg-surface p-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Previous month"
              disabled={month <= "2000-01"}
              onClick={() => moveMonth(-1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <input
              aria-label="Calendar month"
              type="month"
              min="2000-01"
              max="2100-12"
              className="min-w-0 bg-transparent px-1 text-sm text-text-primary"
              value={month}
              onChange={(event) => {
                if (/^\d{4}-\d{2}$/.test(event.target.value)) {
                  setMonth(event.target.value);
                  setFilter("all");
                }
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label="Next month"
              disabled={month >= "2100-12"}
              onClick={() => moveMonth(1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setMonth(indiaDate().slice(0, 7));
              setSelected(indiaDate());
              setFilter("all");
            }}
          >
            Today
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
            aria-label="Refresh work calendar"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>
      {loading ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-text-secondary" role="status">
          <LoaderCircle size={18} className="animate-spin text-lime" />
          Loading your work calendar…
        </Card>
      ) : error ? (
        <Card role="alert" className="space-y-3 p-5">
          <p className="text-sm text-coral">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => setRefresh((n) => n + 1)}>
            Try again
          </Button>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: "Scheduled workdays",
                value: summary.working,
                icon: CalendarDays,
                filter: "all",
                tone: "text-text-primary",
              },
              {
                label: "Office days",
                value: summary.office,
                icon: Check,
                filter: "office",
                tone: "text-mint",
              },
              {
                label: "Approved WFH",
                value: summary.wfh,
                icon: House,
                filter: "work_from_home",
                tone: "text-lime",
              },
              {
                label: "Approved leave",
                value: summary.leave,
                icon: CalendarDays,
                filter: "on_leave",
                tone: "text-violet",
              },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                aria-pressed={filter === item.filter}
                className={`rounded-xl border bg-white p-4 text-left transition-colors ${filter === item.filter && filter !== "all" ? "border-lime bg-lime/5" : "border-border hover:border-border-bright"}`}
                onClick={() =>
                  setFilter((current) => (current === item.filter ? "all" : item.filter))
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-text-secondary">{item.label}</p>
                  <item.icon size={16} className={item.tone} />
                </div>
                <p className={`mt-2 text-2xl font-semibold ${item.tone}`}>{item.value}</p>
              </button>
            ))}
          </div>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <Card className="min-w-0 rounded-2xl p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3>{label}</h3>
                <span className="text-xs text-text-secondary">Click a date to view details</span>
              </div>
              <div className="mb-4 flex flex-wrap gap-1.5" aria-label="Calendar status filters">
                <button
                  type="button"
                  aria-pressed={filter === "all"}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${filter === "all" ? "border-lime bg-lime/10 text-lime" : "border-border text-text-secondary"}`}
                  onClick={() => setFilter("all")}
                >
                  All days
                </button>
                {categories.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={filter === item.key}
                    onClick={() =>
                      setFilter((current) => (current === item.key ? "all" : item.key))
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${filter === item.key ? "border-lime bg-lime/10 text-lime" : "border-border text-text-secondary"}`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                  <div
                    key={day}
                    className="pb-2 text-center text-[11px] font-medium text-text-secondary"
                  >
                    {day}
                  </div>
                ))}
                {Array.from({ length: offset }, (_, index) => (
                  <div key={`empty-${index}`} aria-hidden="true" />
                ))}
                {days.map((day) => {
                  const status = calendarStatuses[day.status] ?? calendarStatuses.needs_review;
                  const requestStyle = requestCalendarStyle(day.request_type, day.request_status);
                  const matches =
                    filter === "all" ||
                    (filter === "office"
                      ? ["present", "late"].includes(day.status)
                      : day.status === filter);
                  return (
                    <button
                      key={day.date}
                      type="button"
                      aria-pressed={selected === day.date}
                      aria-label={`${dateLabel(day.date)}: ${status.label}${day.request_status ? `, ${day.request_type === "wfh" ? "WFH" : "leave"} ${day.request_status}` : ""}`}
                      title={`${dateLabel(day.date)} · ${status.label}${requestStyle ? ` · ${requestStyle.label}` : ""}`}
                      onClick={() => setSelected(day.date)}
                      className={`relative flex min-h-[56px] min-w-0 flex-col items-start rounded-lg border p-1.5 text-left transition-all sm:min-h-[72px] sm:p-2.5 ${requestStyle?.tone || status.tone} ${selected === day.date ? "ring-2 ring-indigo-500 ring-offset-1" : "hover:ring-1 hover:ring-indigo-300"} ${matches ? "" : "opacity-35"}`}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${day.date === data?.today ? "bg-indigo-600 text-white" : ""}`}
                      >
                        {Number(day.date.slice(-2))}
                      </span>
                      <span className="mt-2 hidden max-w-full truncate text-[10px] font-medium sm:block">
                        {status.label}
                      </span>
                      {requestStyle && (
                        <span className="mt-0.5 block max-w-full truncate text-[8px] font-semibold sm:text-[9px]">
                          {requestStyle.label}
                        </span>
                      )}
                      <span
                        className="mt-1 h-1.5 w-1.5 rounded-full sm:hidden"
                        style={{ background: status.color }}
                      />
                      {day.request_status && day.request_status !== "approved" && (
                        <span
                          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
                          style={{
                            background: day.request_status === "rejected" ? "#dc2626" : "#d97706",
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 text-[11px] leading-5 text-text-secondary">
                Request colors: purple for approved leave, indigo for approved WFH, red for
                rejected, and amber for pending. Attendance labels remain visible. Decisions refresh
                automatically every 15 seconds.
              </p>
            </Card>
            <aside className="space-y-3 xl:sticky xl:top-4">
              <Card className="rounded-2xl p-4">
                <p className="text-xs font-medium text-text-secondary">Selected day</p>
                <h3 className="mt-1">{dateLabel(selected)}</h3>
                {chosen && (
                  <>
                    <span
                      className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-medium ${(calendarStatuses[chosen.status] ?? calendarStatuses.needs_review).tone}`}
                    >
                      {(calendarStatuses[chosen.status] ?? calendarStatuses.needs_review).label}
                    </span>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div>
                        <dt className="text-xs text-text-secondary">Office schedule</dt>
                        <dd className="mt-1 font-medium">
                          {chosen.status === "not_employed"
                            ? "Before joining"
                            : chosen.working_day === null
                              ? "Not configured"
                              : chosen.working_day
                                ? "Working day"
                                : "Off day"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-text-secondary">First face scan (IST)</dt>
                        <dd className="mt-1 font-medium">
                          {chosen.entry_at ? timeLabel(chosen.entry_at) : "No scan recorded"}
                        </dd>
                      </div>
                      {chosen.entry_at && (
                        <div>
                          <dt className="text-xs text-text-secondary">Arrival</dt>
                          <dd className="mt-1 font-medium">
                            {chosen.late_minutes === null
                              ? "Needs review"
                              : chosen.late_minutes > 0
                                ? `${chosen.late_minutes} minutes late`
                                : "On time"}
                          </dd>
                        </div>
                      )}
                      {chosen.request_status && (
                        <div className="rounded-xl bg-surface-raised p-3">
                          <dt className="text-xs text-text-secondary">
                            {chosen.request_type === "wfh" ? "Work-from-home" : "Leave"} request
                          </dt>
                          <dd
                            className={`mt-1 font-semibold capitalize ${chosen.request_status === "approved" ? "text-mint" : chosen.request_status === "rejected" ? "text-coral" : "text-warning"}`}
                          >
                            {chosen.request_status}
                          </dd>
                          {chosen.reason && (
                            <dd className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-text-secondary">
                              {chosen.reason}
                            </dd>
                          )}
                        </div>
                      )}
                    </dl>
                  </>
                )}
              </Card>
              <Card className="rounded-2xl p-4">
                <h3>Recorded workdays to date</h3>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-2xl font-semibold text-lime">{summary.completed}</span>
                  <span className="text-sm text-text-secondary">
                    / {summary.expected} scheduled
                  </span>
                </div>
                {summary.expected > 0 && (
                  <div
                    role="progressbar"
                    aria-label="Recorded office and approved WFH workdays"
                    aria-valuemin={0}
                    aria-valuemax={summary.expected}
                    aria-valuenow={summary.completed}
                    className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
                  >
                    <div
                      className="h-full rounded-full bg-indigo-600"
                      style={{
                        width: `${Math.min(100, (summary.completed / summary.expected) * 100)}%`,
                      }}
                    />
                  </div>
                )}
                <p className="mt-2 text-[11px] leading-5 text-text-secondary">
                  Office scans and approved WFH through today. Approved leave is excluded;
                  unrecorded days are not automatically absences.
                </p>
              </Card>
            </aside>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="min-w-0 rounded-2xl p-4">
              <h3>Weekly activity</h3>
              <p className="mb-3 mt-1 text-xs text-text-secondary">
                Day counts from office scans and approved leave/WFH. Click a bar to filter.
              </p>
              <div
                className={weeks.length ? "mt-3 h-48" : "mt-3"}
                aria-label="Weekly office, WFH, leave, absence, and review day counts"
              >
                {weeks.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeks} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0", fontSize: 12 }}
                      />
                      <Legend
                        iconType="circle"
                        iconSize={7}
                        wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                      />
                      {[
                        { key: "office", label: "Office", color: "#059669", filter: "office" },
                        { key: "wfh", label: "WFH", color: "#4f46e5", filter: "work_from_home" },
                        { key: "leave", label: "Leave", color: "#7c3aed", filter: "on_leave" },
                        { key: "absent", label: "Absent", color: "#dc2626", filter: "absent" },
                        {
                          key: "review",
                          label: "Needs review",
                          color: "#be185d",
                          filter: "needs_review",
                        },
                      ].map((series) => (
                        <Bar
                          key={series.key}
                          dataKey={series.key}
                          name={series.label}
                          stackId="days"
                          fill={series.color}
                          maxBarSize={40}
                          cursor="pointer"
                          onClick={() => setFilter(series.filter)}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="rounded-xl bg-surface-raised/50 px-4 py-6 text-center text-sm text-text-secondary">
                    No office activity or approved requests in this month yet.
                  </p>
                )}
              </div>
            </Card>
            <Card className="min-w-0 rounded-2xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3>Arrival punctuality</h3>
                  <p className="mt-1 text-xs text-text-secondary">
                    Measured delay per office scan (minutes).
                  </p>
                </div>
                <div className="text-right text-[11px] text-text-secondary">
                  <p>
                    <strong className="text-mint">
                      {onTimeScans}/{timedScans.length}
                    </strong>{" "}
                    on-time scans
                  </p>
                  <p className="mt-1">
                    Average delay:{" "}
                    <strong className="text-text-primary">
                      {averageDelay === null ? "—" : `${averageDelay} min`}
                    </strong>
                  </p>
                </div>
              </div>
              {timedScans.length ? (
                <div className="mt-3 h-48" aria-label="Arrival lateness in minutes">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={scanDays.map((day) => ({ ...day, day: Number(day.date.slice(-2)) }))}
                      margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                      onClick={(event) => {
                        if (event?.activeLabel != null) {
                          const day = scanDays.find(
                            (item) => Number(item.date.slice(-2)) === Number(event.activeLabel),
                          );
                          if (day) setSelected(day.date);
                        }
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        labelFormatter={(value) => `${value} ${label}`}
                        contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0", fontSize: 12 }}
                      />
                      <Line
                        dataKey="late_minutes"
                        name="Minutes late"
                        type="linear"
                        stroke="#4f46e5"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex min-h-28 items-center justify-center rounded-xl bg-surface-raised/50 px-4 text-center text-sm text-text-secondary">
                  No timed office scans in this month yet.
                </div>
              )}
            </Card>
          </div>
          <Card className="overflow-hidden rounded-2xl p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
              <div>
                <h3>Day-by-day records</h3>
                <p className="mt-1 text-xs text-text-secondary">
                  {records.length} days shown · {summary.late} late arrivals · {summary.absent}{" "}
                  confirmed absences
                </p>
              </div>
              <Select
                aria-label="Filter day records"
                className="w-auto max-w-full"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="all">Activity & requests</option>
                {categories.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </div>
            {records.length ? (
              <div className="max-h-80 divide-y divide-border overflow-auto">
                {records.map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => {
                      setSelected(day.date);
                      document
                        .getElementById("employee-attendance")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-raised ${selected === day.date ? "bg-lime/5" : ""}`}
                  >
                    <span className="text-sm font-medium">{dateLabel(day.date)}</span>
                    <span className="text-xs text-text-secondary">
                      {day.entry_at
                        ? `${timeLabel(day.entry_at)} IST`
                        : day.request_status
                          ? `${day.request_type === "wfh" ? "WFH" : "Leave"} ${day.request_status}`
                          : "No scan"}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-1 text-[11px] ${(calendarStatuses[day.status] ?? calendarStatuses.needs_review).tone}`}
                    >
                      {(calendarStatuses[day.status] ?? calendarStatuses.needs_review).label}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-text-secondary">
                No days match this filter.
              </div>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
