import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const js=ts.transpileModule(readFileSync(new URL('../src/lib/company-source.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {filterCompanySource}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('NPC and Lead counts remain separate, with legacy companies retained as NPC',()=>{
 const sites=[{id:'legacy',status:'Submitted'},{id:'npc',company_source:'npc',status:'Submitted'},{id:'lead',company_source:'lead',status:'Submitted'},{id:'lead-pending',company_source:'lead',status:'Assessed'}];
 const npc=filterCompanySource(sites,'npc'),lead=filterCompanySource(sites,'lead');
 assert.deepEqual(npc.map(s=>s.id),['legacy','npc']);
 assert.equal(npc.filter(s=>s.status==='Submitted').length,2);
 assert.deepEqual(lead.map(s=>s.id),['lead','lead-pending']);
 assert.equal(lead.filter(s=>s.status==='Submitted').length,1);
 assert.equal(sites.length,4);
});

test('migration preserves existing company data, defaults new sites to NPC, and validates source',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE sites(id integer PRIMARY KEY,name text,task_notes text); INSERT INTO sites VALUES(1,'Existing factory','Saved work history');`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261023120000_site_company_source.sql',import.meta.url),'utf8'));
  assert.deepEqual((await db.query('SELECT * FROM sites WHERE id=1')).rows[0],{id:1,name:'Existing factory',task_notes:'Saved work history',company_source:'npc'});
  await db.exec(`INSERT INTO sites(id,name) VALUES(2,'NPC company'); INSERT INTO sites VALUES(3,'Sales company','Existing workflow','lead');`);
  assert.equal((await db.query('SELECT company_source FROM sites WHERE id=2')).rows[0].company_source,'npc');
  await db.exec(`UPDATE sites SET task_notes='Assessment complete' WHERE id=3`);
  assert.equal((await db.query('SELECT company_source FROM sites WHERE id=3')).rows[0].company_source,'lead');
  await assert.rejects(db.exec(`INSERT INTO sites VALUES(4,'Invalid',null,'other')`),/sites_company_source_check/);
  await assert.rejects(db.exec(`UPDATE sites SET company_source=NULL WHERE id=3`),/not-null/);
 }finally{await db.close();}
});
