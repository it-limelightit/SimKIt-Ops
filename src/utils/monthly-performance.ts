export type MonthlyCompany = {
  id: string;
  name: string;
  associateIds: string[];
  assigned: string | null;
  started: string | null;
  assessed: string | null;
  installed: string | null;
  commissioned: string | null;
  submitted: string | null;
  missingDates: string[];
  currentRank?: number;
};

export const monthlyMilestones = [
  "assigned",
  "started",
  "assessed",
  "installed",
  "commissioned",
  "submitted",
] as const;
export type StartBasis = "started" | "assigned";

type Phase = Record<string, unknown> | null;
export function monthlyCompany(input: {
  id: string;
  name: string;
  associateIds: string[];
  assigned: string | null;
  status: string;
  assessment: Phase;
  installation: Phase;
  commissioning: Phase;
  commissioningWorkDate?: string | null;
  logs: Array<{ type: string; to_status: string; at: string }>;
}): MonthlyCompany {
  const valid = (value: unknown) =>
    typeof value === "string" && performanceDate(value) ? value : null;
  const logDate = (status: string) =>
    input.logs
      .filter((log) => log.type === "status_change" && log.to_status === status && valid(log.at))
      .map((log) => log.at)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const assessed = valid(input.assessment?.factory_form_submitted_at) || logDate("Assessed");
  const installed =
    valid(input.installation?.installation_phase_submitted_at) || logDate("Installed");
  const commissioned =
    valid(input.commissioningWorkDate) ||
    valid(input.commissioning?.commissioning_phase_submitted_at) ||
    logDate("Commissioned");
  const submitted = logDate("Submitted");
  const started =
    [logDate("In Assessment"), logDate("Assessed"), assessed]
      .filter((value): value is string => !!value)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const advanced = ["Submitted", "Commissioned", "Certification Pending"].includes(input.status);
  const missingDates: string[] = [];
  if (input.associateIds.length && !valid(input.assigned)) missingDates.push("Assignment date");
  if (
    !assessed &&
    (input.assessment?.assessment_phase_submitted ||
      ["Assessed", "Panel Dispatched", "Installed"].includes(input.status) ||
      advanced)
  )
    missingDates.push("Assessment date");
  if (
    !installed &&
    (input.installation?.installation_phase_submitted || input.status === "Installed" || advanced)
  )
    missingDates.push("Installation date");
  if (!commissioned && (input.commissioning?.commissioning_phase_submitted || advanced))
    missingDates.push("Commissioning date");
  if (!submitted && input.status === "Submitted") missingDates.push("Submission date");
  if (!started && (assessed || installed || commissioned || submitted || advanced))
    missingDates.push("Assessment start date (cannot identify start month)");
  return {
    id: input.id,
    name: input.name,
    associateIds: input.associateIds,
    assigned: valid(input.assigned),
    started,
    assessed,
    installed,
    commissioned,
    submitted,
    missingDates,
    currentRank:
      input.status === "Submitted"
        ? 4
        : ["Commissioned", "Certification Pending"].includes(input.status)
          ? 3
          : input.status === "Installed"
            ? 2
            : ["Assessed", "Panel Dispatched"].includes(input.status)
              ? 1
              : 0,
  };
}

export const cohortStages = [
  {
    key: "assessment",
    label: "Assessment started",
    rank: 1,
    includes: "Includes installed, commissioned and submitted",
  },
  {
    key: "installation",
    label: "Installed",
    rank: 2,
    includes: "Includes commissioned and submitted",
  },
  { key: "commissioning", label: "Commissioned", rank: 3, includes: "Includes submitted" },
  {
    key: "submission",
    label: "Submitted",
    rank: 4,
    includes: "Companies from this month's starts",
  },
] as const;
export type CohortStage = (typeof cohortStages)[number]["key"];
export type ProgressPeriod = "month_end" | "to_date";

