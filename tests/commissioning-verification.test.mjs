import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { evaluateMedia, evaluateCertificate } from '../integrations/commissioning-verifier/rules.mjs';
import { findLogoMatch } from '../integrations/commissioning-verifier/logo-match.mjs';
import { listFolder, manifest, discoverEvidence, resolveCompanyRoot } from '../integrations/commissioning-verifier/worker.mjs';

const media = durations => [
  ...Array.from({ length: 4 }, (_, i) => ({ kind: 'photo', sha256: `p${i}`, valid: true })),
  ...durations.map((duration_seconds, i) => ({ kind: 'video', sha256: `v${i}`, valid: true, duration_seconds })),
];
test('four clips averaging exactly two minutes pass even with individually short clips', () => {
  assert.equal(evaluateMedia(media([60, 120, 120, 180])).passed, true);
  assert.equal(evaluateMedia(media([119.9, 119.9, 119.9, 119.9])).passed, false);
  assert.equal(evaluateMedia(media([120, 120, 120, 120, 120, 120])).passed, true);
});
test('copies, missing duration and unreadable files cannot inflate evidence counts', () => {
  const files = media([120, 120, 120, 120]);
  files[0].sha256 = files[1].sha256;
  assert.equal(evaluateMedia(files).photo_count, 3);
  assert.equal(evaluateMedia(media([120, 120, 120, null])).passed, false);
  const corrupt = media([120, 120, 120, 120]); corrupt[4].valid = false;
  assert.equal(evaluateMedia(corrupt).passed, false);
});

test('logo matching locates original RGB pixels and rejects a featureless reference',()=>{
  const pixels=new Uint8Array(6*6*3).fill(255);
  const target=new Uint8Array([255,0,0,0,0,255,0,255,0,0,0,0]);
  for(let y=0;y<2;y++)for(let x=0;x<2;x++)for(let c=0;c<3;c++)pixels[((y+1)*6+x+3)*3+c]=target[(y*2+x)*3+c];
  const match=findLogoMatch({width:6,height:6,pixels},{width:2,height:2,pixels:target});
  assert.equal(match.x,3);assert.equal(match.y,1);assert.ok(match.score>0.99999);
  assert.equal(findLogoMatch({width:6,height:6,pixels},{width:2,height:2,pixels:new Uint8Array(12).fill(255)}),null);
});
const policy = { approved_for_automation: true, signature_policy: 'name_and_designation_only',
  logo_sha256: 'a'.repeat(64), required_phrases: ['successfully installed and commissioned'],
  signatory_names: ['Jane Shah'], designations: ['Director'], max_age_days: 30 };
const letter = 'For Acme Pvt Ltd. Successfully installed and commissioned. Jane Shah, Director. Date 16/11/2026';
test('certificate requires trusted policy, correct company, entered authority, logo and valid date', () => {
  const check = (text = letter, p = policy, logo = true) => evaluateCertificate(text, 'Acme Pvt Ltd', p, logo, '2026-11-16T12:00:00Z');
  assert.equal(check().passed, true);
  assert.equal(check(letter.replace('Acme', 'Another')).passed, false);
  assert.equal(check(letter.replace('Jane Shah', 'Name:')).passed, false);
  assert.equal(check(letter, policy, false).passed, false);
  assert.equal(check(letter, { ...policy, signature_policy: 'signature_required' }).passed, false);
  assert.equal(check(letter.replace('16/11/2026', '31/11/2026')).passed, false);
  assert.equal(check(letter.replace('16/11/2026', '15/10/2026')).passed, false);
  assert.equal(check(letter, {}).needs_review, true);
  assert.equal(evaluateCertificate(letter,'Acme Pvt Ltd',policy,true,'2026-11-15T19:00:00Z').passed,true,'Certificate dates use the India calendar day');
});
test('Drive listing follows pagination, refuses incomplete searches and preserves shortcut metadata', async () => {
  const tokens = [];
  const files = await listFolder('registered-folder', async (_, params) => {
    tokens.push(params.pageToken);
    return { json: async () => params.pageToken ? { files: [{ id: 'b', mimeType: 'image/png' }] }
      : { files: [{ id: 'a', mimeType: 'image/png' }], nextPageToken: 'second' } };
  });
  assert.equal(files.length, 2); assert.deepEqual(tokens, [undefined, 'second']);
  await assert.rejects(listFolder('folder', async () => ({ json: async () => ({ incompleteSearch: true }) })), /incomplete/);
  assert.equal((await listFolder('folder', async () => ({ json: async () => ({ files: [{ mimeType: 'application/vnd.google-apps.shortcut' }] }) })))[0].mimeType,'application/vnd.google-apps.shortcut');
  assert.deepEqual(manifest({ photo: [{ id: 'b' }, { id: 'a' }] }), manifest({ photo: [{ id: 'a' }, { id: 'b' }] }));
});

