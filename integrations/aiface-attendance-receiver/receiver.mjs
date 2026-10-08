// Separate attendance subscriber. The existing VPS MQTT script and bridge are unchanged.
import mqtt from "mqtt";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { normalizeMessage } from "./vendor/protocol.mjs";
import { EventQueue } from "./vendor/queue.mjs";
import { heartbeatReply, inferPhotoMime } from "./receiver-core.mjs";

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
  if (!ready || heartbeatInFlight) return;
  pendingPing = Date.now();
  // checklive is the only command this receiver publishes; it never enrolls or deletes users.
  client.publish(
    commandTopic,
    JSON.stringify({ cmd: "checklive" }),
    { qos: 1, retain: false },
    (error) => {
      if (error) pendingPing = 0;
    },
  );
}
client.on("connect", () =>
  client.subscribe(eventTopic, { qos: 1 }, (error, granted) => {
    ready = !error && granted?.[0]?.qos !== 128;
    if (ready) {
      console.log("Attendance receiver subscribed to the confirmed device topic.");
      ping();
    } else console.error("Attendance subscription failed.");
  }),
);
client.on("close", () => {
  ready = false;
  pendingPing = 0;
});
client.on("error", () => console.error("MQTT connection failed; reconnecting."));
client.handleMessage = (packet, done) => {
  try {
    if (packet.retain || packet.topic !== eventTopic) return done();
    if (packet.payload.length > 2900000) throw new Error("Packet too large");
    const message = JSON.parse(packet.payload.toString());
    if (heartbeatReply(message, packet, deviceId, pendingPing)) {
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
          if (response.ok) console.log("Device heartbeat delivered to Supabase.");
          else console.error(`Heartbeat rejected (${response.status}).`);
        })
        .catch(() => console.error("Heartbeat delivery failed."))
        .finally(() => {
          heartbeatInFlight = false;
        });
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
      timeOffset: "+05:30",
      validModes: ["8"],
      entryValues: ["0"],
      photoField: "image",
      photoMime: "image/jpeg",
    };
    const events = normalizeMessage(input, eventTopic, config);
    const entries = safeRecords.filter((record) => String(record.inout) === "0");
    events.forEach((event, index) => {
      const id = queue.put(event);
      const delivered =
        queue.db.prepare("SELECT status FROM events WHERE id=?").get(id)?.status === "delivered";
      if (
        !delivered &&
        event.photo_base64 &&
        Date.parse(event.scanned_at) + 86400000 > Date.now() &&
        photos.size < 50
      )
        photos.set(id, {
          photo_base64: event.photo_base64,
          photo_mime: entries[index]._photoMime,
          expires: Date.parse(event.scanned_at) + 86400000,
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
        await response.body?.cancel();
        if (response.ok) {
          queue.finish(row.id);
          photos.delete(row.id);
          console.log("Attendance event delivered to Supabase.");
        } else {
          queue.retry(row.id);
          console.error(
            `Attendance delivery rejected (${response.status}); metadata retained for retry.`,
          );
        }
      } catch {
        queue.retry(row.id);
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
  drainTimer = setInterval(() => void drain(), 1000);
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeatTimer);
  clearInterval(drainTimer);
  ready = false;
  await new Promise((resolve) => client.end(true, {}, resolve));
  while (draining || heartbeatInFlight) await new Promise((resolve) => setTimeout(resolve, 50));
  photos.clear();
  queue.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