function monthEndDate(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

/** Start-month membership never depends on a later installation or submission. */
export function startMonthPerformance(
  companies: MonthlyCompany[],
  month: string,
  period: ProgressPeriod = "month_end",
  today = performanceDate(new Date().toISOString())!,
) {
  const unique = [...new Map(companies.map((company) => [company.id, company])).values()];
  const lastDay = monthEndDate(month);
  const monthEnd = lastDay < today ? lastDay : today;
  const cutoff = period === "to_date" ? today : monthEnd;
  const before = (value: string | null, end = cutoff) => {
    const date = performanceDate(value);
    return !!date && date <= end;
  };
  const startedInMonth = (company: MonthlyCompany) => {
    const date = performanceDate(company.started);
    return !!date && date.slice(0, 7) === month && date <= today;
  };
  const cohort = unique.filter(startedInMonth);
  const rank = (company: MonthlyCompany) => {
    if (company.started && !before(company.started)) return 0;
    const submission = performanceDate(company.submitted);
    const start = performanceDate(company.started);
    let reached =
      submission && (!start || submission >= start) && before(submission)
        ? 4
        : before(company.commissioned)
          ? 3
          : before(company.installed)
            ? 2
            : before(company.started) || before(company.assessed)
              ? 1
              : 0;
    // Current status can establish that work was done, but cannot establish when.
    // Never project undated current status back into a historical month.
    if (cutoff === today) reached = Math.max(reached, company.currentRank ?? 0);
    return reached;
  };
  const stages = cohortStages.map((stage) => ({
    ...stage,
    count: cohort.filter((company) => rank(company) >= stage.rank).length,
  }));
  const sameMonth = cohort.filter((company) => {
    const submission = performanceDate(company.submitted);
    return (
      !!submission &&
      submission.slice(0, 7) === month &&
      submission >= performanceDate(company.started)! &&
      submission <= today
    );
  });
  const earlierSubmissions = unique.filter((company) => {
    const submission = performanceDate(company.submitted);
    const start = performanceDate(company.started);
    return (
      submission?.slice(0, 7) === month &&
      submission <= today &&
      !!start &&
      start.slice(0, 7) < month
    );
  });
  const unknownSubmissions = unique.filter(
    (company) =>
      !performanceDate(company.started) &&
      performanceDate(company.submitted)?.slice(0, 7) === month &&
      before(company.submitted, today),
  );
  const newlyAssigned = unique.filter(
    (company) =>
      performanceDate(company.assigned)?.slice(0, 7) === month && before(company.assigned, today),
  );
  const pending = [
    { label: "Installation not reached", rank: 1 },
    { label: "Commissioning pending", rank: 2 },
    { label: "Submission pending", rank: 3 },
  ].map((stage) => ({
    ...stage,
    count: cohort.filter((company) => rank(company) === stage.rank).length,
  }));
  const submissionsInMonth = unique.filter(
    (company) =>
      performanceDate(company.submitted)?.slice(0, 7) === month && before(company.submitted, today),
  );
  // Reconcile the current Submitted status independently of start-month and
  // historical cutoff filters. Every current submission belongs to one bucket.
  const currentSubmitted = unique.filter((company) =>
    company.currentRank === undefined
      ? before(company.submitted, today)
      : company.currentRank === 4,
  );
  const currentSubmittedInMonth = currentSubmitted.filter(
    (company) =>
      performanceDate(company.submitted)?.slice(0, 7) === month && before(company.submitted, today),
  );
  const currentSubmittedOtherMonths = currentSubmitted.filter(
    (company) =>
      before(company.submitted, today) && performanceDate(company.submitted)!.slice(0, 7) !== month,
  );
  const currentSubmittedUndated = currentSubmitted.filter(
    (company) => !before(company.submitted, today),
  );
  return {
    cohort,
    stages,
    sameMonth,
    earlierSubmissions,
    unknownSubmissions,
    newlyAssigned,
    pending,
    rank,
    cutoff,
    submissionsInMonth,
    currentSubmitted,
    currentSubmittedInMonth,
    currentSubmittedOtherMonths,
    currentSubmittedUndated,
    laterSubmissions: cohort.filter(
      (company) =>
        before(company.submitted, today) && performanceDate(company.submitted)!.slice(0, 7) > month,
    ),
    undatedStarts: unique.filter(
      (company) =>
        !performanceDate(company.started) &&
        ((company.currentRank ?? 0) > 0 ||
          company.installed ||
          company.commissioned ||
          company.submitted),
    ),
  };
}

// All reports use the operating timezone, including month-boundary timestamps.
export function performanceDate(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function monthlyPerformance(
  companies: MonthlyCompany[],
  month: string,
  basis: StartBasis = "started",
  today = performanceDate(new Date().toISOString())!,
) {
  // A company shared by associates is still one company in overall totals.
  const unique = [...new Map(companies.map((company) => [company.id, company])).values()];
  const inMonth = (value: string | null) => {
    const date = performanceDate(value);
    return !!date && date.slice(0, 7) === month && date <= today;
  };
  const counts = Object.fromEntries(
    monthlyMilestones.map((key) => [key, unique.filter((company) => inMonth(company[key])).length]),
  ) as Record<(typeof monthlyMilestones)[number], number>;
  const cohort = unique.filter((company) => inMonth(company[basis]));
  const lastDay = monthEndDate(month);
  const end = lastDay < today ? lastDay : today;
  const byEnd = (value: string | null) => {
    const date = performanceDate(value);
    return !!date && date <= end;
  };
  const stageAtEnd = (company: MonthlyCompany) => {
    if (byEnd(company.submitted)) return "Submitted";
    if (byEnd(company.commissioned)) return "Awaiting submission";
    if (byEnd(company.installed)) return "Awaiting commissioning";
    if (byEnd(company.assessed)) return "Awaiting installation";
    return "Awaiting assessment";
  };
  const sameMonth = cohort.filter((company) => {
    const start = performanceDate(company[basis]);
    const submission = performanceDate(company.submitted);
    return inMonth(company.submitted) && !!start && !!submission && submission >= start;
  }).length;
  return {
    counts,
    cohort,
    sameMonth,
    earlierStartsSubmitted: unique.filter((company) => {
      const start = performanceDate(company[basis]);
      return inMonth(company.submitted) && !!start && start.slice(0, 7) < month;
    }).length,
    unknownStartsSubmitted: unique.filter(
      (company) => inMonth(company.submitted) && !performanceDate(company[basis]),
    ).length,
    stageAtEnd,
    bottlenecks: [
      "Awaiting assessment",
      "Awaiting installation",
      "Awaiting commissioning",
      "Awaiting submission",
      "Submitted",
    ].map((stage) => ({
      stage,
      count: cohort.filter((company) => stageAtEnd(company) === stage).length,
    })),
  };
}

export function performanceMonths(month: string, length = 12) {
  const [year, number] = month.split("-").map(Number);
  return Array.from({ length }, (_, index) => {
    const date = new Date(Date.UTC(year, number - length + index, 1));
    return date.toISOString().slice(0, 7);
  });
}
