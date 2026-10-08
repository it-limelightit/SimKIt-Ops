// Read-only audit: never creates employees, changes settings, publishes MQTT, or deletes photos.
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const project = "jhhiwyvrhfhvvougkqmm";
const url = `https://${project}.supabase.co`;
const file = process.argv[2];
if (!file) throw new Error("Pass the path to your private migration.env file.");
const values = Object.fromEntries(
  (await readFile(file, "utf8"))
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/u.test(line))
    .map((line) => {
      const position = line.indexOf("=");
      return [
        line.slice(0, position),
        line
          .slice(position + 1)
          .trim()
          .replace(/^(['"])(.*)\1$/, "$2"),
      ];
    }),
);
const key = values.DESTINATION_SUPABASE_SECRET_KEY;
if (!key) throw new Error("DESTINATION_SUPABASE_SECRET_KEY is missing in the private file.");
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
});
const required = [
  "attendance_devices",
  "attendance_employees",
  "attendance_settings",
  "attendance_scan_events",
  "attendance_daily_records",
  "attendance_photos",
  "attendance_device_commands",
  "attendance_leave_requests",
  "attendance_device_health",
  "attendance_audit_logs",
];
const report = {
  project,
  tables: [],
  bucketPrivate: false,
  functions: [],
  managementTokenConfigured: !!values.SUPABASE_ACCESS_TOKEN,
};
for (const table of required) {
  const { error, count } = await client.from(table).select("*", { count: "exact", head: true });
  report.tables.push({ table, accessible: !error, rows: count, errorCode: error?.code });
}
const { data: buckets, error: bucketError } = await client.storage.listBuckets();
if (bucketError) throw new Error("Could not inspect Storage buckets.");
report.bucketPrivate = buckets.some(
  (bucket) => bucket.id === "attendance-photos" && bucket.public === false,
);
for (const name of [
  "attendance-enroll-user",
  "attendance-device-event",
  "attendance-command-retry",
  "attendance-photo-access",
  "attendance-photo-cleanup",
  "attendance-leave-email",
]) {
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: "OPTIONS",
    signal: AbortSignal.timeout(15000),
  });
  await response.body?.cancel();
  report.functions.push({ name, preflightStatus: response.status, available: response.ok });
}
console.log(JSON.stringify(report, null, 2));
if (!report.bucketPrivate || report.tables.some((table) => !table.accessible)) process.exitCode = 1;
