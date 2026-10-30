// Separate attendance subscriber. The existing VPS MQTT script and bridge are unchanged.
import mqtt from "mqtt";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { normalizeMessage } from "./vendor/protocol.mjs";
import { EventQueue } from "./vendor/queue.mjs";
import { randomUUID } from "node:crypto";
import { ConnectionHealth, RecoveryWatchdog } from "./connection-health.mjs";
import {
  deviceProfile,
  heartbeatReply,
  inferPhotoMime,
  photoExpiryTime,
} from "./receiver-core.mjs";

const required = (name) => {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
  return process.env[name];
};
const deviceId = required("ATTENDANCE_DEVICE_ID");
const eventTopic = required("ATTENDANCE_EVENT_TOPIC");
const commandTopic = required("ATTENDANCE_COMMAND_TOPIC");
if (
  deviceId !== "AYUE22065256" ||
  eventTopic !== `aiface/${deviceId}/sub/stellar` ||
  commandTopic !== `aiface/${deviceId}/pub/stellar`
)
  throw new Error("Receiver is restricted to the confirmed single attendance device and topics");
const destination = required("ATTENDANCE_DEVICE_WEBHOOK_URL");
if (destination !== "https://jhhiwyvrhfhvvougkqmm.supabase.co/functions/v1/attendance-device-event")
  throw new Error("Unexpected attendance webhook destination");
const webhookSecret = required("ATTENDANCE_DEVICE_WEBHOOK_SECRET");
const database = path.resolve(process.env.RECEIVER_DB || "./receiver.sqlite");
mkdirSync(path.dirname(database), { recursive: true, mode: 0o700 });
const queue = new EventQueue(database);
const watchdog = new RecoveryWatchdog();
let reconnecting = false;
const health = new ConnectionHealth((details) => {
  console.log(`Attendance health ${JSON.stringify(details)}`);
  try {
    queue.put({ kind: "receiver_health", event_id: randomUUID(), device_id: deviceId,
      topic: eventTopic, ...details });
  } catch {
    console.error("Health history could not be queued; inspect queue capacity.");
  }
});
function logError(component, error) {
  let message = String(error?.message || "Unknown error").slice(0, 500);
  for (const value of [process.env.MQTT_PASSWORD, webhookSecret, process.env.MQTT_USERNAME])
    if (value) message = message.split(value).join("[redacted]");
  message = message.replace(/(mqtts?:\/\/)[^\s/]*@/gi, "$1[redacted]@");
  console.error(JSON.stringify({ component, code: error?.code, message }));
}
const photos = new Map();
const batches = new Map();
const client = mqtt.connect(required("MQTT_URL"), {
  username: required("MQTT_USERNAME"),
  password: required("MQTT_PASSWORD"),
  clientId: required("MQTT_CLIENT_ID"),
  clean: false,
  reconnectPeriod: 5000,
  queueQoSZero: false,
});
let ready = false,
  pendingPing = 0,
  draining = false,
  heartbeatInFlight = false;
