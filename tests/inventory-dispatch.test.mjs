import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const db = new PGlite();
const manager = "00000000-0000-4000-8000-000000000001";
const worker = "00000000-0000-4000-8000-000000000002";
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const asUser = (id) => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
const migration = (name) =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const core = [
  ["ENCLOUSURE STICKER", 2.5],
  ["SIM CARD", 1],
  ["3D PRINT ENCLOUSURE", 1],
  ["LCD PCB", 1],
  ["MOTHER BOARD PCB", 1],
  ["CAVLI PCB", 1],
  ["DIN RAIL MOUNTING CLIP", 2],
  ["MAGNETIC MOUNT ANTEENA", 2],
  ["RF CABLE (ANTEENA)", 2],
];
const accessories = [
  "BOX",
  "POWER CORD CABLE",
  "PANEL BOX/DOOR/LOCK",
  "UV PRINTING",
  "CABLE GLAND",
];
const sensors = [
  "ENERGY METER",
  "ENERGY METER CT SENSOR",
  "YHDC CT SENSOR",
  "ROTARY ENCODER",
  "PROXIMITRY SENSOR",
  "VIBRATION SENSOE (VIBE Q)",
  "TOWER LIGHT",
];
const manuals = ["ZIPE TIE", "TAPE ROLE (FRAGILE)", "FORM SHEET", "PLC Interface"];
let cutoff;

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY);
    INSERT INTO profiles VALUES('${manager}'),('${worker}');
    CREATE FUNCTION is_staff(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT id='${manager}'::uuid $$;
    CREATE TABLE inventory_materials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quantity numeric DEFAULT 1, submitted boolean DEFAULT true,
      created_at timestamptz DEFAULT clock_timestamp(), state text DEFAULT 'Pending', notes text, material_name text,
      ct1 text DEFAULT 'FALSE',ct2 text DEFAULT 'FALSE',ct3 text DEFAULT 'FALSE',energy_meter text DEFAULT 'FALSE',
      proxy1 text DEFAULT 'FALSE',proxy2 text DEFAULT 'FALSE',proxy_model text,encoder text DEFAULT 'FALSE',
      vibration text DEFAULT 'FALSE',vibration_model text,antenna text DEFAULT 'FALSE',tower_light text DEFAULT 'FALSE',plc text DEFAULT 'FALSE');`);
  await db.exec(migration("20260907150000_create_inventory_stock.sql"));
  await db.exec(migration("20260908100000_create_inventory_bom.sql"));
  for (const [category, qty] of core) {
    await db.query(
      "INSERT INTO inventory_stock(category,actual_quantity,unit_price,notes) VALUES($1,100,10,$2)",
      [category, JSON.stringify({ inventory_group: "Data Meter", inventory_unit: "Nos" })],
    );
    await db.query(
      "INSERT INTO inventory_bom_items(category,quantity_per_kit,required_by_default) VALUES($1,$2,true)",
      [category, qty],
    );
  }
  for (const category of [...accessories, ...sensors, ...manuals]) {
    await db.query(
      "INSERT INTO inventory_stock(category,actual_quantity,unit_price,notes) VALUES($1,100,30,$2)",
      [category, JSON.stringify({ inventory_unit: "Nos" })],
    );
    await db.query(
      "INSERT INTO inventory_bom_items(category,quantity_per_kit,required_by_default) VALUES($1,99,true)",
      [category],
    );
  }
  for (const category of ["2 CORE WIRE", "4 CORE WIRE"]) {
    await db.query(
      "INSERT INTO inventory_stock(category,actual_quantity,unit_price,notes) VALUES($1,100,30,$2)",
      [category, JSON.stringify({ inventory_unit: "Meter" })],
    );
    await db.query(
      "INSERT INTO inventory_bom_items(category,quantity_per_kit,unit,required_by_default) VALUES($1,10,'Meter',true)",
      [category],
    );
  }
  await db.exec(migration("20261013160000_atomic_inventory_dispatch.sql"));
  await db.exec(migration("20261014110000_device_order_component_selection.sql"));
  cutoff = await scalar("SELECT activated_at::text FROM inventory_dispatch_settings");
  await asUser(manager);
});
after(() => db.close());
beforeEach(async () => {
  await db.exec("BEGIN");
  await asUser(manager);
});
afterEach(() => db.exec("ROLLBACK"));

async function order(options = {}) {
  const names = Object.keys(options);
  const columns = names.length ? `,${names.join(",")}` : "";
  const values = names.map((_, index) => `$${index + 1}`).join(",");
  return scalar(
    `INSERT INTO inventory_materials(material_name${columns}) VALUES('Inventory regression order'${names.length ? `,${values}` : ""}) RETURNING id`,
    Object.values(options),
  );
}
const dispatch = (id, status = "Transit") =>
  db.query(
    "UPDATE inventory_materials SET notes=(inventory_dispatch_notes(notes)||jsonb_build_object('logistics_status',$2::text))::text,state=CASE WHEN $2='Transit' THEN 'In transit' ELSE state END WHERE id=$1",
    [id, status],
  );
const quantity = async (category) =>
  Number(
    await scalar("SELECT sum(actual_quantity) FROM inventory_stock WHERE category=$1", [category]),
  );

test("Packing consumes nothing; Transit consumes configured kit parts, antennas and fixed defaults once", async () => {
  const id = await order({ antenna: "TRUE" });
  await dispatch(id, "Packing");
  assert.equal(await quantity("SIM CARD"), 100);
  await dispatch(id);
  for (const [category, qty] of core) assert.equal(await quantity(category), 100 - qty, category);
  for (const category of accessories)
    assert.equal(await quantity(category), category === "CABLE GLAND" ? 97 : 99, category);
  for (const category of [...sensors, ...manuals, "2 CORE WIRE", "4 CORE WIRE"])
    assert.equal(await quantity(category), 100, category);
  assert.equal(
    await scalar("SELECT count(*)::int FROM inventory_dispatch_deductions WHERE order_id=$1", [id]),
    1,
  );
  await dispatch(id, "Delivered");
  await dispatch(id, "Delivered");
  await db.query("UPDATE inventory_materials SET material_name='Saved again' WHERE id=$1", [id]);
  assert.equal(await quantity("SIM CARD"), 99);
  assert.equal(
    await scalar("SELECT count(*)::int FROM inventory_dispatch_deductions WHERE order_id=$1", [id]),
    1,
  );
});

test("normal CT orders consume 3 YHDC CTs and fixed 12-meter wire, with a recorded stock value", async () => {
  const id = await order({ ct1: "TRUE", ct2: "TRUE", ct3: "TRUE" });
  await dispatch(id, "Delivered");
  assert.equal(await quantity("YHDC CT SENSOR"), 97);
  assert.equal(await quantity("ENERGY METER CT SENSOR"), 100);
  assert.equal(await quantity("2 CORE WIRE"), 88);
  const log = (
    await db.query(
      "SELECT quantity_changed,unit_price_snapshot,consumed_value,unit FROM inventory_logs JOIN inventory_stock ON inventory_stock.id=stock_id WHERE order_id=$1 AND category='2 CORE WIRE'",
      [id],
    )
  ).rows[0];
  assert.equal(Number(log.quantity_changed), -12);
  assert.equal(Number(log.unit_price_snapshot), 30);
  assert.equal(Number(log.consumed_value), 360);
  assert.equal(log.unit, "Meter");
  assert.equal(
    Number(await scalar("SELECT unit_price FROM inventory_stock WHERE category='2 CORE WIRE'")),
    30,
  );
});

test("energy meter CTs are compulsory and do not consume normal YHDC CTs or 12-meter wire", async () => {
  await dispatch(await order({ energy_meter: "TRUE" }));
  assert.equal(await quantity("ENERGY METER"), 99);
  assert.equal(await quantity("ENERGY METER CT SENSOR"), 97);
  assert.equal(await quantity("YHDC CT SENSOR"), 100);
  assert.equal(await quantity("2 CORE WIRE"), 100);
});

test("selected encoder, Vibe Q, inductive proxy inputs and tower light consume only their quantities", async () => {
  await dispatch(
    await order({
      encoder: "TRUE",
      vibration: "TRUE",
      vibration_model: "Vibe Q",
      proxy1: "TRUE",
      proxy2: "TRUE",
      proxy_model: "Inductive",
      tower_light: "TRUE",
      plc: "TRUE",
    }),
  );
  assert.equal(await quantity("ROTARY ENCODER"), 99);
  assert.equal(await quantity("VIBRATION SENSOE (VIBE Q)"), 99);
  assert.equal(await quantity("PROXIMITRY SENSOR"), 98);
  assert.equal(await quantity("TOWER LIGHT"), 99);
  assert.equal(await quantity("4 CORE WIRE"), 95);
  assert.equal(await quantity("PLC Interface"), 100);
  for (const category of manuals) assert.equal(await quantity(category), 100);
});

test("insufficient stock rolls back every deduction, its receipt and the dispatch status", async () => {
  await db.query("UPDATE inventory_stock SET actual_quantity=11 WHERE category='2 CORE WIRE'");
  const id = await order({ ct1: "TRUE", ct2: "TRUE", ct3: "TRUE" });
  await db.exec("SAVEPOINT insufficient");
  await assert.rejects(dispatch(id), /Insufficient stock: 2 CORE WIRE/);
  await db.exec("ROLLBACK TO SAVEPOINT insufficient");
  assert.equal(await quantity("SIM CARD"), 100);
  assert.equal(await quantity("BOX"), 100);
  assert.equal(await quantity("2 CORE WIRE"), 11);
  assert.equal(await scalar("SELECT state FROM inventory_materials WHERE id=$1", [id]), "Pending");
  assert.equal(await scalar("SELECT count(*)::int FROM inventory_dispatch_deductions"), 0);
  assert.equal(await scalar("SELECT count(*)::int FROM inventory_logs WHERE change_type='DISPATCH_DEDUCTION'"), 0);
});

test("multi-device orders and non-inductive proxies are rejected atomically", async () => {
  for (const [options, message] of [
    [{ quantity: 2 }, /exactly one Data Meter/],
    [{ proxy1: "TRUE", proxy_model: "Capacitive" }, /Inductive model/],
  ]) {
    const id = await order(options);
    await db.exec("SAVEPOINT invalid_order");
    await assert.rejects(dispatch(id), message);
    await db.exec("ROLLBACK TO SAVEPOINT invalid_order");
  }
  assert.equal(await quantity("SIM CARD"), 100);
});

test("historical orders and legacy deductions are excluded without changing existing balances", async () => {
  const old = await order({ created_at: cutoff });
  await db.query(
    "UPDATE inventory_materials SET created_at=created_at-interval '1 day' WHERE id=$1",
    [old],
  );
  await dispatch(old, "Delivered");
  assert.equal(await quantity("SIM CARD"), 100);
  const legacy = await order();
  await db.query(
    "INSERT INTO inventory_logs(stock_id,order_id,quantity_changed,change_type) SELECT id,$1,-1,'DISPATCH_DEDUCTION' FROM inventory_stock WHERE category='SIM CARD'",
    [legacy],
  );
  await dispatch(legacy);
  assert.equal(await quantity("SIM CARD"), 100);
  assert.equal(
    await scalar("SELECT status FROM inventory_dispatch_deductions WHERE order_id=$1", [legacy]),
    "legacy_already_deducted",
  );
});

test("stock batches are consumed in order with exact fractional audit quantities", async () => {
  await db.query(
    "UPDATE inventory_stock SET actual_quantity=1,entry_date='2026-01-01' WHERE category='ENCLOUSURE STICKER'",
  );
  await db.query(
    "INSERT INTO inventory_stock(category,actual_quantity,unit_price,entry_date,notes) VALUES('ENCLOUSURE STICKER',2,20,'2026-02-01','{\"inventory_unit\":\"Nos\"}')",
  );
  const id = await order();
  await dispatch(id);
  assert.equal(await quantity("ENCLOUSURE STICKER"), 0.5);
  const amounts = (
    await db.query(
      "SELECT quantity_changed FROM inventory_logs JOIN inventory_stock ON inventory_stock.id=stock_id WHERE order_id=$1 AND category='ENCLOUSURE STICKER' ORDER BY entry_date",
      [id],
    )
  ).rows.map((row) => Number(row.quantity_changed));
  assert.deepEqual(amounts, [-1, -1.5]);
});

test("different orders consume independently and cannot overdraw the same limited stock", async () => {
  await db.query("UPDATE inventory_stock SET actual_quantity=1 WHERE category='SIM CARD'");
  await dispatch(await order());
  const second = await order();
  await db.exec("SAVEPOINT second_order");
  await assert.rejects(dispatch(second), /Insufficient stock: SIM CARD/);
  await db.exec("ROLLBACK TO SAVEPOINT second_order");
  assert.equal(await quantity("SIM CARD"), 0);
  assert.equal(await scalar("SELECT count(*)::int FROM inventory_dispatch_deductions"), 1);
});

test("ledger prevents repeat deduction even after the original stock logs are deleted", async () => {
  const id = await order();
  await dispatch(id);
  await db.query("DELETE FROM inventory_logs WHERE order_id=$1", [id]);
  await dispatch(id, "Delivered");
  assert.equal(await quantity("SIM CARD"), 99);
});

test("non-managers cannot dispatch and cannot call the internal deduction recipe directly", async () => {
  const id = await order();
  await asUser(worker);
  await db.exec("SAVEPOINT unauthorized");
  await assert.rejects(dispatch(id), /Inventory manager access required/);
  await db.exec("ROLLBACK TO SAVEPOINT unauthorized");
  await asUser(manager);
  const exposed = await scalar(
    "SELECT has_function_privilege('authenticated','inventory_dispatch_requirements(inventory_materials)','EXECUTE')",
  );
  assert.equal(exposed, false);
});

test("a log write failure rolls back stock and status along with its deduction receipt", async () => {
  await db.exec(
    "ALTER TABLE inventory_logs ADD CONSTRAINT simulate_audit_failure CHECK(change_type<>'DISPATCH_DEDUCTION')",
  );
  const id = await order();
  await db.exec("SAVEPOINT audit_failure");
  await assert.rejects(dispatch(id), /simulate_audit_failure/);
  await db.exec("ROLLBACK TO SAVEPOINT audit_failure");
  assert.equal(await quantity("SIM CARD"), 100);
  assert.equal(await quantity("ENCLOUSURE STICKER"), 100);
  assert.equal(await scalar("SELECT count(*)::int FROM inventory_dispatch_deductions"), 0);
  assert.equal(await scalar("SELECT state FROM inventory_materials WHERE id=$1", [id]), "Pending");
});

test("duplicate recipes, wrong sensor models and wrong wire units cannot consume inventory", async () => {
  for (const scenario of ["duplicate", "model", "unit"]) {
    await db.exec("SAVEPOINT invalid_configuration");
    if (scenario === "duplicate")
      await db.exec(
        "INSERT INTO inventory_bom_items(category,quantity_per_kit) VALUES('ENCLOSURE STICKER',1)",
      );
    if (scenario === "unit")
      await db.exec(
        "UPDATE inventory_stock SET notes='{\"inventory_unit\":\"Nos\"}' WHERE category='2 CORE WIRE'",
      );
    const id = await order(
      scenario === "model"
        ? { vibration: "TRUE", vibration_model: "Renke" }
        : scenario === "unit"
          ? { ct1: "TRUE", ct2: "TRUE", ct3: "TRUE" }
          : {},
    );
    await db.exec("SAVEPOINT failed_dispatch");
    await assert.rejects(
      dispatch(id),
      scenario === "duplicate" ? /exactly one active Qty\/Kit/ : /Insufficient stock/,
    );
    await db.exec("ROLLBACK TO SAVEPOINT failed_dispatch");
    assert.equal(await quantity("SIM CARD"), 100);
    await db.exec("ROLLBACK TO SAVEPOINT invalid_configuration");
  }
});

test("Shipped status and direct state updates use the same once-per-order receipt", async () => {
  const first = await order();
  await dispatch(first, "Shipped");
  await dispatch(first, "Delivered");
  const second = await order();
  await db.query("UPDATE inventory_materials SET state='Delivered' WHERE id=$1", [second]);
  assert.equal(await quantity("SIM CARD"), 98);
  assert.equal(await scalar("SELECT count(*)::int FROM inventory_dispatch_deductions"), 2);
});

test("frontend and database resolve stock aliases and configured sensor models identically", async () => {
  const source = readFileSync(
    new URL("../src/lib/inventory-components.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const { inventoryComponentKey, inventoryModelKey, inventoryOrderIncludesDm } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
  for (const category of [
    ...core.map(([name]) => name),
    ...sensors,
    ...manuals,
    "Proximity Sensor",
    "3D PRINT ENCLOSURE",
    "Encoder",
    "Antenna",
    "TAPE ROLL",
    "PACKING BOX",
  ]) {
    assert.equal(
      await scalar("SELECT inventory_component_key($1)", [category]),
      inventoryComponentKey(category),
      category,
    );
    assert.equal(
      await scalar("SELECT inventory_component_model($1,NULL)", [category]),
      inventoryModelKey(category, null),
      category,
    );
  }
  assert.equal(
    await scalar("SELECT inventory_component_model('Vibration Sensor','vibe-q')"),
    "vibeq",
  );
  assert.equal(
    await scalar("SELECT inventory_component_model('Proxy Sensor','Inductive')"),
    "inductive",
  );
  for (const notes of [null, "legacy text", "{}", "{broken", JSON.stringify({dm_selected:false}), JSON.stringify({dm_selected:true}), JSON.stringify({dm_selected:"FALSE"})]) {
    assert.equal(await scalar("SELECT inventory_dispatch_selected(coalesce(inventory_dispatch_notes($1)->>'dm_selected','true'))", [notes]), inventoryOrderIncludesDm(notes));
  }
});

test("reapplying the migration preserves its activation cutoff and existing deduction receipts", async () => {
  const id=await order();
  await dispatch(id);
  const pending=await order();
  const receipt=await scalar('SELECT to_jsonb(d) FROM inventory_dispatch_deductions d WHERE order_id=$1',[id]);
  const originalCutoff=await scalar('SELECT activated_at::text FROM inventory_dispatch_settings');
  const repeat=migration('20261013160000_atomic_inventory_dispatch.sql').replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
  await db.exec(repeat);
  await db.exec(migration('20261014110000_device_order_component_selection.sql').replace(/^BEGIN;\s*/m,'').replace(/COMMIT;\s*$/,''));
  assert.equal(await scalar('SELECT activated_at::text FROM inventory_dispatch_settings'),originalCutoff);
  assert.deepEqual(await scalar('SELECT to_jsonb(d) FROM inventory_dispatch_deductions d WHERE order_id=$1',[id]),receipt);
  await dispatch(id,'Delivered');
  assert.equal(await quantity('SIM CARD'),99);
  await dispatch(pending);
  assert.equal(await quantity('SIM CARD'),98);
});

test("zero-change markers make older browser deduction loops skip both Packing and historical orders", async () => {
  const pending=await order();
  await dispatch(pending,'Packing');
  const marker=(await db.query('SELECT quantity_changed,change_type,stock_id FROM inventory_logs WHERE order_id=$1',[pending])).rows;
  assert.equal(marker.length,1);
  assert.equal(Number(marker[0].quantity_changed),0);
  assert.equal(marker[0].stock_id,null);
  assert.equal(await quantity('SIM CARD'),100);
  const old=await order({created_at:'2030-01-01T00:00:00Z'});
  await db.query('INSERT INTO inventory_dispatch_excluded_orders(order_id) VALUES($1)',[old]);
  await dispatch(old,'Delivered');
  assert.equal(await quantity('SIM CARD'),100);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_dispatch_deductions WHERE order_id=$1',[old]),0);
});

test("DM deselection skips its configured parts and antennas stay independently optional", async () => {
  await db.query("UPDATE inventory_stock SET actual_quantity=0 WHERE category='SIM CARD'");
  const id = await order({ notes: JSON.stringify({ dm_selected: false }), antenna: "TRUE", tower_light: "TRUE" });
  await dispatch(id);
  for (const [category, qty] of core) {
    const antennaPart = category.includes("ANTEENA");
    assert.equal(await quantity(category), category === "SIM CARD" ? 0 : antennaPart ? 100 - qty : 100, category);
  }
  assert.equal(await quantity("TOWER LIGHT"), 99);
  assert.equal(await quantity("BOX"), 99);
  await dispatch(id, "Delivered");
  assert.equal(await quantity("MAGNETIC MOUNT ANTEENA"), 98);
  assert.equal(await quantity("TOWER LIGHT"), 99);
});

test("DM-only selections preserve legacy DM defaults but do not deduct unchecked antennas", async () => {
  for (const notes of [null, JSON.stringify({ dm_selected: true })]) {
    await dispatch(await order({ notes }));
  }
  assert.equal(await quantity("SIM CARD"), 98);
  assert.equal(await quantity("MAGNETIC MOUNT ANTEENA"), 100);
  assert.equal(await quantity("RF CABLE (ANTEENA)"), 100);
  assert.equal(await quantity("TOWER LIGHT"), 100);
});

test("any YHDC input selection deducts exactly 3 sensors and preserves the fixed wiring rule", async () => {
  for (let mask = 0; mask < 8; mask++) {
    const selections = Object.fromEntries(["ct1", "ct2", "ct3"].map((key, index) => [key, mask & (1 << index) ? "TRUE" : "FALSE"]));
    await db.exec("SAVEPOINT ct_inputs");
    const id = await order(selections);
    await dispatch(id);
    assert.equal(await quantity("YHDC CT SENSOR"), mask ? 97 : 100);
    assert.equal(await quantity("ENERGY METER CT SENSOR"), 100);
    assert.equal(await quantity("2 CORE WIRE"), mask ? 88 : 100);
    await dispatch(id, "Delivered");
    assert.equal(await quantity("YHDC CT SENSOR"), mask ? 97 : 100);
    await db.exec("ROLLBACK TO SAVEPOINT ct_inputs");
  }
});

test("a single selected YHDC input still requires stock for all 3 sensors", async () => {
  await db.query("UPDATE inventory_stock SET actual_quantity=2 WHERE category='YHDC CT SENSOR'");
  const id = await order({ ct2: "TRUE" });
  await db.exec("SAVEPOINT incomplete_ct_stock");
  await assert.rejects(dispatch(id), /Insufficient stock: YHDC CT SENSOR/);
  await db.exec("ROLLBACK TO SAVEPOINT incomplete_ct_stock");
  assert.equal(await quantity("YHDC CT SENSOR"), 2);
  assert.equal(await quantity("SIM CARD"), 100);
  assert.equal(await scalar("SELECT count(*)::int FROM inventory_dispatch_deductions WHERE order_id=$1", [id]), 0);
});

test("unchecked DM skips additional configured DM parts and selected DM retains them", async () => {
  await db.query("INSERT INTO inventory_stock(category,actual_quantity,notes) VALUES('CUSTOM DM PART',10,'{\"inventory_group\":\"Data Meter\"}')");
  await db.query("INSERT INTO inventory_bom_items(category,quantity_per_kit) VALUES('CUSTOM DM PART',2)");
  await dispatch(await order({ notes: JSON.stringify({ dm_selected: false }) }));
  assert.equal(await quantity("CUSTOM DM PART"), 10);
  await dispatch(await order({ notes: JSON.stringify({ dm_selected: true }) }));
  assert.equal(await quantity("CUSTOM DM PART"), 8);
});
