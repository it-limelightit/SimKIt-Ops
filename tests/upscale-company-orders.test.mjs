import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const user = "00000000-0000-4000-8000-000000000001";
const site = "00000000-0000-4000-8000-000000000002";
const tracker = "00000000-0000-4000-8000-000000000003";
const migration = readFileSync(
  new URL("../supabase/migrations/20261015120000_upscale_company_orders.sql", import.meta.url),
  "utf8",
);
const deleteMigration = readFileSync(
  new URL("../supabase/migrations/20261015130000_delete_company_tracker_with_upscale_orders.sql", import.meta.url),
  "utf8",
);
const shippedDeleteMigration = readFileSync(
  new URL("../supabase/migrations/20261015140000_delete_shipped_upscale_orders_with_audit.sql", import.meta.url),
  "utf8",
);
const siteDeleteMigration = readFileSync(
  new URL("../supabase/migrations/20261015150000_delete_site_with_upscale_orders.sql", import.meta.url),
  "utf8",
);

test("Upscale conversion is atomic, validates device orders, and blocks direct conversion", async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES('${user}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.is_staff(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.has_scoped_manager_module(text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.can_access_company_tracker(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.assert_manager_module_access(text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
    CREATE FUNCTION public.inventory_dispatch_notes(text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
      SELECT coalesce(nullif($1,'')::jsonb,'{}'::jsonb) $$;
    CREATE TABLE public.sites(id uuid PRIMARY KEY, name text, company_name text, address text, city text);
    INSERT INTO public.sites VALUES('${site}','Test Site','Test Company','Test Address','Surat');
    CREATE TABLE public.company_tracker_assignments(
      id uuid PRIMARY KEY, site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE, assignee_id uuid,
      stage text, stage_changed_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    INSERT INTO public.company_tracker_assignments(id,site_id,assignee_id,stage)
      VALUES('${tracker}','${site}','${user}','Quotation Sent');
    CREATE TABLE public.company_tracker_comments(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tracker_id uuid,body text,stage text,author_id uuid,created_at timestamptz DEFAULT now());
    CREATE TABLE public.company_tracker_stage_history(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tracker_id uuid,previous_stage text,new_stage text,
      changed_by uuid,comment_id uuid,was_manual boolean,changed_at timestamptz DEFAULT now());
    CREATE TABLE public.inventory_materials(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),material_name text,location text,quantity numeric,unit text,
      state text,submitted boolean,created_by uuid,notes text,ct1 text,ct2 text,ct3 text,proxy1 text,proxy2 text,
      encoder text,vibration text,vibration_model text,antenna text,tower_light text,energy_meter text,plc text,
      proxy_model text,device_id text);
    ALTER TABLE public.inventory_materials ENABLE ROW LEVEL SECURITY;
  `);
  await db.exec(migration);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
  await assert.rejects(
    db.query("INSERT INTO public.company_tracker_assignments(id,site_id,assignee_id,stage) VALUES(gen_random_uuid(),$1,$2,'Converted')", [site,user]),
    /Create an Upscale device order/,
  );
  await assert.rejects(
    db.query("SELECT public.company_tracker_transition($1,'Ready',true)", [tracker]),
    /Upscale device order/,
  );
  const valid = [
    { machine_name: "Boiler A", components: { dm: true, ct1: true }, vibration_model: "" },
    {
      machine_name: "Boiler B",
      components: { dm: true, vibration: true },
      vibration_model: "vibe-q",
    },
  ];
  await assert.rejects(
    db.query("SELECT public.company_tracker_convert_upscale($1,'Ready',$2::jsonb)", [
      tracker,
      JSON.stringify([valid[0], { ...valid[1], machine_name: " boiler a " }]),
    ]),
    /Duplicate machine name/,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM public.upscale_company_orders")).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("SELECT stage FROM public.company_tracker_assignments WHERE id=$1", [tracker]))
      .rows[0].stage,
    "Quotation Sent",
  );
  await db.query("SELECT public.company_tracker_convert_upscale($1,'Ready',$2::jsonb)", [
    tracker,
    JSON.stringify(valid),
  ]);
  const rows = (
    await db.query(
      "SELECT order_source,client_machine_name,device_id,upscale_device_sequence FROM public.inventory_materials ORDER BY upscale_device_sequence",
    )
  ).rows;
  assert.deepEqual(
    rows.map((row) => row.client_machine_name),
    ["Boiler A", "Boiler B"],
  );
  assert(rows.every((row) => row.order_source === "upscale" && row.device_id === null));
  assert.equal(
    (await db.query("SELECT stage FROM public.company_tracker_assignments WHERE id=$1", [tracker]))
      .rows[0].stage,
    "Converted",
  );
  await assert.rejects(
    db.query("SELECT public.company_tracker_convert_upscale($1,'Again',$2::jsonb)", [
      tracker,
      JSON.stringify(valid),
    ]),
    /Quotation Sent/,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM public.inventory_materials")).rows[0].n,
    2,
  );
  const transitNotes = JSON.stringify({
    logistics_status: "Transit",
    dm_selected: true,
    without_cavli: false,
  });
  await assert.rejects(
    db.query(
      "UPDATE public.inventory_materials SET notes=$1 WHERE client_machine_name='Boiler A'",
      [transitNotes],
    ),
    /Confirm all requested components/,
  );
  await db.query(
    "UPDATE public.inventory_materials SET upscale_confirmed_components=$1::jsonb WHERE client_machine_name='Boiler A'",
    [JSON.stringify({ dm: true, ct1: true })],
  );
  await db.query(
    "UPDATE public.inventory_materials SET notes=$1 WHERE client_machine_name='Boiler A'",
    [transitNotes],
  );
  await assert.rejects(
    db.query(
      "UPDATE public.inventory_materials SET ct1='FALSE' WHERE client_machine_name='Boiler A'",
    ),
    /cannot be changed/,
  );
  await db.exec(`
    CREATE FUNCTION public.is_company_tracker_manager() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE TABLE public.inventory_dispatch_deductions(order_id uuid PRIMARY KEY);
    CREATE TABLE public.inventory_dispatch_excluded_orders(order_id uuid PRIMARY KEY);
    CREATE TABLE public.inventory_logs(order_id text, change_type text, quantity_changed numeric);
    INSERT INTO public.inventory_logs(order_id,change_type,quantity_changed)
      SELECT id::text,'INVENTORY_SERVER_MANAGED',0 FROM public.inventory_materials;
  `);
  await db.exec(deleteMigration);
  await assert.rejects(
    db.query("SELECT public.company_tracker_delete($1)", [tracker]),
    /shipped devices or inventory deductions/,
  );
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.company_tracker_assignments")).rows[0].n, 1);
  await db.query(
    "UPDATE public.inventory_materials SET notes=$1 WHERE client_machine_name='Boiler A'",
    [JSON.stringify({ logistics_status: "Pending", dm_selected: true, without_cavli: false })],
  );
  const deviceId = (await db.query("SELECT id FROM public.inventory_materials WHERE client_machine_name='Boiler A'")).rows[0].id;
  await db.query("INSERT INTO public.inventory_dispatch_deductions(order_id) VALUES($1)", [deviceId]);
  await assert.rejects(
    db.query("SELECT public.company_tracker_delete($1)", [tracker]),
    /shipped devices or inventory deductions/,
  );
  await db.query("DELETE FROM public.inventory_dispatch_deductions WHERE order_id=$1", [deviceId]);
  await db.query("SELECT public.company_tracker_delete($1)", [tracker]);
  for (const table of ["company_tracker_assignments", "upscale_company_orders", "inventory_materials", "inventory_logs"]) {
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n, 0);
  }

  const shippedTracker = "00000000-0000-4000-8000-000000000004";
  await db.query(
    "INSERT INTO public.company_tracker_assignments(id,site_id,assignee_id,stage) VALUES($1,$2,$3,'Quotation Sent')",
    [shippedTracker, site, user],
  );
  await db.query("SELECT public.company_tracker_convert_upscale($1,'Ready',$2::jsonb)", [
    shippedTracker,
    JSON.stringify([{ machine_name: "Press C", components: { dm: true }, vibration_model: "" }]),
  ]);
  const shippedDeviceId = (await db.query("SELECT id FROM public.inventory_materials WHERE client_machine_name='Press C'")).rows[0].id;
  await db.query("UPDATE public.inventory_materials SET upscale_confirmed_components=$1::jsonb WHERE id=$2", [JSON.stringify({ dm: true }), shippedDeviceId]);
  await db.query("UPDATE public.inventory_materials SET notes=$1 WHERE id=$2", [transitNotes, shippedDeviceId]);
  await db.query("INSERT INTO public.inventory_dispatch_deductions(order_id) VALUES($1)", [shippedDeviceId]);
  await db.query("INSERT INTO public.inventory_logs(order_id,change_type,quantity_changed) VALUES($1,'DISPATCH_DEDUCTION',-1)", [shippedDeviceId]);
  await db.exec(shippedDeleteMigration);
  await db.query("SELECT public.company_tracker_delete($1)", [shippedTracker]);
  const archived = (await db.query("SELECT company_name,jsonb_array_length(device_snapshots) AS devices FROM public.upscale_deleted_order_audit")).rows[0];
  assert.equal(archived.company_name, "Test Company");
  assert.equal(archived.devices, 1);
  for (const table of ["company_tracker_assignments", "upscale_company_orders", "inventory_materials"]) {
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n, 0);
  }
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.inventory_dispatch_deductions")).rows[0].n, 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.inventory_logs WHERE change_type='DISPATCH_DEDUCTION'")).rows[0].n, 1);

  const siteTracker = "00000000-0000-4000-8000-000000000005";
  await db.query(
    "INSERT INTO public.company_tracker_assignments(id,site_id,assignee_id,stage) VALUES($1,$2,$3,'Quotation Sent')",
    [siteTracker, site, user],
  );
  await db.query("SELECT public.company_tracker_convert_upscale($1,'Ready',$2::jsonb)", [
    siteTracker,
    JSON.stringify([{ machine_name: "Press D", components: { dm: true }, vibration_model: "" }]),
  ]);
  const siteDeviceId = (await db.query("SELECT id FROM public.inventory_materials WHERE client_machine_name='Press D'")).rows[0].id;
  await db.query("UPDATE public.inventory_materials SET upscale_confirmed_components=$1::jsonb WHERE id=$2", [JSON.stringify({ dm: true }), siteDeviceId]);
  await db.query("UPDATE public.inventory_materials SET notes=$1 WHERE id=$2", [transitNotes, siteDeviceId]);
  await db.query("INSERT INTO public.inventory_dispatch_deductions(order_id) VALUES($1)", [siteDeviceId]);
  await db.query("INSERT INTO public.inventory_logs(order_id,change_type,quantity_changed) VALUES($1,'DISPATCH_DEDUCTION',-1)", [siteDeviceId]);
  await db.exec(siteDeleteMigration);
  await db.query("SELECT public.site_delete_with_upscale($1)", [site]);
  for (const table of ["sites", "company_tracker_assignments", "upscale_company_orders", "inventory_materials"]) {
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n, 0);
  }
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.upscale_deleted_order_audit")).rows[0].n, 2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.inventory_dispatch_deductions")).rows[0].n, 2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.inventory_logs WHERE change_type='DISPATCH_DEDUCTION'")).rows[0].n, 2);
  await db.close();
});
