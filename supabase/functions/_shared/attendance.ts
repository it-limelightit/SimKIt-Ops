import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.0";
import { mqttConfig, publishMqtt } from "./attendance-mqtt.ts";

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
