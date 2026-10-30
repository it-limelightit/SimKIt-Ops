import type { jsPDF } from "jspdf";

export function getOverviewPdfRows<T extends { id: string }>(
  rows: T[],
  excludedIds: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => !excludedIds.has(row.id));
}

export function createOverviewPdfHeader(
  doc: jsPDF,
  options: {
    title: string;
    generatedAt: string;
    dateRange: string;
    companyCount: number;
    logo: string | null;
  },
) {
  const margin = 12;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  const titleLines = doc.splitTextToSize(options.title, width) as string[];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const filterLines = doc.splitTextToSize(
    `Updated date: ${options.dateRange}`,
    width - 8,
  ) as string[];
  const titleY = 37;
  const filterY = titleY + titleLines.length * 6 + 3;
  const bottom = filterY + filterLines.length * 4 + 4;

  return {
    height: bottom + 3,
    draw() {
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, doc.internal.pageSize.getWidth(), bottom + 3, "F");
      let brandX = margin;
      if (options.logo) {
        const image = doc.getImageProperties(options.logo);
        const scale = Math.min(22 / image.width, 22 / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        doc.addImage(options.logo, "PNG", margin + (22 - w) / 2, 6 + (22 - h) / 2, w, h);
        brandX += 27;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(18, 28, 48);
      doc.text("LimelightIT", brandX, 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(85, 96, 115);
      doc.text("Research Pvt. Ltd.", brandX, 19);
      doc.setFontSize(7);
      doc.text("FIELD ASSIGNMENT OVERVIEW", brandX, 24);
      doc.setDrawColor(13, 134, 154);
      doc.setLineWidth(0.6);
      doc.line(margin, 29, margin + width, 29);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.setTextColor(18, 28, 48);
      titleLines.forEach((line, i) => doc.text(line, margin, titleY + i * 6));
      doc.setFillColor(246, 248, 251);
      doc.roundedRect(margin, filterY - 3, width, bottom - filterY + 3, 1, 1, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(85, 96, 115);
      doc.text(
        `Generated: ${options.generatedAt}  |  Companies included: ${options.companyCount}`,
        margin + 4,
        filterY + 1,
      );
      filterLines.forEach((line, i) => doc.text(line, margin + 4, filterY + 5 + i * 4));
    },
  };
}
