import { test } from "node:test";
import assert from "node:assert/strict";
import { heartbeatReply, inferPhotoMime } from "./receiver-core.mjs";
import { normalizeMessage } from "./vendor/protocol.mjs";
import { createHealthServer } from "./health-server.mjs";
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
test("documented aiface entry carries its image and timezone; replay is deduplicated", () => {
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
    timeOffset: "+05:30",
    validModes: ["8"],
    entryValues: ["0"],
    photoField: "image",
    photoMime: inferPhotoMime(image),
  };
  const first = normalizeMessage(message, topic, config)[0];
  assert.equal(first.enroll_id, "9002");
  assert.equal(first.recognized, true);
  assert.equal(first.scanned_at, "2026-10-08T10:05:00+05:30");
  assert.equal(first.photo_base64, image);
  assert.equal(first.photo_mime, "image/jpeg");
  assert.equal("name" in first, false);
  assert.equal(
    normalizeMessage({ ...message, logindex: 100 }, topic, config)[0].event_id,
    first.event_id,
  );
  assert.deepEqual(
    normalizeMessage({ ...message, record: [{ ...message.record[0], inout: 1 }] }, topic, config),
    [],
  );
});
test("public health endpoint exposes only liveness and accepts no device commands", async () => {
  const server = createHealthServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const healthy = await fetch(`${base}/health`);
    assert.equal(healthy.status, 200);
    assert.equal(healthy.headers.get("cache-control"), "no-store");
    assert.deepEqual(await healthy.json(), {
      service: "simkit-aiface-attendance",
      status: "running",
    });
    assert.equal(
      (await fetch(`${base}/health`, { method: "POST", body: '{"cmd":"adduser"}' })).status,
      405,
    );
    assert.equal((await fetch(`${base}/secrets`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
