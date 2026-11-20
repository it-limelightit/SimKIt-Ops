// Deploy only the commissioning migrations and read-only Drive UI function.
// Never print tokens, SQL containing credentials, user data or private key material.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
const project = 'jhhiwyvrhfhvvougkqmm';
const inspectOnly = process.argv.includes('--inspect');
const paths = [process.argv.find(arg => arg.endsWith('.env')),
  '.tmp/supabase-expense-deploy.private.env', '.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/migration.env'].filter(Boolean);
const tokens = new Set();
for (const path of paths) {
  try {
    const content = await readFile(path, 'utf8');
    const line = content.replace(/^\uFEFF/, '').split(/\r?\n/).find(line => /^SUPABASE_ACCESS_TOKEN\s*=/.test(line));
    const value = line?.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value) tokens.add(value);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (process.env.SUPABASE_ACCESS_TOKEN) tokens.add(process.env.SUPABASE_ACCESS_TOKEN);
let token;
let beforeFunctions;
for (const candidate of tokens) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/functions`, {
    headers: { Authorization: `Bearer ${candidate}` }, signal: AbortSignal.timeout(20000) });
  if (response.ok) { token = candidate; beforeFunctions = await response.json(); break; }
  const status = response.status; await response.body?.cancel();
  console.log(`Saved deployment credential check: HTTP ${status}.`);
}
if (!token) throw new Error('No valid Supabase management credential. Update SUPABASE_ACCESS_TOKEN in the private deployment env file, then rerun. No remote changes made.');
async function api(route, init = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/${route}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) { const status = response.status; await response.body?.cancel(); throw new Error(`Supabase ${route.split('?')[0]} failed: HTTP ${status}.`); }
  const text = await response.text(); return text ? JSON.parse(text) : null;
}
const query = sql => api('database/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
const secretNames = (await api('secrets')).map(secret => secret.name);
const state = await query(`SELECT to_regclass('public.commissioning_verification_settings') IS NOT NULL AS migration_present,
  to_regclass('public.commissioning_drive_check_limits') IS NOT NULL AS ui_migration_present,
  to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS migration_history_present`);
const automation=state[0].migration_present?await query(`SELECT activated_at,auto_approve,
  to_jsonb(s)->>'worker_last_seen_at' AS worker_last_seen_at,
  coalesce((to_jsonb(s)->>'worker_last_seen_at')::timestamptz>now()-interval '2 minutes',false) AS worker_online,
  (SELECT count(*) FROM public.commissioning_drive_folders WHERE certificate_policy->>'approved_for_automation'='true') AS configured_letter_policies,
  (SELECT count(*) FROM public.commissioning_verification_exclusions) AS protected_sites
  FROM public.commissioning_verification_settings s WHERE singleton`):null;
console.log(JSON.stringify({ project, access: 'verified', state, driveCredentialConfigured: secretNames.includes('GOOGLE_SERVICE_ACCOUNT_JSON'),
  companiesRootConfigured: secretNames.includes('GOOGLE_DRIVE_COMPANIES_ROOT_ID'), functionPresent: beforeFunctions.some(f => f.slug === 'commissioning-drive-check'),automation }));
if (inspectOnly) process.exit(0);
const tables = ['sites','commissioning','commissioning_approval_requests','field_earnings','field_payment_items','field_payment_records'];
const snapshot = () => query(tables.map(table => `SELECT '${table}' AS table_name,count(*) AS row_count,
  md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM public.${table} t`).join(' UNION ALL '));
const before = await snapshot();
// This project currently uses Dashboard SQL rather than Supabase CLI migration history.
// Keep an isolated commissioning ledger; do not create an incomplete global CLI history.
const historyPresent = state[0].migration_history_present;
if (!historyPresent) await query(`CREATE TABLE IF NOT EXISTS public.commissioning_verification_migrations (
  version text PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public.commissioning_verification_migrations ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.commissioning_verification_migrations FROM PUBLIC,anon,authenticated;`);
const applied = [];
for (const [version, name] of [['20261116120000','commissioning_verification'], ['20261116123000','commissioning_drive_ui_check'],['20261117120000','automatic_commissioning_flow'],['20261117123000','automatic_commissioning_decision_guard'],['20261120120000','commissioning_video_total'],['20261120123000','commissioning_rejected_retry']]) {
  const file = `supabase/migrations/${version}_${name}.sql`;
  const historyTable = historyPresent ? 'supabase_migrations.schema_migrations' : 'public.commissioning_verification_migrations';
  const existing = await query(`SELECT version FROM ${historyTable} WHERE version='${version}'`);
  if (existing.length) { console.log(`Migration ${version} already recorded.`); continue; }
  const sql = await readFile(file, 'utf8');
  const escaped = value => `'${value.replaceAll("'", "''")}'`;
  const body = sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
  const ledger = historyPresent
    ? `INSERT INTO ${historyTable}(version,name,statements) VALUES('${version}',${escaped(name)},ARRAY[${escaped(sql)}]);`
    : `INSERT INTO ${historyTable}(version,name) VALUES('${version}',${escaped(name)});`;
  await query(`BEGIN;\n${body}\n${ledger}\nCOMMIT;`);
  applied.push(version);
  console.log(`Applied migration ${version}.`);
}
const after = await snapshot();
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Business snapshot changed during deployment. Inspect concurrent activity before continuing.');
const slug = 'commissioning-drive-check';
const bundled = await build({ entryPoints: ['supabase/functions/commissioning-drive-check/index.ts'], bundle: true, write: false,
  format: 'esm', platform: 'neutral', target: 'es2022', external: ['npm:*'], logLevel: 'silent' });
const form = new FormData();
form.append('metadata', JSON.stringify({ name: slug, entrypoint_path: 'index.ts', verify_jwt: false }));
form.append('file', new Blob([bundled.outputFiles[0].text], { type: 'application/typescript' }), 'index.ts');
const deployed = await api(`functions/deploy?slug=${slug}`, { method: 'POST', body: form });
if (deployed.slug !== slug || deployed.status !== 'ACTIVE') throw new Error('Function deployment did not become active.');
const afterFunctions = await api('functions');
const othersUnchanged = beforeFunctions.filter(f => f.slug !== slug).every(old => {
  const current = afterFunctions.find(f => f.slug === old.slug); return current?.version === old.version && current?.status === old.status;
});
if (!othersUnchanged) throw new Error('Another function changed during deployment; inspect concurrent activity.');
const unauthenticated = await fetch(`https://${project}.supabase.co/functions/v1/${slug}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) });
const unauthorizedStatus = unauthenticated.status; await unauthenticated.body?.cancel();
if (unauthorizedStatus !== 401) throw new Error(`Unauthenticated request returned HTTP ${unauthorizedStatus}; expected 401.`);
if (process.argv.includes('--activate')) {
  await query('BEGIN; SELECT public.activate_commissioning_verification(); UPDATE public.commissioning_verification_settings SET auto_approve=true WHERE singleton; COMMIT;');
  const activationAfter=await snapshot();
  if(JSON.stringify(before)!==JSON.stringify(activationAfter))throw new Error('Business snapshot changed during activation; inspect concurrent activity.');
}
const settings = await query('SELECT activated_at,auto_approve,worker_last_seen_at FROM public.commissioning_verification_settings WHERE singleton');
const report = { at: new Date().toISOString(), project, migrationsApplied: applied, function: slug,
  version: deployed.version, businessRowsUnchanged: true, otherFunctionsUnchanged: true, unauthorizedStatus,
  settings, remainingSecrets: ['GOOGLE_SERVICE_ACCOUNT_JSON','GOOGLE_DRIVE_COMPANIES_ROOT_ID'].filter(key => !secretNames.includes(key)) };
await mkdir('.tmp', { recursive: true });
await writeFile('.tmp/commissioning-supabase-deployment.json', JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
