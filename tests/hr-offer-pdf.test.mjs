import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
const encode = (source) =>
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const contentUrl = encode(
  readFileSync(new URL("../src/lib/hr-offer-content.ts", import.meta.url), "utf8"),
);
const source = readFileSync(new URL("../src/lib/hr-offer-pdf.ts", import.meta.url), "utf8")
  .replace('"./hr-offer-content"', JSON.stringify(contentUrl))
  .replace(
    'import("jspdf")',
    `import(${JSON.stringify(pathToFileURL(require.resolve("jspdf")).href)})`,
  );
const { createOfferPdf, offerFilename } = await import(encode(source));
const root = new URL("../public/hr-templates/", import.meta.url);
const font = (name) =>
  readFileSync(new URL(`fonts/LiberationSans-${name}.ttf`, root)).toString("base64");
const makeAssets = (template) => ({
  background: `data:image/png;base64,${readFileSync(new URL(`${template}-letterhead.png`, root)).toString("base64")}`,
  regular: font("Regular"),
  bold: font("Bold"),
  italic: font("Italic"),
});
function snapshot(template, fullTime = false, long = false) {
  return {
    version: 1,
    template,
    employee: {
      id: "sample",
      employee_code: "LL-00012",
      name: long ? "Alexandra Elizabeth Fernandes de Albuquerque and Associates" : "Alex Example",
      email: long ? `${"long".repeat(28)}@example.com` : "alex@example.com",
      designation: long
        ? "Senior Embedded Software and Firmware Systems Development Engineer"
        : template === "firmware"
          ? "Embedded System Intern"
          : template === "field_associate"
            ? "Business Consultant"
            : "Full Stack Developer Intern",
      mentor_name: "Sample Mentor",
      joining_date: "2026-08-05",
      department: template,
      app_access: template === "field_associate" ? "field_associate" : "employee",
      address: "Ahmedabad, Gujarat",
      college: "Sample College",
    },
    term: {
      employment_type: fullTime ? "full_time" : "internship",
      monthly_amount: fullTime ? 30000 : 12500,
      annual_ctc: fullTime ? 420000 : null,
      internship_months: fullTime ? null : 6,
      internship_end: fullTime ? null : "2027-02-04",
      effective_from: "2026-08-05",
    },
    fields: {
      offer_date: "2026-08-01",
      honorific: "",
      greeting_name: "Alex",
      recipient_location: long
        ? "Sample Institute of Advanced Technology and Software Engineering, Ahmedabad, Gujarat, India"
        : "Ahmedabad, Gujarat",
      acceptance_place: "Ahmedabad",
      initial_stipend_months: 3,
      acceptance_days: 2,
      office_timings: "10:00 AM to 7:00 PM (Monday to Saturday)",
      incentive_per_installation: 2500,
      travel_per_km: 4.5,
      installation_target: 6,
      probation_months: 4,
      payment_day: 7,
      payroll_cutoff_day: 30,
    },
  };
}
async function inspect(doc) {
  const data = new Uint8Array(doc.output("arraybuffer"));
  const task = getDocument({ data, useSystemFonts: true });
  const pdf = await task.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const { items } = await page.getTextContent();
    pages.push({
      width: page.view[2],
      height: page.view[3],
      items,
      text: items
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " "),
    });
  }
  await task.destroy();
  return pages;
}

for (const template of ["software", "firmware", "field_associate"]) {
  test(`${template}: supplied letterhead, dynamic employee/compensation, blank acceptance and original page format`, async () => {
    const value = snapshot(template);
    const doc = await createOfferPdf(value, makeAssets(template), "LL-OFFER-2026-00012");
    const pages = await inspect(doc);
    assert.equal(pages.length, template === "field_associate" ? 4 : 3);
    const text = pages.map((p) => p.text).join(" ");
    for (const expected of [
      "Alex Example",
      "alex@example.com",
      "Sample Mentor",
      "INR 12,500",
      "5 August 2026",
      "4 February 2027",
      "1 August 2026",
      "Signature (with date)",
      "LL-OFFER-2026-00012",
      "Annexure A",
    ])
      assert.ok(text.includes(expected), expected);
    assert.doesNotMatch(
      text,
      /Nit Sanghani|Suraj Biswas|Garana Mo Farid|nitsanghani05|biswassuraj7047|faridgarana2004/,
    );
    if (template === "field_associate")
      for (const expected of [
        "INR 2,500",
        "INR 4.5",
        "Minimum 6",
        "4-month probation",
        "day 7",
        "day 30",
      ])
        assert.ok(text.includes(expected), expected);
    for (const p of pages) {
      assert.ok(Math.abs(p.width - (template === "software" ? 595.56 : 612)) < 0.01);
      assert.ok(Math.abs(p.height - (template === "software" ? 842.04 : 792)) < 0.01);
    }
    if (process.env.HR_PREVIEW) {
      mkdirSync(".tmp/offers-generated", { recursive: true });
      writeFileSync(
        `.tmp/offers-generated/${template}.pdf`,
        Buffer.from(doc.output("arraybuffer")),
      );
    }
  });
  test(`${template}: full-time letters use annual CTC and monthly gross without internship compensation clauses`, async () => {
    const doc = await createOfferPdf(snapshot(template, true), makeAssets(template));
    const pages = await inspect(doc);
    const text = pages.map((p) => p.text).join(" ");
    assert.match(text, /JOB OFFER/);
    assert.ok(text.includes("INR 4,20,000"));
    assert.ok(text.includes("INR 30,000"));
    assert.doesNotMatch(
      text,
      /Internship Duration|Stipend and Performance|stipend payments|first 3 months of the internship/,
    );
  });
}

test("long names, designations and emails wrap without overflowing the page or acceptance footer", async () => {
  const value = snapshot("software", false, true);
  const doc = await createOfferPdf(value, makeAssets("software"));
  const pages = await inspect(doc);
  for (const page of pages)
    for (const item of page.items.filter((i) => i.str?.trim())) {
      assert.ok(item.transform[4] >= 0, item.str);
      assert.ok(
        item.transform[4] + item.width <= page.width + 1,
        `Horizontal overflow: ${item.str}`,
      );
      assert.ok(item.transform[5] >= 20, `Footer overflow: ${item.str}`);
    }
  assert.equal(
    offerFilename("Alex / Example", "LL-OFFER-2026-00012"),
    "Alex_Example-LL-OFFER-2026-00012-offer.pdf",
  );
});
