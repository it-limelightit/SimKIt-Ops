// Uses existing private deployment access to configure the local worker, without exporting a Google private key.
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const project='jhhiwyvrhfhvvougkqmm';
const tools=JSON.parse((await readFile('.tmp/commissioning-tools/tools.json','utf8')).replace(/^\uFEFF/,''));
let serviceKey;
for(const file of ['.tmp/supabase-expense-deploy.private.env','.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/migration.env']){
  let text;try{text=await readFile(file,'utf8');}catch{continue;}
  const line=text.split(/\r?\n/).find(value=>value.startsWith('SUPABASE_ACCESS_TOKEN='));
  const token=line?.slice(line.indexOf('=')+1).trim().replace(/^(['"])(.*)\1$/,'$2');
  if(!token)continue;
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/api-keys`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok){await response.body?.cancel();continue;}
  const keys=await response.json();serviceKey=keys.find(key=>key.name==='service_role')?.api_key;
  if(serviceKey)break;
}
if(!serviceKey)throw new Error('Authorized Supabase service key is unavailable.');
const folder=resolve('.tmp/commissioning-worker');
await mkdir(folder,{recursive:true});await mkdir(resolve(folder,'references'),{recursive:true});
const env={SUPABASE_URL:`https://${project}.supabase.co`,SUPABASE_SERVICE_ROLE_KEY:serviceKey,
  COMMISSIONING_REFERENCES_DIR:resolve(folder,'references').replaceAll('\\','/'),...Object.fromEntries(Object.entries(tools).map(([key,value])=>[key,value.replaceAll('\\','/')]))};
await writeFile(resolve(folder,'.env'),Object.entries(env).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600});
console.log('Private local worker configuration saved. Google credentials remain in Supabase.');
