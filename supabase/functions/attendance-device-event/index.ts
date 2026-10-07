import {
  adminClient,
  body,
  checked,
  env,
  HttpError,
  json,
  secret,
  serve,
} from "../_shared/attendance.ts";
import { isoTimestamp, photoBytes, requiredText, uuid } from "../_shared/attendance-validation.ts";
serve(async (req) => {
  await secret(req, "ATTENDANCE_DEVICE_WEBHOOK_SECRET");
  const input = await body(req, 2900000);
  if (input.device_id !== env("ATTENDANCE_DEVICE_ID"))
    throw new HttpError(403, "Device not allowed");
  const allowed = env("ATTENDANCE_EVENT_TOPICS")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (typeof input.topic !== "string" || !allowed.includes(input.topic))
    throw new HttpError(403, "Topic not allowed");
  const admin = adminClient();
  if (input.kind === "heartbeat") {
    const observed = Date.parse(isoTimestamp(input.observed_at));
    if (Math.abs(Date.now() - observed) > 60000)
      throw new HttpError(400, "Fresh device heartbeat required");
    checked(await admin.rpc("attendance_heartbeat"));
    return json({ accepted: true });
  }
  if (input.kind === "enrollment_ack") {
    if (typeof input.success !== "boolean") throw new Error("Boolean success required");
    checked(
      await admin.rpc("attendance_ack_command", {
        _id: uuid(input.command_id),
        _enroll_id: requiredText(input.enroll_id, "enroll_id", 64),
        _success: input.success,
      }),
    );
    return json({ accepted: true });
  }
  if (input.kind !== "scan" || typeof input.recognized !== "boolean")
    throw new Error("A scan requires kind and boolean recognized");
  const event = checked(
    await admin.rpc("attendance_ingest_scan", {
      _event_id: requiredText(input.event_id, "event_id"),
      _enroll_id: requiredText(input.enroll_id, "enroll_id", 64),
      _scanned_at: isoTimestamp(input.scanned_at),
      _recognized: input.recognized,
    }),
  ) as { id: string; state: string; duplicate: boolean; expires_at: string };
  if (event.state !== "valid" || !input.photo_base64 || Date.parse(event.expires_at) <= Date.now())
    return json({ ...event, photo: "not_stored" });
  try {
    const photo = photoBytes(input.photo_base64, input.photo_mime);
    const path = `${event.id}.${photo.mime === "image/jpeg" ? "jpg" : "png"}`;
    const existing = checked(
      await admin.from("attendance_photos").select("*").eq("event_id", event.id).maybeSingle(),
    );
    if (existing?.status === "available") return json({ ...event, photo: "available" });
    if (existing?.status === "deleted") return json({ ...event, photo: "expired" });
    if (!existing)
      checked(
        await admin
          .from("attendance_photos")
          .insert({ event_id: event.id, storage_path: path, expires_at: event.expires_at }),
      );
    const target = existing?.storage_path || path;
    checked(
      await admin.storage
        .from("attendance-photos")
        .upload(target, photo.bytes, { contentType: photo.mime, upsert: true, cacheControl: "0" }),
    );
    if (Date.parse(event.expires_at) <= Date.now()) {
      checked(await admin.storage.from("attendance-photos").remove([target]));
      checked(
        await admin
          .from("attendance_photos")
          .update({ status: "deleted", deleted_at: new Date().toISOString() })
          .eq("event_id", event.id),
      );
      return json({ ...event, photo: "expired" });
    }
    const updated = checked(
      await admin
        .from("attendance_photos")
        .update({ status: "available" })
        .eq("event_id", event.id)
        .neq("status", "deleted")
        .select("event_id"),
    );
    if (!updated?.length) checked(await admin.storage.from("attendance-photos").remove([target]));
    return json({ ...event, photo: updated?.length ? "available" : "expired" });
  } catch {
    return json({ ...event, photo: "retry_needed" }, 503);
  }
});
