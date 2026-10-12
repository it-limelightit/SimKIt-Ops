import { createHash } from "node:crypto";

export function normalizeMessage(message, topic, config, receivedAt = Date.now()) {
  if (!config.topics.includes(topic)) throw new Error("Topic not allowed");
  if (!message || typeof message !== "object" || Array.isArray(message))
    throw new Error("JSON object required");
  if (message.kind) {
    if (message.device_id !== config.deviceId) throw new Error("Device not allowed");
    if (!["scan", "heartbeat", "enrollment_ack"].includes(message.kind))
      throw new Error("Unknown event kind");
    const fields =
      message.kind === "scan"
        ? ["event_id", "enroll_id", "scanned_at", "recognized", "photo_base64", "photo_mime"]
        : message.kind === "heartbeat"
          ? ["observed_at"]
          : ["command_id", "enroll_id", "success"];
    return [
      {
        kind: message.kind,
        device_id: message.device_id,
        topic,
        ...Object.fromEntries(
          fields.filter((key) => message[key] !== undefined).map((key) => [key, message[key]]),
        ),
      },
    ];
  }
  if (message.cmd !== "sendlog") return [];
  if (message.sn !== config.deviceId) throw new Error("Device not allowed");
  if (
    !Array.isArray(message.record) ||
    message.record.length > 100 ||
    message.record.length !== message.count
  )
    throw new Error("Invalid sendlog record count");
  if (!config.validModes.length || !config.entryValues.length)
    throw new Error("Confirm firmware face mode and entry flags before ingesting sendlog");
  return message.record
    .filter((record) => config.entryValues.includes(String(record.inout)))
    .map((record) => {
      if (record.enrollid === undefined) throw new Error("Invalid sendlog record");
      // Attendance uses MQTT receipt time, captured once by the receiver.
      // A broken or missing device clock must not determine the work date.
      const scannedAt = new Date(receivedAt).toISOString();
      // Raw device time is only an opaque deduplication value, never attendance time.
      // Batch logindex can change on replay, so do not use it as event identity.
      const stable = JSON.stringify([
        message.sn,
        String(record.enrollid),
        record.time,
        record.mode,
        record.inout,
      ]);
      const event = {
        kind: "scan",
        device_id: message.sn,
        topic,
        event_id: record.event_id
          ? String(record.event_id)
          : createHash("sha256").update(stable).digest("hex"),
        enroll_id: String(record.enrollid),
        scanned_at: scannedAt,
        recognized: config.validModes.includes(String(record.mode)),
      };
      if (config.photoField && record[config.photoField]) {
        event.photo_base64 = record[config.photoField];
        event.photo_mime = config.photoMime;
      }
      return event;
    });
}
export function renderEnrollment(template, command) {
  const values = {
    command_id: command.command_id,
    device_id: command.device_id,
    name: command.employee.name,
    department: command.employee.department,
    enroll_id: command.employee.enroll_id,
  };
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, visit(val)]));
    if (typeof value === "string" && /^\{\{[a-z_]+\}\}$/.test(value)) {
      const key = value.slice(2, -2);
      if (key === "enroll_id_number") {
        if (!/^\d+$/.test(values.enroll_id) || !Number.isSafeInteger(Number(values.enroll_id)))
          throw new Error("Firmware requires a numeric enroll ID");
        return Number(values.enroll_id);
      }
      if (!(key in values)) throw new Error("Unknown enrollment template placeholder");
      return values[key];
    }
    return value;
  };
  return visit(template);
}
