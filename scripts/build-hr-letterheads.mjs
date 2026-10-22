// Rebuild public branding assets from the three locally supplied offer PDFs.
// Original employee text and acceptance signatures are never copied into the app.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const sourceDirectory = resolve(
  process.argv[2] || fileURLToPath(new URL("../.tmp/hr-reference/", import.meta.url)),
);
const target = new URL("../public/hr-templates/", import.meta.url);
await mkdir(new URL("fonts/", target), { recursive: true });
for (const [key, source] of [
  ["software", "offer-latter (1).pdf"],
  ["firmware", "Suraj_Offer_Letter.pdf"],
  ["field_associate", "Farid_Garana_Job_Offer_letter (1).pdf"],
]) {
  const task = getDocument({
    data: new Uint8Array(await readFile(join(sourceDirectory, source))),
    useSystemFonts: true,
  });
  const doc = await task.promise;
  // Software's first page carries its image watermark. Other templates use page 2,
  // keeping all candidate-specific graphics and acceptance areas out of the asset.
  const page = await doc.getPage(key === "software" ? 1 : 2);
  const omitted = new Set([
    OPS.showText,
    OPS.showSpacedText,
    OPS.nextLineShowText,
    OPS.nextLineSetSpacingShowText,
  ]);
  const viewport = page.getViewport({ scale: 1.8 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
    operationsFilter(index, list) {
      if (omitted.has(list.fnArray[index])) return false;
      if (list.fnArray[index] === OPS.constructPath) {
        const bounds = list.argsArray[index][2];
        // Remove title and email underlines from the source's variable body.
        if (bounds && bounds[1] > 100 && bounds[1] < 740 && bounds[3] - bounds[1] < 3) return false;
      }
      return true;
    },
  }).promise;
  await writeFile(new URL(`${key}-letterhead.png`, target), canvas.toBuffer("image/png"));
  await task.destroy();
  console.info(`Built clean ${key} letterhead.`);
}
const standardFonts = join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts");
for (const filename of [
  "LiberationSans-Regular.ttf",
  "LiberationSans-Bold.ttf",
  "LiberationSans-Italic.ttf",
  "LICENSE_LIBERATION",
]) {
  await copyFile(join(standardFonts, filename), new URL(`fonts/${filename}`, target));
}
