import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const staff='00000000-0000-4000-8000-000000000001';
const worker='00000000-0000-4000-8000-000000000002';
const other='00000000-0000-4000-8000-000000000003';
const site='00000000-0000-4000-8000-000000000010';
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const asUser=async(id,role='authenticated')=>{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[id??'',role]);};
before(async()=>{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE SCHEMA extensions;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,encrypted_password text,updated_at timestamptz);
 CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),email text,mobile text);
 CREATE TABLE public.user_roles(user_id uuid REFERENCES auth.users(id),role text);
 CREATE TABLE public.sites(id uuid PRIMARY KEY,name text,company_name text,address text,city text,task_notes text,consultant_stage text,assigned_worker_id uuid REFERENCES auth.users(id));
 CREATE TABLE public.assessment(site_id uuid PRIMARY KEY REFERENCES sites(id),data jsonb,updated_at timestamptz);
 CREATE FUNCTION public.is_staff(actor uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=actor AND role IN ('owner','supervisor')) $$;
 CREATE FUNCTION public.can_access_site(site uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT public.is_staff(auth.uid()) OR EXISTS(SELECT 1 FROM sites WHERE id=site AND assigned_worker_id=auth.uid()) $$;
 INSERT INTO auth.users(id) VALUES('${staff}'),('${worker}'),('${other}');
 INSERT INTO profiles(id,email) VALUES('${staff}','staff@example.test'),('${worker}','worker@example.test'),('${other}','other@example.test');
 INSERT INTO user_roles VALUES('${staff}','owner'),('${worker}','worker'),('${other}','worker');
 INSERT INTO sites(id,name,assigned_worker_id,task_notes) VALUES('${site}','Migration fixture','${worker}','Retain original notes');`);
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261007180000_restore_cloud_workflow_functions.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
test('assigned user can invite a client without removing original site notes',async()=>{
 await asUser(worker);
 assert.equal((await scalar('SELECT save_client_invitation($1,$2,$3)',[site,'client@example.test','fixture-token'])).success,true);
 const notes=await scalar('SELECT task_notes FROM sites WHERE id=$1',[site]);
 assert.ok(notes.endsWith('Retain original notes'));
 assert.ok(notes.includes('fixture-token'));
});
test('unassigned user and anonymous caller cannot replace client invitations',async()=>{
 for(const id of [other,null]){
  await asUser(id,id?'authenticated':'anon');
  await assert.rejects(db.query('SELECT save_client_invitation($1,$2,$3)',[site,'bad@example.test','wrong-token']),/Access denied/);
 }
});
test('valid client token retrieves and submits the matching form only',async()=>{
 await asUser(null,'anon');
 const loaded=await scalar('SELECT get_client_form_site_by_token($1)',['fixture-token']);
 assert.equal(loaded.success,true);assert.equal(loaded.site.id,site);
 assert.equal((await scalar('SELECT save_client_form_by_token($1,$2)',['fixture-token',JSON.stringify({machine_count:3})])).success,true);
 const data=await scalar('SELECT data FROM assessment WHERE site_id=$1',[site]);
 assert.deepEqual(data,{machine_count:3,factory_operations_done:true,assessment_phase_submitted:true});
});
test('invalid client token cannot read or write a form',async()=>{
 assert.equal((await scalar('SELECT get_client_form_site_by_token($1)',['wrong-token'])).success,false);
 assert.equal((await scalar('SELECT save_client_form_by_token($1,$2)',['wrong-token','{}'])).success,false);
 assert.equal(await scalar('SELECT count(*) FROM assessment'),1);
});
test('nonstaff user cannot delete an account',async()=>{
 await asUser(worker);
 await assert.rejects(db.query('SELECT delete_worker($1)',[other]),/Access denied/);
 assert.equal(await scalar('SELECT count(*) FROM auth.users WHERE id=$1',[other]),1);
});
test('staff account deletion removes the account, profile and roles together',async()=>{
 await asUser(staff);
 await db.query('SELECT delete_worker($1)',[other]);
 assert.equal(await scalar('SELECT count(*) FROM auth.users WHERE id=$1',[other]),0);
 assert.equal(await scalar('SELECT count(*) FROM profiles WHERE id=$1',[other]),0);
 assert.equal(await scalar('SELECT count(*) FROM user_roles WHERE user_id=$1',[other]),0);
});
test('legacy identifier resets are unavailable to anonymous and ordinary authenticated callers',async()=>{
 for(const signature of ['public.reset_password_by_identifier(text,text)','public.reset_user_password(uuid,text)']){
  for(const role of ['anon','authenticated'])assert.equal(await scalar('SELECT has_function_privilege($1,$2,\'EXECUTE\')',[role,signature]),false);
  assert.equal(await scalar('SELECT has_function_privilege($1,$2,\'EXECUTE\')',['service_role',signature]),true);
 }
 assert.equal(await scalar("SELECT has_function_privilege('anon','public.delete_worker(uuid)','EXECUTE')"),false);
});
