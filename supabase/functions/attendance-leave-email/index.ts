import { adminClient, body, checked, HttpError, json, env, serve } from "../_shared/attendance.ts";
import { dateOrNull, requiredText } from "../_shared/attendance-validation.ts";
// The email gateway verifies its provider signature, extracts minimal data, then
// HMAC-signs this normalized JSON object. No raw emails/attachments are retained.
serve(async (req) => {
  const timestamp = req.headers.get("x-attendance-timestamp") || "";
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
    throw new HttpError(401, "Expired email webhook");
  const input = await body(req, 12000);
  const signature = req.headers.get("x-attendance-signature") || "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env("ATTENDANCE_EMAIL_WEBHOOK_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (!/^[0-9a-f]{64}$/i.test(signature)) throw new HttpError(401, "Invalid email signature");
  const bytes = Uint8Array.from(signature.match(/../g)!, (hex) => parseInt(hex, 16));
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    new TextEncoder().encode(`${timestamp}.${JSON.stringify(input)}`),
  );
  if (!valid) throw new HttpError(401, "Invalid email signature");
  const sender = requiredText(input.sender, "sender", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) throw new Error("Invalid sender email");
  const request = checked(
    await adminClient().rpc("attendance_email_leave", {
      _message_id: requiredText(input.message_id, "message_id", 200),
      _sender: sender,
      _start: dateOrNull(input.start_date),
      _end: dateOrNull(input.end_date),
      _reason: requiredText(input.reason, "reason", 2000),
    }),
  );
  return json({ request_id: request, status: "received_for_review" });
});
