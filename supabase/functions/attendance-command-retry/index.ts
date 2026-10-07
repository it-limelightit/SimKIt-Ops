import { adminClient, json, publishPending, secret, serve } from "../_shared/attendance.ts";
serve(async (req) => {
  await secret(req, "ATTENDANCE_CRON_SECRET");
  return json(await publishPending(adminClient()));
});
