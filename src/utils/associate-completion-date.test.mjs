import assert from "node:assert/strict";
import test from "node:test";
import { associateCompletionDate } from "./associate-completion-date.ts";

test("legacy August submissions use their saved commissioning record date", () => {
  assert.deepEqual(associateCompletionDate({ recordUpdatedAt: "2026-08-22T07:26:28.223+00:00" }), {
    date: "2026-08-22",
    source: "Legacy record date",
  });
});
test("corrected work dates take priority over later submission and approval dates", () => {
  assert.deepEqual(
    associateCompletionDate({
      workDate: "2026-09-29",
      submittedAt: "2026-10-06T05:19:13Z",
      recordUpdatedAt: "2026-10-06T05:19:13Z",
    }),
    {
      date: "2026-09-29",
      source: "Commissioning work date",
    },
  );
});
test("explicit submissions take priority over record edits", () => {
  assert.equal(
    associateCompletionDate({
      submittedAt: "2026-08-31T20:00:00Z",
      recordUpdatedAt: "2026-10-06T05:19:13Z",
    })?.date,
    "2026-09-01",
  );
});
test("commissioning status dates are preserved when submission status changes later", () => {
  assert.deepEqual(
    associateCompletionDate({
      activityLogs: [
        { type: "status_change", to_status: "Submitted", at: "2026-10-02T10:00:00Z" },
        { type: "status_change", to_status: "Commissioned", at: "2026-08-22T10:00:00Z" },
      ],
    }),
    { date: "2026-08-22", source: "Commissioning date" },
  );
});
test("invalid timestamps fall back safely and undated companies stay undated", () => {
  assert.equal(
    associateCompletionDate({ submittedAt: "invalid", recordUpdatedAt: "2026-08-22T10:00:00Z" })
      ?.date,
    "2026-08-22",
  );
  assert.equal(associateCompletionDate({}), null);
});
