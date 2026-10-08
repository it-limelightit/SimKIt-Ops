import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const module=await import('data:text/javascript;base64,'+Buffer.from(compile('src/lib/phase-draft.ts')).toString('base64'));
const {createPhaseDraft,persistPhaseChanges}=module;
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function database(initial, options={}) {
  let row=initial===null?null:{data:structuredClone(initial),updated_at:'1',worker_id:'original-worker'};
  let reads=0,writes=0;
  const client={from(){let kind='read',record=null;const filters={};const query={
    select(){return kind==='read'?query:execute();},
    eq(key,value){filters[key]=value;return query;},
    async maybeSingle(){reads++;if(options.readError)return {error:new Error('read failed')};return {data:row?structuredClone(row):null};},
    update(value){kind='update';record=value;return query;},
    insert(value){kind='insert';record=value;return query;},
  };
  async function execute(){writes++;if(options.intervene&&(writes===1||options.everyWrite))row={...row,...options.intervene(structuredClone(row))};
    if(kind==='insert'&&row)return {error:{code:'23505'}};
    if(kind==='update'&&(!row||filters.updated_at!==row.updated_at))return {data:[]};
    row={...row,...structuredClone(record),updated_at:String(Number(row?.updated_at||'0')+1)};
    return {data:[{data:options.badResponse?{}:structuredClone(row.data)}]};
  }return query;}};
  return {client,get row(){return row;},get reads(){return reads;},get writes(){return writes;}};
}

test('a delayed autofill cannot erase a successfully submitted full form',async()=>{
  let stored={};const draft=createPhaseDraft({},async changes=>{stored={...stored,...changes};return true;},()=>true,()=>{});
  const stalePrefill=draft.patch;
  const completed={factory_op_owners:[{name:'Owner'}],factory_op_technicians:[{name:'Technician'}],factory_op_shifts:[{name:'Day'}],assessment_phase_submitted:true};
  assert.equal(await draft.save(completed,{}),true);
  await stalePrefill({factory_op_name:'Company',factory_op_address:'Address'});
  assert.deepEqual(stored,{...completed,factory_op_name:'Company',factory_op_address:'Address'});
});

test('rapid edits are merged and writes remain ordered with a request in flight',async()=>{
  let stored={},inFlight=0,maxInFlight=0,release;
  const first=new Promise(resolve=>{release=resolve;});let calls=0;
  const draft=createPhaseDraft({},async changes=>{inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);if(++calls===1)await first;stored={...stored,...changes};inFlight--;return true;},()=>true,()=>{});
  const a=draft.patch({factory_op_name:'Company'});await tick();
  const b=draft.patch({factory_op_owners:[{name:'Owner'}]});
  const c=draft.save({assessment_phase_submitted:true},{});
  release();await Promise.all([a,b,c]);
  assert.equal(maxInFlight,1);assert.equal(stored.factory_op_name,'Company');assert.equal(stored.factory_op_owners[0].name,'Owner');assert.equal(stored.assessment_phase_submitted,true);
});

test('failed changes are retried by explicit submission and failure is returned',async()=>{
  let first=true,stored={};const draft=createPhaseDraft({},async changes=>{if(first){first=false;return false;}stored={...stored,...changes};return true;},()=>true,()=>{});
  assert.equal(await draft.patch({factory_op_owners:[{name:'Owner'}]}),false);
  assert.equal(await draft.save({assessment_phase_submitted:true},{}),true);
  assert.equal(stored.factory_op_owners[0].name,'Owner');
});

test('queued saves from a closed or switched form do not write',async()=>{
  let active=true,calls=0;const draft=createPhaseDraft({},async()=>{calls++;return true;},()=>active,()=>{});
  const save=draft.save({factory_op_name:'Old company'},{});active=false;
  assert.equal(await save,false);assert.equal(calls,0);
});

test('another browser changing unrelated fields is preserved after compare-and-set retry',async()=>{
  const db=database({factory_op_owners:[{name:'Owner'}]},{intervene:r=>({data:{...r.data,mom_uploaded:true},updated_at:'2'})});
  assert.equal(await persistPhaseChanges(db.client,'assessment','site',null,{factory_op_name:'Company'},()=>true,{}),true);
  assert.equal(db.writes,2);assert.equal(db.row.data.mom_uploaded,true);assert.equal(db.row.data.factory_op_owners[0].name,'Owner');assert.equal(db.row.worker_id,'original-worker');
});

