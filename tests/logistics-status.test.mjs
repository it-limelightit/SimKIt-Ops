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
