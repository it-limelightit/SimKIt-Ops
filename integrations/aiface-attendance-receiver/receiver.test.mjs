import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deviceProfile,
  heartbeatReply,
  inferPhotoMime,
  photoExpiryTime,
} from "./receiver-core.mjs";
import { EventQueue } from "./vendor/queue.mjs";
import { normalizeMessage } from "./vendor/protocol.mjs";
test("photos expire at next-day 02:00 IST, including midnight and month boundaries", () => {
  for (const stamp of [
    "2026-10-09T00:00:00+05:30",
    "2026-10-09T23:59:59+05:30",
    "2026-10-09T18:29:59Z",
  ]) {
    assert.equal(new Date(photoExpiryTime(stamp)).toISOString(), "2026-10-09T20:30:00.000Z");
  }
  assert.equal(
    new Date(photoExpiryTime("2026-10-09T18:30:00Z")).toISOString(),
    "2026-10-10T20:30:00.000Z",
  );
  assert.equal(
    new Date(photoExpiryTime("2026-12-31T23:59:59+05:30")).toISOString(),
    "2026-12-31T20:30:00.000Z",
  );
});
test("only a fresh non-retained reply from the actual device counts as heartbeat", () => {
  const message = { ret: "checklive", sn: "AYUE22065256", result: true };
  assert.equal(heartbeatReply(message, { retain: false }, message.sn, 1000, 2000), true);
  assert.equal(heartbeatReply(message, { retain: true }, message.sn, 1000, 2000), false);
  assert.equal(heartbeatReply(message, { retain: false }, message.sn, 0, 2000), false);
  assert.equal(heartbeatReply(message, { retain: false }, message.sn, 1000, 12000), false);
  assert.equal(
    heartbeatReply({ ...message, sn: "other" }, { retain: false }, message.sn, 1000, 2000),
    false,
  );
  assert.equal(
    heartbeatReply({ ...message, result: false }, { retain: false }, message.sn, 1000, 2000),
    false,
  );
});
test("detects actual JPEG/PNG bytes and rejects invalid or disguised image content", () => {
  assert.equal(inferPhotoMime(Buffer.from([255, 216, 255, 0]).toString("base64")), "image/jpeg");
  assert.equal(
    inferPhotoMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")),
    "image/png",
  );
  assert.equal(inferPhotoMime("not-a-photo"), null);
  assert.equal(inferPhotoMime(Buffer.from("ordinary text").toString("base64")), null);
});
test("face profile confirmation strips biometrics, rejects retained/wrong-device data, and queues separate IDs", () => {
  const topic = "aiface/AYUE22065256/sub/stellar";
  const message = {
    cmd: "senduser",
    sn: "AYUE22065256",
    enrollid: 9003,
    backupnum: 50,
    name: "Private name",
    record: Buffer.from([255, 216, 255, 0]).toString("base64"),
  };
  const packet = { topic, retain: false };
  const event = deviceProfile(message, packet, message.sn, topic, 1000);
  assert.equal(event.enroll_id, "9003");
  assert.equal("record" in event, false);
  assert.equal("name" in event, false);
  assert.equal(deviceProfile(message, { ...packet, retain: true }, message.sn, topic), null);
  assert.equal(deviceProfile({ ...message, sn: "wrong" }, packet, message.sn, topic), null);
  assert.equal(deviceProfile({ ...message, backupnum: 11 }, packet, message.sn, topic), null);
  assert.equal(deviceProfile({ ...message, record: "invalid" }, packet, message.sn, topic), null);
  const queue = new EventQueue(":memory:");
  try {
    const first = queue.put(event);
    assert.equal(queue.put(event), first);
    queue.put({ ...event, enroll_id: "8003" });
    assert.equal(queue.ready().length, 2);
    assert.equal(
      queue.ready().some((row) => row.body.includes(message.record)),
      false,
    );
  } finally {
    queue.close();
  }
});
test("aiface entry uses MQTT receipt time and keeps its image; replay is deduplicated", () => {
  const topic = "aiface/AYUE22065256/sub/stellar";
  const image = Buffer.from([255, 216, 255, 0]).toString("base64");
  const message = {
    cmd: "sendlog",
    sn: "AYUE22065256",
    count: 1,
    logindex: 0,
    record: [
      {
        enrollid: 9002,
        name: "Device name",
        time: "2026-10-08 10:05:00",
        mode: 8,
        inout: 0,
        image,
      },
    ],
  };
  const config = {
    deviceId: message.sn,
    topics: [topic],
    validModes: ["8"],
    entryValues: ["0"],
    photoField: "image",
    photoMime: inferPhotoMime(image),
  };
  const receivedAt = Date.parse("2026-10-09T05:00:00.123Z");
  const first = normalizeMessage(message, topic, config, receivedAt)[0];
  assert.equal(first.enroll_id, "9002");
  assert.equal(first.recognized, true);
  assert.equal(first.scanned_at, "2026-10-09T05:00:00.123Z");
  assert.equal(first.photo_base64, image);
  assert.equal(first.photo_mime, "image/jpeg");
  assert.equal("name" in first, false);
  assert.equal(
    normalizeMessage({ ...message, logindex: 100 }, topic, config, receivedAt + 60000)[0].event_id,
    first.event_id,
  );
  const queue = new EventQueue(":memory:");
  try {
    queue.put(first);
    const replay = normalizeMessage(message, topic, config, receivedAt + 60000)[0];
    queue.put(replay);
    assert.equal(queue.ready().length, 1);
    assert.equal(JSON.parse(queue.ready()[0].body).scanned_at, first.scanned_at);
    queue.retry(queue.ready()[0].id);
    assert.equal(
      JSON.parse(queue.db.prepare("SELECT body FROM events").get().body).scanned_at,
      first.scanned_at,
    );
  } finally {
    queue.close();
  }
  for (const time of ["2000-01-01 00:00:00", "invalid", undefined]) {
    const brokenClock = { ...message, record: [{ ...message.record[0], time }] };
    assert.equal(
      normalizeMessage(brokenClock, topic, config, receivedAt)[0].scanned_at,
      first.scanned_at,
    );
  }
  assert.deepEqual(
    normalizeMessage({ ...message, record: [{ ...message.record[0], inout: 1 }] }, topic, config),
    [],
  );
});