test('conflicting edits to the same field stop instead of overwriting newer data',async()=>{
  const db=database({factory_op_owners:[{name:'Newer owner'}]});
  await assert.rejects(persistPhaseChanges(db.client,'assessment','site',null,{factory_op_owners:[{name:'Stale edit'}]},()=>true,{factory_op_owners:[{name:'Old owner'}]}),/another session/);
  assert.equal(db.writes,0);assert.equal(db.row.data.factory_op_owners[0].name,'Newer owner');
});

test('repeated concurrency conflicts fail without claiming a successful save',async()=>{
  const db=database({},{everyWrite:true,intervene:r=>({updated_at:String(Number(r.updated_at)+1)})});
  await assert.rejects(persistPhaseChanges(db.client,'assessment','site',null,{factory_op_name:'Company'},()=>true),/changed in another session/);
  assert.equal(db.writes,3);assert.equal(db.row.data.factory_op_name,undefined);
});

test('failed reads cannot overwrite the form with an empty snapshot',async()=>{
  const db=database({factory_op_owners:[{name:'Owner'}]},{readError:true});
  await assert.rejects(persistPhaseChanges(db.client,'assessment','site',null,{factory_op_name:'Company'},()=>true),/read failed/);assert.equal(db.writes,0);
});

test('concurrent creation of a missing row is retried without losing its fields',async()=>{
  const db=database(null,{intervene:()=>({data:{mom_uploaded:true},updated_at:'1'})});
  assert.equal(await persistPhaseChanges(db.client,'assessment','site','worker',{factory_op_name:'Company'},()=>true),true);
  assert.equal(db.row.data.mom_uploaded,true);assert.equal(db.row.data.factory_op_name,'Company');
});

test('save responses are checked against the requested values',async()=>{
  const db=database({},{badResponse:true});
  await assert.rejects(persistPhaseChanges(db.client,'assessment','site',null,{factory_op_name:'Company'},()=>true),/verification failed/);
});

test('submission cannot claim success if previously saved details were removed by another session',async()=>{
  const previous={factory_op_owners:[{name:'Owner'}]};
  const db=database({});
  await assert.rejects(persistPhaseChanges(db.client,'assessment','site',null,{assessment_phase_submitted:true},()=>true,previous,{...previous,assessment_phase_submitted:true}),/Saved form data changed/);
  assert.equal(db.writes,0);
});

test('unchanged explicit saves verify the full form instead of silently succeeding on missing data',async()=>{
  const db=database({});
  await assert.rejects(persistPhaseChanges(db.client,'assessment','site',null,{},()=>true,{factory_op_name:'Company'},{factory_op_name:'Company'}),/Saved form data changed/);
  assert.equal(db.writes,0);
});

test('the actual hook ignores pre-load patches and stale load responses after site switching',async()=>{
  const states=[],refs=[];let cursor=0,refCursor=0,effects=[],writes=0;
  const resolveReads={};
  globalThis.phaseHookTest={...module,
    useState(value){const i=cursor++;if(!(i in states))states[i]=value;return [states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},
    useRef(value){return refs[refCursor++]??=( {current:value} );},useCallback:fn=>fn,useEffect:fn=>effects.push(fn),toast:{error(){}},
    supabase:{from(){return {select(){return {eq(_key,site){return {maybeSingle:()=>new Promise(resolve=>{resolveReads[site]=resolve;})};}};},upsert(){writes++;return {error:null};}};}},
  };
  const code='const {useState,useRef,useEffect,useCallback,supabase,toast,createPhaseDraft,persistPhaseChanges}=globalThis.phaseHookTest;\n'+compile('src/lib/use-phase-data.ts').replace(/^import .*?;\r?\n/gm,'');
  const {usePhaseData}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  cursor=0;refCursor=0;const first=usePhaseData('assessment','first','worker',{});const cleanup=effects.pop()();
  first.patch({factory_op_name:'Premature write'});assert.equal(writes,0);cleanup();
  cursor=0;refCursor=0;effects=[];usePhaseData('assessment','second','worker',{});effects.pop()();
  resolveReads.second({data:{data:{factory_op_name:'Second company'}}});await tick();
  resolveReads.first({data:{data:{factory_op_name:'First company'}}});await tick();
  assert.equal(refs[1].current.siteId,'second');assert.equal(states[0].factory_op_name,'Second company');assert.equal(writes,0);
  delete globalThis.phaseHookTest;
});
