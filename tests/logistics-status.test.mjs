import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/components/inventory/InventoryPanel.tsx", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "InventoryPanel.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const names = ["normalizeLogisticsStatus", "isDispatchedMaterial", "parseCourierNotes"];
const functions = parsed.statements.filter(
  (statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text),
);
assert.equal(functions.length, names.length);
const compiled = ts.transpileModule(
  functions.map((fn) => fn.getText(parsed)).join("\n") + `\nexport { ${names.join(", ")} };`,
  {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
const { normalizeLogisticsStatus, isDispatchedMaterial } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const material = (state, status, extra = {}) => ({
  state,
  notes: status == null ? null : JSON.stringify({ logistics_status: status, ...extra }),
});

test("dispatched overview excludes pending and packing even when they have dispatch dates", () => {
  const orders = [
    material("Available", "Pending", { transit_date: "2026-10-12" }),
    material("Available", "Packing", { transit_date: "2026-10-12" }),
    material("In transit", "Transit"),
    material("Available", "Dispatched"),
    material("Available", "Delivered"),
  ];
  assert.deepEqual(orders.filter(isDispatchedMaterial), orders.slice(2));
});

test("dispatch aliases belong to transit rather than pending; delivered remains dispatched", () => {
  for (const status of [
    "Dispatched",
    "dispatched",
    " Shipped ",
    "In transit",
    "Transit",
    "in TRANSIT",
  ]) {
    assert.equal(normalizeLogisticsStatus(status), "Transit", status);
    assert.equal(isDispatchedMaterial(material("Available", status)), true, status);
  }
  assert.equal(isDispatchedMaterial(material("Delivered")), true);
  assert.equal(isDispatchedMaterial(material("In transit")), true);
  assert.equal(isDispatchedMaterial(material("Pending")), false);
  assert.equal(isDispatchedMaterial({ state: "Pending", notes: "legacy free text" }), false);
  assert.equal(isDispatchedMaterial({ state: "Pending", notes: "{broken json" }), false);
});

test("latest saved logistics status takes priority over legacy inventory state", () => {
  assert.equal(isDispatchedMaterial(material("In transit", "Pending")), false);
  assert.equal(isDispatchedMaterial(material("Pending", "Dispatched")), true);
});

test("saving courier status preserves the Without Cavli order selection", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 15, 12) });
  let handler;
  function findHandler(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "handleSaveStep2") {
      handler = node.initializer.getText(parsed);
    }
    ts.forEachChild(node, findHandler);
  }
  findHandler(parsed);
  assert.ok(handler);
  const handlerKeys = [
    "editable", "deviceName", "packingDate", "transitDate", "arrivedDate", "state",
    "courierPartner", "courierId", "material", "initialNotes", "userId", "currentActorName",
    "setSaving", "setPackingDate", "setTransitDate", "setArrivedDate", "setExpanded", "onReload",
    "toast", "recordActivityLog", "supabase",
  ];
  const compiledHandler = ts.transpileModule(
    `export function createHandler(context) { const { ${handlerKeys.join(", ")} } = context; return ${handler}; }`,
    { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const { createHandler } = await import(
    `data:text/javascript;base64,${Buffer.from(compiledHandler).toString("base64")}`
  );
  let saved;
  const noop = () => {};
  const initialNotes = { dm_selected: true, without_cavli: true, logistics_status: "Packing" };
  const submit = createHandler({
    editable: true, deviceName: "DM-TEST", packingDate: "2026-10-15", transitDate: "", arrivedDate: "",
    state: "Transit", courierPartner: "Courier", courierId: "TRACK", material: { id: "order", material_name: "Test", state: "Available" },
    initialNotes, userId: "user", currentActorName: "User", setSaving: noop, setPackingDate: noop,
    setTransitDate: noop, setArrivedDate: noop, setExpanded: noop, onReload: noop,
    toast: { error: noop, success: noop }, recordActivityLog: async () => {},
    supabase: { from: () => ({ update: (payload) => { saved = payload; return { eq: async () => ({ error: null }) }; } }) },
  });
  await submit({ preventDefault: noop });
  assert.equal(saved.state, "In transit");
  assert.deepEqual(JSON.parse(saved.notes), {
    dm_selected: true, without_cavli: true, logistics_status: "Transit",
    courier_partner: "Courier", packing_date: "2026-10-15", transit_date: "2026-10-15",
    arrived_date: "", courier_id: "TRACK",
  });
});
