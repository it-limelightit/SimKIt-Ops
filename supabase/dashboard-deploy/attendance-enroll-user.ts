// Supabase Dashboard deployment copy: attendance-enroll-user.
// Generated from the existing Edge Function and shared helpers; no credentials included.

// Source: supabase/functions/_shared/attendance-mqtt.ts
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


// Source: supabase/functions/_shared/attendance-validation.ts
export function requiredText(value: unknown, field: string, max = 128): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error(`Invalid ${field}`);
  return value.trim();
}
export function isoTimestamp(value: unknown): string {
  const text = requiredText(value, "scanned_at", 40);
  if (!dateOrNull(text.slice(0, 10))) throw new Error("Invalid scan date");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) ||
    !Number.isFinite(Date.parse(text))
  )
    throw new Error("scanned_at must include a timezone");
  return new Date(text).toISOString();
}
export function dateOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}
export function uuid(value: unknown): string {
  const text = requiredText(value, "id", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text))
    throw new Error("Invalid id");
  return text;
}
export function photoBytes(base64: unknown, mime: unknown): { bytes: Uint8Array; mime: string } {
  if (mime !== "image/jpeg" && mime !== "image/png")
    throw new Error("Only JPEG and PNG photos are accepted");
  const encoded = requiredText(base64, "photo_base64", 2800000);
  const raw = atob(encoded);
  if (!raw.length || raw.length > 2097152) throw new Error("Photo exceeds 2 MB");
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  if (mime === "image/jpeg" ? !jpeg : !png)
    throw new Error("Photo content does not match its MIME type");
  return { bytes, mime };
}


// Source: supabase/functions/_shared/attendance.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.0";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(503, `Attendance configuration missing: ${name}`);
  return value;
}
export function adminClient() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "POST required" }, 405);
    try {
      return await handler(req);
    } catch (error) {
      // Never log request bodies, photos, auth headers, provider responses or secrets.
      const status = error instanceof HttpError ? error.status : 400;
      return json(
        { error: error instanceof Error ? error.message : "Attendance request failed" },
        status,
      );
    }
  });
}
export async function body(req: Request, max = 16384): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Request body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, "Request too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new HttpError(400, "JSON object required");
  return result;
}
export async function manager(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in required");
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid session");
  const role = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "supervisor")
    .maybeSingle();
  if (role.error || !role.data) throw new HttpError(403, "Manager access required");
  const user = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { admin, user, userId: data.user.id };
}
export async function secret(req: Request, name: string) {
  const expected = env(name);
  const given = req.headers.get("x-attendance-secret") || "";
  const hash = async (text: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([hash(expected), hash(given)]);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  if (mismatch || !given) throw new HttpError(401, "Unauthorized webhook");
}
export function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new HttpError(400, result.error.message);
  return result.data;
}
export async function publishPending(admin: ReturnType<typeof adminClient>, employee?: string) {
  if (Deno.env.get("ATTENDANCE_PUBLISH_MODE") === "mqtt") {
    const config = mqttConfig((name) => Deno.env.get(name));
    if (!config) return { configured: false, sent: 0 };
    const commands = checked(
      await admin.rpc("attendance_claim_commands", { _employee: employee || null }),
    ) as { id: string; lease_token: string; name: string; department: string; enroll_id: string }[];
    let sent = 0;
    for (const command of commands) {
      const result = await publishMqtt(config, command, (connection) =>
        connection.tls
          ? Deno.connectTls({ hostname: connection.host, port: connection.port })
          : Deno.connect({ hostname: connection.host, port: connection.port, transport: "tcp" }),
      );
      checked(
        await admin.rpc("attendance_mqtt_finish_command", {
          _id: command.id,
          _lease: command.lease_token,
          _outcome: result.outcome,
          _ack: result.ack,
        }),
      );
      if (result.outcome === "published") sent++;
    }
    return { configured: true, sent };
  }
  const endpoint = Deno.env.get("ATTENDANCE_PUBLISH_URL");
  const token = Deno.env.get("ATTENDANCE_PUBLISH_SECRET");
  const topic = Deno.env.get("ATTENDANCE_COMMAND_TOPIC");
  const device = Deno.env.get("ATTENDANCE_DEVICE_ID");
  if (!endpoint || !token || !topic || !device) return { configured: false, sent: 0 };
  if (new URL(endpoint).protocol !== "https:")
    throw new HttpError(503, "Publishing endpoint must use HTTPS");
  const commands = checked(
    await admin.rpc("attendance_claim_commands", { _employee: employee || null }),
  ) as { id: string; lease_token: string; name: string; department: string; enroll_id: string }[];
  let sent = 0;
  for (const command of commands) {
    let ok = false;
    try {
      // Normalized adapter contract, NOT assumed device firmware JSON.
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-attendance-secret": token },
        body: JSON.stringify({
          command_id: command.id,
          device_id: device,
          topic,
          operation: "enroll",
          employee: {
            name: command.name,
            department: command.department,
            enroll_id: command.enroll_id,
          },
        }),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      ok = response.ok;
      await response.body?.cancel();
    } catch {
      ok = false;
    }
    checked(
      await admin.rpc("attendance_finish_command", {
        _id: command.id,
        _lease: command.lease_token,
        _sent: ok,
      }),
    );
    if (ok) sent++;
  }
  return { configured: true, sent };
}


// Source: supabase/functions/attendance-enroll-user/index.ts
serve(async (req) => {
  const { admin, user } = await manager(req);
  const input = await body(req);
  let employee: string;
  if (input.action === "retry") {
    employee = uuid(input.employee_id);
    checked(await user.rpc("attendance_retry_enrollment", { _employee: employee }));
  } else {
    const department = requiredText(input.department, "department", 20);
    if (!["firmware", "hardware", "logistic", "software", "manager"].includes(department))
      throw new Error("Invalid department");
    const start = input.employment_start ? dateOrNull(input.employment_start) : null;
    if (input.employment_start && !start) throw new Error("Invalid employment start date");
    const email = input.email ? requiredText(input.email, "email", 254).toLowerCase() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
    employee = checked(
      await user.rpc("attendance_save_employee", {
        _name: requiredText(input.name, "name", 120),
        _department: department,
        _enroll_id: requiredText(input.enroll_id, "enroll_id", 64),
        _email: email,
        _email_verified: input.email_verified === true,
        _start: start,
      }),
    );
  }
  let publishing: { configured: boolean; sent: number };
  try {
    publishing = await publishPending(admin, employee);
  } catch {
    publishing = { configured: false, sent: 0 };
  }
  const current = await admin
    .from("attendance_employees")
    .select("enrollment_status")
    .eq("id", employee)
    .maybeSingle();
  return json({
    employee_id: employee,
    status: current.data?.enrollment_status || "pending",
    publishing,
  });
});
