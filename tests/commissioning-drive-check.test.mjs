import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import * as core from '../supabase/functions/_shared/commissioning-drive.mjs';
import { explainGoogleDriveError } from '../supabase/functions/_shared/commissioning-google-errors.mjs';

const siteId = '00000000-0000-4000-8000-000000000010';
const source = readFileSync(new URL('../supabase/functions/commissioning-drive-check/index.ts',import.meta.url),'utf8');
const js = ts.transpileModule(source.replace(/^import .*;\r?\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/export \{\};?/g,'');
function handler(options = {}) {
  let serve;
  const writes = [];
  const env = { SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'private',...options.env };
  const caller = {auth:{getUser:async()=>({data:{user:options.signedOut?null:{id:siteId}},error:null})},rpc:async(name,args)=>{
    if(name==='can_access_site_for_verification')return {data:false,error:options.rotatedService?null:{code:'42501'}};
    if(name==='start_automatic_commissioning'){writes.push({name,args});return {data:options.startResult||{status:'queued',job_id:'job-id'},error:null};}
    return {data:options.allowed!==false,error:null};
  }};
  const admin = {from:table=>({select:()=>({eq:()=>({
    single:async()=>({data:{company_name:'Acme Pvt Ltd'},error:null}),
    maybeSingle:async()=>({data:null,error:null}),
  })})}),rpc:async(name,args)=>{writes.push({name,args});return {data:options.rateAllowed!==false,error:null};}};
  new Function('createClient','findCompanyRoot','discoverCompanyEvidence','summarizeDriveEvidence','explainGoogleDriveError','Deno','crypto','fetch',js)(
    (_,key)=>key==='public'?caller:admin,core.findCompanyRoot,core.discoverCompanyEvidence,core.summarizeDriveEvidence,
    explainGoogleDriveError,
    {env:{get:key=>env[key]},serve:fn=>{serve=fn;}},webcrypto,options.fetch||(()=>{throw new Error('Unexpected network access');}));
  return {call:body=>serve(new Request('https://project.supabase.co/functions/v1/commissioning-drive-check',{
    method:'POST',headers:options.noAuthorization?{}:{Authorization:options.authorization||'Bearer signed-user-token'},body:JSON.stringify(body??{site_id:siteId})})),writes,setEnv:(name,value)=>{env[name]=value;}};
}
test('read-only endpoint authenticates user and site access before Google calls',async()=>{
  assert.equal((await handler({noAuthorization:true}).call()).status,401);
  assert.equal((await handler({signedOut:true}).call()).status,401);
  assert.equal((await handler({allowed:false}).call()).status,403);
  assert.equal((await handler().call({site_id:'invalid'})).status,400);
  assert.equal((await handler().call({action:'diagnose_setup'})).status,401,'Ordinary users cannot use backend diagnostics');
  assert.equal((await handler().call({action:'worker_access_token'})).status,401,'Ordinary users cannot obtain worker credentials');
});
test('UI receives actionable missing-secret setup information without changing business data',async()=>{
  const h=handler();const response=await h.call();const data=await response.json();
  assert.equal(data.status,'setup_required');assert.equal(data.read_only,true);
  assert.equal(data.messages.length,2);assert.equal(h.writes.length,0);
  assert.match(data.messages[0],/GOOGLE_SERVICE_ACCOUNT_JSON/);
});
test('UI precheck reads real handler paths, discovers root letter and reports average without approving',async()=>{
  const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const key=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
  const credential=JSON.stringify({client_email:'reader@example.iam.gserviceaccount.com',private_key:`-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`});
  const media=[...Array.from({length:4},(_,i)=>({id:`p${i}`,name:`photo${i}.jpg`,mimeType:'image/jpeg',md5Checksum:`p${i}`})),
    ...[60,120,120,180].map((s,i)=>({id:`v${i}`,name:`clip${i}.mp4`,mimeType:'video/mp4',md5Checksum:`v${i}`,videoMediaMetadata:{durationMillis:String(s*1000)}}))];
  const tree={parent:[{id:'company',name:'Acme Pvt Ltd',mimeType:'application/vnd.google-apps.folder'}],company:[{id:'media',name:'Media',mimeType:'application/vnd.google-apps.folder'},{id:'letter',name:'Commissioning Letter.pdf',mimeType:'application/pdf'}],media};
  const h=handler({env:{GOOGLE_SERVICE_ACCOUNT_JSON:credential,GOOGLE_DRIVE_COMPANIES_ROOT_ID:'parent'},fetch:async input=>{
    if(String(input).includes('oauth2.googleapis.com'))return Response.json({access_token:'temporary-google-token'});
    const url=new URL(input);assert.equal(url.searchParams.get('alt'),null,'No file downloads in UI precheck');
    const parent=url.searchParams.get('q').match(/^'([^']+)'/)[1];return Response.json({files:tree[parent]});
  }});
  const response=await h.call();const data=await response.json();
  assert.equal(data.status,'checked');assert.equal(data.photo_count,4);assert.equal(data.video_count,4);
  assert.equal(data.video_average_seconds,120);assert.equal(data.certificate_count,1);
  assert.equal(data.certificate_ocr_status,'not_run');assert.equal(data.read_only,true);
  assert.deepEqual(h.writes.map(write=>write.name),['reserve_commissioning_drive_check']);
  const automatic=await (await h.call({site_id:siteId,action:'commission'})).json();
  assert.equal(automatic.commissioning_state,'queued');assert.equal(automatic.read_only,false);
  assert.equal(automatic.certificate_ocr_status,'not_run','Queued is not proof of a successful letter scan');
  assert.deepEqual(h.writes.at(-1),{name:'start_automatic_commissioning',args:{_site_id:siteId,_drive_link:'https://drive.google.com/drive/folders/company'}});
  const starts=h.writes.filter(write=>write.name==='start_automatic_commissioning').length;
  tree.company[1].mimeType='application/msword';
  const word=await (await h.call({site_id:siteId,action:'commission'})).json();
  assert.equal(word.commissioning_state,'needs_correction');assert.equal(word.read_only,true);
  tree.company[1].mimeType='application/pdf';
  tree.media=tree.media.filter(file=>file.mimeType!=='video/mp4');
  const missingVideos=await (await h.call({site_id:siteId,action:'commission'})).json();
  assert.equal(missingVideos.media_precheck_passed,false);assert.equal(missingVideos.commissioning_state,undefined);
  assert.equal(h.writes.filter(write=>write.name==='start_automatic_commissioning').length,starts);
});
test('precheck does not round short durations up or count identical uploaded copies',()=>{
  const groups={photo:Array.from({length:4},(_,i)=>({id:`p${i}`,md5Checksum:i<2?'duplicate':`p${i}`})),
    video:Array.from({length:4},(_,i)=>({id:`v${i}`,md5Checksum:`v${i}`,videoMediaMetadata:{durationMillis:'119999'}})),certificate:[{name:'letter'}]};
  const result=core.summarizeDriveEvidence(groups);
  assert.equal(result.photo_count,3);assert.equal(result.media_precheck_passed,false);assert.equal(result.video_average_seconds,119.999);
});

