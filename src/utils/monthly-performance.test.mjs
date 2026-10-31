import test from "node:test";
import assert from "node:assert/strict";
import { filterCompanySource } from "../lib/company-source.ts";
import {
  monthlyCompany,
  monthlyPerformance,
  performanceDate,
  performanceMonths,
  startMonthPerformance,
} from "./monthly-performance.ts";

const company = (id, overrides = {}) => ({
  id,
  name: id,
  associateIds: ["a", "b"],
  assigned: "2026-09-20",
  started: "2026-09-25",
  assessed: "2026-09-27",
  installed: "2026-10-04",
  commissioned: "2026-10-12",
  submitted: "2026-10-20",
  missingDates: [],
  ...overrides,
});
const report = (companies, month = "2026-10", basis = "started") =>
  monthlyPerformance(companies, month, basis, "2026-10-31");

test("monthly milestones include earlier starts and companies that progressed to submission", () => {
  const result = report([
    company("earlier"),
    company("new", { started: "2026-10-01", assessed: "2026-10-02", assigned: "2026-10-01" }),
  ]);
  assert.deepEqual(result.counts, {
    assigned: 1,
    started: 1,
    assessed: 1,
    installed: 2,
    commissioned: 2,
    submitted: 2,
  });
  assert.equal(result.sameMonth, 1);
  assert.equal(result.earlierStartsSubmitted, 1);
  assert.equal(result.cohort.length, 1);
});

test("historical cohort position stops at month-end and later submissions remain visible", () => {
  const result = report([company("later")], "2026-09");
  assert.equal(result.stageAtEnd(result.cohort[0]), "Awaiting installation");
  assert.equal(result.sameMonth, 0);
  assert.equal(result.cohort[0].submitted, "2026-10-20");
});

test("shared assignments do not duplicate overall company counts", () => {
  const item = company("shared");
  assert.equal(report([item, item]).counts.submitted, 1);
});

test("assignment and actual recorded start form independent monthly cohorts", () => {
  const item = company("waiting", { assigned: "2026-09-01", started: "2026-10-01" });
  assert.equal(report([item]).sameMonth, 1);
  assert.equal(report([item], "2026-10", "assigned").sameMonth, 0);
  assert.equal(report([item], "2026-10", "assigned").earlierStartsSubmitted, 1);
});

test("India timezone determines the reporting month", () => {
  assert.equal(performanceDate("2026-09-30T20:00:00Z"), "2026-10-01");
  assert.equal(
    report([company("boundary", { submitted: "2026-09-30T20:00:00Z" })]).counts.submitted,
    1,
  );
  assert.equal(performanceDate("invalid"), null);
});

const input = (overrides = {}) => ({
  id: "site",
  name: "Factory",
  associateIds: ["a"],
  assigned: null,
  status: "Submitted",
  assessment: null,
  installation: null,
  commissioning: null,
  logs: [],
  ...overrides,
});
test("unknown milestone dates are flagged; updated_at is never treated as completion", () => {
  const item = monthlyCompany(input());
  assert.equal(item.assigned, null);
  assert.equal(item.started, null);
  assert.equal(item.submitted, null);
  assert.equal(item.missingDates.length, 6);
  assert.equal(report([item]).counts.submitted, 0);
});

test("submission alone does not invent a work start", () => {
  const item = monthlyCompany(
    input({ logs: [{ type: "status_change", to_status: "Submitted", at: "2026-10-02" }] }),
  );
  assert.equal(item.started, null);
  assert.equal(report([item]).unknownStartsSubmitted, 1);
});