let pendingClock = 0;
async function post(event) {
  return fetch(destination, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-attendance-secret": webhookSecret },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
}
function ping() {
  health.tick();
  if (!shuttingDown && !reconnecting && watchdog.due()) {
    reconnecting = true;
    ready = false;
    console.error("No fresh device reply for 3 minutes; resetting attendance MQTT connection.");
    // A broken stream can remain alive after a broker crash. Force-close only
    // this subscriber; durable attendance metadata stays in SQLite.
    const timeout = setTimeout(() => {
      console.error("Attendance MQTT reset stalled; exiting for PM2 recovery.");
      process.exit(1);
    }, 10000);
    timeout.unref();
    client.end(true, {}, () => {
      clearTimeout(timeout);
      reconnecting = false;
      if (!shuttingDown) client.reconnect();
    });
    return;
  }
  if (!ready || heartbeatInFlight) return;
  pendingPing = Date.now();
  // Read-only reachability check; this receiver never enrolls or deletes users.
  client.publish(
    commandTopic,
    JSON.stringify({ cmd: "checklive" }),
    { qos: 1, retain: false },
    (error) => {
      if (error) { pendingPing = 0; logError("heartbeat_publish", error); }
    },
  );
  // Read-only clock sampling detects frozen/reset clocks without changing device settings.
  pendingClock = Date.now();
  client.publish(commandTopic, JSON.stringify({ cmd: "gettime" }), { qos: 1, retain: false },
    (error) => { if (error) { pendingClock = 0; logError("clock_publish", error); } });
}
client.on("connect", () =>
  client.subscribe(eventTopic, { qos: 1 }, (error, granted) => {
    ready = !error && granted?.[0]?.qos !== 128;
    if (ready) {
      health.connect();
      console.log("Attendance receiver subscribed to the confirmed device topic.");
      ping();
    } else console.error("Attendance subscription failed.");
  }),
);
client.on("close", () => {
  ready = false;
  pendingPing = 0;
  pendingClock = 0;
  health.disconnect();
});
client.on("error", (error) => logError("mqtt", error));
client.on("reconnect", () => console.log("MQTT reconnect attempt."));
client.handleMessage = (packet, done) => {
  const receivedAt = Date.now();
  try {
    if (packet.retain || packet.topic !== eventTopic) return done();
    if (packet.payload.length > 2900000) throw new Error("Packet too large");
    const message = JSON.parse(packet.payload.toString());
    if (typeof message.ret === "string" && message.ret.trim() === "gettime" && message.sn === deviceId && message.result !== false) {
      health.sample(message.time, pendingClock, receivedAt);
      pendingClock = 0;
      return done();
    }
    if (heartbeatReply(message, packet, deviceId, pendingPing)) {
      watchdog.observe(receivedAt);
      health.heartbeat(receivedAt);
      pendingPing = 0;
      heartbeatInFlight = true;
      // A real, fresh device reply establishes heartbeat, never broker connectivity alone.
      void post({
        kind: "heartbeat",
        device_id: deviceId,
        topic: eventTopic,
        observed_at: new Date().toISOString(),
      })
        .then(async (response) => {
          await response.body?.cancel();
          health.transition("supabase", response.ok, response.ok ? "heartbeat_accepted" : `http_${response.status}`);
          if (!response.ok) console.error(`Heartbeat rejected (${response.status}); request_id=${response.headers.get("sb-request-id") || response.headers.get("x-request-id") || "unavailable"}.`);
        })
        .catch((error) => {
          health.transition("supabase", false, "heartbeat_delivery_failed");
          logError("heartbeat", error);
        })
        .finally(() => {
          heartbeatInFlight = false;
        });
      return done();
    }
    if (message.cmd === "senduser") {
      const profile = deviceProfile(message, packet, deviceId, eventTopic);
      if (profile) queue.put(profile);
      return done();
    }
    if (message.cmd !== "sendlog") return done();
    const safeRecords = Array.isArray(message.record)
      ? message.record.map((record) => {
          const mime = inferPhotoMime(record.image);
          return { ...record, image: mime ? record.image : undefined, _photoMime: mime };
        })
      : message.record;
    const input = { ...message, record: safeRecords };
    const config = {
      deviceId,
      topics: [eventTopic],
      validModes: ["8"],
      entryValues: ["0"],
      photoField: "image",
      photoMime: "image/jpeg",
    };
    const timing = health.classify(input, receivedAt);
    const events = normalizeMessage(input, eventTopic, config, receivedAt, timing);
    if (events.length && timing.time_source === "unverified")
      console.warn(`Attendance timing needs review: ${timing.time_review_reason}; records=${events.length}.`);
    const entries = safeRecords.filter((record) => String(record.inout) === "0");
    events.forEach((event, index) => {
      const id = queue.put(event);
      const queued = queue.db.prepare("SELECT status,body FROM events WHERE id=?").get(id);
      const delivered = queued?.status === "delivered";
      const expiry = photoExpiryTime(JSON.parse(queued.body).scanned_at);
      if (!delivered && event.photo_base64 && expiry > Date.now() && photos.size < 50)
        photos.set(id, {
          photo_base64: event.photo_base64,
          photo_mime: entries[index]._photoMime,
          expires: expiry,
        });
    });
    // Acknowledge device logs only after all corresponding metadata/photo calls succeed.
    // Never include door-opening access controls in an attendance acknowledgment.
    if (batches.size < 100) {
      const ids = events.map((event) => `scan:${event.event_id}`);
      batches.set(JSON.stringify([message.logindex, message.count, ids]), {
        ids,
        count: message.count,
        logindex: message.logindex,
      });
    }
    done();
  } catch {
    console.error("Device message rejected; no message contents logged.");
    done(new Error("Attendance message could not be queued"));
  }
};
async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (const [id, photo] of photos) if (photo.expires <= Date.now()) photos.delete(id);
    for (const row of queue.ready()) {
      if (shuttingDown) break;
      const event = JSON.parse(row.body),
        photo = photos.get(row.id);
      if (photo) {
        event.photo_base64 = photo.photo_base64;
        event.photo_mime = photo.photo_mime;
      }
      try {
        const response = await post(event);
        if (response.ok) {
          if (event.kind === "device_profile") {
            const result = await response.json();
            if (result.confirmed === true) {
              const cloudtime = new Date(Date.now() + 330 * 60000)
                .toISOString()
                .slice(0, 19)
                .replace("T", " ");
              await new Promise((resolve, reject) =>
                client.publish(
                  commandTopic,
                  JSON.stringify({ ret: "senduser", result: true, cloudtime }),
                  { qos: 1, retain: false },
                  (error) => (error ? reject(error) : resolve()),
                ),
              );
              console.log("Device enrollment profile confirmed in Supabase.");
            } else console.log("Device profile has no matching active employee; review required.");
          } else await response.body?.cancel();
          queue.finish(row.id);
          photos.delete(row.id);
          console.log("Attendance event delivered to Supabase.");
        } else {
          await response.body?.cancel();
          queue.retry(row.id);
          console.error(
            `Attendance delivery rejected (${response.status}); metadata retained for retry.`,
          );
        }
      } catch (error) {
        queue.retry(row.id);
        logError("attendance_delivery", error);
        console.error("Attendance delivery failed; metadata retained for retry.");
      }
    }
    if (ready)
      for (const [key, batch] of batches) {
        if (
          !batch.ids.every(
            (id) =>
              queue.db.prepare("SELECT status FROM events WHERE id=?").get(id)?.status ===
              "delivered",
          )
        )
          continue;
        const cloudtime = new Date(Date.now() + 330 * 60000)
          .toISOString()
          .slice(0, 19)
          .replace("T", " ");
        const ack = { ret: "sendlog", result: true, count: batch.count, cloudtime };
        if (batch.logindex !== undefined) ack.logindex = batch.logindex;
        client.publish(commandTopic, JSON.stringify(ack), { qos: 1, retain: false }, (error) => {
          if (!error) batches.delete(key);
        });
      }
    queue.prune();
  } finally {
    draining = false;
  }
}
const heartbeatTimer = setInterval(ping, 20000),
  drainTimer = setInterval(() => void drain(), 1000),
  healthTimer = setInterval(() => {
    health.tick();
    console.log(`Attendance health summary ${JSON.stringify({
      components: Object.fromEntries(health.states), queue: queue.stats(),
      observed_at: new Date().toISOString(),
    })}`);
  }, 60000);
console.log("Attendance receiver starting; scan timing remains unverified until heartbeat and advancing clock samples are established.");
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeatTimer);
  clearInterval(drainTimer);
  clearInterval(healthTimer);
  ready = false;
  await new Promise((resolve) => client.end(true, {}, resolve));
  while (draining || heartbeatInFlight) await new Promise((resolve) => setTimeout(resolve, 50));
  photos.clear();
  queue.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
