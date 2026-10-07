import { body, checked, HttpError, json, manager, serve } from "../_shared/attendance.ts";
import { uuid } from "../_shared/attendance-validation.ts";
serve(async (req) => {
  const { admin } = await manager(req);
  const input = await body(req);
  const photo = checked(
    await admin
      .from("attendance_photos")
      .select("*")
      .eq("event_id", uuid(input.event_id))
      .maybeSingle(),
  );
  if (!photo || photo.status !== "available") throw new HttpError(404, "Photo unavailable");
  const remaining = Math.floor((Date.parse(photo.expires_at) - Date.now()) / 1000);
  if (remaining < 1) throw new HttpError(410, "Photo expired after 24 hours");
  const seconds = Math.min(60, remaining - 1);
  if (seconds < 1) throw new HttpError(410, "Photo is expiring; access is closed");
  const url = checked(
    await admin.storage.from("attendance-photos").createSignedUrl(photo.storage_path, seconds),
  );
  if (!url?.signedUrl) throw new HttpError(503, "Photo access unavailable");
  const accessExpiresAt = Date.now() + seconds * 1000;
  // Signing latency must not extend access beyond the photo's retention window.
  if (accessExpiresAt > Date.parse(photo.expires_at))
    throw new HttpError(410, "Photo is expiring; access is closed");
  return json({
    url: url.signedUrl,
    expires_at: new Date(accessExpiresAt).toISOString(),
    photo_expires_at: photo.expires_at,
  });
});
