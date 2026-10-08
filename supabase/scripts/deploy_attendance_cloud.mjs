// Attendance-only deployment. Credentials are read from a private file and never printed.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";

const project = "jhhiwyvrhfhvvougkqmm";
const root = fileURLToPath(new URL("../../", import.meta.url));
const envPath = process.argv[2];
if (!envPath) throw new Error("Pass the private migration.env path.");
const values = Object.fromEntries(
  (await readFile(envPath, "utf8"))
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => /^\s*[A-Z_]+\s*=/.test(line))
    .map((line) => {
      const index = line.indexOf("=");
      return [
        line.slice(0, index).trim(),
        line
          .slice(index + 1)
          .trim()
          .replace(/^(['"])(.*)\1$/, "$2"),
      ];
    }),
);
const token = values.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is missing.");
async function api(route, init = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/${route}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Supabase attendance ${init.method || "GET"} ${route.split("?")[0]} failed (HTTP ${response.status}). No secrets printed.`,
    );
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const names = [
  "attendance-enroll-user",
  "attendance-device-event",
  "attendance-command-retry",
  "attendance-photo-access",
  "attendance-photo-cleanup",
  "attendance-leave-email",
];
const report = { project, functions: [], secretsConfigured: [], cron: false, checks: [] };
const reportDir = path.join(root, ".tmp", "supabase-migration-jhhiwyvrhfhvvougkqmm");
await mkdir(reportDir, { recursive: true });
const existing = await api("functions");
if (!Array.isArray(existing)) throw new Error("Unexpected function inventory; deployment stopped.");
console.log(`Token access verified for attendance deployment to ${project}.`);
const manifest = JSON.parse(
  await readFile(path.join(root, "supabase/dashboard-deploy/manifest.json"), "utf8"),
);
for (const name of names) {
  if (process.argv.includes("--configure-only")) {
    const deployed = existing.find((item) => item.slug === name);
    if (!deployed || deployed.status !== "ACTIVE" || deployed.verify_jwt !== false)
      throw new Error(`Deploy ${name} before running --configure-only.`);
    report.functions.push({
      name,
      status: deployed.status,
      version: deployed.version,
      verifyJwt: deployed.verify_jwt,
    });
    continue;
  }
  const source = await readFile(path.join(root, "supabase/dashboard-deploy", `${name}.ts`), "utf8");
  if (createHash("sha256").update(source).digest("hex") !== manifest[name]?.sha256)
    throw new Error(`Regenerate Dashboard files before deploying ${name}.`);
  const form = new FormData();
  form.append("metadata", JSON.stringify({ entrypoint_path: "index.ts", name, verify_jwt: false }));
  form.append("file", new Blob([source], { type: "application/typescript" }), "index.ts");
  const result = await api(`functions/deploy?slug=${encodeURIComponent(name)}`, {
    method: "POST",
    body: form,
  });
  if (result.slug !== name || result.verify_jwt !== false || result.status !== "ACTIVE")
    throw new Error(`Deployment metadata mismatch for ${name}.`);
  report.functions.push({
    name,
    status: result.status,
    version: result.version,
    verifyJwt: result.verify_jwt,
  });
  await writeFile(
    path.join(reportDir, "attendance-deployment-result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(`Deployed ${name} (version ${result.version}).`);
}

// Preserve any preexisting secret; generating a new value could break an existing integration.
const remoteSecrets = await api("secrets");
const configured = new Set(remoteSecrets.map((secret) => secret.name));
const secretPath = path.join(reportDir, "attendance-secrets.private.json");
let privateSecrets;
try {
  privateSecrets = JSON.parse(await readFile(secretPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  privateSecrets = {};
}
const desired = { ATTENDANCE_DEVICE_ID: "AYUE22065256", ATTENDANCE_PUBLISH_MODE: "mqtt" };
for (const name of [
  "ATTENDANCE_DEVICE_WEBHOOK_SECRET",
  "ATTENDANCE_CRON_SECRET",
  "ATTENDANCE_EMAIL_WEBHOOK_SECRET",
]) {
  if (!configured.has(name)) privateSecrets[name] ||= randomBytes(32).toString("hex");
  if (privateSecrets[name] && !configured.has(name)) desired[name] = privateSecrets[name];
}
await writeFile(secretPath, JSON.stringify(privateSecrets, null, 2), { mode: 0o600 });
const pending = Object.entries(desired)
  .filter(([name]) => !configured.has(name))
  .map(([name, value]) => ({ name, value }));
if (pending.length)
  await api("secrets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pending),
  });
report.secretsConfigured = [...configured, ...pending.map((secret) => secret.name)].filter((name) =>
  name.startsWith("ATTENDANCE_"),
);
console.log(
  "Attendance-only baseline secrets configured; MQTT credentials and protocol were not guessed.",
);

// Configure exactly the two attendance schedules with a matching Vault secret.
if (privateSecrets.ATTENDANCE_CRON_SECRET) {
  const cleanupProbe = await fetch(
    `https://${project}.supabase.co/functions/v1/attendance-photo-cleanup`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-attendance-secret": privateSecrets.ATTENDANCE_CRON_SECRET,
      },
      body: "{}",
      signal: AbortSignal.timeout(30000),
    },
  );
  await cleanupProbe.body?.cancel();
  if (!cleanupProbe.ok)
    throw new Error(
      `Cron secret verification failed (${cleanupProbe.status}); Vault and schedules were left unchanged.`,
    );
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  const vaultSql = `DO $attendance$ DECLARE sid uuid; BEGIN
    SELECT id INTO sid FROM vault.secrets WHERE name='attendance_project_url' LIMIT 1;
    IF sid IS NULL THEN PERFORM vault.create_secret('https://${project}.supabase.co','attendance_project_url');
    ELSE PERFORM vault.update_secret(sid,'https://${project}.supabase.co'); END IF;
    SELECT id INTO sid FROM vault.secrets WHERE name='attendance_cron_secret' LIMIT 1;
    IF sid IS NULL THEN PERFORM vault.create_secret(${quote(privateSecrets.ATTENDANCE_CRON_SECRET)},'attendance_cron_secret');
    ELSE PERFORM vault.update_secret(sid,${quote(privateSecrets.ATTENDANCE_CRON_SECRET)}); END IF;
    END $attendance$;`;
  const schedules = await readFile(
    path.join(root, "supabase/scripts/setup_attendance_cron.sql"),
    "utf8",
  );
  await api("database/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: `BEGIN;\n${vaultSql}\n${schedules}\nCOMMIT;` }),
  });
  report.cron = true;
  console.log("Scheduled attendance photo cleanup and eligible enrollment retries.");
}
for (const name of names) {
  const response = await fetch(`https://${project}.supabase.co/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(20000),
  });
  await response.body?.cancel();
  report.checks.push({ name, unauthenticatedStatus: response.status });
  if (response.status !== 401)
    throw new Error(
      `Unauthenticated request to ${name} returned ${response.status}; investigate before live use.`,
    );
}
await writeFile(
  path.join(reportDir, "attendance-deployment-result.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  "All six deployed attendance functions reject unauthenticated requests. Live device connectivity remains unverified.",
);
