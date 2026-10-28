import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const firmware = "00000000-0000-4000-8000-000000000001";
const colleague = "00000000-0000-4000-8000-000000000002";
const manager = "00000000-0000-4000-8000-000000000003";
const software = "00000000-0000-4000-8000-000000000004";
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const asUser = (id) => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
const migration = (name) =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const data = (isManager = false) => scalar("SELECT firmware_inventory_data($1)", [isManager]);
const balance = () =>
  scalar(
    "SELECT sum(actual_quantity)::float8 FROM inventory_stock WHERE category='YHDC CT SENSOR' AND notes NOT LIKE '%bulk_order%'",
  );
let stock, wire, bulk;
const take = (quantity = 4, request = randomUUID(), items, date = "2026-10-20") =>
  db.query("SELECT firmware_inventory_take($1,$2,$3)", [
    request,
    date,
    JSON.stringify(items ?? [{ stock_id: stock, quantity, reason: "Sensor testing" }]),
  ]);
const giveBack = (loan, quantity, request = randomUUID(), date = "2026-10-21") =>
  db.query("SELECT firmware_inventory_return($1,$2,$3,$4)", [request, loan, quantity, date]);
async function rejects(action, pattern) {
  await db.exec("SAVEPOINT expected_error");
  await assert.rejects(action, pattern);
  await db.exec("ROLLBACK TO SAVEPOINT expected_error");
}

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION is_staff(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT id='${manager}'::uuid $$;
    CREATE FUNCTION has_role(id uuid,role text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT role='employee' AND id<>'${manager}'::uuid $$;
    CREATE FUNCTION field_inventory_manager() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(auth.uid()='${manager}'::uuid,false) $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY,name text);
    INSERT INTO profiles VALUES('${firmware}','Firmware One'),('${colleague}','Firmware Two'),('${manager}','Manager'),('${software}','Software');
    CREATE TABLE attendance_employees(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth_user_id uuid,name text,department text,active boolean DEFAULT true,deleted_at timestamptz);
    INSERT INTO attendance_employees(auth_user_id,name,department) VALUES('${firmware}','Firmware One','firmware'),('${colleague}','Firmware Two','firmware'),('${software}','Software','software');
    CREATE TABLE inventory_materials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),material_name text,quantity numeric DEFAULT 1,submitted boolean DEFAULT true,created_at timestamptz DEFAULT clock_timestamp(),state text DEFAULT 'Pending',notes text,uplink text,device_id text,order_source text,
      ct1 text DEFAULT 'FALSE',ct2 text DEFAULT 'FALSE',ct3 text DEFAULT 'FALSE',energy_meter text DEFAULT 'FALSE',proxy1 text DEFAULT 'FALSE',proxy2 text DEFAULT 'FALSE',proxy_model text,encoder text DEFAULT 'FALSE',vibration text DEFAULT 'FALSE',vibration_model text,antenna text DEFAULT 'FALSE',tower_light text DEFAULT 'FALSE',plc text DEFAULT 'FALSE');`);
  for (const name of [
    "20260907150000_create_inventory_stock.sql",
    "20260908100000_create_inventory_bom.sql",
    "20261013160000_atomic_inventory_dispatch.sql",
    "20261021120000_inventory_packing_consumption.sql",
  ])
    await db.exec(migration(name));
  for (const [category, quantity, unit, extra] of [
    ["YHDC CT SENSOR", 2, "Nos", {}],
    ["YHDC CT SENSOR", 8, "Nos", {}],
    ["2 CORE WIRE", 100, "Meter", {}],
    ["YHDC CT SENSOR", 1000, "Nos", { inventory_entry_type: "bulk_order" }],
  ]) {
    const id = await scalar(
      "INSERT INTO inventory_stock(category,actual_quantity,unit_price,notes) VALUES($1,$2,10,$3) RETURNING id",
      [category, quantity, JSON.stringify({ inventory_unit: unit, ...extra })],
    );
    if (category === "2 CORE WIRE") wire = id;
    else if (extra.inventory_entry_type) bulk = id;
    else stock ??= id;
  }
  for (const category of [
    "BOX",
    "POWER CORD CABLE",
    "PANEL BOX/DOOR/LOCK",
    "UV PRINTING",
    "CABLE GLAND",
    "TOWER LIGHT",
  ])
    await db.query(
      "INSERT INTO inventory_stock(category,actual_quantity,unit_price) VALUES($1,100,10)",
      [category],
    );
  await db.exec(migration("20261028120000_firmware_inventory.sql"));
});
after(() => db.close());
beforeEach(async () => {
  await db.exec("BEGIN");
  await asUser(firmware);
});
afterEach(() => db.exec("ROLLBACK"));

test("catalog combines batches, excludes planned inventory and starts with empty history", async () => {
  const result = await data();
  assert.equal(result.loans.length, 0);
  assert.equal(result.products.find((p) => p.category === "YHDC CT SENSOR").available, 10);
  assert.equal(await balance(), 10);
});

test("take deducts FIFO receipts and records person, reason, exact balances and audit", async () => {
  await take();
  const loan = (await data()).loans[0];
  assert.equal(await balance(), 6);
  assert.equal(loan.owner_name, "Firmware One");
  assert.equal(loan.reason, "Sensor testing");
  assert.equal(loan.taken_date, "2026-10-20");
  assert.equal(loan.stock_before, 10);
  assert.equal(loan.stock_after, 6);
  assert.equal(Number(await scalar("SELECT count(*) FROM firmware_inventory_allocations")), 2);
  assert.equal(
    await scalar(
      "SELECT sum(quantity_changed)::float8 FROM inventory_logs WHERE change_type='FIRMWARE_TAKE'",
    ),
    -4,
  );
  assert.equal(
    await scalar("SELECT actual_quantity::float8 FROM inventory_stock WHERE id=$1", [bulk]),
    1000,
  );
});

test("partial and full returns restore only the selected quantity and preserve each dated event", async () => {
  await take();
  const loan = (await data()).loans[0];
  await giveBack(loan.id, 1);
  assert.equal(await balance(), 7);
  await giveBack(loan.id, 3, randomUUID(), "2026-10-22");
  assert.equal(await balance(), 10);
  const saved = (await data()).loans[0];
  assert.equal(saved.returned_quantity, 4);
  assert.equal(saved.returns.length, 2);
  assert.deepEqual(
    saved.returns.map((r) => [r.quantity, r.return_date, r.actor_name]),
    [
      [1, "2026-10-21", "Firmware One"],
      [3, "2026-10-22", "Firmware One"],
    ],
  );
  assert.deepEqual(
    saved.returns.map((r) => [r.stock_before, r.stock_after]),
    [
      [6, 7],
      [7, 10],
    ],
  );
  await rejects(() => giveBack(loan.id, 1, randomUUID(), "2026-10-22"), /outstanding balance/);
});

test("retrying either save is idempotent", async () => {
  const request = randomUUID();
  await take(4, request);
  await take(4, request);
  assert.equal(await balance(), 6);
  assert.equal((await data()).loans.length, 1);
  const loan = (await data()).loans[0],
    returnRequest = randomUUID();
  await giveBack(loan.id, 2, returnRequest);
  await giveBack(loan.id, 2, returnRequest);
  assert.equal(await balance(), 8);
  assert.equal((await data()).loans[0].returns.length, 1);
});

test("multi-item shortage rolls back all deductions and all history", async () => {
  await rejects(
    () =>
      take(1, randomUUID(), [
        { stock_id: stock, quantity: 1, reason: "Test" },
        { stock_id: wire, quantity: 101, reason: "Test" },
      ]),
    /Insufficient stock/,
  );
  assert.equal(await balance(), 10);
  assert.equal((await data()).loans.length, 0);
  assert.equal(Number(await scalar("SELECT count(*) FROM inventory_logs")), 0);
});

test("fractional meters work; invalid quantities, bulk receipts and duplicate products are rejected", async () => {
  await take(1, randomUUID(), [{ stock_id: wire, quantity: 1.25, reason: "Wire testing" }]);
  const loan = (await data()).loans[0];
  await giveBack(loan.id, 0.25);
  assert.equal(
    await scalar("SELECT actual_quantity::float8 FROM inventory_stock WHERE id=$1", [wire]),
    99,
  );
  for (const quantity of [0, -1, 0.5, 1.001, "NaN", "Infinity"])
    await rejects(() => take(quantity), /positive quantity/);
  await rejects(
    () => take(1, randomUUID(), [{ stock_id: bulk, quantity: 1, reason: "Test" }]),
    /unavailable/,
  );
  await rejects(
    () =>
      take(1, randomUUID(), [
        { stock_id: stock, quantity: 1, reason: "Test" },
        { stock_id: stock, quantity: 1, reason: "Again" },
      ]),
    /unique constraint/,
  );
});

test("future dates, empty reasons, early or backdated returns and excessive returns are rejected", async () => {
  await rejects(() => take(1, randomUUID(), undefined, "2999-01-01"), /valid date/);
  await rejects(
    () => take(1, randomUUID(), [{ stock_id: stock, quantity: 1, reason: "  " }]),
    /reason/,
  );
  await take();
  const loan = (await data()).loans[0];
  for (const date of ["2026-10-19", "2999-01-01"])
    await rejects(() => giveBack(loan.id, 1, randomUUID(), date), /Return date/);
  for (const qty of [0, -1, 5, 0.5, 1.001, "NaN"])
    await rejects(() => giveBack(loan.id, qty), /return quantity/);
  await giveBack(loan.id, 1, randomUUID(), "2026-10-22");
  await rejects(() => giveBack(loan.id, 1, randomUUID(), "2026-10-21"), /Return date/);
});

test("personal history and returns are private; managers can inspect all firmware history", async () => {
  await take();
  const loan = (await data()).loans[0];
  await asUser(colleague);
  assert.equal((await data()).loans.length, 0);
  await rejects(() => giveBack(loan.id, 1), /only return your own/);
  await rejects(() => data(true), /manager access/);
  await asUser(manager);
  assert.equal((await data(true)).loans.length, 1);
  await rejects(() => take(), /firmware employee/);
  for (const user of [software, null]) {
    await asUser(user);
    assert.equal(await scalar("SELECT firmware_inventory_access()"), false);
    await rejects(() => data(), /firmware employee/);
    await rejects(() => take(), /firmware employee/);
    await rejects(() => giveBack(loan.id, 1), /firmware employee/);
  }
});

test("inactive and deleted firmware employees lose access; direct ledger changes are denied", async () => {
  await db.query("UPDATE attendance_employees SET active=false WHERE auth_user_id=$1", [firmware]);
  await rejects(() => take(), /firmware employee/);
  await db.query(
    "UPDATE attendance_employees SET active=true,deleted_at=now() WHERE auth_user_id=$1",
    [firmware],
  );
  await rejects(() => data(), /firmware employee/);
  await db.exec("SET LOCAL ROLE authenticated");
  for (const table of [
    "firmware_inventory_loans",
    "firmware_inventory_returns",
    "firmware_inventory_allocations",
  ])
    await rejects(() => db.exec(`DELETE FROM ${table}`), /permission denied/);
});

test("dispatch uses the same diminished stock and returns restore availability for dispatch", async () => {
  await take(8);
  const loan = (await data()).loans[0];
  await asUser(manager);
  const order = await scalar(
    `INSERT INTO inventory_materials(material_name,ct1,ct2,ct3,notes) VALUES('Factory','TRUE','TRUE','TRUE','{"dm_selected":false,"logistics_status":"Pending"}') RETURNING id`,
  );
  const pack = () =>
    db.query(
      `UPDATE inventory_materials SET notes='{"dm_selected":false,"logistics_status":"Packing"}' WHERE id=$1`,
      [order],
    );
  await rejects(pack, /Insufficient stock/);
  await asUser(firmware);
  await giveBack(loan.id, 2);
  await asUser(manager);
  await pack();
  assert.equal(await balance(), 1);
  await asUser(firmware);
  await giveBack(loan.id, 6);
  assert.equal(await balance(), 7);
});

test("stock receipts referenced by history cannot be deleted or silently returned as another model", async () => {
  await take();
  const loan = (await data()).loans[0];
  await rejects(
    () => db.query("DELETE FROM inventory_stock WHERE id=$1", [stock]),
    /foreign key constraint/,
  );
  await db.query("UPDATE inventory_stock SET sensor_type='Different model' WHERE id=$1", [stock]);
  await rejects(() => giveBack(loan.id, 1), /Original stock item was changed/);
  assert.equal((await data()).loans[0].returned_quantity, 0);
});
