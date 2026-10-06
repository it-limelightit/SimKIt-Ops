import assert from "node:assert/strict";
import test from "node:test";
import { commissioningWorkTimestamp } from "./commissioning-work-date.ts";
import { matchesOverviewFilters } from "./overview-filters.ts";

const approvedAt = "2026-10-06T18:30:00+05:30";
const row = {
  name: "Factory",
  company_name: "Company",
  city: "Surat",
  status: "Commissioned",
  workerIds: ["associate"],
  meta: { c1_name: "", c1_mobile: "" },
};
const matchesDay = (timestamp, day) =>
  matchesOverviewFilters(
    { ...row, progress: { updated: timestamp } },
    {
      city: "",
      associateId: "associate",
      search: "",
      myTasksUserId: null,
      dateRange: { start: day, end: day },
    },
    new Map(),
  );

test("corrected commissioning counts on the work day, not the approval day", () => {
  const effective = commissioningWorkTimestamp("2026-10-02", approvedAt);
  assert.equal(matchesDay(effective, "2026-10-02"), true);
  assert.equal(matchesDay(effective, "2026-10-06"), false);
  assert.equal(approvedAt, "2026-10-06T18:30:00+05:30");
});

test("a correction across months belongs only to the corrected reporting period", () => {
  const effective = commissioningWorkTimestamp("2026-09-30", approvedAt);
  assert.equal(matchesDay(effective, "2026-09-30"), true);
  assert.equal(matchesDay(effective, "2026-10-06"), false);
});

test("legacy work keeps its existing timestamp when no ledger date is available", () => {
  assert.equal(matchesDay(commissioningWorkTimestamp(undefined, approvedAt), "2026-10-06"), true);
  assert.equal(commissioningWorkTimestamp(undefined, null), null);
});
