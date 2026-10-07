// Example for a trusted email gateway AFTER verifying the provider signature.
// Usage: node --env-file=.env sign-leave-email.mjs normalized-request.json
// Sends a normalized leave request to Supabase, never prints credentials.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const body = JSON.stringify({
  message_id: input.message_id,
  sender: input.sender,
  start_date: input.start_date || null,
  end_date: input.end_date || null,
  reason: input.reason,
});
const timestamp = String(Math.floor(Date.now() / 1000));
const secret = process.env.ATTENDANCE_EMAIL_WEBHOOK_SECRET;
const url = process.env.ATTENDANCE_EMAIL_WEBHOOK_URL;
if (!secret || !url || new URL(url).protocol !== "https:")
  throw new Error("Configure email webhook secret and HTTPS URL");
const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-attendance-timestamp": timestamp,
    "x-attendance-signature": signature,
  },
  body,
  redirect: "error",
  signal: AbortSignal.timeout(10000),
});
console.info(`Leave webhook status: ${response.status}`);
if (!response.ok) process.exitCode = 1;
