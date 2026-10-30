// Deploy only attendance-device-event. The timing migration is already applied
// separately; this command never reapplies migrations or restarts VPS services.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const file = process.argv[2];
if (!file) throw new Error("Pass the private environment file containing SUPABASE_ACCESS_TOKEN.");
const line = (await readFile(file, "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/).find((line) => line.startsWith("SUPABASE_ACCESS_TOKEN="));
const token = line?.slice(line.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
if (!token) throw new Error("Supabase management token is missing.");
const project = "jhhiwyvrhfhvvougkqmm", slug = "attendance-device-event";
async function api(route, init = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/${route}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers }, signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Attendance deployment API returned HTTP ${response.status}.`); }
  return response.json();
}
const before = await api("functions");
const source = await readFile(`supabase/dashboard-deploy/${slug}.ts`, "utf8");
const manifest = JSON.parse(await readFile("supabase/dashboard-deploy/manifest.json", "utf8"));
if (createHash("sha256").update(source).digest("hex") !== manifest[slug].sha256) throw new Error("Attendance bundle checksum mismatch.");
const form = new FormData();
form.append("metadata", JSON.stringify({ entrypoint_path: "index.ts", name: slug, verify_jwt: false }));
form.append("file", new Blob([source], { type: "application/typescript" }), "index.ts");
const deployed = await api(`functions/deploy?slug=${slug}`, { method: "POST", body: form });
if (deployed.slug !== slug || deployed.status !== "ACTIVE" || deployed.verify_jwt !== false) throw new Error("Unexpected attendance deployment status.");
const after = await api("functions");
for (const previous of before.filter((entry) => entry.slug !== slug)) {
  const actual = after.find((entry) => entry.slug === previous.slug);
  if (!actual || actual.version !== previous.version || actual.status !== previous.status) throw new Error("An unrelated function changed; inspect deployment history.");
}
const unauthorized = await fetch(`https://${project}.supabase.co/functions/v1/${slug}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000),
});
await unauthorized.body?.cancel();
if (unauthorized.status !== 401) throw new Error("Attendance shared-secret authentication check failed.");
const report = { at: new Date().toISOString(), function: slug, version: deployed.version, status: deployed.status, otherFunctionsUnchanged: true, unauthorizedStatus: unauthorized.status };
await writeFile(".tmp/attendance-time-function-deployment.json", JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
