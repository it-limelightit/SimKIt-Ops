import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/components/inventory/InventoryStockPanel.tsx", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "InventoryStockPanel.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let saveHandler;
function findHandler(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "handleSaveItem")
    saveHandler = node.initializer.getText(parsed);
  ts.forEachChild(node, findHandler);
}
findHandler(parsed);
assert.ok(saveHandler, "Stock form save handler must exist");
const keys = [
  "stock",
  "inventoryComponentKey",
  "inventoryModelKey",
  "category",
  "sensorType",
  "customSensorType",
  "actualQuantity",
  "minQuantity",
  "unitPrice",
  "unitPriceWithGst",
  "priceInputIncludesGst",
  "inventoryGroup",
  "inventoryUnit",
  "quantityPerKit",
  "entryDate",
  "notes",
  "editingId",
  "bomItems",
  "setSaving",
  "supabase",
  "toast",
  "setIsModalOpen",
  "resetForm",
  "fetchStock",
  "fetchBom",
  "console",
];
const compiled = ts.transpileModule(
  `export function createSave(state) {
  const { ${keys.join(",")} } = state;
  const CUSTOM_OPTION_VALUE = '__custom__';
  return ${saveHandler};
}`,
  { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
).outputText;
const { createSave } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const bomSource = readFileSync(
  new URL("../src/lib/inventory-bom-service.ts", import.meta.url),
  "utf8",
);
const componentSource = readFileSync(
  new URL("../src/lib/inventory-components.ts", import.meta.url),
  "utf8",
);
const componentCompiled = ts.transpileModule(componentSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const componentHelpers = await import(
  `data:text/javascript;base64,${Buffer.from(componentCompiled).toString("base64")}`
);
const bomParsed = ts.createSourceFile(
  "inventory-bom-service.ts",
  bomSource,
  ts.ScriptTarget.Latest,
  true,
);
const bomStandalone =
  componentSource +
  "\n" +
  bomParsed.statements
    .filter((statement) => !ts.isImportDeclaration(statement))
    .map((statement) => statement.getText(bomParsed))
    .join("\n");
const bomCompiled = ts.transpileModule(bomStandalone, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { calculateInventoryBom } = await import(
  `data:text/javascript;base64,${Buffer.from(bomCompiled).toString("base64")}`
);

function fixture(overrides = {}, failBom = false) {
  const writes = [],
    successes = [],
    errors = [],
    saving = [];
  let closed = false;
  const write = async (table, action, payload, id) => {
    writes.push({ table, action, payload, id });
    return {
      error:
        failBom && table === "inventory_bom_items"
          ? new Error("Kit requirement save failed")
          : null,
    };
  };
  const state = {
    ...componentHelpers,
    stock: [],
    category: "2 CORE WIRE",
    sensorType: "",
    customSensorType: "",
    actualQuantity: 10,
    minQuantity: 5,
    unitPrice: 30,
    unitPriceWithGst: 35.4,
    priceInputIncludesGst: false,
    inventoryGroup: "Accessories",
    inventoryUnit: "Meter",
    quantityPerKit: 2.5,
    entryDate: "2026-10-13",
    notes: "Inventory test",
    editingId: null,
    bomItems: [],
    setSaving: (value) => saving.push(value),
    supabase: {
      from: (table) => ({
        insert: (payload) => write(table, "insert", payload),
        update: (payload) => ({ eq: async (_column, id) => write(table, "update", payload, id) }),
      }),
    },
    toast: {
      success: (message) => successes.push(message),
      error: (message) => errors.push(message),
    },
    setIsModalOpen: (open) => {
      closed = !open;
    },
    resetForm() {},
    fetchStock() {},
    fetchBom() {},
    console: { error() {} },
    ...overrides,
  };
  return {
    state,
    writes,
    successes,
    errors,
    saving,
    isClosed: () => closed,
    save: () => createSave(state)({ preventDefault() {} }),
  };
}

test("accessory Qty/Kit saves decimal units separately from physical stock and drives bulk requirements", async () => {
  const form = fixture();
  await form.save();
  assert.equal(form.errors.length, 0);
  const stock = form.writes.find((write) => write.table === "inventory_stock").payload;
  const bom = form.writes.find((write) => write.table === "inventory_bom_items").payload;
  assert.equal(stock.actual_quantity, 10);
  assert.equal(stock.unit_price, 30);
  assert.equal(JSON.parse(stock.notes).inventory_group, "Accessories");
  assert.equal(JSON.parse(stock.notes).inventory_unit, "Meter");
  assert.equal(bom.quantity_per_kit, 2.5);
  assert.equal(bom.unit, "Meter");
  const [planning] = calculateInventoryBom([{ ...bom, id: "wire-bom" }], {
    bulkOrderDeviceQuantity: 8,
    currentStock: [stock],
    usage: [],
  });
  assert.equal(planning.bulk_order_quantity, 20);
  assert.equal(planning.in_stock_quantity, 10);
  assert.equal(planning.shortage_quantity, 10);
  assert.equal(stock.actual_quantity, 10);
  assert.equal(form.isClosed(), true);
});

test("editing an accessory updates its existing kit row and preserves optional use and alert settings", async () => {
  const form = fixture({
    editingId: "wire-stock",
    quantityPerKit: 3,
    bomItems: [
      { id: "wire-bom", category: "2 core wire", required_by_default: false, min_quantity: 7 },
    ],
  });
  await form.save();
  const bom = form.writes.find((write) => write.table === "inventory_bom_items");
  assert.equal(bom.action, "update");
  assert.equal(bom.id, "wire-bom");
  assert.equal(bom.payload.quantity_per_kit, 3);
  assert.equal(bom.payload.required_by_default, false);
  assert.equal(bom.payload.min_quantity, 7);
  assert.equal(form.writes.filter((write) => write.table === "inventory_bom_items").length, 1);
});

test("zero physical stock allows a valid accessory requirement; invalid kit quantities write nothing", async () => {
  const emptyStock = fixture({ actualQuantity: 0 });
  await emptyStock.save();
  assert.equal(emptyStock.errors.length, 0);
  assert.equal(emptyStock.writes[0].payload.actual_quantity, 0);
  for (const quantityPerKit of ["", 0, -1, NaN, Infinity]) {
    const form = fixture({ quantityPerKit });
    await form.save();
    assert.equal(form.writes.length, 0);
    assert.match(form.errors[0], /quantity required for one kit/);
  }
});

test("Data Meter kit quantities still save and Sensors retain their existing stock-only behavior", async () => {
  const meter = fixture({
    category: "LCD PCB",
    inventoryGroup: "Data Meter",
    inventoryUnit: "Nos",
    quantityPerKit: 2,
  });
  await meter.save();
  assert.equal(
    meter.writes.find((write) => write.table === "inventory_bom_items").payload.quantity_per_kit,
    2,
  );
  const sensor = fixture({ category: "CT 1", inventoryGroup: "Sensors", quantityPerKit: "" });
  await sensor.save();
  assert.deepEqual(
    sensor.writes.map((write) => write.table),
    ["inventory_stock"],
  );
  assert.equal(sensor.errors.length, 0);
});

test("failed kit saves leave the form open and never announce a successful update", async () => {
  const form = fixture({}, true);
  await form.save();
  assert.equal(form.successes.length, 0);
  assert.match(form.errors[0], /Kit requirement save failed/);
  assert.equal(form.isClosed(), false);
  assert.deepEqual(form.saving, [true, false]);
});

const orderSource = readFileSync(new URL("../src/components/business-consultant/OrderTab.tsx", import.meta.url), "utf8");
const orderParsed = ts.createSourceFile("OrderTab.tsx", orderSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let submitHandler;
function findSubmit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(orderParsed) === "handleSubmit") submitHandler = node.initializer.getText(orderParsed);
  ts.forEachChild(node, findSubmit);
}
findSubmit(orderParsed);
assert.ok(submitHandler);
const orderKeys = ["dm", "withoutCavli", "ct1", "ct2", "ct3", "proxy1", "proxy2", "encoder", "vibration", "vibrationModel", "antenna", "towerLight", "energyMeter", "companyName", "address", "workerId", "userId", "email", "profile", "site", "onOrderReady", "supabase", "toast", "actorName", "recordActivityLog", "setSubmitting", "setExistingOrder", "setSubmittedOrder", "setDm", "setWithoutCavli", "setCt1", "setCt2", "setCt3", "setProxy1", "setProxy2", "setEncoder", "setVibration", "setVibrationModel", "setAntenna", "setTowerLight", "setEnergyMeter"];
const orderCompiled = ts.transpileModule(`export function createSubmit(state) { const { ${orderKeys.join(",")} } = state; return ${submitHandler}; }`, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createSubmit } = await import(`data:text/javascript;base64,${Buffer.from(orderCompiled).toString("base64")}`);

function orderForm(overrides = {}, duplicate = false) {
  const payloads = [], errors = [], resets = {};
  const noop = () => {};
  const state = {
    dm: true, withoutCavli: false, ct1: false, ct2: false, ct3: false, proxy1: false, proxy2: false,
    encoder: false, vibration: false, vibrationModel: "", antenna: false, towerLight: false, energyMeter: false,
    companyName: "Form test", address: "Office", workerId: "worker", userId: "worker", email: "worker@example.test", profile: null,
    site: { id: "site", name: "Factory" }, onOrderReady: noop,
    actorName: () => "Worker", recordActivityLog: async () => {},
    toast: { error: message => errors.push(message), success: noop },
    setSubmitting: noop, setExistingOrder: noop, setSubmittedOrder: noop,
    ...Object.fromEntries(orderKeys.filter(key => /^set(Dm|WithoutCavli|Ct|Proxy|Encoder|Vibration|Antenna|TowerLight|EnergyMeter)/.test(key)).map(key => [key, value => { resets[key] = value; }])),
    supabase: { from: () => ({
      select: () => {
        const query = {
          eq: () => query,
          then: (resolve) => Promise.resolve({ data: duplicate ? [{ id: "existing" }] : [], error: null }).then(resolve),
        };
        return query;
      },
      insert: payload => { payloads.push(payload); return { select: () => ({ single: async () => ({ data: { id: "new", ...payload }, error: null }) }) }; },
    }) },
    ...overrides,
  };
  return { payloads, errors, resets, submit: () => createSubmit(state)({ preventDefault: noop }) };
}

test("device order submission stores DM-only defaults and resets optional components", async () => {
  const form = orderForm();
  await form.submit();
  assert.deepEqual(form.errors, []);
  assert.equal(form.payloads.length, 1);
  const payload = form.payloads[0];
  assert.equal(JSON.parse(payload.notes).dm_selected, true);
  assert.equal(JSON.parse(payload.notes).without_cavli, false);
  for (const flag of ["antenna", "tower_light", "ct1", "ct2", "ct3", "proxy1", "proxy2", "encoder", "vibration", "energy_meter"]) assert.equal(payload[flag], "FALSE", flag);
  assert.equal(form.resets.setDm, true);
  assert.equal(form.resets.setWithoutCavli, false);
  assert.equal(form.resets.setAntenna, false);
});

test("device order submission records Without Cavli only for a selected DM", async () => {
  const withoutCavli = orderForm({ withoutCavli: true });
  await withoutCavli.submit();
  assert.equal(JSON.parse(withoutCavli.payloads[0].notes).without_cavli, true);

  const noDm = orderForm({ dm: false, withoutCavli: true });
  await noDm.submit();
  assert.equal(JSON.parse(noDm.payloads[0].notes).without_cavli, false);
});

test("device order submission persists deselected DM, optional antenna and individual CT inputs", async () => {
  const form = orderForm({ dm: false, antenna: true, towerLight: true, ct1: true, ct3: true });
  await form.submit();
  assert.deepEqual(form.errors, []);
  const payload = form.payloads[0];
  assert.equal(JSON.parse(payload.notes).dm_selected, false);
  assert.equal(payload.antenna, "TRUE");
  assert.equal(payload.tower_light, "TRUE");
  assert.equal(payload.ct1, "TRUE");
  assert.equal(payload.ct2, "FALSE");
  assert.equal(payload.ct3, "TRUE");
});

test("component selections retain duplicate-order protection", async () => {
  const form = orderForm({ dm: false, ct2: true }, true);
  await form.submit();
  assert.equal(form.payloads.length, 0);
  assert.match(form.errors[0], /Already ordered/);
});

const packingSource = readFileSync(new URL("../src/components/inventory/InventoryPanel.tsx", import.meta.url), "utf8");
const checklistSource = packingSource.slice(packingSource.indexOf("  const checklistItems = [];"), packingSource.indexOf("  // Quick fill all checkboxes"));
const packingKeys = ["material", "isTruthy", "ct1", "ct2", "ct3", "proxy1", "proxy2", "encoder", "vibration", "antenna", "towerLight", "energyMeter", "plc", "setCt1", "setCt2", "setCt3", "setProxy1", "setProxy2", "setEncoder", "setVibration", "setAntenna", "setTowerLight", "setEnergyMeter", "setPlc"];
const packingCompiled = ts.transpileModule(`export function checklist(state) { const { ${packingKeys.join(",")} } = state; ${checklistSource}; return checklistItems; }`, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { checklist } = await import(`data:text/javascript;base64,${Buffer.from(packingCompiled).toString("base64")}`);

test("packing checks only the requested CT inputs without changing the saved input flags", () => {
  const changes = {};
  const state = {
    material: { id: "order", ct1: "FALSE", ct2: "TRUE", ct3: "FALSE" },
    isTruthy: value => value === "TRUE", ct1: false, ct2: false, ct3: false,
    setCt1: value => { changes.ct1 = value; }, setCt2: value => { changes.ct2 = value; }, setCt3: value => { changes.ct3 = value; },
  };
  const items = checklist(state);
  assert.deepEqual(items.map(item => item.label), ["YHDC CT 2"]);
  items[0].onChange(true);
  assert.deepEqual(changes, { ct2: true });
});
