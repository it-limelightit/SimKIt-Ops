import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectionHealth, RecoveryWatchdog, deviceClockTime } from "./connection-health.mjs";
import { EventQueue } from "./vendor/queue.mjs";
import { normalizeMessage } from "./vendor/protocol.mjs";

const base = Date.parse("2026-10-29T04:30:00Z");
test("a silent subscriber is recovered after three minutes while fresh device replies prevent needless recovery", () => {
  const w = new RecoveryWatchdog(base);
  assert.equal(w.due(base + 179999), false);
  assert.equal(w.due(base + 180000), true);
  assert.equal(w.due(base + 181000), false);
  assert.equal(w.due(base + 360000), true);
  w.observe(base + 370000);
  assert.equal(w.due(base + 540000), false);
  assert.equal(w.due(base + 550000), true);
});
const message = (time, count = 1) => ({ cmd: "sendlog", sn: "device", count,
  record: Array.from({ length: count }, () => ({ enrollid: 1, mode: 8, inout: 0, time })) });
function healthy(clockDate = "2026-10-29") {
  const h = new ConnectionHealth();
  h.connect(base); h.heartbeat(base);
  h.sample(`${clockDate} 10:00:00`, base - 100, base);
  h.heartbeat(base + 20000);
  h.sample(`${clockDate} 10:00:20`, base + 19900, base + 20000);
  return h;
}
test("a wrong absolute date does not control live attendance when the sampled clock advances", () => {
  const h = healthy("2000-01-01");
  const m = message("2000-01-01 10:00:21");
  const timing = h.classify(m, base + 21000);
  assert.equal(timing.time_source, "receiver_live");
  const event = normalizeMessage(m, "scan", { deviceId: "device", topics: ["scan"], validModes: ["8"], entryValues: ["0"] }, base + 21000, timing)[0];
  assert.equal(event.scanned_at, "2026-10-29T04:30:21.000Z");
  assert.equal(event.device_time_raw, m.record[0].time);
});
test("startup, reconnect, heartbeat loss and frozen/reset clocks require review", () => {
  const h = new ConnectionHealth(); h.connect(base); h.heartbeat(base);
  h.sample("2026-10-29 10:00:00", base - 100, base);
  assert.equal(h.classify(message("2026-10-29 10:00:01"), base + 1000).time_source, "unverified");
  h.sample("2026-10-29 10:00:00", base + 19900, base + 20000);
  assert.equal(h.stableSamples, 1);
  const live = healthy();
  live.sample("2000-01-01 00:00:00", base + 39900, base + 40000);
  assert.equal(live.classify(message("2000-01-01 00:00:01"), base + 41000).time_source, "unverified");
  const gap = healthy();
  assert.equal(gap.classify(message("2026-10-29 10:01:10"), base + 70000).time_source, "unverified");
  const reconnect = healthy(); reconnect.disconnect(base + 22000); reconnect.connect(base + 23000); reconnect.heartbeat(base + 24000);
  assert.equal(reconnect.classify(message("2026-10-29 10:00:24"), base + 24000).time_source, "unverified");
});
test("being online does not turn old records, batches, missing times or future times into live scans", () => {
  const h = healthy();
  assert.equal(h.classify(message("2026-10-29 09:00:00"), base + 21000).time_review_reason, "delayed_or_clock_changed");
  assert.equal(h.classify(message("2026-10-29 10:00:21", 2), base + 21000).time_review_reason, "buffered_batch");
  assert.equal(h.classify(message(undefined), base + 21000).time_review_reason, "device_time_missing_or_invalid");
  assert.equal(h.classify(message("2026-10-29 11:00:00"), base + 21000).time_review_reason, "device_time_ahead");
  assert.equal(deviceClockTime("2026-02-30 10:00:00"), null);
  assert.equal(deviceClockTime("2026-10-29T10:00:00Z"), null);
});
test("health transitions include outage duration without logging every successful ping", () => {
  const logs = []; const h = new ConnectionHealth((event) => logs.push(event));
  h.connect(base); h.heartbeat(base + 1000); h.heartbeat(base + 2000);
  const replies = logs.filter((event) => event.reason === "fresh_checklive_reply");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].previous_state_duration_ms, 1000);
  h.disconnect(base + 3000);
  assert.equal(logs.find((event) => event.component === "mqtt" && !event.healthy).previous_state_duration_ms, 3000);
});
test("long Supabase outages keep retrying durable timestamps beyond the previous 20-attempt limit", () => {
  const queue = new EventQueue(":memory:");
  try {
    const id = queue.put({ kind: "scan", event_id: "outage", scanned_at: new Date(base).toISOString(), time_source: "receiver_live" });
    for (let i = 0; i < 25; i++) queue.retry(id);
    const row = queue.db.prepare("SELECT * FROM events WHERE id=?").get(id);
    assert.equal(row.status, "pending"); assert.equal(row.attempts, 25);
    assert.equal(JSON.parse(row.body).scanned_at, new Date(base).toISOString());
    queue.put({ kind: "scan", event_id: "outage", scanned_at: new Date(base + 3600000).toISOString(), time_source: "unverified" });
    assert.equal(JSON.parse(queue.db.prepare("SELECT body FROM events WHERE id=?").get(id).body).time_source, "receiver_live");
  } finally { queue.close(); }
});
