import type { jsPDF } from "jspdf";
import type { OfferSnapshot } from "./hr";
import { offerContent, offerDate, type OfferBlock } from "./hr-offer-content";

export type OfferAssets = { background: string; regular: string; bold: string; italic: string };
const base64 = (bytes: Uint8Array) => {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
};
const assets = new Map<string, Promise<OfferAssets>>();
export async function loadOfferAssets(template: OfferSnapshot["template"]) {
  if (!assets.has(template)) {
    assets.set(
      template,
      (async () => {
        const paths = [
          `${template}-letterhead.png`,
          "fonts/LiberationSans-Regular.ttf",
          "fonts/LiberationSans-Bold.ttf",
          "fonts/LiberationSans-Italic.ttf",
        ];
        const files = await Promise.all(
          paths.map(async (path) => {
            const response = await fetch(`/hr-templates/${path}`);
            if (!response.ok) throw new Error("Could not load the offer letterhead. Please retry.");
            return base64(new Uint8Array(await response.arrayBuffer()));
          }),
        );
        return {
          background: `data:image/png;base64,${files[0]}`,
          regular: files[1],
          bold: files[2],
          italic: files[3],
        };
      })().catch((error) => {
        assets.delete(template);
        throw error;
      }),
    );
  }
  return assets.get(template)!;
}

type Token = { text: string; bold: boolean };
function tokens(text: string): Token[] {
  return text.split("**").flatMap((part, i) =>
    (part.match(/\s+|\S+/g) || []).map((value) => ({
      text: value.replace(/[\r\n]/g, " "),
      bold: i % 2 === 1,
    })),
  );
}

