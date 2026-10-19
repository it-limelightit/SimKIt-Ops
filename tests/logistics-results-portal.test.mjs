import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/inventory/LogisticsResultsPortal.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace(/from "(react-dom|react\/jsx-runtime)"/g, (_, name) => `from "${import.meta.resolve(name)}"`);
const { LogisticsResultsPortal } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("shared logistics results stay out of the KTA section while their container mounts", () => {
  const child = createElement("div", null, "Order results");
  assert.equal(renderToStaticMarkup(createElement(LogisticsResultsPortal, { host: null }, child)), "");
  const host = { nodeType: 1 };
  const portal = LogisticsResultsPortal({ host, children: child });
  assert.equal(portal.containerInfo, host);
  assert.equal(portal.children, child);
});

test("standalone device information still renders results inline without a shared host", () => {
  const markup = renderToStaticMarkup(createElement(LogisticsResultsPortal, {}, createElement("div", null, "Device results")));
  assert.equal(markup, "<div>Device results</div>");
});
