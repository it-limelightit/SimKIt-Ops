import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const originalMigration = readFileSync(
  new URL("../supabase/migrations/20261015120000_upscale_company_orders.sql", import.meta.url),
  "utf8",
);
const pendingMigration = readFileSync(
  new URL("../supabase/migrations/20261016100000_direct_converted_assignment_pending_upscale.sql", import.meta.url),
  "utf8",
);

test("manager direct conversion stays pending until its validated Upscale order is saved", async () => {
  const db = new PGlite();
  const user = "00000000-0000-4000-8000-000000000011";
  const site = "00000000-0000-4000-8000-000000000012";
  const directTracker = "00000000-0000-4000-8000-000000000013";
  const quotedTracker = "00000000-0000-4000-8000-000000000014";
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES('${user}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION public.is_staff(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
      CREATE FUNCTION public.has_scoped_manager_module(text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
      CREATE FUNCTION public.is_company_tracker_manager() RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT current_setting('test.manager',true)='true' $$;
      CREATE FUNCTION public.can_access_company_tracker(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
      CREATE FUNCTION public.assert_manager_module_access(text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
      CREATE FUNCTION public.company_tracker_mark_missed_monitoring_days() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
      CREATE FUNCTION public.inventory_dispatch_notes(text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
        SELECT coalesce(nullif($1,'')::jsonb,'{}'::jsonb) $$;
      CREATE TABLE public.sites(id uuid PRIMARY KEY, name text, company_name text, address text, city text);
      INSERT INTO public.sites VALUES('${site}','Test Site','Test Company','Test Address','Surat');
      CREATE TABLE public.profiles(id uuid PRIMARY KEY, name text);
      INSERT INTO public.profiles VALUES('${user}','Test Manager');
      CREATE TABLE public.company_tracker_assignments(
        id uuid PRIMARY KEY, site_id uuid REFERENCES public.sites(id), assignee_id uuid,
        stage text, stage_changed_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.company_tracker_comments(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tracker_id uuid,body text,stage text,author_id uuid,created_at timestamptz DEFAULT now());
      CREATE TABLE public.company_tracker_stage_history(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tracker_id uuid,previous_stage text,new_stage text,
        changed_by uuid,comment_id uuid,was_manual boolean,changed_at timestamptz DEFAULT now());
      CREATE TABLE public.company_tracker_issue_resolution(tracker_id uuid,checklist jsonb);
      CREATE TABLE public.company_tracker_monitoring_days(tracker_id uuid,day_number integer,checklist jsonb,result text,completed_at timestamptz);
      CREATE TABLE public.inventory_materials(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),material_name text,location text,quantity numeric,unit text,
        state text,submitted boolean,created_by uuid,notes text,ct1 text,ct2 text,ct3 text,proxy1 text,proxy2 text,
        encoder text,vibration text,vibration_model text,antenna text,tower_light text,energy_meter text,plc text,
        proxy_model text,device_id text);
      ALTER TABLE public.inventory_materials ENABLE ROW LEVEL SECURITY;
    `);
    await db.exec(originalMigration);
    await db.exec(pendingMigration);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);

    await assert.rejects(
      db.query("INSERT INTO public.company_tracker_assignments(id,site_id,assignee_id,stage) VALUES($1,$2,$3,'Converted')", [directTracker,site,user]),
      /Only commissioning managers/,
    );
    await db.query("SELECT set_config('test.manager','true',false)");
    await db.query("INSERT INTO public.company_tracker_assignments(id,site_id,assignee_id,stage) VALUES($1,$2,$3,'Converted')", [directTracker,site,user]);
    let board = (await db.query("SELECT public.company_tracker_board() AS value")).rows[0].value;
    assert.equal(board.find((entry) => entry.id === directTracker).upscale_order_pending, true);

    const device = [{ machine_name: "Client Press", components: { dm: true, ct1: true }, vibration_model: "" }];
    await assert.rejects(
      db.query("SELECT public.company_tracker_convert_upscale($1,'Order ready',$2::jsonb)", [directTracker,JSON.stringify([{ ...device[0], components: {} }])]),
      /Select at least one device component/,
    );
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.upscale_company_orders")).rows[0].n, 0);
    await db.query("SELECT public.company_tracker_convert_upscale($1,'Order ready',$2::jsonb)", [directTracker,JSON.stringify(device)]);
    board = (await db.query("SELECT public.company_tracker_board() AS value")).rows[0].value;
    assert.equal(board.find((entry) => entry.id === directTracker).upscale_order_pending, false);
    assert.equal((await db.query("SELECT stage FROM public.company_tracker_assignments WHERE id=$1", [directTracker])).rows[0].stage, "Converted");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.company_tracker_stage_history WHERE tracker_id=$1", [directTracker])).rows[0].n, 0);
    await assert.rejects(
      db.query("SELECT public.company_tracker_convert_upscale($1,'Again',$2::jsonb)", [directTracker,JSON.stringify(device)]),
      /already has an Upscale device order/,
    );

    await db.query("INSERT INTO public.company_tracker_assignments(id,site_id,assignee_id,stage) VALUES($1,$2,$3,'Quotation Sent')", [quotedTracker,site,user]);
    await assert.rejects(db.query("SELECT public.company_tracker_transition($1,'Ready',true)", [quotedTracker]), /Upscale device order/);
    await db.query("SELECT public.company_tracker_convert_upscale($1,'Ready',$2::jsonb)", [quotedTracker,JSON.stringify(device)]);
    assert.equal((await db.query("SELECT stage FROM public.company_tracker_assignments WHERE id=$1", [quotedTracker])).rows[0].stage, "Converted");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.company_tracker_stage_history WHERE tracker_id=$1", [quotedTracker])).rows[0].n, 1);
  } finally {
    await db.close();
  }
});
