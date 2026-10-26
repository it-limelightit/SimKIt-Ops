import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('fast metadata parser preserves legacy parsing for normal, nested, escaped and ambiguous notes',async()=>{
 const db=new PGlite();
 try{
  const original=readFileSync(new URL('../supabase/migrations/20261005120000_field_operations_attendance_earnings.sql',import.meta.url),'utf8');
  const parser=original.slice(original.indexOf('CREATE FUNCTION public.field_ops_site_metadata'),original.indexOf('CREATE FUNCTION public.field_ops_worker_ids'));
  await db.exec(parser.replace('public.field_ops_site_metadata','public.legacy_field_ops_site_metadata'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261023130000_field_metadata_parse_fast_path.sql',import.meta.url),'utf8'));
  const meta={status:'Installed',worker_ids:['00000000-0000-4000-8000-000000000002'],message:'a } brace, a "]" bracket, "quotes" and \\ paths',nested:{items:[{name:'sensor'}]},activity_logs:[{id:1,note:'ગુજરાતી factory notes with { braces } and [brackets]'}]};
  const block=`[METADATA:${JSON.stringify(meta)}]`;
  const cases=[null,'Plain notes',block,'prefix '+block+' normal [notes]',block+' free text {another block}]',block+'[METADATA:{"status":"Submitted"}]',block.slice(0,-1),'[METADATA:{broken}]','[METADATA:{"note":"a } brace","nested":[{"a":1}]}]','[METADATA:{\n"status":"Assessed"\n}]'];
  for(const notes of cases){const [row]=(await db.query('SELECT field_ops_site_metadata($1) actual,legacy_field_ops_site_metadata($1) expected',[notes])).rows;assert.deepEqual(row.actual,row.expected);}
  const parsed=(await db.query('SELECT field_ops_site_metadata($1) actual',[block])).rows[0].actual;assert.deepEqual(parsed,meta);
  const large={...meta,activity_logs:Array.from({length:100},(_,i)=>({id:i,note:'ગુજરાતી factory notes with { braces } and [brackets] '.repeat(4)}))};
  assert.deepEqual((await db.query('SELECT field_ops_site_metadata($1) actual',[`[METADATA:${JSON.stringify(large)}]`])).rows[0].actual,large);
 }finally{await db.close();}
});
