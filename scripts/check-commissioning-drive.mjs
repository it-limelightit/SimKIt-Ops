// Read-only remote diagnosis using existing deployment credentials; no secrets are printed.
import { readFile,writeFile } from 'node:fs/promises';
const project='jhhiwyvrhfhvvougkqmm';
const company=process.argv.find(arg=>arg.startsWith('--company='))?.slice('--company='.length);
let token;
for(const file of ['.tmp/supabase-expense-deploy.private.env','.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/migration.env']){
  let content;try{content=await readFile(file,'utf8');}catch{continue;}
  const line=content.replace(/^\uFEFF/,'').split(/\r?\n/).find(line=>/^SUPABASE_ACCESS_TOKEN\s*=/.test(line));
  const candidate=line?.slice(line.indexOf('=')+1).trim().replace(/^(['"])(.*)\1$/,'$2');
  if(!candidate)continue;
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/api-keys`,{headers:{Authorization:`Bearer ${candidate}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok){await response.body?.cancel();continue;}
  const keys=await response.json();
  const service=keys.find(key=>key.name==='service_role');
  const anon=keys.find(key=>key.name==='anon');
  if(!service?.api_key||!anon?.api_key)throw new Error('Legacy service credentials are unavailable; diagnostic stopped.');
  token={service:service.api_key,anon:anon.api_key,management:candidate};break;
}
if(!token)throw new Error('No authorized deployment credential available for read-only diagnosis.');
const diagnose=async()=>{
  const response=await fetch(`https://${project}.supabase.co/functions/v1/commissioning-drive-check`,{method:'POST',headers:{Authorization:`Bearer ${token.service}`,apikey:token.anon,'Content-Type':'application/json'},body:JSON.stringify({action:'diagnose_setup',...(company?{company_name:company}:{})}),signal:AbortSignal.timeout(100000)});
  return {http_status:response.status,...await response.json()};
};
let data=await diagnose();let corrected=false;
if(process.argv.includes('--fix-root') && data.status==='folder_id_required'){
  const matches=data.folder_candidates;
  if(matches?.length!==1 || matches[0].name!==data.configured_value || !/^[\w-]{10,}$/.test(matches[0].id) || matches[0].id===data.configured_value)
    throw new Error('Company parent name is ambiguous or does not resolve safely; no secret changed.');
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/secrets`,{method:'POST',headers:{Authorization:`Bearer ${token.management}`,'Content-Type':'application/json'},
    body:JSON.stringify([{name:'GOOGLE_DRIVE_COMPANIES_ROOT_ID',value:matches[0].id}]),signal:AbortSignal.timeout(20000)});
  if(!response.ok){const status=response.status;await response.body?.cancel();throw new Error(`Could not correct the parent folder ID (HTTP ${status}).`);}
  await response.body?.cancel();corrected=true;
  console.log('Corrected only GOOGLE_DRIVE_COMPANIES_ROOT_ID using one unique exact folder-name match.');
  for(let attempt=0;attempt<3;attempt++){
    await new Promise(done=>setTimeout(done,2000));data=await diagnose();if(data.status!=='folder_id_required')break;
  }
}
const report={at:new Date().toISOString(),configuration_corrected:corrected,...data};
await writeFile('.tmp/commissioning-drive-diagnostic.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
