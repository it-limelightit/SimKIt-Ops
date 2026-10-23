import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const manager = "00000000-0000-4000-8000-000000000001",
  a = "00000000-0000-4000-8000-000000000002",
  b = "00000000-0000-4000-8000-000000000003",
  outsider = "00000000-0000-4000-8000-000000000004";
const historic = "00000000-0000-4000-8000-000000000099";
let serial = 100;
const id = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const login = async (user) => {
  await db.exec("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user || ""]);
};
const checklist = (site) => scalar("SELECT installation_order_checklist($1)", [site]);
const inventory = () => scalar("SELECT field_associate_extra_inventory()");
const confirm = (site, order, items, revision = 0) =>
  scalar("SELECT installation_confirm_order($1,$2,$3,$4::jsonb)", [
    site,
    order,
    revision,
    JSON.stringify(items),
  ]);
const choices = (board, extra = {}) =>
  board.orders[0].items.map((item) => ({
    key: item.key,
    received: true,
    used: true,
    ...extra[item.key],
  }));
const receipt = (category, quantity, cost, reason = "selected") => ({
  category,
  quantity,
  consumed_value: cost,
  reason,
});

async function fixture({
  worker = a,
  status = "Transit",
  siteName,
  legacyLink = false,
  withReceipt = true,
} = {}) {
  const site = id(),
    order = id();
  const name = siteName || `Factory ${serial}`;
  await db.query(
    "INSERT INTO sites(id,name,company_name,assigned_worker_id,worker_ids) VALUES($1,$2,$2,$3,$4)",
    [site, name, worker, [worker]],
  );
  await db.query(
    `INSERT INTO inventory_materials(id,site_id,material_name,created_by,notes,antenna,vibration_model)
    VALUES($1,$2,$3,$4,$5,'FALSE','vibe-q')`,
    [
      order,
      legacyLink ? null : site,
      name,
      worker,
      JSON.stringify({ logistics_status: status, dm_selected: true }),
    ],
  );
  if (withReceipt)
    await db.query(
      "INSERT INTO inventory_dispatch_deductions(order_id,status,items) VALUES($1,'deducted',$2::jsonb)",
      [
        order,
        JSON.stringify([
          receipt("MOTHER BOARD PCB", 1, 40, "Data Meter Qty/Kit"),
          receipt("LCD PCB", 1, 60, "Data Meter Qty/Kit"),
          receipt("YHDC CT SENSOR", 3, 21),
          receipt("PROXIMITY SENSOR", 2, 26),
        ]),
      ],
    );
  await db.query("INSERT INTO installation(site_id,data) VALUES($1,'{}')", [site]);
  return { site, order };
}

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY,name text,is_active boolean DEFAULT true);
    INSERT INTO profiles VALUES('${manager}','Manager',true),('${a}','Associate A',true),('${b}','Associate B',true),('${outsider}','Other user',true);
    CREATE FUNCTION is_staff(_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT _id='${manager}'::uuid $$;
    CREATE FUNCTION has_scoped_manager_module(module text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION assert_manager_module_access(module text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
    CREATE FUNCTION field_ops_associate(_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT _id IN ('${a}'::uuid,'${b}'::uuid) AND EXISTS(SELECT 1 FROM profiles WHERE id=_id AND is_active) $$;
    CREATE TABLE sites(id uuid PRIMARY KEY,name text,company_name text,assigned_worker_id uuid,worker_ids uuid[]);
    CREATE FUNCTION field_ops_worker_ids(s sites) RETURNS uuid[] LANGUAGE sql STABLE AS $$ SELECT s.worker_ids $$;
    CREATE TABLE installation(site_id uuid PRIMARY KEY,data jsonb NOT NULL DEFAULT '{}');
    GRANT SELECT,INSERT,UPDATE ON installation TO authenticated;
    CREATE TABLE inventory_materials(id uuid PRIMARY KEY,site_id uuid,material_name text,created_by uuid,
      submitted boolean DEFAULT true,order_source text,notes text,state text DEFAULT 'In transit',device_id text,created_at timestamptz DEFAULT now(),antenna text,vibration_model text);
    CREATE TABLE inventory_dispatch_deductions(order_id uuid PRIMARY KEY,status text,items jsonb);
    CREATE TABLE inventory_stock(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),category text,sensor_type text,unit_price numeric,actual_quantity numeric,notes text,updated_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now());
    INSERT INTO inventory_stock(category,unit_price,actual_quantity,notes) VALUES('MOTHER BOARD PCB',25,200,'{"inventory_unit":"Nos"}');
    CREATE FUNCTION inventory_dispatch_stock_unit(s inventory_stock) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'Nos'::text $$;
    CREATE FUNCTION inventory_dispatch_requirements(m inventory_materials) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '[{"key":"motherboardpcb","category":"MOTHER BOARD PCB","model":"","quantity":1,"unit":"Nos","reason":"Data Meter Qty/Kit"}]'::jsonb $$;
    INSERT INTO sites VALUES('${historic}','Historical','Historical','${a}',ARRAY['${a}'::uuid]);
    INSERT INTO installation VALUES('${historic}','{"installation_phase_submitted":true}');
  `);
  const source = readFileSync(
    new URL("../supabase/migrations/20261013160000_atomic_inventory_dispatch.sql", import.meta.url),
    "utf8",
  );
  await db.exec(
    source.slice(
      source.indexOf("CREATE OR REPLACE FUNCTION public.inventory_dispatch_notes"),
      source.indexOf("CREATE OR REPLACE FUNCTION public.inventory_dispatch_requirements"),
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261023110000_installation_associate_extra_inventory.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
beforeEach(async () => {
  await db.exec("BEGIN");
});
afterEach(async () => {
  await db.exec("ROLLBACK");
  await db.exec("RESET ROLE");
});
after(() => db.close());

test("dispatched devices and each sensor unit have independent Received/Used checkboxes and inventory prices", async () => {
  const { site } = await fixture();
  await login(a);
  const board = await checklist(site);
  assert.equal(board.required, true);
  assert.equal(board.orders.length, 1);
  const items = board.orders[0].items;
  assert.equal(items.length, 6);
  assert.equal(items.find((x) => x.group_key === "dm").unit_price, 100);
  assert.equal(items.filter((x) => x.group_key === "yhdcctsensor").length, 3);
  assert.equal(items.find((x) => x.group_key === "yhdcctsensor").unit_price, 7);
  assert.equal(items.find((x) => x.group_key === "proximitysensor").unit_price, 13);
  assert(items.every((x) => !x.received && !x.used && x.quantity === 1));
});

test("only received but unused equipment becomes associate extras; central stock is unchanged", async () => {
  const { site, order } = await fixture();
  await login(a);
  const board = await checklist(site);
  await confirm(
    site,
    order,
    choices(board, {
      "yhdcctsensor:2": { received: false, used: false },
      "yhdcctsensor:3": { used: false },
      "proximitysensor:2": { used: false },
    }),
  );
  const rows = await inventory();
  assert.equal(rows.length, 2);
  assert.equal(
    rows.reduce((sum, x) => sum + x.quantity, 0),
    2,
  );
  assert.equal(
    rows.reduce((sum, x) => sum + Number(x.total_value), 0),
    20,
  );
  assert(rows.every((x) => x.associate_id === a));
  await db.exec("RESET ROLE");
  assert.equal(Number(await scalar("SELECT actual_quantity FROM inventory_stock")), 200);
});

test("confirmation is required at the database level before new installation submission", async () => {
  const { site, order } = await fixture();
  await login(a);
  await db.exec("SAVEPOINT missing_confirmation");
  await assert.rejects(
    () =>
      db.query(
        `UPDATE installation SET data='{"installation_phase_submitted":true}' WHERE site_id=$1`,
        [site],
      ),
    /Confirm received and used/,
  );
  await db.exec("ROLLBACK TO SAVEPOINT missing_confirmation");
  await confirm(site, order, choices(await checklist(site)));
  await db.query(
    `UPDATE installation SET data='{"installation_phase_submitted":true}' WHERE site_id=$1`,
    [site],
  );
  assert.equal(
    (await scalar("SELECT data FROM installation WHERE site_id=$1", [site]))
      .installation_phase_submitted,
    true,
  );
});

test("completing coordination and photos cannot bypass equipment confirmation", async () => {
  const { site } = await fixture();
  await login(a);
  await assert.rejects(
    () =>
      db.query(
        `UPDATE installation SET data='{"coordination_done":true,"photos_uploaded":true}' WHERE site_id=$1`,
        [site],
      ),
    /Confirm received and used/,
  );
});

test("invalid, omitted, duplicate and impossible item choices are rejected; client prices and quantities are ignored", async () => {
  const { site, order } = await fixture();
  await login(a);
  const valid = choices(await checklist(site));
  for (const [items, pattern] of [
    [valid.slice(1), /every dispatched/],
    [[...valid.slice(1), valid[1]], /exactly once/],
    [valid.map((x, i) => (i ? x : { ...x, received: false, used: true })), /cannot be used/],
  ]) {
    await db.exec("SAVEPOINT invalid_choice");
    await assert.rejects(() => confirm(site, order, items), pattern);
    await db.exec("ROLLBACK TO SAVEPOINT invalid_choice");
  }
  await confirm(
    site,
    order,
    valid.map((x) => ({ ...x, used: false, quantity: 999, unit_price: 999 })),
  );
  const rows = await inventory();
  assert.equal(
    rows.reduce((sum, x) => sum + x.quantity, 0),
    6,
  );
  assert.equal(rows.find((x) => x.group_key === "dm").unit_price, 100);
});

test("updates replace the same balance, reject stale revisions and keep saved inventory prices", async () => {
  const { site, order } = await fixture();
  await login(a);
  const first = choices(await checklist(site));
  await confirm(
    site,
    order,
    first.map((x) => ({ ...x, used: false })),
  );
  assert.equal(
    (await inventory()).reduce((sum, x) => sum + x.quantity, 0),
    6,
  );
  await db.exec("SAVEPOINT stale_revision");
  await assert.rejects(() => confirm(site, order, first, 0), /Refresh/);
  await db.exec("ROLLBACK TO SAVEPOINT stale_revision");
  await db.exec("RESET ROLE; UPDATE inventory_stock SET unit_price=9999");
  await login(a);
  await confirm(site, order, first, 1);
  assert.deepEqual(await inventory(), []);
  const next = await checklist(site);
  assert.equal(next.orders[0].revision, 2);
  assert.equal(next.orders[0].items[0].unit_price, 100);
});

test("unassigned users cannot read or confirm another site's equipment or directly alter balances", async () => {
  const { site, order } = await fixture();
  await login(b);
  await db.exec("SAVEPOINT other_site");
  await assert.rejects(() => checklist(site), /access required/);
  await db.exec("ROLLBACK TO SAVEPOINT other_site");
  await db.exec("SAVEPOINT direct_write");
  await assert.rejects(
    () => db.query("DELETE FROM installation_order_confirmations WHERE order_id=$1", [order]),
    /permission denied/,
  );
  await db.exec("ROLLBACK TO SAVEPOINT direct_write");
  await login(null);
  await db.exec("SAVEPOINT anonymous");
  await assert.rejects(() => checklist(site), /access required/);
  await db.exec("ROLLBACK TO SAVEPOINT anonymous");
});

test("associates see only their extras; managers see all associates and quantities with prices", async () => {
  const one = await fixture(),
    two = await fixture({ worker: b });
  await login(a);
  await confirm(
    one.site,
    one.order,
    choices(await checklist(one.site)).map((x) => ({ ...x, used: false })),
  );
  await login(b);
  await confirm(
    two.site,
    two.order,
    choices(await checklist(two.site)).map((x) => ({ ...x, used: false })),
  );
  assert((await inventory()).every((x) => x.associate_id === b));
  await login(manager);
  const all = await inventory();
  assert.equal(new Set(all.map((x) => x.associate_id)).size, 2);
  assert.equal(
    all.reduce((sum, x) => sum + x.quantity, 0),
    12,
  );
  assert(all.every((x) => x.unit_price != null && x.total_value != null));
});

test("another assigned associate can view a confirmation but cannot take over its inventory", async () => {
  const { site, order } = await fixture();
  await db.query("UPDATE sites SET worker_ids=$2 WHERE id=$1", [site, [a, b]]);
  await login(a);
  const initial = await checklist(site);
  await confirm(site, order, choices(initial));
  await login(b);
  const shared = await checklist(site);
  assert.equal(shared.orders[0].associate_id, a);
  await assert.rejects(
    () => confirm(site, order, choices(shared), 1),
    /already confirmed by another/,
  );
});

test("pending orders cannot be confirmed or submitted; historical completed installations remain unchanged", async () => {
  const { site, order } = await fixture({ status: "Packing" });
  await login(a);
  assert.equal((await checklist(site)).waiting_dispatch, true);
  await db.exec("SAVEPOINT not_dispatched");
  await assert.rejects(() => confirm(site, order, []), /Dispatched order not found/);
  await db.exec("ROLLBACK TO SAVEPOINT not_dispatched");
  await db.exec("SAVEPOINT pending_submit");
  await assert.rejects(
    () =>
      db.query(
        `UPDATE installation SET data='{"installation_phase_submitted":true}' WHERE site_id=$1`,
        [site],
      ),
    /Wait for the device order/,
  );
  await db.exec("ROLLBACK TO SAVEPOINT pending_submit");
  assert.equal((await checklist(historic)).legacy, true);
  await db.query(
    `UPDATE installation SET data=data||'{"notes":"existing record edited"}' WHERE site_id=$1`,
    [historic],
  );
  assert.deepEqual(await inventory(), []);
});

test("legacy company-name orders link only when the company is unambiguous", async () => {
  const one = await fixture({ legacyLink: true, siteName: "Unique Legacy" });
  await login(a);
  assert.equal((await checklist(one.site)).orders.length, 1);
  await db.exec("RESET ROLE");
  await fixture({ siteName: "Unique Legacy" });
  await login(a);
  await assert.rejects(() => checklist(one.site), /More than one company matches/);
});

test("legacy orders without deduction receipts use current matching manager prices", async () => {
  const { site, order } = await fixture({ withReceipt: false });
  await login(a);
  const board = await checklist(site);
  assert.equal(board.orders[0].items.length, 1);
  assert.equal(board.orders[0].items[0].unit_price, 25);
  await confirm(
    site,
    order,
    choices(board).map((x) => ({ ...x, used: false })),
  );
  assert.equal((await inventory())[0].total_value, 25);
});
