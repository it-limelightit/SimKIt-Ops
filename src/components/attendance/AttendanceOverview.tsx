import { useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CalendarDays,
  UserX,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui-kit";
import { attendanceSummary, formatAttendanceDuration } from "@/lib/attendance-analytics";
import { departments, type AttendanceRow } from "@/lib/device-attendance";

export function AttendanceOverview({
  rows,
  status,
  onStatus,
  department,
  onDepartment,
  section = "metrics",
}: {
  rows: AttendanceRow[];
  status: string;
  onStatus: (status: string) => void;
  department: string;
  onDepartment: (department: string) => void;
  section?: "metrics" | "analytics";
}) {
  const [expanded, setExpanded] = useState(false);
  const scoped = rows.filter((row) => department === "all" || row.department === department);
  const summary = attendanceSummary(scoped);
  const metrics = [
    {
      label: "Total employees",
      value: summary.total,
      detail: "Eligible on this date",
      icon: Users,
      filter: "all",
      tone: "text-text-secondary bg-surface-raised",
    },
    {
      label: "Present",
      value: summary.recorded,
      detail: "Includes on-time and late",
      icon: Users,
      filter: "recorded",
      tone: "text-lime bg-lime/10",
    },
    {
      label: "On time",
      value: summary.onTime,
      detail:
        summary.punctuality == null
          ? "No assessed arrivals yet"
          : `${summary.punctuality}% of ${summary.onTime + summary.late} assessed arrivals`,
      icon: CheckCircle2,
      filter: "on_time",
      tone: "text-mint bg-mint/10",
    },
    {
      label: "Late",
      value: summary.late,
      detail: summary.late
        ? `${formatAttendanceDuration(summary.totalDelay)} combined delay`
        : "No late arrivals recorded",
      icon: Clock3,
      filter: "late_arrivals",
      tone: "text-warning bg-warning/10",
    },
    {
      label: "Absent",
      value: summary.absent,
      detail: "Confirmed by cutoff rule",
      icon: UserX,
      filter: "absent",
      tone: "text-coral bg-coral/10",
    },
    {
      label: "On leave",
      value: summary.onLeave,
      detail: "Approved leave",
      icon: CalendarDays,
      filter: "on_leave",
      tone: "text-violet bg-violet/10",
    },
  ];
  const segments = [
    {
      label: "On time",
      count: summary.onTime,
      color: "bg-mint",
      status: "on_time",
    },
    {
      label: "Late",
      count: summary.late,
      color: "bg-warning",
      status: "late_arrivals",
    },
    { label: "Absent", count: summary.absent, color: "bg-coral", status: "absent" },
  ];
  return (
    <section aria-label="Daily attendance analytics" className="space-y-4">
      {section === "metrics" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-primary">
              Daily overview{" "}
              <span className="ml-2 font-normal capitalize text-text-secondary">
                {department === "all" ? "All departments" : department}
              </span>
            </h2>
            <p className="text-xs text-text-secondary">Select a card to filter the employee list</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {metrics.map(({ label, value, detail, icon: Icon, filter, tone }) => (
              <button
                key={label}
                type="button"
                onClick={() => onStatus(status === filter ? "all" : filter)}
                aria-pressed={status === filter}
                className={`group min-w-0 rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime sm:p-3 ${status === filter ? "border-lime bg-lime/5 shadow-sm" : "border-border bg-surface hover:border-lime/40 hover:shadow-sm"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-text-secondary">{label}</span>
                  <span className={`rounded-lg p-1.5 ${tone}`}>
                    <Icon size={15} />
                  </span>
                </div>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-text-primary tabular-nums">
                  {value}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-text-secondary">{detail}</p>
              </button>
            ))}
          </div>
        </>
      )}
      {section === "analytics" && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls="attendance-detail-analytics"
            className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-sm font-medium lg:hidden"
          >
            {expanded ? "Hide detailed analytics" : "View detailed analytics"}
            <ChevronDown
              size={16}
              className={expanded ? "rotate-180 transition-transform" : "transition-transform"}
            />
          </button>
          <div
            id="attendance-detail-analytics"
            className={`${expanded ? "grid" : "hidden"} gap-3 lg:grid lg:grid-cols-3`}
          >
            <Card className="rounded-xl p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Attendance coverage</h3>
                <span className="text-xs text-text-secondary">{summary.expected} expected</span>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums">
                  {summary.coverage == null ? "—" : `${summary.coverage}%`}
                </span>
                <span className="text-xs text-text-secondary">
                  of expected employees have an entry
                </span>
              </div>
              <div
                className="mt-4"
                role="img"
                aria-label={segments.map((s) => `${s.label}: ${s.count}`).join(", ")}
              >
                <div className="flex h-3 overflow-hidden rounded-full bg-surface-raised">
                  {segments
                    .filter((s) => s.count > 0)
                    .map((s) => (
                      <div
                        key={s.label}
                        className={`${s.color} transition-[width] duration-300`}
                        style={{
                          width: `${summary.expected ? (s.count / summary.expected) * 100 : 0}%`,
                        }}
                      />
                    ))}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
                {segments.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    aria-pressed={s.status ? status === s.status : undefined}
                    onClick={() => s.status && onStatus(status === s.status ? "all" : s.status)}
                    className="flex items-center gap-2 rounded px-1 py-1 text-xs text-text-secondary hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-lime"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${s.color}`} />
                    <span>{s.label}</span>
                    <span className="ml-auto font-semibold text-text-primary tabular-nums">
                      {s.count}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-3 border-t border-border pt-2 text-[11px] leading-relaxed text-text-secondary">
                Approved leave and scheduled off days are excluded. Select a category to filter.
              </p>
            </Card>
            <Card className="rounded-xl p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Arrival timing</h3>
                <Clock3 size={16} className="text-text-secondary" />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums">
                  {summary.punctuality == null ? "—" : `${summary.punctuality}%`}
                </span>
                <span className="text-xs text-text-secondary">arrived on time</span>
              </div>
              <dl className="mt-3 divide-y divide-border text-sm">
                {[
                  ["Combined delay", formatAttendanceDuration(summary.totalDelay)],
                  ["Average per late arrival", formatAttendanceDuration(summary.averageDelay)],
                  ["Longest delay", formatAttendanceDuration(summary.longestDelay)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 py-2">
                    <dt className="text-text-secondary">{label}</dt>
                    <dd className="font-medium tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                Lateness starts after the shift’s grace period.{" "}
                {summary.unassessed
                  ? `${summary.unassessed} recorded entries await timing assessment. `
                  : ""}
                Timing includes recorded entries under review. First entries measure arrival, not
                hours worked.
              </p>
            </Card>
            <Card className="rounded-xl p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">By department</h3>
                <span className="text-xs text-text-secondary">Recorded / expected</span>
              </div>
              <div className="mt-4 space-y-3">
                {departments.map((d) => {
                  const group = attendanceSummary(rows.filter((row) => row.department === d));
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onDepartment(department === d ? "all" : d)}
                      aria-pressed={department === d}
                      className={`w-full rounded-lg p-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-lime ${department === d ? "bg-lime/10" : "hover:bg-surface-raised"}`}
                    >
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium capitalize">{d}</span>
                        <ArrowUpRight size={12} className="text-text-secondary" />
                        <span className="ml-auto text-text-secondary tabular-nums">
                          {group.recorded} / {group.expected}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-raised">
                        <div
                          className="h-full rounded-full bg-lime/70 transition-[width]"
                          style={{ width: `${group.coverage ?? 0}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