export async function createOfferPdf(
  snapshot: OfferSnapshot,
  suppliedAssets?: OfferAssets,
  reference = "",
) {
  const [{ jsPDF }, art] = await Promise.all([
    import("jspdf"),
    suppliedAssets || loadOfferAssets(snapshot.template),
  ]);
  const { employee: e, term: t, fields: f, template } = snapshot;
  const intern = t.employment_type === "internship";
  const software = template === "software",
    firmware = template === "firmware";
  const width = software ? 595.56 : 612,
    height = software ? 842.04 : 792;
  const doc = new jsPDF({
    unit: "pt",
    format: [width, height],
    compress: true,
    putOnlyUsedFonts: true,
  });
  for (const [style, data] of [
    ["normal", art.regular],
    ["bold", art.bold],
    ["italic", art.italic],
  ]) {
    doc.addFileToVFS(`Offer-${style}.ttf`, data);
    doc.addFont(`Offer-${style}.ttf`, "Offer", style);
  }
  doc.setProperties({
    title: `${intern ? "Internship" : "Employment"} offer - ${e.name}`,
    author: "LimelightIT Research PVT LTD",
    subject: reference || "Offer letter",
  });
  const fontSize = software ? 10 : firmware ? 9.5 : 9.4;
  const left = software ? 50 : firmware ? 100 : 60;
  const right = firmware ? 78 : 58;
  const bottom = height - (firmware ? 62 : 85);
  const lineHeight = fontSize * 1.26;
  let y = 0;
  const frame = () => {
    doc.addImage(art.background, "PNG", 0, 0, width, height, `${template}-background`, "FAST");
    doc.setFont("Offer", "normal");
    doc.setTextColor(76, 145, 200);
    doc.setFontSize(software ? 16 : 15);
    doc.text(
      "LimelightIT Research PVT LTD",
      software ? 120 : firmware ? 139 : 113,
      software ? 50.4 : 46.7,
    );
    doc.setTextColor(0);
    doc.setFontSize(8);
    doc.text(String(doc.getNumberOfPages()), software ? 10 : 11, 25);
    if (!firmware || doc.getNumberOfPages() === 1) {
      const address =
        template === "field_associate"
          ? ["A-448, Money plant, high street,", "Gota, Ahmedabad,", "Gujarat 382470"]
          : [
              "1113 ELITE MAGNUM Sola Road,",
              "Bhuyangdev Cross Rd,",
              "Ahmedabad- 380061",
              "Gujarat",
            ];
      doc.setFontSize(9);
      doc.setTextColor(55);
      doc.text(address, 12, height - (address.length * 11 + 22), { lineHeightFactor: 1.2 });
    }
    if (reference) {
      doc.setFontSize(6.5);
      doc.setTextColor(90);
      doc.text(reference, width - 20, height - 25, { align: "right" });
    }
    doc.setFont("Offer", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(0);
  };
  const newPage = (start = 82) => {
    doc.addPage([width, height]);
    frame();
    y = start;
  };

  function richLines(text: string, maxWidth: number) {
    const lines: Token[][] = [[]];
    let used = 0;
    for (const word of tokens(text)) {
      doc.setFont("Offer", word.bold ? "bold" : "normal");
      const pieces: string[] = [];
      let rest = word.text;
      // Long emails and unbroken names must wrap within the available width.
      while (doc.getTextWidth(rest.trimEnd()) > maxWidth) {
        let end = rest.length - 1;
        while (end > 1 && doc.getTextWidth(rest.slice(0, end)) > maxWidth) end--;
        pieces.push(rest.slice(0, end));
        rest = rest.slice(end);
      }
      pieces.push(rest);
      for (const piece of pieces) {
        if (!piece.trim() && !lines[lines.length - 1].length) continue;
        const length = doc.getTextWidth(piece);
        if (used + doc.getTextWidth(piece.trimEnd()) > maxWidth && lines[lines.length - 1].length) {
          lines.push([]);
          used = 0;
        }
        lines[lines.length - 1].push({ text: piece, bold: word.bold });
        used += length;
      }
    }
    return lines;
  }
  function write(item: OfferBlock, x = left, maxWidth = width - left - right) {
    x += item.indent || 0;
    maxWidth -= item.indent || 0;
    const size = item.heading ? fontSize + 3 : fontSize;
    doc.setFontSize(size);
    const lines = richLines(item.heading ? `**${item.text}**` : item.text, maxWidth);
    for (const line of lines) {
      if (y + lineHeight > bottom) newPage();
      let cursor = x;
      for (const token of line) {
        doc.setFont("Offer", token.bold ? "bold" : "normal");
        doc.setFontSize(size);
        doc.text(token.text.trimEnd(), cursor, y);
        cursor += doc.getTextWidth(token.text);
      }
      y += item.heading ? lineHeight + 4 : lineHeight;
    }
    y += item.gap ?? 7;
    doc.setFont("Offer", "normal");
    doc.setFontSize(fontSize);
  }

  frame();
  const frontLeft = software ? 72 : firmware ? 94 : 68;
  const frontWidth = width - frontLeft - (software ? 65 : 63);
  const title = `${intern ? "INTERNSHIP" : "JOB"} OFFER WITH LIMELIGHTIT RESEARCH PVT. LTD`;
  doc.setFontSize(software ? 15 : 14);
  doc.setTextColor(67, 84, 111);
  const titleLines = doc.splitTextToSize(title, frontWidth);
  doc.text(titleLines, frontLeft, 195, { lineHeightFactor: 1.2 });
  const titleBottom = 195 + (titleLines.length - 1) * 18;
  doc.setDrawColor(67, 84, 111);
  doc.setLineWidth(0.5);
  doc.line(frontLeft, titleBottom + 4, width - 63, titleBottom + 4);
  doc.setTextColor(0);
  doc.setFontSize(fontSize);
  y = titleBottom + 39;
  const fullName = `${f.honorific ? `${f.honorific} ` : ""}${e.name}`;
  write({ text: `**Date:** ${offerDate(f.offer_date)}`, gap: 1 }, frontLeft, frontWidth);
  write({ text: `**${fullName}**`, gap: 1 }, frontLeft, frontWidth);
  write({ text: f.recipient_location, gap: 1 }, frontLeft, frontWidth);
  doc.setTextColor(0, 0, 200);
  write({ text: e.email, gap: 15 }, frontLeft, frontWidth);
  doc.setTextColor(0);
  write({ text: `Dear ${f.greeting_name},`, gap: 12 }, frontLeft, frontWidth);
  write(
    {
      text: `I am delighted & excited to welcome you to **LimelightIT Research PVT LTD** as **${e.designation}**. At LimelightIT, we believe that our team is our biggest strength and we take pride in hiring ONLY the best and the brightest. We are confident that you would play a significant role in the overall success of the venture and wish you the most enjoyable, learning packed and truly meaningful ${intern && firmware ? "internship " : ""}experience with LimelightIT.`,
      gap: 14,
    },
    frontLeft,
    frontWidth,
  );
  write(
    {
      text: "Your appointment will be governed by the terms and conditions presented in the Annexure A. We look forward to you joining us. Please do not hesitate to call us for any information you may need. Also, please sign this offer as your acceptance and forward the same to us.",
      gap: 20,
    },
    frontLeft,
    frontWidth,
  );
  write({ text: "**Congratulations!**", gap: 12 }, frontLeft, frontWidth);
  if (y + 50 > bottom) newPage();
  y = Math.max(y + 35, Math.min(height - 205, bottom - 52));
  write({ text: "**Tarun Purohit**", gap: 0 }, frontLeft, frontWidth);
  doc.setFont("Offer", "italic");
  doc.text(["Founder and CEO,", "LimelightIT Research pvt. Ltd."], frontLeft, y, {
    lineHeightFactor: 1.25,
  });

  const pages = offerContent(snapshot);
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    newPage(firmware && i === 0 ? 104 : 85);
    if (page.title) {
      doc.setFont("Offer", "normal");
      doc.setFontSize(software ? 20 : 18);
      doc.text(page.title, software ? 72 : firmware ? 94 : 68, y);
      y += 30;
    }
    for (const item of page.blocks) write(item);
    if (i === pages.length - 1) {
      if (y + 65 > bottom) newPage();
      y = Math.max(y + 20, Math.min(height - 120, bottom - 40));
      const signatureX = Math.max(width / 2 + 50, left + 170);
      write({ text: `Date: ${offerDate(f.offer_date)}`, gap: 1 }, left, signatureX - left - 15);
      const dateBottom = y;
      write({ text: `Place: ${f.acceptance_place}`, gap: 0 }, left, signatureX - left - 15);
      y = dateBottom - lineHeight - 1;
      write({ text: "**Signature (with date)**", gap: 5 }, signatureX, width - signatureX - 40);
      write({ text: `**Name: ${fullName}**`, gap: 0 }, signatureX, width - signatureX - 40);
    }
  }
  return doc;
}

export function offerFilename(name: string, reference: string) {
  return `${name.replace(/[^a-zA-Z0-9_-]+/g, "_")}-${reference.replace(/[^a-zA-Z0-9_-]+/g, "_")}-offer.pdf`;
}
