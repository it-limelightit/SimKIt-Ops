import { adminClient, checked, json, secret, serve } from "../_shared/attendance.ts";
import { photoExpiryTime } from "../_shared/attendance-validation.ts";
serve(async (req) => {
  await secret(req, "ATTENDANCE_CRON_SECRET");
  const admin = adminClient();
  const cutoff = Date.now();
  let deleted = 0;
  let failed = 0;
  // Consume all expired batches; a daily job must not stop after 100 photos.
  while (true) {
    const expired = checked(
      await admin
        .from("attendance_photos")
        .select("*")
        .lte("expires_at", new Date(cutoff).toISOString())
        .neq("status", "deleted")
        .order("expires_at")
        .limit(100),
    );
    if (!expired?.length) break;
    try {
      checked(
        await admin.storage
          .from("attendance-photos")
          .remove(expired.map((p: { storage_path: string }) => p.storage_path)),
      );
      checked(
        await admin
          .from("attendance_photos")
          .update({ status: "deleted", deleted_at: new Date().toISOString() })
          .in(
            "event_id",
            expired.map((p: { event_id: string }) => p.event_id),
          ),
      );
      deleted += expired.length;
    } catch {
      failed += expired.length;
      break;
    }
  }
  // Sweep orphaned files using the same next-day 02:00 IST deadline.
  // Offset adjustment prevents skipping files after earlier files are deleted.
  let offset = 0;
  while (true) {
    const files = checked(
      await admin.storage
        .from("attendance-photos")
        .list("", { limit: 100, offset, sortBy: { column: "created_at", order: "asc" } }),
    );
    if (!files?.length) break;
    const metadata = checked(
      await admin
        .from("attendance_photos")
        .select("storage_path,expires_at,status")
        .in(
          "storage_path",
          files.map((file: { name: string }) => file.name),
        ),
    );
    const byPath = new Map(
      (metadata || []).map((p: { storage_path: string; expires_at: string }) => [
        p.storage_path,
        p,
      ]),
    );
    const removable = files.filter((file) => {
      const meta = byPath.get(file.name) as { expires_at: string } | undefined;
      return meta
        ? Date.parse(meta.expires_at) <= cutoff
        : !!file.created_at && photoExpiryTime(file.created_at) <= cutoff;
    });
    let removed = 0;
    if (removable.length) {
      const result = await admin.storage
        .from("attendance-photos")
        .remove(removable.map((file: { name: string }) => file.name));
      if (result.error) failed += removable.length;
      else {
        removed = removable.length;
        deleted += removed;
      }
    }
    offset += files.length - removed;
    if (files.length < 100) break;
  }
  return json({ deleted, failed }, failed ? 503 : 200);
});
