import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import mqtt from "mqtt";
import { EventQueue } from "./queue.mjs";
import { normalizeMessage, renderEnrollment } from "./protocol.mjs";

const required = (name) => {
  if (!process.env[name]) throw new Error(`Missing configuration: ${name}`);
  return process.env[name];
};
const config = {
  deviceId: required("ATTENDANCE_DEVICE_ID"),
  topics: required("ATTENDANCE_EVENT_TOPICS")
    .split(",")
    .map((s) => s.trim()),
  timeOffset: required("ATTENDANCE_DEVICE_TIME_OFFSET"),
  validModes: (process.env.ATTENDANCE_VALID_MODES || "").split(",").filter(Boolean),
  entryValues: (process.env.ATTENDANCE_ENTRY_INOUT_VALUES || "").split(",").filter(Boolean),
  photoField: process.env.ATTENDANCE_PHOTO_FIELD,
  photoMime: process.env.ATTENDANCE_PHOTO_MIME || "image/jpeg",
};
if (!/^[+-]\d{2}:\d{2}$/.test(config.timeOffset))
  throw new Error("Device time offset must be explicit");
const destination = required("ATTENDANCE_DEVICE_WEBHOOK_URL");
if (new URL(destination).protocol !== "https:")
  throw new Error("Supabase destination must use HTTPS");
const webhookSecret = required("ATTENDANCE_DEVICE_WEBHOOK_SECRET");
const publishSecret = required("ATTENDANCE_PUBLISH_SECRET");
const queue = new EventQueue(process.env.BRIDGE_DB || "./bridge.sqlite");
const photos = new Map();
const client = mqtt.connect(required("MQTT_URL"), {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clientId: required("MQTT_CLIENT_ID"),
  clean: false,
  reconnectPeriod: 5000,
  queueQoSZero: false,
});
client.on("connect", () => {
  client.subscribe(config.topics, { qos: 1 }, (error) => {
    if (error) console.error("MQTT subscription failed");
  });
});
client.on("error", () => console.error("MQTT connection error; retrying"));
// Persist metadata before acknowledging QoS 1 deliveries. QoS 0 messages cannot
// be guaranteed during outages; the provided screenshot shows QoS 0.
client.handleMessage = (packet, done) => {
  try {
    if (packet.retain) return done(); // Never use retained stale heartbeat/scan as live evidence.
    if (packet.payload.length > 2900000) throw new Error("Message too large");
    const events = normalizeMessage(JSON.parse(packet.payload.toString()), packet.topic, config);
    for (const event of events) {
      // Do not queue historical heartbeat messages and replay them as live health.
      if (event.kind === "heartbeat") {
        const observed = Date.parse(event.observed_at);
        if (!Number.isFinite(observed) || Math.abs(Date.now() - observed) > 60000)
          throw new Error("Fresh device heartbeat timestamp required");
      }
      const id = queue.put(event);
      const expires = Date.parse(event.scanned_at) + 86400000;
      if (
        typeof event.photo_base64 === "string" &&
        event.photo_base64.length <= 2800000 &&
        expires > Date.now() &&
        photos.size < 50
      )
        photos.set(id, { bytes: event.photo_base64, mime: event.photo_mime, expires });
    }
    done();
  } catch (error) {
    console.error(`Attendance message rejected: ${error.message}`);
    done(new Error("Attendance message not queued"));
  }
};
let draining = false;
const timer = setInterval(async () => {
  if (draining) return;
  draining = true;
  try {
    for (const [id, photo] of photos) if (photo.expires <= Date.now()) photos.delete(id);
    for (const item of queue.ready()) {
      const event = JSON.parse(item.body);
      if (event.kind === "heartbeat" && Date.now() - Date.parse(event.observed_at) > 60000) {
        queue.finish(item.id);
        continue;
      }
      const photo = photos.get(item.id);
      if (photo) Object.assign(event, { photo_base64: photo.bytes, photo_mime: photo.mime });
      try {
        const result = await fetch(destination, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-attendance-secret": webhookSecret },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        });
        await result.body?.cancel();
        if (result.ok) {
          queue.finish(item.id);
          photos.delete(item.id);
        } else queue.retry(item.id);
      } catch {
        queue.retry(item.id);
      }
    }
    queue.prune();
  } finally {
    draining = false;
  }
}, 1000);

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST" || req.url !== "/publish") return send(404, { error: "Not found" });
  const digest = (value) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(req.headers["x-attendance-secret"] || ""), digest(publishSecret)))
    return send(401, { error: "Unauthorized" });
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) return send(413, { error: "Too large" });
      chunks.push(chunk);
    }
    const command = JSON.parse(Buffer.concat(chunks).toString());
    if (
      command.device_id !== config.deviceId ||
      !process.env.ATTENDANCE_COMMAND_TOPIC ||
      command.topic !== process.env.ATTENDANCE_COMMAND_TOPIC ||
      command.operation !== "enroll"
    )
      return send(403, { error: "Command destination not allowed" });
    if (
      !/^[0-9a-f-]{36}$/i.test(command.command_id) ||
      typeof command.employee?.name !== "string" ||
      typeof command.employee?.enroll_id !== "string"
    )
      return send(400, { error: "Invalid enrollment command" });
    const canonical = JSON.stringify(command);
    const existing = queue.db.prepare("SELECT * FROM commands WHERE id=?").get(command.command_id);
    if (existing) {
      if (existing.body !== canonical) return send(409, { error: "Command ID conflict" });
      return send(existing.status === "published" ? 200 : 409, { status: existing.status });
    }
    if (!client.connected) return send(503, { error: "MQTT disconnected" });
    const template = JSON.parse(readFileSync(required("ATTENDANCE_ENROLL_TEMPLATE_FILE"), "utf8"));
    const payload = renderEnrollment(template, command);
    queue.db
      .prepare("INSERT INTO commands VALUES(?,?,'publishing',?)")
      .run(command.command_id, canonical, Date.now());
    // An uncertain send is never automatically duplicated: reconcile with device.
    await Promise.race([
      client.publishAsync(command.topic, JSON.stringify(payload), { qos: 1, retain: false }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("MQTT publish timeout")), 8000)),
    ]);
    queue.db.prepare("UPDATE commands SET status='published' WHERE id=?").run(command.command_id);
    send(200, { status: "published" });
  } catch {
    send(503, { error: "Publishing unavailable; check template and MQTT status" });
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.BRIDGE_PORT || 8787), process.env.BRIDGE_HOST || "127.0.0.1", () =>
  console.info("Attendance bridge started"),
);
process.on("SIGTERM", () => {
  clearInterval(timer);
  server.close();
  client.end(true);
  process.exit(0);
});