test("explicit milestones and corrected commissioning work dates beat later changes", () => {
  const item = monthlyCompany(
    input({
      assessment: { factory_form_submitted_at: "2026-08-20" },
      commissioning: { commissioning_phase_submitted_at: "2026-10-05" },
      commissioningWorkDate: "2026-09-29",
      logs: [
        { type: "status_change", to_status: "In Assessment", at: "2026-08-18" },
        { type: "status_change", to_status: "Submitted", at: "2026-10-06" },
        { type: "status_change", to_status: "Submitted", at: "2026-10-10" },
      ],
    }),
  );
  assert.equal(item.started, "2026-08-18");
  assert.equal(item.commissioned, "2026-09-29");
  assert.equal(item.submitted, "2026-10-06");
  assert.equal(report([item]).counts.commissioned, 0);
});

test("trend month buckets span the selected year boundary without cumulative counts", () => {
  assert.deepEqual(performanceMonths("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
  const item = company("once");
  assert.equal(report([item], "2026-09").counts.submitted, 0);
  assert.equal(report([item], "2026-10").counts.submitted, 1);
});

test("future milestones and reversed timelines do not create same-month completions", () => {
  const future = company("future", { submitted: "2026-10-30", started: "2026-10-01" });
  assert.equal(
    monthlyPerformance([future], "2026-10", "started", "2026-10-15").counts.submitted,
    0,
  );
  assert.equal(report([company("reversed", { started: "2026-10-25" })]).sameMonth, 0);
});

test("inclusive funnel counts submitted companies in all earlier stages", () => {
  const group = Array.from({ length: 10 }, (_, index) =>
    company(`new-${index}`, {
      started: "2026-10-01",
      assessed: "2026-10-02",
      installed: index < 7 ? "2026-10-05" : null,
      commissioned: index < 5 ? "2026-10-10" : null,
      submitted: index < 3 ? "2026-10-15" : null,
    }),
  );
  const result = startMonthPerformance(
    [...group, company("earlier")],
    "2026-10",
    "month_end",
    "2026-10-31",
  );
  assert.deepEqual(
    result.stages.map((stage) => stage.count),
    [10, 7, 5, 3],
  );
  assert.equal(result.sameMonth.length, 3);
  assert.deepEqual(
    result.earlierSubmissions.map((item) => item.id),
    ["earlier"],
  );
  assert.deepEqual(
    result.pending.map((item) => item.count),
    [3, 2, 2],
  );
});

test("a dated submission proves earlier stages without inventing their dates", () => {
  const item = company("submitted", { started: "2026-10-01", installed: null, commissioned: null });
  const result = startMonthPerformance([item], "2026-10", "month_end", "2026-10-31");
  assert.deepEqual(
    result.stages.map((stage) => stage.count),
    [1, 1, 1, 1],
  );
  assert.equal(item.installed, null);
  assert.equal(item.commissioned, null);
});

test("historical groups retain membership as they progress in later months", () => {
  const item = company("september-start");
  const historical = startMonthPerformance([item], "2026-09", "month_end", "2026-10-31");
  const current = startMonthPerformance([item], "2026-09", "to_date", "2026-10-31");
  assert.deepEqual(
    historical.stages.map((stage) => stage.count),
    [1, 0, 0, 0],
  );
  assert.deepEqual(
    current.stages.map((stage) => stage.count),
    [1, 1, 1, 1],
  );
  assert.equal(historical.sameMonth.length, 0);
  assert.equal(historical.laterSubmissions.length, 1);
  assert.equal(
    startMonthPerformance([item], "2026-10", "month_end", "2026-10-31").cohort.length,
    0,
  );
});

test("later installation or commissioning never supplies a missing assessment start", () => {
  const item = monthlyCompany(
    input({
      installation: { installation_phase_submitted_at: "2026-10-04" },
      commissioningWorkDate: "2026-10-08",
    }),
  );
  assert.equal(item.started, null);
  const result = startMonthPerformance([item], "2026-10", "to_date", "2026-10-31");
  assert.equal(result.cohort.length, 0);
  assert.equal(result.undatedStarts.length, 1);
});

test("current undated status never backdates a historical submission", () => {
  const item = company("undated", {
    started: "2026-09-01",
    assessed: "2026-09-04",
    installed: null,
    commissioned: null,
    submitted: null,
    currentRank: 4,
  });
  assert.equal(
    startMonthPerformance([item], "2026-09", "month_end", "2026-10-31").stages[3].count,
    0,
  );
  assert.equal(
    startMonthPerformance([item], "2026-09", "to_date", "2026-10-31").stages[3].count,
    1,
  );
  assert.equal(
    startMonthPerformance([item], "2026-09", "to_date", "2026-10-31").sameMonth.length,
    0,
  );
});

test("funnel deduplicates shared companies and reports unknown starts separately", () => {
  const item = company("shared", { started: "2026-10-01" });
  const unknown = company("unknown", { started: null });
  const result = startMonthPerformance([item, item, unknown], "2026-10", "month_end", "2026-10-31");
  assert.deepEqual(
    result.stages.map((stage) => stage.count),
    [1, 1, 1, 1],
  );
  assert.equal(result.unknownSubmissions.length, 1);
});

test("assessment starts at the India month boundary belong to the correct funnel", () => {
  const item = company("boundary", { started: "2026-09-30T20:00:00Z" });
  assert.equal(
    startMonthPerformance([item], "2026-10", "month_end", "2026-10-31").cohort.length,
    1,
  );
  assert.equal(
    startMonthPerformance([item], "2026-09", "month_end", "2026-10-31").cohort.length,
    0,
  );
});

test("historical cutoff is the actual last day of the selected month", () => {
  assert.equal(
    startMonthPerformance([], "2026-09", "month_end", "2026-10-31").cutoff,
    "2026-09-30",
  );
  assert.equal(
    startMonthPerformance([], "2026-02", "month_end", "2026-10-31").cutoff,
    "2026-02-28",
  );
  assert.equal(
    startMonthPerformance([], "2024-02", "month_end", "2026-10-31").cutoff,
    "2024-02-29",
  );
  assert.equal(
    startMonthPerformance([], "2026-10", "month_end", "2026-10-15").cutoff,
    "2026-10-15",
  );
});

test("assessment form resubmission does not move an older start into this month", () => {
  const item = monthlyCompany(
    input({
      assessment: { factory_form_submitted_at: "2026-10-05" },
      logs: [{ type: "status_change", to_status: "Assessed", at: "2026-09-04" }],
    }),
  );
  assert.equal(item.started, "2026-09-04");
  assert.equal(
    startMonthPerformance([item], "2026-10", "month_end", "2026-10-31").cohort.length,
    0,
  );
});

test("current-month inclusive counts use current status even when completion dates are missing", () => {
  const item = company("known-submission", {
    started: "2026-10-01",
    installed: null,
    commissioned: null,
    submitted: null,
    currentRank: 4,
  });
  const result = startMonthPerformance([item], "2026-10", "month_end", "2026-10-31");
  assert.deepEqual(
    result.stages.map((stage) => stage.count),
    [1, 1, 1, 1],
  );
  // Current progress remains visible, but a missing date is not assigned to
  // this calendar month and then silently lost when the month becomes past.
  assert.equal(result.sameMonth.length, 0);
  assert.equal(item.submitted, null);
});

test("performance excludes lead companies from every report group", () => {
  const sites = [
    company("npc-start", { company_source: "npc", assigned: "2026-10-01", started: "2026-10-02" }),
    company("legacy-npc", { assigned: "2026-10-01", started: "2026-10-02" }),
    company("lead-start", {
      company_source: "lead",
      assigned: "2026-10-01",
      started: "2026-10-02",
    }),
    company("lead-earlier", { company_source: "lead" }),
    company("lead-unknown", { company_source: "lead", started: null }),
  ];
  const npcSites = filterCompanySource(sites, "npc");
  const result = startMonthPerformance(npcSites, "2026-10", "month_end", "2026-10-31");
  assert.deepEqual(
    result.cohort.map((item) => item.id),
    ["npc-start", "legacy-npc"],
  );
  assert.deepEqual(
    result.stages.map((stage) => stage.count),
    [2, 2, 2, 2],
  );
  assert.equal(result.newlyAssigned.length, 2);
  assert.equal(result.sameMonth.length, 2);
  assert.equal(result.earlierSubmissions.length, 0);
  assert.equal(result.unknownSubmissions.length, 0);
  assert.equal(result.undatedStarts.length, 0);
});

test("all 85 current submissions reconcile across selected month, other months and missing dates", () => {
  const records = Array.from({ length: 85 }, (_, index) =>
    company(`submitted-${index}`, {
      currentRank: 4,
      submitted:
        index < 17 ? "2026-10-20" : index < 25 ? "2026-09-20" : index < 55 ? "2026-08-20" : null,
    }),
  );
  const result = startMonthPerformance(records, "2026-10", "month_end", "2026-10-31");
  assert.equal(result.currentSubmitted.length, 85);
  assert.equal(result.currentSubmittedInMonth.length, 17);
  assert.equal(result.currentSubmittedOtherMonths.length, 38);
  assert.equal(result.currentSubmittedUndated.length, 30);
  assert.equal(result.submissionsInMonth.length, 17);
  assert.equal(
    result.currentSubmitted.length,
    result.currentSubmittedInMonth.length +
      result.currentSubmittedOtherMonths.length +
      result.currentSubmittedUndated.length,
  );
  const allIds = [
    ...result.currentSubmittedInMonth,
    ...result.currentSubmittedOtherMonths,
    ...result.currentSubmittedUndated,
  ].map((record) => record.id);
  assert.equal(new Set(allIds).size, 85);
});

test("all submissions received includes earlier and unknown starts independently of the start funnel", () => {
  const records = [
    company("earlier"),
    company("unknown", { started: null }),
    company("same", { started: "2026-10-01" }),
  ];
  const result = startMonthPerformance(records, "2026-10", "month_end", "2026-10-31");
  assert.equal(result.submissionsInMonth.length, 3);
  assert.equal(result.stages[3].count, 1);
  assert.equal(result.sameMonth.length, 1);
});

test("undated submissions stay visible in reconciliation when a month becomes historical", () => {
  const item = company("undated", { currentRank: 4, started: "2026-09-01", submitted: null });
  const september = startMonthPerformance([item], "2026-09", "month_end", "2026-09-30");
  const october = startMonthPerformance([item], "2026-09", "month_end", "2026-10-31");
  assert.equal(september.sameMonth.length, 0);
  assert.equal(october.sameMonth.length, 0);
  assert.equal(september.currentSubmittedUndated.length, 1);
  assert.equal(october.currentSubmittedUndated.length, 1);
  assert.equal(
    startMonthPerformance([item], "2026-09", "to_date", "2026-10-31").stages[3].count,
    1,
  );
});

test("saved historical status events recover dates without using commissioning or edit dates", () => {
  const recovered = monthlyCompany(
    input({
      commissioningWorkDate: "2026-08-15",
      logs: [
        { type: "status_change", to_status: "Assessed", at: "2026-08-01T10:00:00Z" },
        { type: "status_change", to_status: "Submitted", at: "2026-09-20T10:00:00Z" },
      ],
    }),
  );
  const result = startMonthPerformance([recovered], "2026-09", "month_end", "2026-10-31");
  assert.equal(result.submissionsInMonth.length, 1);
  assert.equal(result.currentSubmittedUndated.length, 0);
  assert.equal(result.currentSubmittedInMonth.length, 1);
});

test("current status total and historical submission activity remain distinct after reopening", () => {
  const reopened = company("reopened", { currentRank: 2 });
  const result = startMonthPerformance([reopened], "2026-10", "month_end", "2026-10-31");
  assert.equal(result.currentSubmitted.length, 0);
  assert.equal(result.submissionsInMonth.length, 1);
});
