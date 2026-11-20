// Real local tools with synthetic evidence only. Every network request is intercepted.
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,mkdtemp,stat } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCanvas,loadImage } from '@napi-rs/canvas';
import { jsPDF } from 'jspdf';
import { RULE_VERSION } from '../integrations/commissioning-verifier/rules.mjs';
const run=promisify(execFile);
const tools=JSON.parse((await readFile('.tmp/commissioning-tools/tools.json','utf8')).replace(/^\uFEFF/,''));
Object.assign(process.env,tools,{SUPABASE_URL:'https://synthetic-test.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-only'});
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
await mkdir(resolve('.tmp'),{recursive:true});
const directory=await mkdtemp(resolve('.tmp/commissioning-smoke-'));
const references=join(directory,'references');await mkdir(references);
process.env.COMMISSIONING_REFERENCES_DIR=references;
const checksum=data=>createHash('sha256').update(data).digest('hex');
const root={id:'root',name:'Synthetic Factory',mimeType:'application/vnd.google-apps.folder'};
const media={id:'media',name:'Media',mimeType:'application/vnd.google-apps.folder'};
const files=new Map();
const photos=[];const videos=[];
function register(id,name,mimeType,bytes,parent,extra={}){
  const metadata={id,name,mimeType,size:String(bytes.length),version:'1',modifiedTime:'2026-11-17T00:00:00Z',
    md5Checksum:createHash('md5').update(bytes).digest('hex'),parents:[parent],...extra};
  files.set(id,{bytes,metadata});return metadata;
}
for(const [index,color] of ['red','blue','green','purple'].entries()){
  const photo=createCanvas(320,240);const ctx=photo.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,320,240);
  ctx.fillStyle='white';ctx.font='30px Arial';ctx.fillText(`Site photo ${index+1}`,20,100);
  photos.push(register(`photo-${index}`,`photo-${index}.png`,'image/png',await photo.encode('png'),'media'));
  if (index >= 2) continue;
  const videoPath=join(directory,`video-${index}.mp4`);
  await run(tools.FFMPEG_BIN,['-nostdin','-v','error','-f','lavfi','-i',`color=c=${color}:s=160x120:r=1`,'-t','60','-an','-c:v','libx264','-pix_fmt','yuv420p','-y',videoPath],{timeout:30000,windowsHide:true});
  videos.push(register(`video-${index}`,`video-${index}.mp4`,'video/mp4',await readFile(videoPath),'media',{videoMediaMetadata:{durationMillis:'60000'}}));
}
const logo=createCanvas(240,80);const logoContext=logo.getContext('2d');logoContext.fillStyle='white';logoContext.fillRect(0,0,240,80);
logoContext.fillStyle='#1246a0';logoContext.fillRect(5,5,230,70);logoContext.fillStyle='white';logoContext.font='bold 30px Arial';logoContext.fillText('TEST LOGO',25,50);
const logoBytes=await logo.encode('png');const logoHash=checksum(logoBytes);await writeFile(join(references,`${logoHash}.png`),logoBytes);
const page=createCanvas(1000,1400);const ctx=page.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1000,1400);ctx.drawImage(await loadImage(logoBytes),50,50);
ctx.fillStyle='black';ctx.font='34px Arial';
const date=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata'}).format(new Date());
['Synthetic Factory','Installation and commissioning certificate','Successfully installed and commissioned',`Date: ${date}`,'Authorized Signatory','Test Director','Designation: Director'].forEach((line,index)=>ctx.fillText(line,50,210+index*90));
const pageBytes=await page.encode('png');const certificate=register('certificate','Commissioning Letter.png','image/png',pageBytes,'root');
const pdf=new jsPDF({unit:'mm',format:'a4'});pdf.addImage(new Uint8Array(pageBytes),'PNG',0,0,210,297);
const pdfPath=join(directory,'synthetic-certificate.pdf');await writeFile(pdfPath,Buffer.from(pdf.output('arraybuffer')));
const pdfBytes = await readFile(pdfPath);
const info=await run(tools.PDFINFO_BIN,[pdfPath],{timeout:30000,windowsHide:true});assert.match(info.stdout,/Pages:\s+1/);
await run(tools.PDFTOPPM_BIN,['-f','1','-l','1','-r','72','-png',pdfPath,join(directory,'pdf-smoke')],{timeout:30000,windowsHide:true});
assert.ok((await stat(join(directory,'pdf-smoke-1.png'))).size>0);
globalThis.fetch=async input=>{
  const url=new URL(input);
  if(url.hostname==='synthetic-test.invalid')return Response.json({access_token:'synthetic-token',expires_in:3300,companies_root_id:'root'});
  assert.equal(url.hostname,'www.googleapis.com','No real external requests are allowed in this test');
  const id=url.pathname.split('/').at(-1);
  if(url.searchParams.get('alt')==='media')return new Response(files.get(id).bytes);
  if(id==='files'){
    const parent=url.searchParams.get('q').match(/^'([^']+)'/)[1];
    return Response.json({files:parent==='root'?[media,certificate]:parent==='media'?[...photos,...videos]:[]});
  }
  return Response.json(id==='root'?root:id==='media'?media:files.get(id)?.metadata);
};
const {verify}=await import('../integrations/commissioning-verifier/worker.mjs');
const payload={company_name:'Synthetic Factory',drive_link:'https://drive.google.com/drive/folders/root',
  job:{rule_version:RULE_VERSION,request_stamp:new Date().toISOString()},folders:{root_folder_id:'root',certificate_policy:{approved_for_automation:true,
    signature_policy:'name_and_designation_only',required_phrases:['Successfully installed and commissioned'],signatory_names:['Test Director'],designations:['Director'],max_age_days:1,logo_sha256:logoHash}}};
