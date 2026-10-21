import type { AttendanceRow, Employee } from "./device-attendance";
import type { EmployeeDay } from "@/components/attendance/attendance-history";
import { attendanceSummary, formatAttendanceDuration } from "./attendance-analytics";
import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";

const labels: Record<string, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  on_leave: "On leave",
  needs_review: "Needs review",
  awaiting_scan: "Awaiting scan",
  off_day: "Off day",
};
const navy: [number, number, number] = [31, 51, 71];
const muted: [number, number, number] = [102, 120, 138];
const time = (value: string | null) =>
  value
    ? new Date(value).toLocaleTimeString("en-GB", {
        timeZone: "Asia/Kolkata",
        hour12: false,
      })
    : "-";
const percentage = (value: number | null) => (value == null ? "N/A" : `${value}%`);

async function report(title: string, generatedAt: Date, logo?: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  doc.setProperties({
    title,
    author: "LimelightIT Research Pvt. Ltd.",
    subject: "Attendance analytics",
  });
  function frame() {
    doc.setFillColor(...navy);
    doc.rect(0, 0, 210, 26, "F");
    doc.setFillColor(99, 102, 241);
    doc.rect(0, 26, 210, 1.2, "F");
    if (logo) doc.addImage(logo, "PNG", 12, 6, 13, 13);
    const textX = logo ? 30 : 12;
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("LimelightIT Research Pvt. Ltd.", textX, 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`SIM-Kit | ${title}`, textX, 19);
  }
  frame();
  let y = 36;
  function table(heading: string, head: string[], body: string[][], options: UserOptions = {}) {
    if (y > 248) {
      doc.addPage();
      frame();
      y = 36;
    }
    doc.setTextColor(...navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(heading, 12, y);
    autoTable(doc, {
      startY: y + 4,
      head: [head],
      body,
      margin: { left: 12, right: 12, top: 36, bottom: 22 },
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 2.5,
        textColor: navy,
        overflow: "linebreak",
        lineWidth: 0,
      },
      headStyles: {
        fillColor: navy,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        cellPadding: 3,
      },
      alternateRowStyles: { fillColor: [247, 249, 252] },
      rowPageBreak: "avoid",
      showHead: "everyPage",
      didDrawPage: frame,
      didParseCell: (cell) => {
        if (cell.section !== "body") return;
        const colors: Record<string, [number, number, number]> = {
          Present: [220, 252, 231],
          Late: [255, 237, 213],
          Absent: [255, 228, 230],
          "Needs review": [254, 243, 199],
          "No record": [254, 243, 199],
          "On leave": [224, 231, 255],
          "Off day": [241, 245, 249],
        };
        const color = colors[cell.cell.text.join(" ")];
        if (color) {
          cell.cell.styles.fillColor = color;
          cell.cell.styles.fontStyle = "bold";
        }
      },
      ...options,
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
  }
  function analytics(rows: AttendanceRow[], missing = 0, before = 0) {
    const s = attendanceSummary(rows);
    table(
      "Attendance at a glance",
      ["Metric", "Value", "Metric", "Value"],
      [
        ["Recorded entries", String(s.recorded), "On-time entries", String(s.onTime)],
        ["Late entries", String(s.late), "Absent", String(s.absent)],
        ["On leave", String(s.onLeave), "Off days", String(s.offDay)],
        ["Needs review", String(s.review), "Awaiting scan", String(s.awaiting)],
        ["Recorded coverage", percentage(s.coverage), "Punctuality", percentage(s.punctuality)],
        [
          "Total delay",
          formatAttendanceDuration(s.totalDelay),
          "Average late delay",
          s.averageDelay == null ? "N/A" : formatAttendanceDuration(s.averageDelay),
        ],
        ["Missing records", String(missing), "Before joining", String(before)],
        [
          "Leave conflicts",
          String(rows.filter((r) => r.leave_conflict).length),
          "Unassessed entries",
          String(s.unassessed),
        ],
      ],
    );
  }
  function finish() {
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page);
      doc.setDrawColor(230, 235, 242);
      doc.line(12, 282, 198, 282);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.text(
        `Generated ${generatedAt.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour12: false })} IST | All times IST`,
        12,
        288,
      );
      doc.text(`Page ${page} of ${pages}`, 198, 288, { align: "right" });
    }
    return doc;
  }
  return { table, analytics, finish };
}

