import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {build} from 'esbuild';
const project='jhhiwyvrhfhvvougkqmm',slug='payment-email-ingest';
const env=await readFile('.tmp/supabase-expense-deploy.private.env','utf8');
const line=env.replace(/^\uFEFF/,'').split(/\r?\n/).find(l=>/^SUPABASE_ACCESS_TOKEN\s*=/.test(l));
const token=line?.slice(line.indexOf('=')+1).trim().replace(/^(['"])(.*)\1$/,'$2');
if(!token)throw Error('Saved deployment credential missing');
async function api(path,init={}){
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/${path}`,{...init,headers:{Authorization:`Bearer ${token}`,...init.headers},signal:AbortSignal.timeout(60000)});
 if(!response.ok){await response.body?.cancel();throw Error(`Supabase ${path.split('?')[0]} returned HTTP ${response.status}`);}
 const text=await response.text();return text?JSON.parse(text):null;
}
const query=sql=>api('database/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:sql})});
if(process.argv.includes('--inspect')){
 console.log(JSON.stringify({functions:(await api('functions')).map(f=>({slug:f.slug,version:f.version,status:f.status})),state:await query(`SELECT mailbox,last_checked_at,(SELECT count(*) FROM payment_email_alerts) AS alerts FROM payment_alert_monitor WHERE singleton`)},null,2));process.exit(0);
}
const tables=['sites','commissioning','commissioning_approval_requests','field_earnings','field_payment_items','field_payment_records'];
const snapshot=()=>query(tables.map(t=>`SELECT '${t}' AS name,count(*) AS count,md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'[]')) AS digest FROM public.${t} x`).join(' UNION ALL '));
const before=await snapshot(),functions=await api('functions');
await writeFile('.tmp/payment-alert-before.json',JSON.stringify({before,functions:functions.map(f=>({slug:f.slug,version:f.version,status:f.status}))},null,2));
await query(`CREATE TABLE IF NOT EXISTS public.payment_alert_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());ALTER TABLE public.payment_alert_migrations ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.payment_alert_migrations FROM PUBLIC,anon,authenticated;`);
for(const [version,name] of [['20261117140000','payment_email_alerts'],['20261117150000','payment_alert_temporary_test'],['20261117160000','remove_payment_alert_test_sender']]){
if(!(await query(`SELECT version FROM public.payment_alert_migrations WHERE version='${version}'`)).length){
 const sql=await readFile(`supabase/migrations/${version}_${name}.sql`,'utf8');
 await query(sql.replace(/COMMIT;\s*$/,`INSERT INTO public.payment_alert_migrations(version) VALUES('${version}');COMMIT;`));
 console.log('Payment alert migration applied.');
}
}
const privatePath='.tmp/payment-alert-setup.private.env';
const secrets=await api('secrets');
let privateConfig;
try{privateConfig=await readFile(privatePath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
let secret=privateConfig?.split(/\r?\n/).find(l=>l.startsWith('PAYMENT_ALERT_INGEST_SECRET='))?.split('=')[1];
if(!secret){
 if(secrets.some(s=>s.name==='PAYMENT_ALERT_INGEST_SECRET'))throw Error('Remote signing secret exists but local setup file is missing. Recover it through Supabase; no rotation performed.');
 secret=randomBytes(32).toString('hex');await mkdir('.tmp',{recursive:true});
 await writeFile(privatePath,`PAYMENT_ALERT_ENDPOINT=https://${project}.supabase.co/functions/v1/${slug}\nPAYMENT_ALERT_INGEST_SECRET=${secret}\n`,{flag:'wx',mode:0o600});
}
if(!secrets.some(s=>s.name==='PAYMENT_ALERT_INGEST_SECRET'))await api('secrets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([{name:'PAYMENT_ALERT_INGEST_SECRET',value:secret}])});
const readyScript=(await readFile('integrations/payment-email-monitor/Code.gs','utf8'))+
 `\n// Private setup helper. Do not share this file or project with untrusted editors.\nfunction configureAndInstallPaymentMonitor() {\n const properties=PropertiesService.getScriptProperties();\n properties.deleteProperty('PAYMENT_TEST_UNTIL_MS');\n properties.setProperties(${JSON.stringify({PAYMENT_ALERT_ENDPOINT:`https://${project}.supabase.co/functions/v1/${slug}`,PAYMENT_ALERT_INGEST_SECRET:secret})});\n installPaymentMonitor();\n}\n`;
await writeFile('.tmp/payment-email-monitor-ready.gs',readyScript,{mode:0o600});
const bundled=await build({entryPoints:[`supabase/functions/${slug}/index.ts`],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['npm:*'],logLevel:'silent'});
const form=new FormData();form.append('metadata',JSON.stringify({name:slug,entrypoint_path:'index.ts',verify_jwt:false}));
form.append('file',new Blob([bundled.outputFiles[0].text],{type:'application/typescript'}),'index.ts');
const deployed=await api(`functions/deploy?slug=${slug}`,{method:'POST',body:form});
if(deployed.status!=='ACTIVE')throw Error('Payment endpoint did not activate');
const response=await fetch(`https://${project}.supabase.co/functions/v1/${slug}`,{method:'POST',body:'{}',signal:AbortSignal.timeout(20000)});
if(response.status!==401)throw Error(`Unsigned webhook returned ${response.status}, expected 401`);await response.body?.cancel();
const after=await snapshot(),functionsAfter=await api('functions');
if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Existing business rows changed; inspect concurrent activity.');
const unrelatedChanges=functions.filter(f=>f.slug!==slug).filter(f=>!functionsAfter.some(n=>n.slug===f.slug&&n.version===f.version&&n.status===f.status));
if(unrelatedChanges.length)throw Error('Unrelated function changed; inspect concurrent activity: '+JSON.stringify(unrelatedChanges.map(f=>({slug:f.slug,beforeVersion:f.version,afterVersion:functionsAfter.find(n=>n.slug===f.slug)?.version,beforeStatus:f.status,afterStatus:functionsAfter.find(n=>n.slug===f.slug)?.status}))));
const state=await query(`SELECT mailbox,last_checked_at,(SELECT count(*) FROM payment_email_alerts) AS alerts FROM payment_alert_monitor WHERE singleton`);
const report={deployedAt:new Date().toISOString(),project,function:slug,version:deployed.version,businessRowsUnchanged:true,otherFunctionsUnchanged:true,unsignedRequestStatus:401,state,privateSetupFile:privatePath};
await writeFile('.tmp/payment-alert-deployment.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
