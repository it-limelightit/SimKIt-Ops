import { Fragment, useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  Layers3,
} from "lucide-react";
import { Input, Select } from "@/components/ui-kit";
import {
  cohortStages,
  performanceDate,
  performanceMonths,
  startMonthPerformance,
  type MonthlyCompany,
  type CohortStage,
} from "@/utils/monthly-performance";

const stageStyles = [
  {
    icon: "bg-sky-500/10 text-sky-500",
    bar: "bg-sky-500",
    active: "border-sky-500 ring-sky-500/15",
  },
  {
    icon: "bg-indigo-500/10 text-indigo-500",
    bar: "bg-indigo-500",
    active: "border-indigo-500 ring-indigo-500/15",
  },
  {
    icon: "bg-violet-500/10 text-violet-500",
    bar: "bg-violet-500",
    active: "border-violet-500 ring-violet-500/15",
  },
  {
    icon: "bg-emerald-500/10 text-emerald-500",
    bar: "bg-emerald-500",
    active: "border-emerald-500 ring-emerald-500/15",
  },
];
const monthLabel = (month: string, short = false) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString("en-IN", {
    month: short ? "short" : "long",
    year: "numeric",
  });
const percent = (count: number, total: number) => (total ? Math.round((count / total) * 100) : 0);
const dateLabel = (value: string | null) => {
  const date = performanceDate(value);
  return date
    ? new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "2-digit",
      })
    : null;
};
const moveMonth = (month: string, offset: number) => {
  const date = new Date(`${month}-01T12:00:00`);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

export function MonthlyPerformance({
  companies,
  associates,
}: {
  companies: MonthlyCompany[];
  associates: { id: string; name: string }[];
}) {
  const currentMonth = performanceDate(new Date().toISOString())!.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [associate, setAssociate] = useState("all");
  const [selection, setSelection] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showSubmissionSummary, setShowSubmissionSummary] = useState(false);
  const [visibleChartStages, setVisibleChartStages] = useState<CohortStage[]>(
    cohortStages.map((stage) => stage.key),
  );
  const tableRef = useRef<HTMLElement>(null);
  const scoped = useMemo(
    () =>
      companies.filter(
        (company) => associate === "all" || company.associateIds.includes(associate),
      ),
    [companies, associate],
  );
  const report = useMemo(() => startMonthPerformance(scoped, month, "month_end"), [scoped, month]);
  const previous = useMemo(
    () => startMonthPerformance(scoped, moveMonth(month, -1), "month_end"),
    [scoped, month],
  );
  const currentReport = useMemo(
    () => startMonthPerformance(scoped, month, "to_date"),
    [scoped, month],
  );
  const trend = useMemo(
    () =>
      performanceMonths(month, 6).map((key) => {
        const result = startMonthPerformance(scoped, key, "month_end");
        return {
          month: key,
          label: monthLabel(key, true),
          assessment: result.stages[0].count,
          installation: result.stages[1].count,
          commissioning: result.stages[2].count,
          submission: result.stages[3].count,
        };
      }),
    [scoped, month],
  );
  const changeMonth = (value: string) => {
    setMonth(value);
    setSelection("all");
    setPage(0);
    setExpanded(null);
  };
  const choose = (value: string) => {
    setSelection(value);
    setSearch("");
    setPage(0);
    setExpanded(null);
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const reached = cohortStages.find((stage) => stage.key === selection);
  const pending = report.pending.find((stage) => `pending-${stage.rank}` === selection);
  const sources: Record<
    string,
    { title: string; description: string; companies: MonthlyCompany[] }
  > = {
    current_total: {
      title: "All currently submitted companies",
      description: "",
      companies: report.currentSubmitted,
    },
    current_month: {
      title: `Currently submitted · submitted in ${monthLabel(month)}`,
      description: "",
      companies: report.currentSubmittedInMonth,
    },
    current_other: {
      title: "Currently submitted · submitted in other months",
      description: "",
      companies: report.currentSubmittedOtherMonths,
    },
    current_undated: {
      title: "Currently submitted · submission date missing or invalid",
      description: "",
      companies: report.currentSubmittedUndated,
    },
    received: {
      title: `All submissions received in ${monthLabel(month)}`,
      description: "",
      companies: report.submissionsInMonth,
    },
    all: {
      title: "Companies started this month",
      description:
        "All assessment starts in this month, including companies that advanced to later stages.",
      companies: report.cohort,
    },
    assigned: {
      title: "Newly assigned this month",
      description:
        "Assignment is separate from assessment start. These companies may not have started work yet.",
      companies: report.newlyAssigned,
    },
    same_month: {
      title: "Started and submitted in the same month",
      description:
        "Assessment started and the company reached submission within the selected month.",
      companies: report.sameMonth,
    },
    earlier: {
      title: "Earlier work submitted this month",
      description:
        "Assessment started before this month. These companies are excluded from this month's start funnel.",
      companies: report.earlierSubmissions,
    },
    unknown: {
      title: "Submissions with an unknown start month",
      description:
        "A submission is recorded, but assessment start is undated. Excluded from the start funnel.",
      companies: report.unknownSubmissions,
    },
    review: {
      title: "Companies needing an assessment start date",
      description:
        "Later installation or submission cannot establish the assessment start month. Excluded from start-month comparisons.",
      companies: report.undatedStarts,
    },
  };
  const source = reached
    ? {
        title: `${reached.label} · ${monthLabel(month)} starts`,
        description: reached.includes + ". Every company here belongs to the selected start month.",
        companies: report.cohort.filter((company) => report.rank(company) >= reached.rank),
      }
    : pending
      ? {
          title: pending.label,
          description: "Companies from this month's starts waiting at this point in the workflow.",
          companies: report.cohort.filter((company) => report.rank(company) === pending.rank),
        }
      : sources[selection] || sources.all;
  const filtered = source.companies
    .filter((company) => company.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const activePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(activePage * 10, activePage * 10 + 10);
  const conversion = percent(report.stages[3].count, report.cohort.length);
  const difference = conversion - percent(previous.stages[3].count, previous.cohort.length);
  const pendingTotal = report.pending.reduce((total, stage) => total + stage.count, 0);
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
        <div className="flex flex-col gap-5 border-b border-border p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Monthly execution report
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-text-primary">
              From assessment to submission
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-border bg-surface-raised/50 p-1.5">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => changeMonth(moveMonth(month, -1))}
              className="rounded-lg p-2 text-text-secondary hover:bg-surface"
            >
              <ChevronLeft size={17} />
            </button>
            <CalendarDays size={16} className="text-text-secondary" />
            <input
              aria-label="Reporting month"
              type="month"
              value={month}
              max={currentMonth}
              onChange={(event) => {
                if (/^\d{4}-\d{2}$/.test(event.target.value) && event.target.value <= currentMonth)
                  changeMonth(event.target.value);
              }}
              className="w-36 bg-transparent py-2 text-sm font-semibold text-text-primary outline-none"
            />
            <button
              type="button"
              aria-label="Next month"
              disabled={month >= currentMonth}
              onClick={() => changeMonth(moveMonth(month, 1))}
              className="rounded-lg p-2 text-text-secondary hover:bg-surface disabled:opacity-30"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 px-5 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} className="text-text-secondary" />
            <Select
              aria-label="Field associate"
              value={associate}
              onChange={(event) => {
                setAssociate(event.target.value);
                setPage(0);
              }}
              className="h-9 text-xs sm:w-52"
            >
              <option value="all">All field associates</option>
              {associates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </section>

      <section
        aria-label="Submitted total reconciliation"
        className="overflow-hidden rounded-xl border border-border bg-surface"
      >
        <button
          type="button"
          aria-expanded={showSubmissionSummary}
          aria-controls="submission-summary-details"
          onClick={() => setShowSubmissionSummary((value) => !value)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-raised/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-500"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
              <Layers3 size={17} />
            </span>
            <span className="text-sm font-bold text-text-primary">Submission summary</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="rounded-full bg-surface-raised px-3 py-1 text-xs font-semibold text-text-secondary">
              {report.currentSubmitted.length} submitted
            </span>
            <ChevronDown
              size={16}
              className={`text-text-secondary transition-transform ${showSubmissionSummary ? "rotate-180" : ""}`}
            />
          </span>
        </button>
        {showSubmissionSummary && (
          <div id="submission-summary-details" className="border-t border-border p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  key: "current_total",
                  label: "Total currently submitted",
                  value: report.currentSubmitted.length,
                },
                {
                  key: "current_month",
                  label: `Submitted in ${monthLabel(month, true)}`,
                  value: report.currentSubmittedInMonth.length,
                },
                {
                  key: "current_other",
                  label: "Submitted in other months",
                  value: report.currentSubmittedOtherMonths.length,
                },
                {
                  key: "current_undated",
                  label: "Submission date missing / invalid",
                  value: report.currentSubmittedUndated.length,
                },
              ].map((item) => (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => choose(item.key)}
                  className={`rounded-lg border p-4 text-left transition-colors hover:border-sky-500/50 ${item.key === "current_total" ? "border-sky-500/25 bg-sky-500/5" : "border-border"}`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-text-secondary">
                    <span>{item.label}</span>
                    <ArrowUpRight size={13} />
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-text-primary">{item.value}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 font-mono text-xs text-text-secondary">
              {report.currentSubmitted.length} total = {report.currentSubmittedInMonth.length}{" "}
              selected month + {report.currentSubmittedOtherMonths.length} other months +{" "}
              {report.currentSubmittedUndated.length} date missing / invalid
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => choose("received")}
          className="rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-sky-500/50"
        >
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>All submissions received this month</span>
            <ArrowUpRight size={15} />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-text-primary">
            {report.submissionsInMonth.length}
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {monthLabel(month, true)} · all start months
          </p>
        </button>
        <button
          type="button"
          onClick={() => choose("assigned")}
          className="rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-sky-500/50"
        >
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>New assignments</span>
            <ArrowUpRight size={15} />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-text-primary">
            {report.newlyAssigned.length}
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            Assigned during {monthLabel(month, true)}
          </p>
        </button>
        <button
          type="button"
          onClick={() => choose("same_month")}
          className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-left transition-colors hover:border-emerald-500/60"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-emerald-600">
            <span>Started & submitted this month</span>
            <ArrowUpRight size={15} />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-text-primary">
            {report.sameMonth.length}
            <span className="ml-2 text-sm font-medium text-text-secondary">
              / {report.cohort.length} starts
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {percent(report.sameMonth.length, report.cohort.length)}% completed within the starting
            month
          </p>
        </button>
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-xs text-text-secondary">Start-to-submission conversion</div>
          <div className="mt-2 text-2xl font-extrabold text-text-primary">{conversion}%</div>
          <p className="mt-1 text-xs text-text-secondary">
            {previous.cohort.length && report.cohort.length
              ? `${difference >= 0 ? "+" : ""}${difference} percentage points vs previous month`
              : "No comparable prior group"}
          </p>
        </div>
      </div>

      <section aria-label="Inclusive stage funnel" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-text-primary">
              {monthLabel(month)} starts · stage progress
            </h3>
          </div>
          <span className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] text-text-secondary">
            As of {dateLabel(report.cutoff)}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {report.stages.map((stage, index) => {
            const style = stageStyles[index];
            const value = percent(stage.count, report.cohort.length);
            return (
              <button
                type="button"
                key={stage.key}
                aria-pressed={selection === stage.key}
                onClick={() => choose(stage.key)}
                className={`rounded-xl border bg-surface p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${selection === stage.key ? `${style.active} ring-4` : "border-border"}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg font-mono text-xs font-bold ${style.icon}`}
                  >
                    0{index + 1}
                  </span>
                  <ArrowRight size={16} className="text-text-dim" />
                </div>
                <div className="mt-4 text-xs font-semibold text-text-secondary">{stage.label}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold tracking-tight text-text-primary">
                    {stage.count}
                  </span>
                  <span className="text-xs text-text-secondary">companies</span>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-border/50">
                  <div
                    className={`h-full rounded-full transition-all ${style.bar}`}
                    style={{ width: `${value}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-text-secondary">
                  {value}% of this month's starts
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <section
          aria-label="Monthly stage comparison"
          className="min-w-0 rounded-xl border border-border bg-surface p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-text-primary">Monthly stage performance</h3>
            <span className="rounded-md bg-surface-raised px-2 py-1 text-[10px] font-medium text-text-secondary">
              By month-end
            </span>
          </div>
          <div role="group" aria-label="Chart stages" className="mt-4 flex flex-wrap gap-1.5">
            {cohortStages.map((stage, index) => {
              const active = visibleChartStages.includes(stage.key);
              return (
                <button
                  type="button"
                  key={stage.key}
                  aria-pressed={active}
                  onClick={() =>
                    setVisibleChartStages((current) =>
                      active
                        ? current.length > 1
                          ? current.filter((key) => key !== stage.key)
                          : current
                        : [...current, stage.key],
                    )
                  }
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${active ? "border-border bg-surface-raised/60 text-text-primary" : "border-transparent text-text-dim hover:bg-surface-raised/40"}`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${active ? stageStyles[index].bar : "bg-border"}`}
                  />
                  {stage.key === "assessment" ? "Assessment" : stage.label}
                </button>
              );
            })}
          </div>
          <div className="mt-4 h-60 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 8, right: 8, left: -24, bottom: 0 }} barGap={3}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="rgba(148,163,184,0.18)"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(148,163,184,0.08)" }}
                  contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                />
                {cohortStages
                  .filter((stage) => visibleChartStages.includes(stage.key))
                  .map((stage) => (
                    <Bar
                      key={stage.key}
                      isAnimationActive={false}
                      dataKey={stage.key}
                      name={stage.key === "assessment" ? "Assessment started" : stage.label}
                      fill={
                        {
                          assessment: "#38bdf8",
                          installation: "#6366f1",
                          commissioning: "#8b5cf6",
                          submission: "#10b981",
                        }[stage.key]
                      }
                      radius={[4, 4, 0, 0]}
                      maxBarSize={22}
                      onClick={(entry: { month?: string }) => {
                        if (entry.month) {
                          setMonth(entry.month);
                          choose(stage.key);
                        }
                      }}
                      cursor="pointer"
                    />
                  ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-1">
            {trend.map((item) => (
              <button
                type="button"
                key={item.month}
                onClick={() => changeMonth(item.month)}
                aria-pressed={month === item.month}
                className={`rounded px-2 py-1 text-[10px] ${month === item.month ? "bg-sky-500/10 font-bold text-sky-500" : "text-text-secondary hover:bg-surface-raised"}`}
              >
                {monthLabel(item.month, true)}
              </button>
            ))}
          </div>
        </section>
        <section
          aria-label="Pending steps"
          className="rounded-xl border border-border bg-surface p-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-text-primary">Where progress is waiting</h3>
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-600">
              {pendingTotal} pending
            </span>
          </div>
          <div className="mt-5 space-y-4">
            {report.pending.map((item) => (
              <button
                type="button"
                key={item.rank}
                onClick={() => choose(`pending-${item.rank}`)}
                className="group w-full text-left"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-text-secondary group-hover:text-text-primary">
                    {item.label}
                  </span>
                  <span className="flex items-center gap-2 text-sm font-bold text-text-primary">
                    {item.count}
                    <ArrowUpRight size={13} className="text-text-dim" />
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-border/50">
                  <div
                    className="h-full rounded-full bg-amber-500/70"
                    style={{ width: `${percent(item.count, report.cohort.length)}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
          <div className="mt-5 border-t border-border pt-4 text-xs leading-5 text-text-secondary">
            <span className="font-semibold text-emerald-600">
              {report.laterSubmissions.length} submitted in a later month.
            </span>
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-bold text-text-primary">
            Other submissions received in {monthLabel(month, true)}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => choose("earlier")}
            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-raised"
          >
            {report.earlierSubmissions.length} from earlier starts{" "}
            <ArrowUpRight size={12} className="ml-1 inline" />
          </button>
          <button
            type="button"
            onClick={() => choose("unknown")}
            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-raised"
          >
            {report.unknownSubmissions.length} unknown start{" "}
            <ArrowUpRight size={12} className="ml-1 inline" />
          </button>
        </div>
      </div>

      <section
        ref={tableRef}
        aria-label="Company tracking"
        className="scroll-mt-5 overflow-hidden rounded-xl border border-border bg-surface"
      >
        <div className="space-y-3 border-b border-border p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-text-primary">{source.title}</h3>
                <span className="rounded-full bg-surface-raised px-2 py-0.5 font-mono text-xs text-text-secondary">
                  {source.companies.length}
                </span>
              </div>
            </div>
            <div className="relative lg:w-60">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
              />
              <Input
                aria-label="Search companies in selected stage"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="Find a company..."
                className="h-9 pl-9 text-xs"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { key: "all", label: "All starts" },
              ...cohortStages.map((stage) => ({ key: stage.key, label: stage.label })),
            ].map((item) => (
              <button
                type="button"
                key={item.key}
                aria-pressed={selection === item.key}
                onClick={() => {
                  setSelection(item.key);
                  setPage(0);
                }}
                className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${selection === item.key ? "bg-text-primary text-surface" : "bg-surface-raised/70 text-text-secondary hover:text-text-primary"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-raised/50 font-mono text-[9px] uppercase tracking-wider text-text-secondary">
              <tr>
                <th className="min-w-52 px-5 py-3">Company</th>
                <th className="min-w-28 px-3 py-3">Started</th>
                {cohortStages.slice(1).map((stage) => (
                  <th key={stage.key} className="min-w-32 px-3 py-3">
                    {stage.label}
                  </th>
                ))}
                <th className="min-w-40 px-5 py-3">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((company) => {
                const rowReport = selection.startsWith("current_") ? currentReport : report;
                const rank = rowReport.rank(company);
                const isExpanded = expanded === company.id;
                return (
                  <Fragment key={company.id}>
                    <tr className="transition-colors hover:bg-surface-raised/30">
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => setExpanded(isExpanded ? null : company.id)}
                          className="flex items-center gap-2 text-left font-semibold text-text-primary"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-text-secondary">
                            <Building2 size={14} />
                          </span>
                          <span>{company.name}</span>
                          <ChevronDown
                            size={13}
                            className={`shrink-0 text-text-dim transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          />
                        </button>
                      </td>
                      <td className="px-3 py-4 text-text-secondary">
                        {dateLabel(company.started) || "Date missing"}
                      </td>
                      {(
                        [
                          { key: "installed", rank: 2 },
                          { key: "commissioned", rank: 3 },
                          { key: "submitted", rank: 4 },
                        ] as const
                      ).map((step) => {
                        const date = performanceDate(company[step.key]);
                        const done = rank >= step.rank;
                        return (
                          <td key={step.key} className="px-3 py-4">
                            <div
                              className={`flex items-center gap-1.5 ${done ? "text-emerald-600" : "text-text-dim"}`}
                            >
                              {done ? (
                                <Check size={13} />
                              ) : (
                                <span className="h-1.5 w-1.5 rounded-full bg-border" />
                              )}
                              <span>
                                {done
                                  ? date && date <= rowReport.cutoff
                                    ? dateLabel(date)
                                    : "Reached · date missing"
                                  : date
                                    ? `Later: ${dateLabel(date)}`
                                    : "Pending"}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-5 py-4">
                        <div className="flex gap-1">
                          {cohortStages.map((stage, index) => (
                            <span
                              key={stage.key}
                              className={`h-1.5 w-7 rounded-full ${rank >= stage.rank ? stageStyles[index].bar : "bg-border/70"}`}
                            />
                          ))}
                        </div>
                        <span className="mt-2 block text-[10px] text-text-secondary">
                          {rank === 4
                            ? "Submitted"
                            : rank === 3
                              ? "Awaiting submission"
                              : rank === 2
                                ? "Awaiting commissioning"
                                : rank === 1
                                  ? "Assessment started"
                                  : "Start month unknown / outside period"}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="bg-surface-raised/30 px-5 py-4">
                          <div className="grid gap-4 sm:grid-cols-3">
                            <div>
                              <p className="font-semibold text-text-primary">
                                Assignment & ownership
                              </p>
                              <p className="mt-1 leading-5 text-text-secondary">
                                Assigned: {dateLabel(company.assigned) || "Date missing"}
                                <br />
                                {company.associateIds
                                  .map(
                                    (id) =>
                                      associates.find((item) => item.id === id)?.name ||
                                      "Unknown associate",
                                  )
                                  .join(", ") || "Unassigned"}
                              </p>
                            </div>
                            <div>
                              <p className="font-semibold text-text-primary">Assessment record</p>
                              <p className="mt-1 leading-5 text-text-secondary">
                                Started: {dateLabel(company.started) || "Date missing"}
                                <br />
                                Assessment milestone:{" "}
                                {dateLabel(company.assessed) || "Date missing"}
                              </p>
                            </div>
                            <div>
                              <p className="font-semibold text-text-primary">Record quality</p>
                              <p className="mt-1 leading-5 text-text-secondary">
                                {company.missingDates.length
                                  ? `Missing: ${company.missingDates.join(", ")}`
                                  : "All recorded milestone dates available."}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <Building2 size={24} className="text-text-dim" />
            <p className="text-sm font-semibold text-text-primary">
              No companies in this selection
            </p>
            <p className="text-xs text-text-secondary">
              {search
                ? "Try another company name or clear your search."
                : "Choose another stage, month or field associate."}
            </p>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[11px] text-text-secondary">
          <span>
            {filtered.length
              ? `${activePage * 10 + 1}–${Math.min((activePage + 1) * 10, filtered.length)} of ${filtered.length} companies`
              : "0 companies"}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Previous company page"
              disabled={activePage === 0}
              onClick={() => setPage(activePage - 1)}
              className="rounded p-1 hover:bg-surface-raised disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              {activePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              aria-label="Next company page"
              disabled={activePage >= pageCount - 1}
              onClick={() => setPage(activePage + 1)}
              className="rounded p-1 hover:bg-surface-raised disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-2 px-1 text-[11px] leading-5 text-text-secondary sm:flex-row sm:items-start sm:justify-between">
        {!!report.undatedStarts.length && (
          <button
            type="button"
            onClick={() => choose("review")}
            className="shrink-0 font-semibold text-amber-600 underline decoration-amber-500/30 underline-offset-4"
          >
            Review {report.undatedStarts.length} missing start dates{" "}
            <ArrowRight size={11} className="inline" />
          </button>
        )}
      </div>
    </div>
  );
}
