import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  RefreshCw,
  Search,
  UserX,
  Users,
  X,
} from "lucide-react";
import { Button, Card, Input, Select } from "@/components/ui-kit";
import { attendanceRpc, indiaDate, timeLabel, type Employee } from "@/lib/device-attendance";
import { formatLateLabel } from "@/lib/attendance-analytics";
import {
  calendarStatuses,
  calendarSummary,
  type CalendarDay,
  type EmployeeCalendar as CalendarData,
} from "@/lib/employee-calendar";
import { EmployeeCalendar } from "./EmployeeCalendar";

/** Short cell code per day status (blank = nothing to show). */
const codes: Record<string, string> = {
  present: "P",
  late: "L",
  absent: "A",
  work_from_home: "W",
  on_leave: "LV",
  site_visit: "SV",
  absence_justified: "AJ",
  needs_review: "?",
  awaiting_scan: "…",
  off_day: "OD",
};
const legend = [
  "present",
  "late",
  "absent",
  "on_leave",
  "work_from_home",
  "site_visit",
  "absence_justified",
  "needs_review",
  "off_day",
] as const;

type Row = { employee: Employee; data: CalendarData | null; error: string | null };
type Summary = ReturnType<typeof calendarSummary>;

/** Runs async jobs with a small concurrency cap so a month load does not flood the API. */
async function mapLimited<T, R>(items: T[], limit: number, job: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await job(items[index]);
      }
    }),
  );
  return out;
}

function dayTitle(employee: Employee, day: CalendarDay) {
  const status = calendarStatuses[day.status]?.label ?? day.status;
  const parts = [`${employee.name} · ${day.date}`, status];
  if (day.entry_at) parts.push(`Entry ${timeLabel(day.entry_at)}`);
  if ((day.late_minutes ?? 0) > 0) parts.push(formatLateLabel(day.late_minutes ?? 0));
  if (day.reason) parts.push(day.reason);
  return parts.join(" · ");
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
      <span className={`grid size-9 place-items-center rounded-lg ${tone}`}>
        <Icon size={17} />
      </span>
      <div>
        <p className="text-lg font-semibold leading-tight tabular-nums">{value}</p>
        <p className="text-xs text-text-secondary">{label}</p>
      </div>
    </div>
  );
}

/**
 * Month register for Tarun: every employee x every day, colour-coded so late,
 * absent and leave days stand out. Data comes from attendance_team_calendar,
 * which already authorises Tarun for any employee.
 */