const definitions = [
  [
    "Coverage",
    "Recorded entries on expected days / expected days. Leave and off days are excluded. Missing dates are listed separately; they are not inferred as absences.",
  ],
  [
    "Punctuality",
    "On-time entries / entries with an assessed delay. N/A means no eligible entries.",
  ],
  [
    "Delay / Review",
    "Average delay uses late entries only. Scan during leave and missing records require manager review. A scan is a first entry, not a measure of working hours.",
  ],
];

export async function createEmployeeAttendancePdf(
  employee: Employee,
  days: EmployeeDay[],
  start: string,
  end: string,
  generatedAt = new Date(),
  logo?: string,
) {
  const pdf = await report("Employee Attendance Report", generatedAt, logo);
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const before = (day: EmployeeDay) =>
    !day.row && !!employee.employment_start && day.date < employee.employment_start;
  pdf.table(
    "Employee details",
    ["Field", "Details"],
    [
      ["Employee", employee.name],
      ["Enrollment / Department", `${employee.enroll_id} / ${employee.department}`],
      ["Email", employee.email || "Not provided"],
      ["Report period", `${start} to ${end} (${days.length} days)`],
      ["Joining date", employee.employment_start || "Not available"],
    ],
  );
  pdf.analytics(
    ordered.flatMap((d) => (d.row ? [d.row] : [])),
    ordered.filter((d) => !d.row && !before(d)).length,
    ordered.filter(before).length,
  );
  pdf.table(
    "Daily attendance records",
    ["Date", "First entry", "Status", "Delay", "Review notes"],
    ordered.map((day) => [
      day.date,
      time(day.row?.entry_at || null),
      day.row
        ? labels[day.row.status] || day.row.status
        : before(day)
          ? "Before joining"
          : "No record",
      day.row?.late_minutes == null ? "-" : formatAttendanceDuration(day.row.late_minutes),
      day.row?.leave_conflict
        ? "Scan during leave; review"
        : !day.row && !before(day)
          ? "Missing attendance; review"
          : "-",
    ]),
    {
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 23 },
        2: { cellWidth: 30 },
        3: { cellWidth: 22 },
      },
    },
  );
  pdf.table("How to read this report", ["Metric", "Definition"], definitions);
  return pdf.finish();
}

export async function createOverallAttendancePdf(
  rows: AttendanceRow[],
  date: string,
  scope: string,
  generatedAt = new Date(),
  logo?: string,
) {
  const pdf = await report("Attendance Analytics Report", generatedAt, logo);
  pdf.table(
    "Report details",
    ["Field", "Details"],
    [
      ["Attendance date", date],
      ["Scope", scope],
      ["Employees", String(rows.length)],
    ],
  );
  pdf.analytics(rows);
  const departments = [...new Set(rows.map((r) => r.department))].sort();
  pdf.table(
    "Department comparison",
    ["Department", "Staff", "Recorded", "Late", "Absent", "Coverage", "On time %"],
    departments.map((dept) => {
      const s = attendanceSummary(rows.filter((r) => r.department === dept));
      return [
        dept,
        String(s.total),
        String(s.recorded),
        String(s.late),
        String(s.absent),
        percentage(s.coverage),
        percentage(s.punctuality),
      ];
    }),
  );
  pdf.table(
    "Employee attendance records",
    ["Employee / ID", "Department", "Status", "First entry", "Delay", "Review notes"],
    [...rows]
      .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name))
      .map((r) => [
        `${r.name}\n${r.enroll_id}`,
        r.department,
        labels[r.status] || r.status,
        time(r.entry_at),
        r.late_minutes == null ? "-" : formatAttendanceDuration(r.late_minutes),
        r.leave_conflict
          ? "Scan during leave; review"
          : r.status === "needs_review"
            ? "Manager review required"
            : "-",
      ]),
    {
      columnStyles: {
        0: { cellWidth: 44 },
        1: { cellWidth: 24 },
        2: { cellWidth: 28 },
        3: { cellWidth: 23 },
        4: { cellWidth: 22 },
      },
    },
  );
  pdf.table("How to read this report", ["Metric", "Definition"], definitions);
  return pdf.finish();
}
