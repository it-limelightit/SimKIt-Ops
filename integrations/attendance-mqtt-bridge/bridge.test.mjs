import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMessage, renderEnrollment } from "./protocol.mjs";
import { EventQueue } from "./queue.mjs";
const topic = "aiface/AYUE22065256/sub/stellar";
const config = {
  deviceId: "AYUE22065256",
  topics: [topic],
  timeOffset: "+05:30",
  validModes: ["8"],
  entryValues: ["0"],
  photoField: "photo",
  photoMime: "image/jpeg",
};
const message = {
  cmd: "sendlog",
  sn: config.deviceId,
  count: 1,
  logindex: 0,
  record: [{ enrollid: 1001, name: "Vikash", time: "2026-08-13 10:48:17", mode: 8, inout: 0 }],
};
test("observed sendlog maps serial, enrollid and explicit timezone; identity survives batch replay", () => {
  const first = normalizeMessage(message, topic, config)[0];
  assert.equal(first.enroll_id, "1001");
  assert.equal(first.scanned_at, "2026-08-13T10:48:17+05:30");
  assert.equal(first.recognized, true);
  assert.equal(
    normalizeMessage({ ...message, logindex: 100 }, topic, config)[0].event_id,
    first.event_id,
  );
});
test("unknown firmware modes are not attendance; incorrect device/topic and missing mapping are rejected", () => {
  assert.equal(
    normalizeMessage(message, topic, { ...config, validModes: ["9"] })[0].recognized,
    false,
  );
  assert.throws(() => normalizeMessage(message, topic, { ...config, entryValues: [] }), /Confirm/);
  assert.throws(() => normalizeMessage({ ...message, sn: "other" }, topic, config), /Device/);
  assert.throws(() => normalizeMessage(message, "other", config), /Topic/);
});
test("templates preserve string IDs and allow explicitly configured numeric firmware IDs", () => {
  const command = {
    command_id: "abc",
    device_id: config.deviceId,
    employee: { name: "Rahul", enroll_id: "00104", department: "software" },
  };
  assert.deepEqual(
    renderEnrollment(
      { sn: "{{device_id}}", id: "{{enroll_id}}", number: "{{enroll_id_number}}" },
      command,
    ),
    { sn: config.deviceId, id: "00104", number: 104 },
  );
  assert.throws(
    () =>
      renderEnrollment(
        { id: "{{enroll_id_number}}" },
        { ...command, employee: { ...command.employee, enroll_id: "abc" } },
      ),
    /numeric/,
  );
});
test("durable queue deduplicates metadata and never writes photo bytes to disk", () => {
  const queue = new EventQueue(":memory:");
  const event = {
    ...normalizeMessage(message, topic, config)[0],
    photo_base64: "private-photo",
    photo_mime: "image/jpeg",
  };
  const id = queue.put(event);
  queue.put(event);
  const rows = queue.ready();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body.includes("private-photo"), false);
  queue.retry(id);
  assert.equal(queue.ready().length, 0);
  queue.finish(id);
  assert.equal(queue.ready().length, 0);
  queue.close();
});
