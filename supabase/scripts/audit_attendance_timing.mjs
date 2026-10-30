// Read-only live audit. Never changes attendance or publishes device commands.
import { readFile, writeFile } from "node:fs/promises";
const [file, day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())] = process.argv.slice(2);
if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Pass private environment file and optional YYYY-MM-DD date.");
const values = Object.fromEntries((await readFile(file, "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/)
  .filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
    const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")];
  }));
const key = values.DESTINATION_SUPABASE_SECRET_KEY;
if (!key) throw new Error("Private Supabase secret key is missing.");
async function rows(table, query) {
  const response = await fetch(`https://jhhiwyvrhfhvvougkqmm.supabase.co/rest/v1/${table}?${query}`, {
    headers: { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`${table}: HTTP ${response.status}`); }
  return response.json();
}
const start = `${day}T00:00:00+05:30`;
const end = new Date(Date.parse(start) + 86400000).toISOString();
const report = { checked_at: new Date().toISOString(), day,
  scans: await rows("attendance_scan_events", `select=*&or=(work_date.eq.${day},and(received_at.gte.${encodeURIComponent(start)},received_at.lt.${encodeURIComponent(end)}))&order=received_at.asc&limit=1000`),
  daily: await rows("attendance_daily_records", `select=*&work_date=eq.${day}&limit=1000`),
  device: await rows("attendance_devices", "select=*&id=eq.office"),
  health: await rows("attendance_device_health", `select=*&work_date=eq.${day}`),
};
const output = `.tmp/attendance-time-audit-${day}.json`;
await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ day, snapshot: output, scans: report.scans.length, daily: report.daily.length,
  review: report.scans.filter((scan) => scan.validation_state !== "valid").length,
  first_receipt: report.scans[0]?.received_at, last_receipt: report.scans.at(-1)?.received_at,
  clock_gap_detected: report.health[0]?.gap_detected,
  original_device_times_available: report.scans.filter((scan) => scan.device_time_raw).length,
  note: "Receipt-time clustering alone cannot prove an actual scan time. No records changed." }, null, 2));
