export type CalendarDay = {
  date: string;
  status: string;
  working_day: boolean | null;
  entry_at: string | null;
  late_minutes: number | null;
  request_type: "leave" | "wfh" | null;
  request_status: string | null;
  reason: string | null;
};
export type EmployeeCalendar = { month: string; today: string; days: CalendarDay[] };
export const calendarStatuses: Record<string, { label: string; color: string; tone: string }> = {
  present: {
    label: "Office",
    color: "#059669",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  late: { label: "Late", color: "#d97706", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  work_from_home: {
    label: "WFH",
    color: "#4f46e5",
    tone: "border-indigo-200 bg-indigo-50 text-indigo-800",
  },
  on_leave: {
    label: "Leave",
    color: "#7c3aed",
    tone: "border-violet-200 bg-violet-50 text-violet-800",
  },
  absent: { label: "Absent", color: "#dc2626", tone: "border-rose-200 bg-rose-50 text-rose-800" },
  off_day: {
    label: "Off day",
    color: "#94a3b8",
    tone: "border-slate-200 bg-slate-50 text-slate-500",
  },
  scheduled: {
    label: "Working day",
    color: "#cbd5e1",
    tone: "border-slate-200 bg-white text-slate-600",
  },
  awaiting_scan: {
    label: "Awaiting scan",
    color: "#0891b2",
    tone: "border-cyan-200 bg-cyan-50 text-cyan-800",
  },
  needs_review: {
    label: "Needs review",
    color: "#be185d",
    tone: "border-pink-200 bg-pink-50 text-pink-800",
  },
  not_configured: {
    label: "Not configured",
    color: "#94a3b8",
    tone: "border-slate-200 bg-slate-50 text-slate-500",
  },
  not_employed: {
    label: "Before joining",
    color: "#cbd5e1",
    tone: "border-slate-100 bg-slate-50 text-slate-400",
  },
};
export function calendarSummary(days: CalendarDay[], today: string) {
  return {
    working: days.filter((d) => d.working_day === true).length,
    office: days.filter((d) => d.status === "present" || d.status === "late").length,
    wfh: days.filter((d) => d.status === "work_from_home").length,
    leave: days.filter((d) => d.status === "on_leave").length,
    late: days.filter((d) => d.status === "late").length,
    absent: days.filter((d) => d.status === "absent").length,
    completed: days.filter(
      (d) =>
        d.date <= today &&
        d.working_day === true &&
        ["present", "late", "work_from_home"].includes(d.status),
    ).length,
    expected: days.filter(
      (d) => d.date <= today && d.working_day === true && d.status !== "on_leave",
    ).length,
  };
}
export function calendarWeeks(days: CalendarDay[]) {
  const start = days[0] ? (new Date(`${days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const weeks: {
    name: string;
    office: number;
    wfh: number;
    leave: number;
    absent: number;
    review: number;
  }[] = [];
  days.forEach((day, index) => {
    const week = Math.floor((index + start) / 7);
    weeks[week] ??= { name: `Week ${week + 1}`, office: 0, wfh: 0, leave: 0, absent: 0, review: 0 };
    if (["present", "late"].includes(day.status)) weeks[week].office++;
    else if (day.status === "work_from_home") weeks[week].wfh++;
    else if (day.status === "on_leave") weeks[week].leave++;
    else if (day.status === "absent") weeks[week].absent++;
    else if (day.status === "needs_review") weeks[week].review++;
  });
  return weeks;
}
