import { createHash, createSign } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { RULE_VERSION, evaluateMedia, evaluateCertificate } from './rules.mjs';
import { findLogoMatch } from './logo-match.mjs';
import { listDriveFolder, findCompanyRoot, discoverCompanyEvidence } from '../../supabase/functions/_shared/commissioning-drive.mjs';

const run = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const folderId = value => typeof value === 'string' && /^[\w-]+$/.test(value);
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_ATTEMPT_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 60;
let credentials;
let googleToken;
let tokenUntil = 0;
const resourceKeys = new Map();

async function token() {
  if (googleToken && Date.now() < tokenUntil) return googleToken;
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const response=await fetch(new URL('/functions/v1/commissioning-drive-check',process.env.SUPABASE_URL),{method:'POST',headers:{
      apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({action:'worker_access_token'}),signal:AbortSignal.timeout(30000)});
    const result=await response.json();
    if(!response.ok || typeof result.access_token!=='string')throw new Error('Worker Google connection is unavailable');
    googleToken=result.access_token;tokenUntil=Date.now()+Math.min(result.expires_in||3300,3300)*1000;
    if(result.companies_root_id)process.env.GOOGLE_DRIVE_COMPANIES_ROOT_ID=result.companies_root_id;
    return googleToken;
  }
  credentials ??= JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  if (!credentials.client_email || !credentials.private_key) throw new Error('Service account credential is incomplete');
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const assertion = `${payload}.${createSign('RSA-SHA256').update(payload).sign(credentials.private_key, 'base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Google authentication failed (${response.status})`);
  const body = await response.json();
  googleToken = body.access_token; tokenUntil = Date.now() + 3300000;
  return googleToken;
}

async function drive(path, params = {}, resourceHeader) {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  if (resourceHeader && /^[\w-]+\/[\w-]+$/.test(resourceHeader)) resourceKeys.set(resourceHeader.split('/')[0],resourceHeader);
  const fileId = path.startsWith('files/') ? path.slice(6) : params.q?.match(/^'([\w-]+)' in parents/)?.[1];
  const resourceKey = resourceKeys.get(fileId);
  for (const [key, value] of Object.entries({ supportsAllDrives: 'true', ...params })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${await token()}`, ...(resourceKey ? {'X-Goog-Drive-Resource-Keys':resourceKey} : {}) }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Drive read failed (${response.status}); check folder sharing or retry later`);
  return response;
}

export async function listFolder(id, request = drive, maxEntries = MAX_FILES) {
  return listDriveFolder(id, request, maxEntries);
}

export async function resolveCompanyRoot(company, mapping, parentId, request = drive) {
  return findCompanyRoot(company, mapping, parentId, request);
}

export async function discoverEvidence(rootId, request = drive) {
  return discoverCompanyEvidence(rootId, request);
}

export const manifest = groups => Object.fromEntries(Object.entries(groups).map(([kind, files]) => [kind,
  files.map(file => ({ id: file.id, version: file.version, modifiedTime: file.modifiedTime,
    size: file.size, name: file.name, mimeType: file.mimeType, md5Checksum: file.md5Checksum, parents: file.parents,
    shortcutTarget: file.shortcutDetails?.targetId })).sort((a, b) => a.id.localeCompare(b.id))]));

async function download(file, destination, budget) {
  if (!folderId(file.id) || !Number.isFinite(Number(file.size)) || Number(file.size) <= 0 || Number(file.size) > MAX_FILE_BYTES)
    throw new Error('Evidence file is empty, unsupported, or exceeds the 100 MB limit');
  const response = await drive(`files/${file.id}`, { alt: 'media' });
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length; budget.bytes += chunk.length;
    if (length > MAX_FILE_BYTES || budget.bytes > MAX_ATTEMPT_BYTES) throw new Error('Evidence download size limit exceeded');
    chunks.push(chunk);
  }
  if (length !== Number(file.size)) throw new Error('File size changed during download');
  const bytes = Buffer.concat(chunks);
  await writeFile(destination, bytes);
  return hash(bytes);
}

