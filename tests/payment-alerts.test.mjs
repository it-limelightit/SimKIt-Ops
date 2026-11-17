import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {parseContaboBatch,verifyPaymentSignature} from '../supabase/functions/_shared/payment-alerts.mjs';
globalThis.crypto??=webcrypto;
const subject='Contabo: Payment missing - Avoid service suspension and data loss! Act now!';
const message=(id='abcdef1234567890')=>({id,sender:'Contabo <no-reply@contabo.com>',subject,preview:'Please pay your invoice.',received_at:'2026-11-17T10:00:00.000Z'});
const batch=(messages=[message()])=>({mailbox:'it@limelightit.io',messages});
test('only matching Contabo emails from the billing mailbox are accepted',()=>{
 assert.equal(parseContaboBatch(batch()).messages[0].sender,'no-reply@contabo.com');
 for(const m of [{sender:'other@contabo.com'},{sender:'no-reply@contabo.com.attacker.test'},
 {subject:'Contabo: Your invoice'},{subject:'Re: '+subject},{id:'../../bad'},{received_at:'invalid'},
 {preview:'x'.repeat(1001)}])assert.throws(()=>parseContaboBatch(batch([{...message(),...m}])));
 assert.throws(()=>parseContaboBatch({...batch(),mailbox:'other@example.com'}));
 assert.throws(()=>parseContaboBatch(batch(Array(51).fill(message()))));
});
test('webhook signature binds the exact body and expires after five minutes',async()=>{
 const secret='a'.repeat(64),timestamp=String(Date.now()),body=JSON.stringify(batch());
 const signature=createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
 assert.equal(await verifyPaymentSignature(secret,timestamp,signature,body),true);
 assert.equal(await verifyPaymentSignature(secret,timestamp,signature,body+' '),false);
 assert.equal(await verifyPaymentSignature('b'.repeat(64),timestamp,signature,body),false);
 assert.equal(await verifyPaymentSignature(secret,timestamp,signature,body,Number(timestamp)+300001),false);
 assert.equal(await verifyPaymentSignature(secret,timestamp,'invalid',body),false);
});
test('actual ingest handler rejects unsigned/oversized input and saves only authenticated batches',async()=>{
 const source=readFileSync(new URL('../supabase/functions/payment-email-ingest/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/export \{\};?/g,'');
 const secret='a'.repeat(64);const writes=[];let serve;let fail=false;
 new Function('createClient','parseContaboBatch','verifyPaymentSignature','Deno',js)(()=>({rpc:async(name,args)=>{writes.push({name,args});return fail?{error:{message:'private database error'}}:{data:1,error:null};}}),parseContaboBatch,verifyPaymentSignature,{env:{get:name=>name==='PAYMENT_ALERT_INGEST_SECRET'?secret:'private'},serve:fn=>{serve=fn;}});
 const call=body=>{const timestamp=String(Date.now());return serve(new Request('https://example.test',{method:'POST',body,headers:{'x-payment-timestamp':timestamp,'x-payment-signature':createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex')}}));};
 assert.equal((await serve(new Request('https://example.test',{method:'POST',body:'{}'}))).status,401);assert.equal(writes.length,0);
 assert.equal((await call('a'.repeat(65537))).status,413);assert.equal(writes.length,0);
 const invalid=await call(JSON.stringify({...batch(),mailbox:'wrong@example.com'}));assert.equal(invalid.status,400);assert.equal(writes.length,0);
 const valid=await call(JSON.stringify({...batch(),completed:true}));assert.equal(valid.status,200);
 assert.equal(writes[0].name,'ingest_payment_emails');assert.equal(writes[0].args._completed,true);
 assert.equal(writes[0].args._messages[0].sender,'no-reply@contabo.com');
 fail=true;const error=await call(JSON.stringify(batch()));assert.equal(error.status,503);assert.doesNotMatch(await error.text(),/private/);
});
function scriptRuntime({mailbox='it@limelightit.io',fail=false}={}){
 const properties=new Map([['PAYMENT_ALERT_ENDPOINT','https://jhhiwyvrhfhvvougkqmm.supabase.co/functions/v1/payment-email-ingest'],['PAYMENT_ALERT_INGEST_SECRET','a'.repeat(64)]]);
 const posts=[];let released=false;
 const reply=value=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(value)});
 const context=vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key),setProperty:(key,value)=>properties.set(key,value)})},
 ScriptApp:{getOAuthToken:()=> 'read-only-token'},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{released=true;}})},
 Utilities:{computeHmacSha256Signature:(value,key)=>[...createHmac('sha256',key).update(value).digest()].map(b=>b>127?b-256:b)},
 UrlFetchApp:{fetch:(url,options)=>{
  if(url.endsWith('/profile'))return reply({emailAddress:mailbox});
  if(url.includes('/messages?'))return reply({messages:[{id:'abcdef1234567890'}]});
  if(url.includes('/messages/'))return reply({id:'abcdef1234567890',internalDate:String(Date.now()),snippet:'Payment warning',payload:{headers:[{name:'From',value:'Contabo <no-reply@contabo.com>'},{name:'Subject',value:subject}]}});
  posts.push({url,options});return {getResponseCode:()=>fail?503:200};
 }}});
 vm.runInContext(readFileSync(new URL('../integrations/payment-email-monitor/Code.gs',import.meta.url),'utf8'),context);
 return {context,properties,posts,released:()=>released};
}
test('Gmail script signs matching metadata and advances cursor only after complete sync',async()=>{
 const runtime=scriptRuntime();vm.runInContext('checkContaboPayments()',runtime.context);
 assert.equal(runtime.posts.length,1);const {options}=runtime.posts[0];
 assert.equal(JSON.parse(options.payload).completed,true);
 assert.equal(await verifyPaymentSignature('a'.repeat(64),options.headers['X-Payment-Timestamp'],options.headers['X-Payment-Signature'],options.payload),true);
 assert.equal(parseContaboBatch(JSON.parse(options.payload)).messages.length,1);
 assert.ok(runtime.properties.get('LAST_SUCCESS_MS'));assert.equal(runtime.released(),true);
});
test('Gmail script retains retry cursor on failure and refuses a different mailbox',()=>{
 const failed=scriptRuntime({fail:true});assert.throws(()=>vm.runInContext('checkContaboPayments()',failed.context),/SimKit sync failed/);
 assert.equal(failed.properties.get('LAST_SUCCESS_MS'),undefined);assert.equal(failed.released(),true);
 const wrong=scriptRuntime({mailbox:'wrong@example.com'});assert.throws(()=>vm.runInContext('checkContaboPayments()',wrong.context),/it@limelightit.io only/);assert.equal(wrong.posts.length,0);
});
const db=new PGlite();
const users=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'];
before(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE profiles(id uuid PRIMARY KEY,is_active boolean DEFAULT true);
 INSERT INTO auth.users VALUES('${users[0]}','tarun@limelightit.io',now()),('${users[1]}','nitsanghani1@gmail.com',now()),('${users[2]}','kishanvyas308@gmail.com',now()),('${users[3]}','other@example.com',now());
 INSERT INTO profiles SELECT id,true FROM auth.users;`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261117140000_payment_email_alerts.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261117150000_payment_alert_temporary_test.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261117160000_remove_payment_alert_test_sender.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
async function login(index){await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[users[index]]);await db.exec('SET ROLE authenticated');}
async function ingest(messages=[message()]){await db.exec('RESET ROLE');return scalar('SELECT ingest_payment_emails($1,$2::jsonb)',['it@limelightit.io',JSON.stringify(parseContaboBatch(batch(messages)).messages)]);}
test('database access is limited to the three named active verified accounts',async()=>{
 await ingest();
 for(let i=0;i<3;i++){await login(i);assert.equal((await scalar('SELECT payment_alert_overview()')).active.length,1);}
 await login(3);assert.equal(Number(await scalar('SELECT count(*) FROM payment_email_alerts')),0);
 await assert.rejects(scalar('SELECT payment_alert_overview()'),/access denied/);
 await assert.rejects(db.exec("INSERT INTO payment_email_alerts(mailbox,gmail_message_id,sender,subject,received_at) VALUES('it@limelightit.io','abcdef1234567891','no-reply@contabo.com','test',now())"),/permission denied/);
 await login(0);await assert.rejects(scalar('SELECT ingest_payment_emails($1,$2::jsonb)',['it@limelightit.io','[]']),/permission denied/);
 await db.exec('RESET ROLE');await db.query('UPDATE profiles SET is_active=false WHERE id=$1',[users[0]]);
 await login(0);await assert.rejects(scalar('SELECT payment_alert_overview()'),/access denied/);
 await db.exec('RESET ROLE');await db.query('UPDATE profiles SET is_active=true WHERE id=$1',[users[0]]);
});
test('seen stays active; payment clears globally; duplicates do not reopen; new emails alert again',async()=>{
 await login(0);const id=(await scalar('SELECT payment_alert_overview()')).active[0].id;
 await scalar('SELECT set_payment_alert_status($1,$2)',[id,'seen']);
 await login(1);let view=await scalar('SELECT payment_alert_overview()');
 assert.equal(view.active[0].status,'seen');assert.equal(view.active[0].seen_by_email,'tarun@limelightit.io');
 await scalar('SELECT set_payment_alert_status($1,$2)',[id,'paid']);
 await login(2);view=await scalar('SELECT payment_alert_overview()');
 assert.equal(view.active.length,0);assert.equal(view.history[0].paid_by_email,'nitsanghani1@gmail.com');
 assert.equal(await ingest(),0);
 await login(0);assert.equal((await scalar('SELECT payment_alert_overview()')).active.length,0);
 await scalar('SELECT set_payment_alert_status($1,$2)',[id,'seen']);
 assert.equal((await scalar('SELECT payment_alert_overview()')).history[0].status,'paid');
 assert.equal(await ingest([message('abcdef1234567892')]),1);
 await login(0);assert.equal((await scalar('SELECT payment_alert_overview()')).active.length,1);
 assert.equal(Number(await scalar('SELECT count(*) FROM payment_alert_events')),2);
 await assert.rejects(scalar('SELECT set_payment_alert_status($1,$2)',[id,'delete']),/Invalid/);
});
test('rejected batches leave no partial records or fake heartbeat',async()=>{
 await db.exec('RESET ROLE');const before=await scalar('SELECT count(*) FROM payment_email_alerts');
 await assert.rejects(scalar('SELECT ingest_payment_emails($1,$2::jsonb)',['it@limelightit.io',JSON.stringify([
 {...message('abcdef1234567893'),sender:'no-reply@contabo.com'}, {...message('abcdef1234567894'),sender:'bad@example.com'}])]),/Invalid/);
 assert.equal(await scalar('SELECT count(*) FROM payment_email_alerts'),before);
 await assert.rejects(scalar('SELECT ingest_payment_emails($1,$2::jsonb)',['other@example.com','[]']),/Unexpected/);
 await scalar('SELECT ingest_payment_emails($1,$2::jsonb)',['it@limelightit.io','[]']);
 assert.ok(await scalar('SELECT last_checked_at IS NOT NULL FROM payment_alert_monitor'));
});
test('removed test sender is rejected by both parser and database while Contabo remains accepted',async()=>{
 const testMessage={...message('abcdef1234567895'),sender:'nitsanghani05@gmail.com'};
 assert.throws(()=>parseContaboBatch(batch([testMessage])));
 await db.exec('RESET ROLE');
 await assert.rejects(scalar('SELECT ingest_payment_emails($1,$2::jsonb)',['it@limelightit.io',JSON.stringify([testMessage])]),/Invalid/);
 assert.equal(Number(await scalar("SELECT count(*) FROM information_schema.columns WHERE table_name='payment_alert_monitor' AND column_name IN ('test_sender','test_until')")),0);
 assert.equal(await ingest([message('abcdef1234567897')]),1);
});
