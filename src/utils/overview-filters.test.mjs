import assert from "node:assert/strict";
import test from "node:test";
import { matchesOverviewFilters } from "./overview-filters.ts";

const names = new Map([
  ["a", "Associate A"],
  ["b", "Associate B"],
]);
const row = {
  name: "Factory One",
  company_name: "Acme",
  city: "Surat",
  status: "Assessed",
  workerIds: ["a", "b"],
  progress: { updated: "2026-09-15T12:00:00" },
  meta: { c1_name: "Contact", c1_mobile: "123456" },
};
const filters = {
  city: "",
  associateId: "a",
  dateRange: { start: "2026-09-01", end: "2026-09-30" },
  search: "",
  myTasksUserId: null,
};
const matches = (changes = {}, rowChanges = {}) =>
  matchesOverviewFilters({ ...row, ...rowChanges }, { ...filters, ...changes }, names);

test("unfiltered manager overview includes all companies without personal assignments", () => {
  const defaults = {
    city: "",
    associateId: "",
    dateRange: { start: "", end: "" },
    search: "",
    myTasksUserId: null,
  };
  const companies = [
    row,
    { ...row, workerIds: [], status: "Pending Assignment", progress: { updated: null } },
    { ...row, workerIds: ["another-associate"], status: "Submitted" },
  ];
  assert.equal(
    companies.filter((company) => matchesOverviewFilters(company, defaults, names)).length,
    3,
  );
});

test("associate, city, search, personal tasks, and dates intersect", () => {
  assert.equal(matches({ city: "Surat", search: " acme ", myTasksUserId: "b" }), true);
  assert.equal(matches({ associateId: "other" }), false);
  assert.equal(matches({ city: "Other" }), false);
  assert.equal(matches({ search: "Missing" }), false);
  assert.equal(matches({ myTasksUserId: "other" }), false);
  assert.equal(matches({ myTasksUserId: "a" }, { status: "Submitted" }), false);
  assert.equal(matches({ search: "Associate B" }), true);
  assert.equal(matches({}, { progress: { updated: "2026-10-01T12:00:00" } }), false);
});

test("custom dates include both boundary days and support either bound", () => {
  assert.equal(matches({}, { progress: { updated: "2026-09-01T00:00:00" } }), true);
  assert.equal(matches({}, { progress: { updated: "2026-09-30T23:59:59" } }), true);
  assert.equal(matches({ dateRange: { start: "2026-09-15", end: "" } }), true);
  assert.equal(matches({ dateRange: { start: "", end: "2026-09-15" } }), true);
  assert.equal(matches({ dateRange: { start: "2026-09-16", end: "" } }), false);
});

test("empty custom dates preserve the associate filter without excluding undated rows", () => {
  assert.equal(
    matches({ dateRange: { start: "", end: "" } }, { progress: { updated: null } }),
    true,
  );
  assert.equal(matches({ dateRange: { start: "", end: "" }, associateId: "other" }), false);
  assert.equal(matches({}, { progress: { updated: null } }), false);
  assert.equal(matches({}, { progress: { updated: "invalid" } }), false);
});

test("September 29 end date excludes October 1 updates for the selected associate", () => {
  assert.equal(
    matches(
      { dateRange: { start: "2026-08-15", end: "2026-09-29" } },
      {
        status: "Installed",
        progress: { updated: "2026-10-01T12:00:00" },
        assessmentCompletedAt: "2026-09-15T12:00:00",
      },
    ),
    false,
  );
  assert.equal(
    matches(
      { dateRange: { start: "2026-08-15", end: "2026-09-29" } },
      {
        progress: { updated: "2026-09-29T23:59:59" },
      },
    ),
    true,
  );
});

test("date filtering uses the same assignment and appointment fallbacks as the table", () => {
  assert.equal(matches({}, { progress: { updated: null }, assigned_at: "2026-09-15" }), true);
  assert.equal(matches({}, { progress: { updated: null }, appt_date: "2026-09-15" }), true);
  assert.equal(matches({}, { assigned_at: "2026-10-01" }), true);
});