const report=await verify(payload);
assert.equal(report.status,'passed',JSON.stringify(report.messages));assert.equal(report.photo_count,4);assert.equal(report.video_count,2);
assert.equal(report.video_total_seconds,120);assert.equal(report.certificate_passed,true);assert.equal(report.manifest_rechecked,true);
const reviewedPdfPolicy = { approved_for_automation: true, reviewed_pdf_sha256: checksum(pdfBytes) };
const reviewedPayload = { ...payload, folders: { ...payload.folders, certificate_policy: reviewedPdfPolicy } };
assert.equal((await verify(reviewedPayload)).status, 'needs_review');
files.get('certificate').bytes = pdfBytes;
Object.assign(certificate, { name: 'Commissioning Letter.pdf', mimeType: 'application/pdf', size: String(pdfBytes.length) });
const reviewed = await verify(reviewedPayload);
assert.equal(reviewed.status, 'passed');
assert.equal(reviewed.certificate_verification_method, 'reviewed_pdf_sha256');
assert.equal(reviewed.certificate_sha256, reviewedPdfPolicy.reviewed_pdf_sha256);
assert.equal((await verify({ ...reviewedPayload, folders: { ...payload.folders,
  certificate_policy: { ...reviewedPdfPolicy, reviewed_pdf_sha256: 'a'.repeat(64) } } })).status, 'needs_review');
files.get('certificate').bytes = pageBytes;
Object.assign(certificate, { name: 'Commissioning Letter.png', mimeType: 'image/png', size: String(pageBytes.length) });
const wrongLogo=createCanvas(240,80);const wrong=wrongLogo.getContext('2d');wrong.fillStyle='white';wrong.fillRect(0,0,240,80);
wrong.fillStyle='red';wrong.beginPath();wrong.arc(40,40,30,0,Math.PI*2);wrong.fill();wrong.fillStyle='black';wrong.font='30px Arial';wrong.fillText('WRONG',85,50);
const wrongBytes=await wrongLogo.encode('png');const wrongHash=checksum(wrongBytes);await writeFile(join(references,`${wrongHash}.png`),wrongBytes);
const rejected=await verify({...payload,folders:{...payload.folders,certificate_policy:{...payload.folders.certificate_policy,logo_sha256:wrongHash}}});
assert.equal(rejected.status,'needs_review');assert.equal(rejected.certificate_passed,false);assert.ok(rejected.messages.some(message=>/logo/.test(message)));
const longAudio=join(directory,'short-video-long-audio.mp4');
await run(tools.FFMPEG_BIN,['-nostdin','-v','error','-t','30','-i',join(directory,'video-0.mp4'),'-f','lavfi','-t','180','-i','anullsrc=r=8000:cl=mono','-c:v','copy','-c:a','aac','-y',longAudio],{timeout:30000,windowsHide:true});
videos[0]=register('video-0','short-video-long-audio.mp4','video/mp4',await readFile(longAudio),'media',{videoMediaMetadata:{durationMillis:'180000'}});
const shortVideo=await verify(payload);
assert.equal(shortVideo.status,'needs_correction');assert.ok(shortVideo.video_total_seconds<120);
const summary={synthetic_only:true,real_tools:true,photos:report.photo_count,videos:report.video_count,total_seconds:report.video_total_seconds,
  letter_ocr_and_logo:report.certificate_passed,wrong_logo_rejected:true,long_audio_tail_rejected:true,pdf_rendering:true,manifest_rechecked:true};
await writeFile('.tmp/commissioning-worker-smoke.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
