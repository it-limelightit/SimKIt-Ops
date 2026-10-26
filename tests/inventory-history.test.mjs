import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const manager='00000000-0000-4000-8000-000000000001',worker='00000000-0000-4000-8000-000000000002',scoped='00000000-0000-4000-8000-000000000003';
const migration=name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8').replace(/^BEGIN;\s*/m,'').replace(/COMMIT;\s*$/,'');
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const asUser=id=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id??'']);
const history=(args={})=>scalar(`SELECT inventory_history(_view=>$1,_company=>$2,_item=>$3,_from=>$4,_to=>$5,_search=>$6,_page=>$7,_page_size=>$8)`,[args.view??'company',args.company??'',args.item??'',args.from??null,args.to??null,args.search??'',args.page??1,args.size??20]);
const enable=()=>db.exec(migration('20261023140000_inventory_issue_history.sql'));
const order=async(name,ct='TRUE')=>scalar(`INSERT INTO inventory_materials(material_name,ct1,ct2,ct3,tower_light,notes) VALUES($1,$2,$2,$2,'TRUE','{"dm_selected":false,"logistics_status":"Pending"}') RETURNING id`,[name,ct]);
const pack=id=>db.query(`UPDATE inventory_materials SET notes='{"dm_selected":false,"logistics_status":"Packing"}' WHERE id=$1`,[id]);
let oldOrder,pendingOrder,activationStock;
before(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION is_staff(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT id='${manager}'::uuid $$;
 CREATE FUNCTION has_scoped_manager_module(module text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid()='${scoped}'::uuid AND module='inventory' $$;
 CREATE FUNCTION assert_manager_module_access(module text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF auth.uid()='${worker}'::uuid THEN RAISE EXCEPTION 'Module access denied' USING ERRCODE='42501'; END IF; END $$;
 CREATE TABLE profiles(id uuid PRIMARY KEY,name text);INSERT INTO profiles VALUES('${manager}','Manager'),('${worker}','Worker'),('${scoped}','Inventory operator');
 CREATE TABLE inventory_materials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),material_name text,quantity numeric DEFAULT 1,submitted boolean DEFAULT true,created_at timestamptz DEFAULT clock_timestamp(),state text DEFAULT 'Pending',notes text,uplink text,device_id text,order_source text,
 ct1 text DEFAULT 'FALSE',ct2 text DEFAULT 'FALSE',ct3 text DEFAULT 'FALSE',energy_meter text DEFAULT 'FALSE',proxy1 text DEFAULT 'FALSE',proxy2 text DEFAULT 'FALSE',proxy_model text,encoder text DEFAULT 'FALSE',vibration text DEFAULT 'FALSE',vibration_model text,antenna text DEFAULT 'FALSE',tower_light text DEFAULT 'FALSE',plc text DEFAULT 'FALSE');`);
 for(const name of ['20260907150000_create_inventory_stock.sql','20260908100000_create_inventory_bom.sql','20261013160000_atomic_inventory_dispatch.sql','20261021120000_inventory_packing_consumption.sql'])await db.exec(migration(name));
 for(const [category,quantity,unit,notes]of [['YHDC CT SENSOR',2,'Nos',{}],['YHDC CT SENSOR',8,'Nos',{}],['2 CORE WIRE',100,'Meter',{}],['TOWER LIGHT',10,'Nos',{}],['YHDC CT SENSOR',1000,'Nos',{inventory_entry_type:'bulk_order'}]]){
  await db.query('INSERT INTO inventory_stock(category,actual_quantity,unit_price,notes) VALUES($1,$2,10,$3)',[category,quantity,JSON.stringify({...notes,inventory_unit:unit})]);
 }
 for(const category of ['BOX','POWER CORD CABLE','PANEL BOX/DOOR/LOCK','UV PRINTING','CABLE GLAND'])await db.query("INSERT INTO inventory_stock(category,actual_quantity,unit_price,notes) VALUES($1,100,10,'{\"inventory_unit\":\"Nos\"}')",[category]);
 await asUser(manager);oldOrder=await order('Completed before activation','FALSE');await pack(oldOrder);
 pendingOrder=await order('Pending before activation');activationStock=await scalar('SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM inventory_stock s');await enable();
});
after(()=>db.close());beforeEach(async()=>{await db.exec('BEGIN');await asUser(manager);});afterEach(()=>db.exec('ROLLBACK'));

test('activation starts empty and preserves old receipts, balances and previously pending orders',async()=>{
 assert.equal((await history()).total_records,0);assert.deepEqual(await scalar('SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM inventory_stock s'),activationStock);
 await pack(pendingOrder);const data=await history();assert.equal(data.total_records,1);assert.equal(data.issues[0].company_name,'Pending before activation');assert.match(data.issues[0].reference,/^ISS-\d{6,}$/);
 await db.query(`UPDATE inventory_materials SET notes='{"dm_selected":false,"logistics_status":"Delivered"}' WHERE id=$1`,[oldOrder]);assert.equal((await history()).total_records,1);
});

test('FIFO batches are combined and fixed balances differ from current stock after later companies and restocks',async()=>{
 const a=await order('Factory A');await pack(a);let first=(await history()).issues[0];
 assert.equal(first.items.length,8);const sensor=first.items.find(i=>i.category==='YHDC CT SENSOR');assert.equal(sensor.quantity,3);assert.equal(sensor.stock_before,10);assert.equal(sensor.stock_after,7);assert.equal(sensor.current_stock,7);
 const b=await order('Factory B');await pack(b);let data=await history({company:'Factory A'});assert.equal(data.issues[0].items.find(i=>i.category==='YHDC CT SENSOR').current_stock,4);
 await db.exec(`UPDATE inventory_stock SET actual_quantity=actual_quantity+5 WHERE category='YHDC CT SENSOR' AND actual_quantity=0 AND notes NOT LIKE '%bulk_order%'`);
 data=await history({company:'Factory A'});const saved=data.issues[0].items.find(i=>i.category==='YHDC CT SENSOR');assert.equal(saved.stock_before,10);assert.equal(saved.stock_after,7);assert.equal(saved.current_stock,9);
 assert.equal((await history()).company_count,2);assert.equal((await history()).item_type_count,8);
});

test('logistics updates do not create duplicate issues and deleted orders keep their immutable history',async()=>{
 const id=await order('Original Company');await pack(id);const first=(await history()).issues[0];
 await db.query(`UPDATE inventory_materials SET material_name='Renamed Company',notes='{"dm_selected":false,"logistics_status":"Delivered"}' WHERE id=$1`,[id]);
 let data=await history();assert.equal(data.total_records,1);assert.equal(data.issues[0].reference,first.reference);assert.equal(data.issues[0].company_name,'Original Company');assert.equal(data.issues[0].logistics_status,'Delivered');
 await db.query('DELETE FROM inventory_materials WHERE id=$1',[id]);data=await history();assert.equal(data.issues[0].order_exists,false);assert.equal(data.issues[0].items.length,8);
});

test('item filters, search, pagination and IST dates return matching history only',async()=>{
 await pack(await order('Factory A'));await pack(await order('Factory B'));
 const all=await history();const sensorKey=all.products.find(p=>p.category==='YHDC CT SENSOR').key;
 const items=await history({view:'item',item:sensorKey});assert.equal(items.total_records,2);assert.equal(items.item_rows.length,2);
 assert.equal((await history({search:all.issues[0].reference})).total_records,1);
 assert.equal((await history({company:'Factory B',item:sensorKey})).issues[0].items.length,1);
 assert.equal((await history({size:1,page:2})).issues.length,1);
 const today=await scalar("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text");assert.equal((await history({from:today,to:today})).total_records,2);
 assert.equal((await history({to:'2000-01-01'})).total_records,0);
});

test('workers and anonymous users cannot read history; scoped inventory managers can; direct writes are denied',async()=>{
 await pack(await order('Factory A'));
 await asUser(scoped);assert.equal((await history()).total_records,1);
 for(const id of [worker,null]){await asUser(id);await db.exec('SAVEPOINT denied');await assert.rejects(history(),/Inventory manager access required/);await db.exec('ROLLBACK TO SAVEPOINT denied');}
 await asUser(manager);await db.exec('SET LOCAL ROLE authenticated');await db.exec('SAVEPOINT denied');await assert.rejects(db.exec("DELETE FROM inventory_issues"),/permission denied/);await db.exec('ROLLBACK TO SAVEPOINT denied');
});

test('insufficient stock rolls back both deductions and the new history entry',async()=>{
 const id=await order('Cannot issue');await db.exec("UPDATE inventory_stock SET actual_quantity=0 WHERE category='TOWER LIGHT'");
 const before=await scalar('SELECT sum(actual_quantity) FROM inventory_stock');await db.exec('SAVEPOINT packing');await assert.rejects(pack(id),/Insufficient stock/);await db.exec('ROLLBACK TO SAVEPOINT packing');
 assert.equal((await history()).total_records,0);assert.equal(await scalar('SELECT sum(actual_quantity) FROM inventory_stock'),before);
});

test('different models and units never share current stock totals',async()=>{
 await db.exec(`INSERT INTO inventory_stock(category,sensor_type,actual_quantity,unit_price,notes) VALUES
 ('VIBRATION SENSOR','Vibe Q',10,10,'{"inventory_unit":"Nos"}'),
 ('VIBRATION SENSOR','Other',500,10,'{"inventory_unit":"Nos"}'),
 ('4 CORE WIRE',null,100,10,'{"inventory_unit":"Meter"}'),
 ('4 CORE WIRE',null,800,10,'{"inventory_unit":"Nos"}')`);
 const id=await order('Model-specific factory');await db.query("UPDATE inventory_materials SET vibration='TRUE',vibration_model='Vibe Q' WHERE id=$1",[id]);await pack(id);
 const data=await history();const vibration=data.issues[0].items.find(i=>i.category==='VIBRATION SENSOR');
 assert.equal(vibration.stock_before,10);assert.equal(vibration.current_stock,9);assert.equal(vibration.model,'Vibe Q');
 const wire=data.issues[0].items.find(i=>i.category==='4 CORE WIRE');assert.equal(wire.stock_before,100);assert.equal(wire.current_stock,95);assert.equal(wire.unit,'Meter');
});
