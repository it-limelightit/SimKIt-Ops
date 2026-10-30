import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import ts from "typescript";
import { jsPDF } from "jspdf";

const source = ts.transpileModule(readFileSync("src/lib/overview-pdf.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { getOverviewPdfRows, createOverviewPdfHeader } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("PDF exclusions preserve filtered row order, use IDs and never mutate dashboard data", () => {
  const rows = [{ id: "a", name: "Same company" }, { id: "b", name: "Same company" }, { id: "c" }];
  const excluded = new Set(["b", "outside-current-filters"]);
  assert.deepEqual(getOverviewPdfRows(rows, excluded), [rows[0], rows[2]]);
  assert.equal(rows.length, 3);
  assert.deepEqual(getOverviewPdfRows(rows, new Set()), rows);
  assert.deepEqual(getOverviewPdfRows(rows, new Set(["a", "b", "c"])), []);
  assert.deepEqual(getOverviewPdfRows([], excluded), []);
});

test("branded PDF header repeats with complete metadata and expands for long titles", async () => {
  const doc = new jsPDF();
  const logo = `data:image/png;base64,${readFileSync("image copy.png").toString("base64")}`;
  const options = {
    title: "NPC - Not Started Yet Report",
    generatedAt: "30 Oct 2026, 4:30 pm IST",
    dateRange: "2026-10-01 to 2026-10-30",
    companyCount: 2,
    logo,
  };
  const header = createOverviewPdfHeader(doc, options);
  header.draw();
  doc.text("Table begins here", 12, header.height + 5);
  doc.addPage();
  header.draw();
  const pdf = doc.output();
  for (const text of [
    options.title,
    "LimelightIT",
    "Research Pvt. Ltd.",
    "Companies included: 2",
    options.dateRange,
    "IST",
  ])
    assert.equal(pdf.split(text).length - 1, 2, text);
  const longHeader = createOverviewPdfHeader(doc, { ...options, title: options.title.repeat(5) });
  assert.ok(longHeader.height > header.height, "long titles reserve extra space above the table");
  longHeader.draw();
  const withoutLogo = createOverviewPdfHeader(new jsPDF(), { ...options, logo: null });
  assert.doesNotThrow(() => withoutLogo.draw());
  if (process.env.OVERVIEW_PDF_PREVIEW) {
    const preview = new jsPDF();
    const previewHeader = createOverviewPdfHeader(preview, options);
    previewHeader.draw();
    preview.setFillColor(233, 237, 244);
    preview.rect(12, previewHeader.height, 186, 7, "F");
    preview.setFontSize(8);
    preview.text(
      "#           COMPANY / SITE DETAILS                      FIELD ASSOCIATE                  STATUS",
      15,
      previewHeader.height + 4.5,
    );
    mkdirSync(".tmp", { recursive: true });
    writeFileSync(".tmp/overview-pdf-preview.pdf", Buffer.from(preview.output("arraybuffer")));
    const { createCanvas } = await import("@napi-rs/canvas");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({
      data: new Uint8Array(preview.output("arraybuffer")),
      useSystemFonts: true,
    });
    const document = await loadingTask.promise;
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    writeFileSync(".tmp/overview-pdf-preview.png", canvas.toBuffer("image/png"));
    await loadingTask.destroy();
  }
});
