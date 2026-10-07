// Request-scoped MQTT 3.1.1 client for enrollment, not a permanent subscriber.
// Only exact configured topics, QoS 1 publishing, and QoS 0/1 incoming replies.
export interface MqttConnection {
  read(buffer: Uint8Array): Promise<number | null>;
  write(buffer: Uint8Array): Promise<number>;
  close(): void;
}
export type EnrollmentCommand = { id: string; name: string; department: string; enroll_id: string };
export type AckRules = {
  topic: string;
  kind_path: string;
  kind_value: unknown;
  command_id_path: string;
  enroll_id_path: string;
  serial_path: string;
  success_path: string;
  success_value: unknown;
  failure_value: unknown;
};
export type MqttConfig = {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
  deviceId: string;
  topic: string;
  template: unknown;
  ack?: AckRules;
  timeoutMs: number;
};
export type MqttOutcome = { outcome: "not_sent" | "uncertain" | "published"; ack: boolean | null };
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
function word(value: number) {
  return Uint8Array.of(value >> 8, value & 255);
}
function text(value: string) {
  const bytes = encoder.encode(value);
  if (bytes.length > 65535 || value.includes("\0")) throw new Error("Invalid MQTT string");
  return concat(word(bytes.length), bytes);
}
function packet(header: number, body: Uint8Array) {
  if (body.length > 65536) throw new Error("MQTT packet too large");
  let length = body.length;
  const encoded = [];
  do {
    let digit = length % 128;
    length = Math.floor(length / 128);
    if (length) digit |= 128;
    encoded.push(digit);
  } while (length);
  return concat(Uint8Array.of(header, ...encoded), body);
}
function validTopic(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 256 || /[+#\0]/.test(value))
    throw new Error("Exact MQTT topic required");
}
function field(object: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) => (value && typeof value === "object" ? Reflect.get(value, key) : undefined),
      object,
    );
}
export function renderMqttEnrollment(
  template: unknown,
  command: EnrollmentCommand,
  deviceId: string,
): unknown {
  const values: Record<string, unknown> = {
    command_id: command.id,
    device_id: deviceId,
    name: command.name,
    department: command.department,
    enroll_id: command.enroll_id,
  };
  const visit = (value: unknown, depth = 0): unknown => {
    if (depth > 16) throw new Error("Enrollment template too deep");
    if (Array.isArray(value)) return value.map((v) => visit(v, depth + 1));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, visit(v, depth + 1)]),
      );
    if (typeof value === "string" && /^\{\{[a-z_]+\}\}$/.test(value)) {
      const key = value.slice(2, -2);
      if (key === "enroll_id_number") {
        if (!/^\d+$/.test(command.enroll_id) || !Number.isSafeInteger(Number(command.enroll_id)))
          throw new Error("Numeric enroll ID required");
        return Number(command.enroll_id);
      }
      if (!(key in values)) throw new Error("Unknown template placeholder");
      return values[key];
    }
    return value;
  };
  if (!template || typeof template !== "object" || Array.isArray(template))
    throw new Error("Enrollment template must be a JSON object");
  return visit(template);
}
export function mqttConfig(get: (name: string) => string | undefined): MqttConfig | null {
  const names = [
    "ATTENDANCE_MQTT_HOST",
    "ATTENDANCE_MQTT_PORT",
    "ATTENDANCE_MQTT_TLS",
    "ATTENDANCE_MQTT_USERNAME",
    "ATTENDANCE_MQTT_PASSWORD",
    "ATTENDANCE_MQTT_ENROLL_TEMPLATE",
    "ATTENDANCE_COMMAND_TOPIC",
    "ATTENDANCE_DEVICE_ID",
  ];
  if (names.some((name) => !get(name))) return null;
  const port = Number(get("ATTENDANCE_MQTT_PORT"));
  const tls = get("ATTENDANCE_MQTT_TLS");
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !["true", "false"].includes(tls!))
    throw new Error("Invalid MQTT connection configuration");
  const topic = get("ATTENDANCE_COMMAND_TOPIC")!;
  validTopic(topic);
  const template = JSON.parse(get("ATTENDANCE_MQTT_ENROLL_TEMPLATE")!);
  const ack = get("ATTENDANCE_MQTT_ACK_RULES")
    ? (JSON.parse(get("ATTENDANCE_MQTT_ACK_RULES")!) as AckRules)
    : undefined;
  if (ack) {
    validTopic(ack.topic);
    for (const key of [
      "kind_path",
      "command_id_path",
      "enroll_id_path",
      "serial_path",
      "success_path",
    ] as const) {
      if (typeof ack[key] !== "string" || !/^\w+(?:\.\w+)*$/.test(ack[key]))
        throw new Error("Invalid acknowledgment field mapping");
    }
    if (
      ack.kind_value === undefined ||
      ack.success_value === undefined ||
      ack.failure_value === undefined ||
      JSON.stringify(ack.success_value) === JSON.stringify(ack.failure_value)
    )
      throw new Error("Explicit acknowledgment values required");
    if (!JSON.stringify(template).includes("{{command_id}}"))
      throw new Error("Device acknowledgments require command ID correlation");
  }
  const config = {
    host: get("ATTENDANCE_MQTT_HOST")!,
    port,
    tls: tls === "true",
    username: get("ATTENDANCE_MQTT_USERNAME")!,
    password: get("ATTENDANCE_MQTT_PASSWORD")!,
    deviceId: get("ATTENDANCE_DEVICE_ID")!,
    topic,
    template,
    ack,
    timeoutMs: 10000,
  };
  // Validate the shape before any database command is claimed.
  renderMqttEnrollment(
    template,
    { id: "validation", name: "validation", department: "software", enroll_id: "1" },
    config.deviceId,
  );
  return config;
}
export async function publishMqtt(
  config: MqttConfig,
  command: EnrollmentCommand,
  connect: (config: MqttConfig) => Promise<MqttConnection>,
): Promise<MqttOutcome> {
  let connection: MqttConnection | undefined;
  let closed = false;
  let sending = false;
  let brokerAccepted = false;
  let ack: boolean | null = null;
  const deadline = Date.now() + config.timeoutMs;
  async function timed<T>(promise: Promise<T>): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      // The operation may already be pending: observe its rejection when the
      // connection closes, even though there is no remaining wait budget.
      void promise.catch(() => {});
      throw new Error("MQTT timeout");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("MQTT timeout")), remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async function write(bytes: Uint8Array) {
    let offset = 0;
    while (offset < bytes.length) {
      const n = await timed(connection!.write(bytes.subarray(offset)));
      if (n <= 0) throw new Error("MQTT write closed");
      offset += n;
    }
  }
  async function readExact(count: number) {
    const bytes = new Uint8Array(count);
    let offset = 0;
    while (offset < count) {
      const n = await timed(connection!.read(bytes.subarray(offset)));
      if (!n) throw new Error("MQTT connection closed");
      offset += n;
    }
    return bytes;
  }
  async function readPacket() {
    const header = (await readExact(1))[0];
    let size = 0;
    let factor = 1;
    for (let i = 0; i < 4; i++) {
      const digit = (await readExact(1))[0];
      size += (digit & 127) * factor;
      if (size > 65536) throw new Error("MQTT response too large");
      if (!(digit & 128)) return { header, bytes: await readExact(size) };
      factor *= 128;
    }
    throw new Error("Malformed MQTT packet");
  }
  async function acceptReply(reply: { header: number; bytes: Uint8Array }) {
    if (reply.header >> 4 !== 3) return;
    const bytes = reply.bytes;
    const qos = (reply.header >> 1) & 3;
    if (bytes.length < 2 || qos > 1) throw new Error("Unsupported MQTT reply");
    const length = (bytes[0] << 8) | bytes[1];
    let offset = 2 + length;
    if (offset + (qos === 1 ? 2 : 0) > bytes.length) throw new Error("Malformed MQTT reply");
    const topic = decoder.decode(bytes.subarray(2, offset));
    if (qos === 1) {
      await write(packet(0x40, bytes.subarray(offset, offset + 2)));
      offset += 2;
    }
    if (!config.ack || topic !== config.ack.topic || reply.header & 1) return; // Ignore retained replies.
    let data: unknown;
    try {
      data = JSON.parse(decoder.decode(bytes.subarray(offset)));
    } catch {
      return;
    }
    const rules = config.ack;
    if (
      field(data, rules.kind_path) !== rules.kind_value ||
      field(data, rules.command_id_path) !== command.id ||
      String(field(data, rules.enroll_id_path)) !== command.enroll_id ||
      field(data, rules.serial_path) !== config.deviceId
    )
      return;
    const result = field(data, rules.success_path);
    if (result === rules.success_value) ack = true;
    else if (result === rules.failure_value) ack = false;
  }
  try {
    const payload = encoder.encode(
      JSON.stringify(renderMqttEnrollment(config.template, command, config.deviceId)),
    );
    const opening = connect(config).then((conn) => {
      if (closed) conn.close();
      return conn;
    });
    connection = await timed(opening);
    const clientId = `att-${crypto.randomUUID().replaceAll("-", "").slice(0, 19)}`;
    await write(
      packet(
        0x10,
        concat(
          text("MQTT"),
          Uint8Array.of(4, 0xc2),
          word(30),
          text(clientId),
          text(config.username),
          text(config.password),
        ),
      ),
    );
    const connack = await readPacket();
    if (
      connack.header !== 0x20 ||
      connack.bytes.length !== 2 ||
      connack.bytes[0] !== 0 ||
      connack.bytes[1] !== 0
    )
      throw new Error("MQTT broker rejected connection");
    if (config.ack) {
      // Subscribe before publishing so an immediate device response is not missed.
      await write(packet(0x82, concat(word(1), text(config.ack.topic), Uint8Array.of(0))));
      while (true) {
        const reply = await readPacket();
        if (reply.header === 0x90) {
          if (
            reply.bytes.length !== 3 ||
            reply.bytes[0] !== 0 ||
            reply.bytes[1] !== 1 ||
            reply.bytes[2] !== 0
          )
            throw new Error("MQTT subscription rejected");
          break;
        }
        // Never accept a response before the command was sent.
        if (reply.header >> 4 === 3 && ((reply.header >> 1) & 3) === 1) {
          const n = (reply.bytes[0] << 8) | reply.bytes[1];
          await write(packet(0x40, reply.bytes.subarray(2 + n, 4 + n)));
        }
      }
    }
    sending = true;
    await write(packet(0x32, concat(text(config.topic), word(2), payload)));
    while (true) {
      const reply = await readPacket();
      if (
        reply.header === 0x40 &&
        reply.bytes.length === 2 &&
        reply.bytes[0] === 0 &&
        reply.bytes[1] === 2
      )
        brokerAccepted = true;
      else await acceptReply(reply);
      if (brokerAccepted && (!config.ack || ack !== null)) return { outcome: "published", ack };
    }
  } catch {
    return {
      outcome: brokerAccepted || ack !== null ? "published" : sending ? "uncertain" : "not_sent",
      ack,
    };
  } finally {
    closed = true;
    try {
      connection?.close();
    } catch {
      /* Already disconnected. */
    }
  }
}
