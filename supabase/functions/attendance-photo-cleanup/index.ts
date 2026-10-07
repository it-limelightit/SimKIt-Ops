import { adminClient, checked, json, secret, serve } from "../_shared/attendance.ts";
serve(async (req) => {
  await secret(req, "ATTENDANCE_CRON_SECRET");
  const admin = adminClient();
  const expired = checked(
    await admin
      .from("attendance_photos")
      .select("*")
      .lte("expires_at", new Date().toISOString())
      .neq("status", "deleted")
      .order("expires_at")
      .limit(100),
  );
  let deleted = 0;
  let failed = 0;
  for (const photo of expired || []) {
    try {
      checked(await admin.storage.from("attendance-photos").remove([photo.storage_path]));
      checked(
        await admin
          .from("attendance_photos")
          .update({ status: "deleted", deleted_at: new Date().toISOString() })
          .eq("event_id", photo.event_id),
      );
      deleted++;
    } catch {
      failed++;
    }
  }
  const files = checked(
    await admin.storage
      .from("attendance-photos")
      .list("", { limit: 100, sortBy: { column: "created_at", order: "asc" } }),
  );
  for (const file of files || []) {
    const meta = checked(
      await admin
        .from("attendance_photos")
        .select("expires_at,status")
        .eq("storage_path", file.name)
        .maybeSingle(),
    );
    if (
      (meta && Date.parse(meta.expires_at) <= Date.now()) ||
      (!meta && file.created_at && Date.parse(file.created_at) + 86400000 <= Date.now())
    ) {
      const result = await admin.storage.from("attendance-photos").remove([file.name]);
      if (result.error) failed++;
    }
  }
  return json({ deleted, failed }, failed ? 503 : 200);
});