test('Google error reasons distinguish disabled API, scope, sharing and quota without leaking raw bodies',()=>{
  const disabled=explainGoogleDriveError(403,{error:{errors:[{reason:'accessNotConfigured'}],details:[{reason:'SERVICE_DISABLED',metadata:{consumer:'projects/12345'}}]}},{project_id:'simkit-reader'});
  assert.equal(disabled.category,'api_disabled');assert.match(disabled.api_setup_url,/project=simkit-reader/);
  assert.doesNotMatch(disabled.message,/Share/);
  assert.equal(explainGoogleDriveError(403,{error:{errors:[{reason:'insufficientPermissions'}]}}).category,'scope_missing');
  assert.equal(explainGoogleDriveError(403,{error:{errors:[{reason:'userRateLimitExceeded'}]}}).category,'quota');
  const sharing=explainGoogleDriveError(404,{error:{message:'private-key-material'}},{folder_id:'company-parent',service_account_email:'reader@example.test'});
  assert.equal(sharing.category,'folder_access');assert.match(sharing.message,/reader@example.test/);assert.match(sharing.message,/company-parent/);
  assert.doesNotMatch(JSON.stringify(sharing),/private-key-material/);
});

test('backend diagnosis reads root without user impersonation and refreshes Google token when credentials change',async()=>{
  const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const key=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
  const credential={client_email:'reader@example.iam.gserviceaccount.com',private_key:`-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`,project_id:'simkit-reader'};
  let tokens=0;
  const h=handler({authorization:'Bearer private',env:{GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify(credential),GOOGLE_DRIVE_COMPANIES_ROOT_ID:'parent'},fetch:async input=>{
    if(String(input).includes('oauth2.googleapis.com'))return Response.json({access_token:`token-${++tokens}`});
    const url=new URL(input);return url.pathname.endsWith('/files/parent')?Response.json({id:'parent',name:'Company Evidence',mimeType:'application/vnd.google-apps.folder'}):Response.json({files:[]});
  }});
  const access=await (await h.call({action:'worker_access_token'})).json();
  assert.equal(typeof access.access_token,'string');assert.equal(access.private_key,undefined);
  assert.equal((await (await h.call({action:'diagnose_setup'})).json()).status,'connection_ok');
  assert.equal((await (await h.call({action:'diagnose_setup'})).json()).status,'connection_ok');
  assert.equal(tokens,1);
  h.setEnv('GOOGLE_SERVICE_ACCOUNT_JSON',JSON.stringify({...credential,client_email:'another-reader@example.iam.gserviceaccount.com'}));
  assert.equal((await (await h.call({action:'diagnose_setup'})).json()).status,'connection_ok');
  assert.equal(tokens,2,'Changed identity must not reuse the old identity token');
  assert.equal(h.writes.length,0,'Backend diagnosis never reserves jobs or modifies business rows');
});