export function MonthlyAttendanceRegister({ employees }: { employees: Employee[] }) {
  const [month, setMonth] = useState(indiaDate().slice(0, 7));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [focus, setFocus] = useState<string | null>(null);
  const [open, setOpen] = useState<Employee | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const active = useMemo(
    () => employees.filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );
  const activeKey = active.map((e) => e.id).join(",");

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    void mapLimited(active, 6, async (employee): Promise<Row> => {
      try {
        const data = await attendanceRpc<CalendarData>("attendance_team_calendar", {
          _employee: employee.id,
          _month: `${month}-01`,
        });
        return { employee, data, error: null };
      } catch (failure) {
        return {
          employee,
          data: null,
          error: failure instanceof Error ? failure.message : "Could not load",
        };
      }
    }).then((result) => {
      if (!cancelled) setRows(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, refresh, activeKey]);

  useEffect(() => {
    if (open) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  const today = indiaDate();
  const daysInMonth = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const dates = Array.from(
    { length: daysInMonth },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
  const label = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const moveMonth = (offset: number) => {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    const next = date.toISOString().slice(0, 7);
    if (next <= today.slice(0, 7)) setMonth(next);
  };

  const summaries = new Map<string, Summary>(
    (rows ?? [])
      .filter((row) => row.data)
      .map((row) => [
        row.employee.id,
        calendarSummary(row.data!.days, row.data!.today, row.data!.tracking_start),
      ]),
  );
  // A date is an office-wide off day when most loaded employees are off that day.
  const offDates = new Set(
    dates.filter((date) => {
      const loaded = (rows ?? []).filter((row) => row.data);
      const off = loaded.filter(
        (row) => row.data!.days.find((d) => d.date === date)?.status === "off_day",
      ).length;
      return loaded.length > 0 && off * 2 > loaded.length;
    }),
  );
  const visible = (rows ?? [])
    .filter((row) =>
      `${row.employee.name} ${row.employee.enroll_id}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      const sa = summaries.get(a.employee.id);
      const sb = summaries.get(b.employee.id);
      const diff =
        sort === "late"
          ? (sb?.late ?? 0) - (sa?.late ?? 0)
          : sort === "absent"
            ? (sb?.absent ?? 0) - (sa?.absent ?? 0)
            : sort === "leave"
              ? (sb?.leave ?? 0) - (sa?.leave ?? 0)
              : 0;
      return diff || a.employee.name.localeCompare(b.employee.name);
    });
  const totals = visible.reduce(
    (sum, row) => {
      const s = summaries.get(row.employee.id);
      if (!s) return sum;
      return {
        late: sum.late + s.late,
        absent: sum.absent + s.absent,
        leave: sum.leave + s.leave,
        completed: sum.completed + s.completed,
        expected: sum.expected + s.expected,
      };
    },
    { late: 0, absent: 0, leave: 0, completed: 0, expected: 0 },
  );
  const attendanceRate = totals.expected
    ? `${Math.round((totals.completed / totals.expected) * 100)}%`
    : "–";

  return (
    <section className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={CalendarCheck}
          label="Attendance rate"
          value={rows ? attendanceRate : "…"}
          tone="bg-emerald-50 text-emerald-700"
        />
        <Stat
          icon={Clock3}
          label="Late days"
          value={rows ? totals.late : "…"}
          tone="bg-amber-50 text-amber-700"
        />
        <Stat
          icon={UserX}
          label="Absent days"
          value={rows ? totals.absent : "…"}
          tone="bg-rose-50 text-rose-700"
        />
        <Stat
          icon={Users}
          label="Leave days"
          value={rows ? totals.leave : "…"}
          tone="bg-green-50 text-green-700"
        />
      </div>

      <Card className="overflow-hidden rounded-xl p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3 sm:p-4">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => moveMonth(-1)}
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </Button>
            <span className="min-w-32 text-center text-sm font-semibold">{label}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => moveMonth(1)}
              disabled={month >= today.slice(0, 7)}
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {month !== today.slice(0, 7) && (
              <Button variant="ghost" size="sm" onClick={() => setMonth(today.slice(0, 7))}>
                This month
              </Button>
            )}
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-secondary"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employee"
                className="h-9 w-48 pl-8"
                aria-label="Search employee"
              />
            </div>
            <Select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className="h-9"
              aria-label="Sort employees"
            >
              <option value="name">Sort: Name</option>
              <option value="late">Sort: Most late</option>
              <option value="absent">Sort: Most absent</option>
              <option value="leave">Sort: Most leave</option>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRefresh((v) => v + 1)}
              aria-label="Refresh"
              disabled={rows === null}
            >
              <RefreshCw size={15} className={rows === null ? "animate-spin" : ""} />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface/50 px-3 py-2 text-xs sm:px-4">
          <span className="mr-1 text-text-secondary">Highlight:</span>
          {legend.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={focus === key}
              onClick={() => setFocus((current) => (current === key ? null : key))}
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 transition ${calendarStatuses[key].tone} ${focus && focus !== key ? "opacity-40" : ""} ${focus === key ? "ring-2 ring-lime/60" : "hover:opacity-80"}`}
            >
              <b>{codes[key]}</b> {calendarStatuses[key].label}
            </button>
          ))}
          {focus && (
            <button
              type="button"
              onClick={() => setFocus(null)}
              className="ml-1 inline-flex items-center gap-1 text-text-secondary hover:text-text-primary"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 min-w-44 border-b border-border bg-surface px-3 py-2 text-left font-semibold">
                  Employee
                </th>
                {dates.map((date) => {
                  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IN", {
                    weekday: "short",
                    timeZone: "UTC",
                  });
                  const isToday = date === today;
                  const monday = new Date(`${date}T12:00:00Z`).getUTCDay() === 1;
                  return (
                    <th
                      key={date}
                      className={`min-w-9 border-b border-border px-0.5 py-1.5 text-center tabular-nums ${monday ? "border-l" : ""} ${isToday ? "bg-lime/15 text-lime" : offDates.has(date) ? "bg-slate-100 text-slate-400" : "bg-surface text-text-secondary"}`}
                    >
                      <div className="text-sm font-semibold">{Number(date.slice(8))}</div>
                      <div className="text-[10px] font-normal uppercase">{weekday.slice(0, 2)}</div>
                    </th>
                  );
                })}
                <th className="border-b border-l border-border bg-surface px-2 py-2 text-center font-semibold text-amber-700">
                  Late
                </th>
                <th className="border-b border-border bg-surface px-2 py-2 text-center font-semibold text-rose-700">
                  Absent
                </th>
                <th className="border-b border-border bg-surface px-2 py-2 text-center font-semibold text-green-700">
                  Leave
                </th>
                <th className="border-b border-border bg-surface px-2 py-2 text-center font-semibold">
                  Present
                </th>
              </tr>
            </thead>
            <tbody>
              {rows === null &&
                Array.from({ length: Math.min(active.length || 6, 8) }, (_, i) => (
                  <tr key={i}>
                    <td className="sticky left-0 border-b border-border bg-surface px-3 py-2.5">
                      <div className="h-3 w-28 animate-pulse rounded bg-slate-200" />
                      <div className="mt-1.5 h-2 w-16 animate-pulse rounded bg-slate-100" />
                    </td>
                    <td colSpan={dates.length + 4} className="border-b border-border px-1">
                      <div className="h-7 animate-pulse rounded bg-slate-100" />
                    </td>
                  </tr>
                ))}
              {rows !== null && visible.length === 0 && (
                <tr>
                  <td
                    colSpan={dates.length + 5}
                    className="px-3 py-8 text-center text-sm text-text-secondary"
                  >
                    No employees match “{search}”.
                  </td>
                </tr>
              )}
              {visible.map((row) => {
                const byDate = new Map((row.data?.days ?? []).map((d) => [d.date, d]));
                const s = summaries.get(row.employee.id);
                const selected = open?.id === row.employee.id;
                return (
                  <tr
                    key={row.employee.id}
                    className={`group ${selected ? "[&>td]:bg-lime/5" : "hover:[&>td]:bg-surface-raised"}`}
                  >
                    <td className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-1.5">
                      <button
                        type="button"
                        className={`text-left font-semibold hover:text-lime hover:underline ${selected ? "text-lime" : ""}`}
                        onClick={() => setOpen(selected ? null : row.employee)}
                        title="Open full calendar"
                      >
                        {row.employee.name}
                      </button>
                      <div className="text-[10px] capitalize text-text-secondary">
                        #{row.employee.enroll_id} · {row.employee.department}
                      </div>
                    </td>
                    {row.error ? (
                      <td
                        colSpan={dates.length + 4}
                        className="border-b border-border px-3 text-rose-700"
                      >
                        {row.error}
                      </td>
                    ) : (
                      <>
                        {dates.map((date) => {
                          const day = byDate.get(date);
                          const code = day ? (codes[day.status] ?? "") : "";
                          const tone = day && code ? calendarStatuses[day.status]?.tone : "";
                          const dimmed = focus !== null && day?.status !== focus;
                          const lateMinutes =
                            day?.status === "late" && (day.late_minutes ?? 0) > 0
                              ? day.late_minutes
                              : null;
                          const monday = new Date(`${date}T12:00:00Z`).getUTCDay() === 1;
                          return (
                            <td
                              key={date}
                              className={`border-b border-border p-0.5 text-center ${monday ? "border-l" : ""} ${date === today ? "bg-lime/5" : offDates.has(date) ? "bg-slate-50" : ""}`}
                            >
                              <div
                                title={day ? dayTitle(row.employee, day) : date}
                                className={`flex h-8 min-w-8 items-center justify-center whitespace-nowrap rounded-md border px-0.5 text-[11px] font-semibold transition-opacity ${tone || "border-transparent text-slate-300"} ${dimmed ? "opacity-20" : ""} ${day?.status === "off_day" ? "font-medium opacity-70" : ""}`}
                              >
                                {lateMinutes !== null ? (
                                  <span className="leading-none">
                                    {lateMinutes > 60 ? (
                                      <>
                                        {Math.floor(lateMinutes / 60)}
                                        <span className="text-[9px] font-normal">h</span>
                                        {lateMinutes % 60 > 0 && (
                                          <>
                                            {lateMinutes % 60}
                                            <span className="text-[9px] font-normal">m</span>
                                          </>
                                        )}
                                      </>
                                    ) : (
                                      <>
                                        {lateMinutes}
                                        <span className="text-[9px] font-normal">m</span>
                                      </>
                                    )}
                                  </span>
                                ) : (
                                  code || "·"
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="border-b border-l border-border px-2 text-center">
                          <span
                            className={`inline-block min-w-6 rounded px-1 py-0.5 font-semibold tabular-nums ${s?.late ? "bg-amber-50 text-amber-700" : "text-text-secondary"}`}
                          >
                            {s?.late ?? "–"}
                          </span>
                        </td>
                        <td className="border-b border-border px-2 text-center">
                          <span
                            className={`inline-block min-w-6 rounded px-1 py-0.5 font-semibold tabular-nums ${s?.absent ? "bg-rose-50 text-rose-700" : "text-text-secondary"}`}
                          >
                            {s?.absent ?? "–"}
                          </span>
                        </td>
                        <td className="border-b border-border px-2 text-center">
                          <span
                            className={`inline-block min-w-6 rounded px-1 py-0.5 font-semibold tabular-nums ${s?.leave ? "bg-green-50 text-green-700" : "text-text-secondary"}`}
                          >
                            {s?.leave ?? "–"}
                          </span>
                        </td>
                        <td className="border-b border-border px-2 text-center font-medium tabular-nums">
                          {s ? `${s.office}` : "–"}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-3 py-2 text-[11px] text-text-secondary sm:px-4">
          Late cells show time late (e.g. <b>15m</b>, or <b>1h20m</b> when over an hour). Hover a
          cell for entry time and reason. Click a name to open their full calendar.
        </p>
      </Card>

      {open && (
        <div ref={detailRef} className="grid scroll-mt-4 gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{open.name} · full calendar</h3>
            <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
              <X size={15} /> Close
            </Button>
          </div>
          <EmployeeCalendar key={open.id} employeeId={open.id} employeeName={open.name} />
        </div>
      )}
    </section>
  );
}