async function command(executable, args) {
  return run(executable, args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
}
async function inspectMedia(file, kind, path, sha256) {
  try {
    if (kind === 'photo') {
      const signature = (await readFile(path)).subarray(0, 12);
      const correct = (file.mimeType === 'image/jpeg' && signature.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
        || (file.mimeType === 'image/png' && signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        || (file.mimeType === 'image/webp' && signature.subarray(0, 4).toString() === 'RIFF' && signature.subarray(8, 12).toString() === 'WEBP');
      if (!correct) return { valid: false };
    }
    const { stdout } = await command(process.env.FFPROBE_BIN || 'ffprobe', ['-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,width,height,duration,nb_frames', '-of', 'json', path]);
    const info = JSON.parse(stdout);
    const streams = info.streams?.filter(stream => stream.codec_type === 'video') ?? [];
    if (!streams.length || streams.some(stream => !(stream.width > 0 && stream.height > 0))) return { valid: false };
    if (kind === 'photo') {
      // Decode a frame too; a renamed non-image must not qualify as a photo.
      await command(process.env.MAGICK_BIN || 'magick', [path, '-resize', '32x32', 'null:']);
      return { kind, sha256, valid: /^image\/(jpeg|png|webp)$/.test(file.mimeType) };
    }
    // Decode the entire clip to reject truncated/corrupt video; no metadata-only pass.
    const decoded=await command(process.env.FFMPEG_BIN || 'ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', path, '-map', '0:v:0', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-']);
    // Container duration can include an audio-only tail. Measure the selected video stream.
    let seconds = Number(streams[0].duration);
    if(!Number.isFinite(seconds)||seconds<=0){
      const timings=[...decoded.stdout.matchAll(/^out_time_us=(\d+)\s*$/gm)];
      seconds=timings.length?Number(timings.at(-1)[1])/1000000:NaN;
    }
    return { kind, sha256, valid: true, duration_seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null };
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Install ffprobe, ffmpeg and ImageMagick before running the worker');
    return { valid: false };
  }
}

async function certificatePages(file, path, directory) {
  if (file.mimeType === 'application/pdf') {
    // Reject long PDFs before rendering to bound resource consumption.
    const { stdout } = await command(process.env.PDFINFO_BIN || 'pdfinfo', [path]);
    const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]);
    if (!(pages >= 1 && pages <= 5)) throw new Error('Certificate must have between 1 and 5 pages');
    await command(process.env.PDFTOPPM_BIN || 'pdftoppm', ['-png', '-r', '150', path, join(directory, 'page')]);
    return (await readdir(directory)).filter(name => /^page-\d+\.png$/.test(name)).sort().map(name => join(directory, name));
  }
  if (/^image\/(jpeg|png|webp)$/.test(file.mimeType)) {
    const rendered = join(directory, 'page-1.png');
    await command(process.env.MAGICK_BIN || 'magick', [path, '-auto-orient', rendered]);
    return [rendered];
  }
  throw new Error('Upload the completed certificate as PDF, JPEG, PNG or WebP');
}

async function compareLogo(page, reference, directory, pageIndex) {
  const magick=process.env.MAGICK_BIN || 'magick';
  const {stdout}=await command(magick,['identify','-format','%w %h',reference]);
  const [width,height]=stdout.trim().split(/\s+/).map(Number);
  if(!Number.isInteger(width)||!Number.isInteger(height)||Math.min(width,height)<20||Math.max(width,height)>2000)
    throw new Error('Approved logo dimensions must be between 20 and 2000 pixels');
  const factor=Math.min(8,Math.max(2,Math.floor(Math.min(width,height)/10)));
  const smallPage=join(directory,`logo-page-${pageIndex}.png`);
  const smallReference=join(directory,`logo-reference-${pageIndex}.png`);
  await command(magick,[page,'-filter','box','-resize',`${100/factor}%`,'+repage',smallPage]);
  await command(magick,[reference,'-filter','box','-resize',`${100/factor}%`,'+repage',smallReference]);
  async function readPixels(path){
    const dimensions=(await command(magick,['identify','-format','%w %h',path])).stdout.trim().split(/\s+/).map(Number);
    if(!dimensions.every(value=>Number.isInteger(value)&&value>0)||dimensions[0]*dimensions[1]>20000000)
      throw new Error('Logo image exceeds the processing limit');
    const result=await run(magick,[path,'-background','white','-alpha','remove','-alpha','off','-colorspace','sRGB','-depth','8','rgb:-'],
      {encoding:'buffer',timeout:30000,maxBuffer:64*1024*1024,windowsHide:true});
    return {width:dimensions[0],height:dimensions[1],pixels:result.stdout};
  }
  const approximate=findLogoMatch(await readPixels(smallPage),await readPixels(smallReference));
  if(!approximate)return false;
  const x=Math.max(0,approximate.x*factor-2*factor);
  const y=Math.max(0,approximate.y*factor-2*factor);
  const candidate=join(directory,`logo-candidate-${pageIndex}.png`);
  await command(magick,[page,'-crop',`${width+4*factor}x${height+4*factor}+${x}+${y}`,'+repage',candidate]);
  // Reduced images only locate the candidate. Approval always uses original-resolution pixels.
  const exact=findLogoMatch(await readPixels(candidate),await readPixels(reference));
  return exact!==null&&exact.score>=0.98;
}

async function checkCertificate(file, path, directory, company, policy, requestStamp) {
  const preflight = evaluateCertificate('', company, policy, false, requestStamp);
  if (preflight.messages[0]?.startsWith('Company certificate/')) return preflight;
  const referenceRoot = resolve(process.env.COMMISSIONING_REFERENCES_DIR || './references');
  const reference = resolve(referenceRoot, `${policy.logo_sha256}.png`);
  if (!reference.startsWith(referenceRoot + sep) || hash(await readFile(reference)) !== policy.logo_sha256)
    throw new Error('Approved logo reference is missing or its checksum does not match');
  const pages = await certificatePages(file, path, directory);
  let text = ''; let logoMatched = false;
  for (const [pageIndex,page] of pages.entries()) {
    const { stdout } = await command(process.env.TESSERACT_BIN || 'tesseract', [page, 'stdout', '-l', 'eng', '--psm', '3']);
    text += `\n${stdout}`;
    if(!logoMatched)logoMatched=await compareLogo(page,reference,directory,pageIndex);
  }
  // Do not persist full OCR text or personal data unnecessarily.
  return evaluateCertificate(text, company, policy, logoMatched, requestStamp);
}

export async function verify(payload) {
  const { job, folders, company_name: company } = payload;
  const base = { rule_version: RULE_VERSION, folders, messages: [] };
  if (job.rule_version !== RULE_VERSION) throw new Error('Worker rule version does not match the queued request');
  if (!folders) return { ...base, status: 'needs_review', messages: ['Register the company Drive evidence folders before verification.'] };
  if (!folders.certificate_policy?.approved_for_automation)
    return { ...base, status: 'needs_review', messages: ['Approved company certificate and logo references are not configured.'] };
  const rootId = await resolveCompanyRoot(company, folders, process.env.GOOGLE_DRIVE_COMPANIES_ROOT_ID);
  const request = new URL(job.drive_link || payload.drive_link || 'https://invalid.local');
  const submittedId=request.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)\/?$/)?.[1] || request.searchParams.get('id');
  if (request.hostname !== 'drive.google.com' || request.protocol !== 'https:' || !folderId(submittedId) ||
    (submittedId!==rootId && await resolveCompanyRoot(company,{root_folder_id:submittedId},undefined)!==rootId))
    return { ...base, status: 'needs_correction', messages: ['Submit the registered company/site Drive folder link.'] };
  const groups = await discoverEvidence(rootId);
  const letters = groups.certificate;
  if (letters.length !== 1)
    return { ...base, status: 'needs_correction', messages: ['Keep one unambiguous final commissioning letter in the company root or its commissioning-letter/certificate folder.'] };
  if (['application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(letters[0].mimeType))
    return { ...base, status: 'needs_correction', messages: ['Save the completed commissioning letter as PDF, JPEG, PNG or WebP for scanning.'] };
  const directory = await mkdtemp(join(tmpdir(), 'simkit-verification-'));
  const budget = { bytes: 0 };
  try {
    const files = [];
    for (const kind of ['photo', 'video']) {
      for (const file of groups[kind]) {
        if (!(kind === 'photo' ? /^image\// : /^video\//).test(file.mimeType)) continue;
        const path = join(directory, file.id);
        const checksum = await download(file, path, budget);
        files.push(await inspectMedia(file, kind, path, checksum));
      }
    }
    const media = evaluateMedia(files);
    if (!media.passed) return { ...base, ...media, status: 'needs_correction' };
    const letterPath = join(directory, 'certificate');
    await download(letters[0], letterPath, budget);
    const certificate = await checkCertificate(letters[0], letterPath, directory, company, folders.certificate_policy, job.request_stamp);
    const afterRoot = await resolveCompanyRoot(company, folders, process.env.GOOGLE_DRIVE_COMPANIES_ROOT_ID);
    const after = await discoverEvidence(rootId);
    if (afterRoot !== rootId || JSON.stringify(manifest(groups)) !== JSON.stringify(manifest(after)))
      return { ...base, status: 'needs_correction', messages: ['Drive evidence changed during verification. Submit again after uploads finish.'] };
    return { ...base, ...media, resolved_root_folder_id: rootId, manifest: manifest(groups), manifest_rechecked: true, certificate_passed: certificate.passed,
      status: certificate.passed ? 'passed' : 'needs_review', messages: certificate.messages };
  } finally {
    // Only remove the exact directory created by mkdtemp under the system temp root.
    if (resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.includes('simkit-verification-'))
      await rm(directory, { recursive: true, force: true });
  }
}

async function rpc(name, args = {}) {
  const url = new URL(process.env.SUPABASE_URL);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('Supabase HTTPS URL required');
  const response = await fetch(new URL(`/rest/v1/rpc/${name}`, url), { method: 'POST', headers: {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Supabase ${name} failed (${response.status})`);
  const body=await response.text();
  return body?JSON.parse(body):null;
}

async function main() {
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  // An online heartbeat means all required local tools really are available.
  for(const [envName,binary,args] of [['FFPROBE_BIN','ffprobe',['-version']],['FFMPEG_BIN','ffmpeg',['-version']],
    ['MAGICK_BIN','magick',['-version']],['TESSERACT_BIN','tesseract',['--version']],['PDFINFO_BIN','pdfinfo',['-v']],['PDFTOPPM_BIN','pdftoppm',['-v']]]) {
    try{await command(process.env[envName]||binary,args);}catch{throw new Error(`Verification tool unavailable: ${binary}`);}
  }
  await token();
  do {
    await rpc('commissioning_verification_heartbeat');
    const payload = await rpc('claim_commissioning_verification');
    if (payload) {
      let report;
      try { report = await verify(payload); }
      catch { report = { status: 'technical_error', messages: ['Verification could not finish. Check Drive access, local tools and worker configuration; resubmit after correction.'] }; }
      const status = await rpc('finish_commissioning_verification', { _job_id: payload.job.id, _lease_token: payload.job.lease_token, _report: report });
      console.log(`Verification ${payload.job.id}: ${status}`);
    }
    if (process.argv.includes('--once')) return;
    await new Promise(done => setTimeout(done, 15000));
  } while (true);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