test('rotated backend credentials require a verified service-only database grant',async()=>{
  const privileged=await handler({authorization:'Bearer rotated-service-key',rotatedService:true}).call({action:'diagnose_setup'});
  assert.equal((await privileged.json()).status,'setup_required');
  assert.equal((await handler({authorization:'Bearer normal-user-key'}).call({action:'diagnose_setup'})).status,401);
});

test('a folder name entered as an ID produces exact visible candidates without changing configuration',async()=>{
  const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const privateKey=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
  const credential=JSON.stringify({client_email:'reader@example.iam.gserviceaccount.com',private_key:`-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`});
  const h=handler({authorization:'Bearer private',env:{GOOGLE_SERVICE_ACCOUNT_JSON:credential,GOOGLE_DRIVE_COMPANIES_ROOT_ID:'Implementation_SIM-kit'},fetch:async input=>{
    if(String(input).includes('oauth2.googleapis.com'))return Response.json({access_token:'token'});
    const url=new URL(input);
    if(url.pathname.endsWith('/files/Implementation_SIM-kit'))return Response.json({error:{errors:[{reason:'notFound'}]}},{status:404});
    assert.match(url.searchParams.get('q'),/name = 'Implementation_SIM-kit'/);
    return Response.json({files:[{id:'real-drive-folder-id',name:'Implementation_SIM-kit'}]});
  }});
  const result=await (await h.call({action:'diagnose_setup'})).json();
  assert.equal(result.status,'folder_id_required');assert.equal(result.folder_candidates[0].id,'real-drive-folder-id');assert.equal(h.writes.length,0);
});