test('company-name lookup is scoped to the approved parent and refuses duplicate company folders', async () => {
  const folder = (id, name) => ({ id, name, mimeType: 'application/vnd.google-apps.folder' });
  const read = files => async () => ({ json: async () => ({ files }) });
  assert.equal(await resolveCompanyRoot('Acme Pvt Ltd', {}, 'parent', read([folder('acme', 'ACME Pvt. Ltd.')])), 'acme');
  await assert.rejects(resolveCompanyRoot('Acme Pvt Ltd', {}, 'parent', read([folder('a', 'Acme Pvt Ltd'), folder('b', 'Acme Pvt Ltd')])), /ambiguous/);
  await assert.rejects(resolveCompanyRoot('Acme Pvt Ltd', {}, 'parent', read([folder('other', 'Other Company')])), /missing/);
});

test('finds mixed media and a commissioning letter in either the company root or a loosely named letter folder', async () => {
  const folder = (id, name) => ({ id, name, mimeType: 'application/vnd.google-apps.folder' });
  const photo = { id: 'photo', name: 'site.jpg', mimeType: 'image/jpeg' };
  const video = { id: 'video', name: 'clip.mp4', mimeType: 'video/mp4' };
  const letterFile = { id: 'certificate', name: 'signed-scan.pdf', mimeType: 'application/pdf' };
  const tree = { company: [folder('media', 'Media'), letterFile], media: [photo, video] };
  const read = async (_, params) => ({ json: async () => ({ files: tree[params.q.match(/^'([^']+)'/)[1]] ?? [] }) });
  let found = await discoverEvidence('company', read);
  assert.deepEqual(found.photo, [photo]); assert.deepEqual(found.video, [video]); assert.deepEqual(found.certificate, [letterFile]);
  tree.company = [folder('media', 'Photos and Videos'), folder('letters', 'Commisoned Latter')];
  tree.letters = [letterFile];
  found = await discoverEvidence('company', read);
  assert.deepEqual(found.photo, [photo]); assert.deepEqual(found.certificate, [letterFile]);
  // A named letter scan in the media folder must never count as a site photo.
  tree.media.push({ id: 'letter-scan', name: 'Commissioning Letter.jpg', mimeType: 'image/jpeg' });
  found = await discoverEvidence('company', read);
  assert.equal(found.photo.length, 1); assert.equal(found.certificate.length, 2);
});

test('unrelated parent shortcuts are ignored; a matching company shortcut resolves to its target',async()=>{
  const shortcut=(id,name,targetId)=>({id,name,mimeType:'application/vnd.google-apps.shortcut',shortcutDetails:{targetId,targetMimeType:'application/vnd.google-apps.folder'}});
  const read=async(path)=>({json:async()=>path==='files'
    ? {files:[shortcut('unrelated','Other company','inaccessible'),shortcut('company-link','Acme Pvt Ltd','company-target')]}
    : path==='files/company-target' ? {id:'company-target',name:'Acme Pvt Ltd',mimeType:'application/vnd.google-apps.folder'}
    : assert.fail(`Unrelated shortcut was accessed: ${path}`)});
  assert.equal(await resolveCompanyRoot('Acme Pvt Ltd',{},'parent',read),'company-target');
});

test('media shortcuts resolve, carry resource keys, count targets once and preserve link provenance',async()=>{
  const folder=(id,name)=>({id,name,mimeType:'application/vnd.google-apps.folder'});
  const link=(id,name,targetId,type,resourceKey)=>({id,name,mimeType:'application/vnd.google-apps.shortcut',shortcutDetails:{targetId,targetMimeType:type,...(resourceKey?{targetResourceKey:resourceKey}:{})}});
  const photo={id:'photo-target',name:'site.jpg',mimeType:'image/jpeg',md5Checksum:'photo-hash'};
  const video={id:'video-target',name:'clip.mp4',mimeType:'video/mp4',md5Checksum:'video-hash',videoMediaMetadata:{durationMillis:'120000'}};
  const letter={id:'letter-target',name:'Signed.pdf',mimeType:'application/pdf'};
  const tree={company:[link('media-link','Media','actual-media','application/vnd.google-apps.folder','resource-key'),link('letter-link','Commissioning Letter','letter-target','application/pdf')],
    'actual-media':[photo,link('photo-copy','Photo duplicate','photo-target','image/jpeg'),link('video-link','Demo','video-target','video/mp4')]};
  const targets={'actual-media':folder('actual-media','Media'),'photo-target':photo,'video-target':video,'letter-target':letter};
  const keys=[];
  const read=async(path,params,key)=>{
    if(path==='files')return {json:async()=>({files:tree[params.q.match(/^'([^']+)'/)[1]]??[]})};
    keys.push(key);return {json:async()=>targets[path.slice(6)]};
  };
  const groups=await discoverEvidence('company',read);
  assert.equal(groups.photo.length,1);assert.equal(groups.video.length,1);assert.equal(groups.certificate.length,1);
  assert.equal(groups.shortcuts.length,4);assert.ok(keys.includes('actual-media/resource-key'));
  assert.equal(manifest(groups).shortcuts.find(link=>link.id==='media-link').shortcutTarget,'actual-media');
});

test('circular folder and file shortcuts fail with an actionable loop error',async()=>{
  const link=(id,targetId)=>({id,name:'Media',mimeType:'application/vnd.google-apps.shortcut',shortcutDetails:{targetId}});
  const read=async(path)=>({json:async()=>path==='files'?{files:[link('loop','company')]}:{id:'company',name:'Company',mimeType:'application/vnd.google-apps.folder'}});
  await assert.rejects(discoverEvidence('company',read),/shortcut folder loop/);
  const chained=async(path)=>({json:async()=>path==='files'?{files:[link('link-a','link-b')]}:link(path.slice(6),path.endsWith('link-b')?'link-a':'link-b')});
  await assert.rejects(discoverEvidence('company',chained),/shortcut loop/);
});

const db = new PGlite();
const user = '00000000-0000-4000-8000-000000000001';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
let historicalSnapshot;
const submit = async (site, stamp) => db.query(`INSERT INTO commissioning_approval_requests(site_id,requested_by,drive_link,requested_at)
  VALUES($1,$2,'https://drive.google.com/drive/folders/root',$3)
  ON CONFLICT(site_id) DO UPDATE SET requested_at=excluded.requested_at,status='pending' RETURNING id`, [id(site), user, stamp]);
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${user}');
    CREATE TABLE profiles(id uuid PRIMARY KEY,is_active boolean DEFAULT true,email text,name text,created_at timestamptz DEFAULT now());
    INSERT INTO profiles(id,email,name) VALUES('${user}','worker@example.test','Associate');
    CREATE TABLE sites(id uuid PRIMARY KEY,name text,company_name text,consultant_stage text,task_notes text,assigned_worker_id uuid);
    CREATE TABLE commissioning(site_id uuid PRIMARY KEY REFERENCES sites(id),worker_id uuid,data jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now());
    CREATE TABLE installation(LIKE commissioning INCLUDING ALL);
    CREATE TABLE field_manager_commissionings(site_id uuid,active boolean);
    CREATE TABLE field_existing_completions(site_id uuid,phase text);
    CREATE TABLE field_earnings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid,phase text,
      associate_id uuid,company_name text,associate_name text,associate_joined timestamptz,
      completed_at timestamptz,earning_date date,amount numeric,eligible boolean DEFAULT true,UNIQUE(site_id,phase));
    CREATE TABLE field_payment_items(earning_id uuid);
    CREATE TABLE field_work_rates(associate_id uuid,assessment numeric,installation numeric,commissioning numeric);
    INSERT INTO field_work_rates VALUES('${user}',0,0,250);
    CREATE FUNCTION public.is_staff(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION public.can_access_site(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid() IS NOT NULL $$;
    CREATE FUNCTION public.assert_manager_module_access(text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
    CREATE FUNCTION public.has_role(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION public.field_ops_associate(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 IS NOT NULL $$;
    CREATE FUNCTION public.field_ops_site_metadata(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif($1,''),'{}')::jsonb $$;
    CREATE FUNCTION public.field_ops_worker_ids(s sites) RETURNS uuid[] LANGUAGE sql AS $$ SELECT ARRAY[s.assigned_worker_id] $$;
    CREATE FUNCTION public.field_ops_site_active(s sites) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    INSERT INTO sites SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Factory','Acme Pvt Ltd',NULL,NULL,'${user}' FROM generate_series(10,25) n;
    INSERT INTO commissioning SELECT id,'${user}','{"coordination_done":true,"visit_done":true,"connection_done":true,"configure_done":true,"testing_done":true,"screenshots_uploaded":true,"certificate_sent":true,"final_mom_uploaded":true}',now() FROM sites;
    INSERT INTO installation SELECT id,'${user}','{"installation_phase_submitted":true,"installation_phase_submitted_at":"2026-10-01"}',now() FROM sites;`);
  const original = readFileSync(new URL('../supabase/migrations/20260910100000_commissioning_approval.sql', import.meta.url), 'utf8');
  // Real legacy approval table, RPCs and bypass guard, against a minimal existing application schema.
  await db.exec(original);
  const earnings = readFileSync(new URL('../supabase/migrations/20261005140000_field_operations_assessment_commissioning_pay.sql', import.meta.url), 'utf8');
  const readiness = readFileSync(new URL('../supabase/migrations/20261005120000_field_operations_attendance_earnings.sql', import.meta.url), 'utf8');
  await db.exec(readiness.match(/CREATE FUNCTION public\.field_ops_phase_ready[\s\S]*?END \$\$;/)[0]);
  await db.exec(earnings.match(/CREATE OR REPLACE FUNCTION public\.field_ops_capture_earning[\s\S]*?END \$\$;/)[0]);
  await db.exec('CREATE TRIGGER field_ops_commissioning_earning AFTER INSERT OR UPDATE ON commissioning FOR EACH ROW EXECUTE FUNCTION field_ops_capture_earning()');
  await db.exec(readFileSync(new URL('../supabase/migrations/20261116120000_commissioning_verification.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261116123000_commissioning_drive_ui_check.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261117120000_automatic_commissioning_flow.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261117123000_automatic_commissioning_decision_guard.sql', import.meta.url), 'utf8'));
});
after(() => db.close());

test('migration is disabled; activation snapshots history without changing business rows', async () => {
  await submit(10, '2026-11-01T00:00:00Z');
  await db.query(`UPDATE commissioning SET data=data||'{"commissioning_phase_submitted":true,"commissioning_phase_submitted_at":"2026-10-01"}' WHERE site_id=$1`, [id(11)]).catch(async () => {
    // The real legacy trigger requires approval before the completion marker can be set.
    await submit(11, '2026-11-01T00:00:00Z');
    await db.query("UPDATE commissioning_approval_requests SET status='approved' WHERE site_id=$1", [id(11)]);
    await db.query(`UPDATE commissioning SET data=data||'{"commissioning_phase_submitted":true,"commissioning_phase_submitted_at":"2026-10-01"}' WHERE site_id=$1`, [id(11)]);
  });
  await db.query("UPDATE sites SET task_notes=$2 WHERE id=$1", [id(12), JSON.stringify({ status: 'Submitted', submitted_at: '2026-10-02' })]);
  const before = await scalar("SELECT jsonb_agg(to_jsonb(c) ORDER BY site_id) FROM commissioning c");
  assert.equal(await scalar('SELECT count(*) FROM commissioning_verification_jobs'), 0);
  await db.query('SELECT activate_commissioning_verification()');
  assert.deepEqual(await scalar('SELECT jsonb_agg(to_jsonb(c) ORDER BY site_id) FROM commissioning c'), before);
  assert.equal(await scalar('SELECT count(*) FROM commissioning_verification_exclusions'), 3);
  await submit(10, new Date().toISOString());
  await submit(12, new Date().toISOString());
  assert.equal(await scalar('SELECT count(*) FROM commissioning_verification_jobs'), 0);
  historicalSnapshot = await scalar(`SELECT jsonb_agg(jsonb_build_object('site',to_jsonb(s),'commissioning',to_jsonb(c)) ORDER BY s.id)
    FROM sites s JOIN commissioning c ON c.site_id=s.id WHERE s.id IN ($1,$2,$3)`, [id(10),id(11),id(12)]);
});

test('new requests queue; stale worker results cannot approve a resubmission', async () => {
  await submit(13, new Date().toISOString());
  const payload = await scalar('SELECT claim_commissioning_verification()');
  assert.equal(payload.job.site_id, id(13));
  assert.equal(payload.drive_link, 'https://drive.google.com/drive/folders/root');
  await submit(13, new Date(Date.now() + 1000).toISOString());
  await assert.rejects(db.query('SELECT finish_commissioning_verification($1,$2,$3)',
    [payload.job.id, payload.job.lease_token, { status: 'passed' }]), /lease/);
  assert.equal(await scalar('SELECT status FROM commissioning_approval_requests WHERE site_id=$1', [id(13)]), 'pending');
  const current = await scalar('SELECT claim_commissioning_verification()');
  await db.query('SELECT finish_commissioning_verification($1,$2,$3)', [current.job.id, current.job.lease_token,
    { status: 'needs_review', messages: ['Configure Drive access.'] }]);
});

test('automatic finalizer requires policy and media, preserves other dates, is idempotent and service-only', async () => {
  await submit(14, new Date().toISOString());
  await db.query(`INSERT INTO commissioning_drive_folders(site_id,root_folder_id,certificate_policy)
    VALUES($1,'root',$2)`, [id(14), policy]);
  const payload = await scalar('SELECT claim_commissioning_verification()');
  const report = { status: 'passed', rule_version: 'media-average-v1', folders: payload.folders,
    photo_count: 4, video_count: 4, video_average_seconds: 120, certificate_passed: true, manifest_rechecked: true };
  await assert.rejects(db.query('SELECT finish_commissioning_verification($1,$2,$3)', [payload.job.id, payload.job.lease_token, { ...report, video_average_seconds: 119.99 }]), /mismatch/);
  assert.equal(await scalar('SELECT finish_commissioning_verification($1,$2,$3)', [payload.job.id, payload.job.lease_token, report]), 'passed');
  assert.equal(await scalar('SELECT status FROM commissioning_approval_requests WHERE site_id=$1', [id(14)]), 'pending');
  // Explicitly enable approvals and resubmit; old shadow result cannot finalize by itself.
  await db.exec('UPDATE commissioning_verification_settings SET auto_approve=true');
  await submit(14, new Date(Date.now() + 2000).toISOString());
  const next = await scalar('SELECT claim_commissioning_verification()');
  const installBefore = await scalar('SELECT to_jsonb(i) FROM installation i WHERE site_id=$1', [id(14)]);
  assert.equal(await scalar('SELECT finish_commissioning_verification($1,$2,$3)', [next.job.id, next.job.lease_token, report]), 'approved');
  const approvedAt = await scalar('SELECT reviewed_at FROM commissioning_approval_requests WHERE site_id=$1', [id(14)]);
  assert.equal(await scalar('SELECT finish_commissioning_verification($1,$2,$3)', [next.job.id, next.job.lease_token, report]), 'approved');
  assert.deepEqual(await scalar('SELECT reviewed_at FROM commissioning_approval_requests WHERE site_id=$1', [id(14)]), approvedAt);
  assert.deepEqual(await scalar('SELECT to_jsonb(i) FROM installation i WHERE site_id=$1', [id(14)]), installBefore);
  assert.equal(await scalar("SELECT data->>'commissioning_phase_submitted' FROM commissioning WHERE site_id=$1", [id(14)]), 'true');
  assert.equal(await scalar('SELECT count(*) FROM field_earnings WHERE site_id=$1', [id(14)]), 1);
  assert.equal(await scalar('SELECT amount FROM field_earnings WHERE site_id=$1', [id(14)]), '250');
  assert.equal(await scalar("SELECT has_function_privilege('authenticated','finish_commissioning_verification(uuid,uuid,jsonb)','EXECUTE')"), false);
  assert.equal(await scalar("SELECT has_table_privilege('authenticated','commissioning_drive_folders','SELECT')"), false);
});

test('metadata replacement finds balanced end without consuming surrounding notes', async () => {
  const text = 'before [METADATA:{"note":"braces } and ]","nested":{"a":1}}] after';
  const start = text.indexOf('[METADATA:') + 1;
  const end = await scalar('SELECT commissioning_metadata_end($1,$2)', [text, start]);
  assert.equal(text.slice(end), ' after');
});

test('completion during a running job blocks finalization and excluded records remain unchanged', async () => {
  await submit(15, new Date().toISOString());
  const payload = await scalar('SELECT claim_commissioning_verification()');
  await db.query('UPDATE sites SET task_notes=$2 WHERE id=$1', [id(15), JSON.stringify({ status: 'Submitted', submitted_at: '2026-11-16' })]);
  assert.equal(await scalar('SELECT finish_commissioning_verification($1,$2,$3)', [payload.job.id, payload.job.lease_token, { status: 'passed' }]), 'superseded');
  assert.equal(await scalar('SELECT status FROM commissioning_approval_requests WHERE site_id=$1', [id(15)]), 'pending');
  assert.deepEqual(await scalar(`SELECT jsonb_agg(jsonb_build_object('site',to_jsonb(s),'commissioning',to_jsonb(c)) ORDER BY s.id)
    FROM sites s JOIN commissioning c ON c.site_id=s.id WHERE s.id IN ($1,$2,$3)`, [id(10),id(11),id(12)]), historicalSnapshot);
});

test('Drive UI rate limit is service-only and never mutates commissioning',async()=>{
  const before=await scalar('SELECT to_jsonb(c) FROM commissioning c WHERE site_id=$1',[id(16)]);
  assert.equal(await scalar('SELECT reserve_commissioning_drive_check($1,$2)',[id(16),user]),true);
  assert.equal(await scalar('SELECT reserve_commissioning_drive_check($1,$2)',[id(16),user]),false);
  assert.deepEqual(await scalar('SELECT to_jsonb(c) FROM commissioning c WHERE site_id=$1',[id(16)]),before);
  assert.equal(await scalar("SELECT has_function_privilege('authenticated','reserve_commissioning_drive_check(uuid,uuid)','EXECUTE')"),false);
});

test('single automatic action queues full checks and commissions once only after the letter passes',async()=>{
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
  await db.query('SELECT commissioning_verification_heartbeat()');
  await db.query('INSERT INTO commissioning_drive_folders(site_id,root_folder_id,certificate_policy) VALUES($1,$2,$3)',[id(17),'root',policy]);
  const original=await scalar('SELECT data FROM commissioning WHERE site_id=$1',[id(17)]);
  const started=await scalar('SELECT start_automatic_commissioning($1,$2)',[id(17),'https://drive.google.com/drive/folders/root']);
  assert.equal(started.status,'queued');
  const repeated=await scalar('SELECT start_automatic_commissioning($1,$2)',[id(17),'https://drive.google.com/drive/folders/root']);
  assert.equal(repeated.job_id,started.job_id,'Double clicks reuse one active attempt');
  assert.deepEqual(await scalar('SELECT data FROM commissioning WHERE site_id=$1',[id(17)]),original,'Starting verification is not completion');
  const job=await scalar('SELECT claim_commissioning_verification()');
  assert.equal(job.job.id,started.job_id);
  const report={status:'passed',rule_version:job.job.rule_version,folders:job.folders,photo_count:4,video_count:4,video_average_seconds:120,manifest_rechecked:true,certificate_passed:false};
  await assert.rejects(db.query('SELECT finish_commissioning_verification($1,$2,$3)',[job.job.id,job.job.lease_token,report]),/mismatch/);
  assert.equal(await scalar("SELECT coalesce(data->>'commissioning_phase_submitted','false') FROM commissioning WHERE site_id=$1",[id(17)]),'false');
  report.certificate_passed=true;
  assert.equal(await scalar('SELECT finish_commissioning_verification($1,$2,$3)',[job.job.id,job.job.lease_token,report]),'approved');
  assert.equal((await scalar('SELECT commissioning_verification_context($1)',[id(17)])).mode,'completed');
  assert.equal((await scalar('SELECT start_automatic_commissioning($1,$2)',[id(17),'https://drive.google.com/drive/folders/root'])).status,'approved');
  assert.equal(await scalar('SELECT count(*) FROM field_earnings WHERE site_id=$1',[id(17)]),1);
  assert.equal(await scalar('SELECT initiated_by FROM commissioning_verification_jobs WHERE id=$1',[job.job.id]),user);
});

test('historical dates, missing letter policy, offline worker and site permissions block automatic commissioning',async()=>{
  const old=await scalar('SELECT to_jsonb(r) FROM commissioning_approval_requests r WHERE site_id=$1',[id(10)]);
  assert.equal((await scalar('SELECT start_automatic_commissioning($1,$2)',[id(10),'https://drive.google.com/drive/folders/root'])).status,'historical');
  assert.deepEqual(await scalar('SELECT to_jsonb(r) FROM commissioning_approval_requests r WHERE site_id=$1',[id(10)]),old);
  assert.equal((await scalar('SELECT start_automatic_commissioning($1,$2)',[id(18),'https://drive.google.com/drive/folders/root'])).status,'setup_required');
  assert.equal(await scalar('SELECT count(*) FROM commissioning_approval_requests WHERE site_id=$1',[id(18)]),0);
  await db.query('INSERT INTO commissioning_drive_folders(site_id,root_folder_id,certificate_policy) VALUES($1,$2,$3)',[id(19),'root',policy]);
  await db.exec("UPDATE commissioning_verification_settings SET worker_last_seen_at=now()-interval '3 minutes'");
  const offline=await scalar('SELECT start_automatic_commissioning($1,$2)',[id(19),'https://drive.google.com/drive/folders/root']);
  assert.equal(offline.status,'setup_required');assert.match(offline.message,/offline/);
  assert.equal(await scalar('SELECT count(*) FROM commissioning_approval_requests WHERE site_id=$1',[id(19)]),0);
  assert.equal(await scalar("SELECT has_function_privilege('authenticated','commissioning_verification_heartbeat()','EXECUTE')"),false);
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(db.query('SELECT start_automatic_commissioning($1,$2)',[id(20),'https://drive.google.com/drive/folders/root']),/access required/);
});

test('manager decisions cannot bypass a pending automatic letter verification',async()=>{
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
  await db.query('SELECT commissioning_verification_heartbeat()');
  await db.query('INSERT INTO commissioning_drive_folders(site_id,root_folder_id,certificate_policy) VALUES($1,$2,$3)',[id(20),'root',policy]);
  const started=await scalar('SELECT start_automatic_commissioning($1,$2)',[id(20),'https://drive.google.com/drive/folders/root']);
  assert.equal(started.status,'queued');
  await db.query("SELECT set_config('request.jwt.claim.role','authenticated',false)");
  await assert.rejects(db.query("UPDATE commissioning_approval_requests SET status='approved' WHERE site_id=$1",[id(20)]),/completed server verification/);
  await assert.rejects(db.query("UPDATE commissioning_approval_requests SET status='rejected' WHERE site_id=$1",[id(20)]),/completed server verification/);
  assert.equal(await scalar('SELECT status FROM commissioning_approval_requests WHERE site_id=$1',[id(20)]),'pending');
  await db.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
  const claimed=await scalar('SELECT claim_commissioning_verification()');
  const report={status:'passed',rule_version:claimed.job.rule_version,folders:claimed.folders,photo_count:4,video_count:4,video_average_seconds:120,manifest_rechecked:true,certificate_passed:true};
  assert.equal(await scalar('SELECT finish_commissioning_verification($1,$2,$3)',[claimed.job.id,claimed.job.lease_token,report]),'approved');
});
