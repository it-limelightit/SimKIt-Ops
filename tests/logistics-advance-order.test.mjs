import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const manager = "00000000-0000-4000-8000-000000000001";
const associate = "00000000-0000-4000-8000-000000000002";
const scoped = "00000000-0000-4000-8000-000000000003";
const scalar = async (sql, args = []) => Object.values((await db.query(sql,args)).rows[0])[0];
const asUser = id => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);
let serial = 10;
const newSite = async (extra = {}) => {
  const id = `00000000-0000-4000-8000-${String(++serial).padStart(12,"0")}`;
  await db.query("INSERT INTO sites(id,name,company_name,address,assigned_worker_id) VALUES($1,$2,$2,$3,$4)",[id,`Company ${serial}`, extra.address ?? "Factory address", extra.worker === undefined ? associate : extra.worker]);
  return id;
};
const selection = extra => ({ notes: JSON.stringify({dm_selected:true,without_cavli:false}), ...extra });
const create = (site, values = selection()) => scalar("SELECT logistics_create_advance_order($1,$2::jsonb)",[site,JSON.stringify(values)]);

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES('${manager}'),('${associate}'),('${scoped}');
    CREATE TABLE profiles(id uuid PRIMARY KEY,name text,is_active boolean DEFAULT true);
    INSERT INTO profiles VALUES('${associate}','Field Associate',true);
    CREATE TABLE sites(id uuid PRIMARY KEY,name text,company_name text,city text,address text,assigned_worker_id uuid,task_notes text);
    CREATE FUNCTION is_staff(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT id='${manager}'::uuid $$;
    CREATE FUNCTION has_scoped_manager_module(module text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid()='${scoped}'::uuid AND module='logistic' $$;
    CREATE FUNCTION assert_manager_module_access(module text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
    CREATE FUNCTION field_ops_site_metadata(notes text) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(notes::jsonb,'{}'::jsonb) $$;
    CREATE FUNCTION field_ops_worker_ids(site sites) RETURNS uuid[] LANGUAGE sql STABLE AS $$ SELECT ARRAY[site.assigned_worker_id] $$;
    CREATE FUNCTION field_ops_site_active(site sites) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION field_ops_associate(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM profiles p WHERE p.id=$1 AND p.is_active) $$;
    CREATE FUNCTION inventory_dispatch_notes(notes text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN coalesce(notes::jsonb,'{}'::jsonb); EXCEPTION WHEN others THEN RETURN '{}'::jsonb; END $$;
    CREATE TABLE inventory_materials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),material_name text,location text,created_by uuid,quantity numeric,unit text,submitted boolean,state text CHECK(state IN ('Available','In transit')),order_source text,
      ct1 text,ct2 text,ct3 text,proxy1 text,proxy2 text,proxy_model text,encoder text,vibration text,vibration_model text,antenna text,tower_light text,energy_meter text,plc text,notes text);`);
  const sql = readFileSync(new URL("../supabase/migrations/20261022190000_logistics_advance_orders.sql",import.meta.url),"utf8");
  await db.exec(sql);
  await db.exec(sql);
  await db.exec("SET ROLE authenticated");
  await asUser(manager);
});
after(() => db.close());

test("only logistics managers can read companies and place advance orders",async () => {
  await asUser(associate);
  await assert.rejects(()=>scalar("SELECT logistics_advance_companies()"),/Logistics manager access required/);
  await assert.rejects(()=>create(manager),/Logistics manager access required/);
  await asUser(scoped);
  assert(Array.isArray(await scalar("SELECT logistics_advance_companies()")));
  await asUser(manager);
});

test("advance order uses server company and associate details and enters Pending",async () => {
  await db.exec("RESET ROLE");
  const site = await newSite();
  await db.exec("SET ROLE authenticated");
  const result = await create(site, selection({created_by:manager,material_name:"Forged",location:"Other address",state:"Delivered",ct3:"TRUE",proxy1:"TRUE",proxy_model:"Forged"}));
  assert.equal(result.created_by,associate);
  assert.equal(result.advance_order_actor,manager);
  assert.equal(result.site_id,site);
  assert.notEqual(result.material_name,"Forged");
  assert.equal(result.location,"Factory address");
  assert.equal(result.state,"Available");
  assert.equal(JSON.parse(result.notes).logistics_status,"Pending");
  assert.equal(result.ct3,"TRUE");
  assert.equal(result.proxy_model,"Inductive");
  assert.equal(result.quantity,1);
  await assert.rejects(()=>create(site),/Already ordered/);
});

test("missing address, missing associate and inactive associate block creation",async () => {
  await db.exec("RESET ROLE");
  const noAddress = await newSite({address:" "});
  const noWorker = await newSite({worker:null});
  const inactive = await newSite({worker:manager});
  await db.exec("SET ROLE authenticated");
  await assert.rejects(()=>create(noAddress),/delivery address is required/);
  await assert.rejects(()=>create(noWorker),/active field associate/);
  await assert.rejects(()=>create(inactive),/active field associate/);
});

test("sensor-only orders are accepted and invalid selections are rejected",async () => {
  await db.exec("RESET ROLE");
  const site = await newSite();
  await db.exec("SET ROLE authenticated");
  await assert.rejects(()=>create(site,selection({notes:'{"dm_selected":false,"without_cavli":false}'})),/at least one/);
  await assert.rejects(()=>create(site,selection({ct1:"TRUE",ct3:"TRUE"})),/single-phase or three-phase/);
  await assert.rejects(()=>create(site,selection({vibration:"TRUE",vibration_model:"other"})),/valid vibration/);
  await assert.rejects(()=>create(site,{notes:"{}"}),/Invalid device selection/);
  const result = await create(site,selection({notes:'{"dm_selected":false,"without_cavli":true}',vibration:"TRUE",vibration_model:"vibe-q"}));
  assert.equal(JSON.parse(result.notes).dm_selected,false);
  assert.equal(JSON.parse(result.notes).without_cavli,false);
  assert.equal(result.vibration_model,"vibe-q");
});

test("legacy field associate orders prevent a second manager order for the same company",async () => {
  await db.exec("RESET ROLE");
  const site = await newSite();
  await db.query("INSERT INTO inventory_materials(material_name,submitted,state) SELECT company_name,true,'Available' FROM sites WHERE id=$1",[site]);
  await db.exec("SET ROLE authenticated");
  await assert.rejects(()=>create(site),/Already ordered/);
});
