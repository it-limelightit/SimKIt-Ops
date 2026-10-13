import type { Employee, AttendanceRow } from "./device-attendance";
import type { EmployeeDay } from "@/components/attendance/attendance-history";
import type { Worksheet, Workbook } from "exceljs";

const labels: Record<string, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  on_leave: "On leave",
  needs_review: "Needs review",
  awaiting_scan: "Awaiting scan",
  off_day: "Off day",
};
const palette = { ink: "172554", purple: "4F46E5", muted: "64748B", pale: "EEF2FF" };

function heading(sheet: Worksheet, title: string, subtitle: string, columns: number) {
  sheet.properties.defaultRowHeight = 21;
  sheet.mergeCells(1, 1, 1, columns);
  const titleCell = sheet.getCell("A1");
  titleCell.value = title;
  titleCell.font = { name: "Aptos", size: 17, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.ink } };
  titleCell.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(1).height = 34;
  sheet.mergeCells(2, 1, 2, columns);
  sheet.getCell("A2").value = subtitle;
  sheet.getCell("A2").font = { name: "Aptos", size: 11, color: { argb: palette.muted } };
  sheet.getCell("A2").alignment = { indent: 1, vertical: "middle" };
  sheet.getRow(2).height = 25;
  sheet.getRow(3).height = 8;
  sheet.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  sheet.headerFooter.oddFooter = "&LSIM-KIT OPS | Attendance&CAll times IST&RPage &P of &N";
}

function finishReport(workbook: Workbook) {
  for (const sheet of workbook.worksheets) {
    const tabular = sheet.getTables().length > 0;
    sheet.views = [
      {
        zoomScale: 90,
        showGridLines: false,
        ...(tabular
          ? { state: "frozen" as const, ySplit: 5, xSplit: 0, topLeftCell: "A6", activeCell: "A6" }
          : { showRowColHeaders: false }),
      },
    ];
    sheet.eachRow((row, index) => {
      row.eachCell((cell) => {
        cell.font = { name: "Aptos", size: 11, color: { argb: palette.ink }, ...cell.font };
        cell.alignment = { vertical: "middle", ...cell.alignment };
        if (tabular && index >= 6) {
          cell.alignment = {
            ...cell.alignment,
            horizontal:
              typeof cell.value === "number" || cell.value instanceof Date ? "center" : "left",
            indent: 1,
          };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: index % 2 ? "F8FAFC" : "FFFFFF" },
          };
          cell.border = { bottom: { style: "hair", color: { argb: "E2E8F0" } } };
        }
      });
      if (tabular && index >= 6) row.height = 25;
    });
    if (tabular) {
      sheet.getRow(5).height = 29;
      sheet.getRow(5).eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.ink } };
        cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
        cell.alignment = { vertical: "middle", wrapText: true, indent: 1 };
      });
    }
    sheet.pageSetup.margins = {
      left: 0.25,
      right: 0.25,
      top: 0.35,
      bottom: 0.35,
      header: 0.15,
      footer: 0.15,
    };
  }
}

export async function createEmployeeAttendanceWorkbook(
  employee: Employee,
  days: EmployeeDay[],
  start: string,
  end: string,
  generatedAt = new Date(),
) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SIM-KIT OPS";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.calcProperties.fullCalcOnLoad = true;
  const overview = workbook.addWorksheet("Overview", { views: [{ showGridLines: false }] });
  const records = workbook.addWorksheet("Daily records", {
    views: [{ state: "frozen", ySplit: 5, xSplit: 2, showGridLines: false }],
  });
  const guide = workbook.addWorksheet("Report guide", { views: [{ showGridLines: false }] });
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const period = `${start} to ${end} | All times in Asia/Kolkata (IST)`;
  heading(overview, "ATTENDANCE / Employee summary", period, 6);
  overview.columns = [24, 18, 3, 24, 18, 3].map((width) => ({ width }));
  for (const [address, label, value] of [
    ["A4", "Employee", employee.name],
    ["D4", "Enrollment ID", employee.enroll_id],
    ["A5", "Department", employee.department],
    ["D5", "Joining date", employee.employment_start || "Not available"],
  ]) {
    const cell = overview.getCell(address);
    cell.value = label;
    cell.font = { bold: true, color: { argb: palette.muted } };
    overview.mergeCells(
      Number(cell.row),
      Number(cell.col) + 1,
      Number(cell.row),
      Number(cell.col) + 2,
    );
    overview.getCell(cell.row, cell.col + 1).value = value;
    overview.getCell(cell.row, cell.col + 1).alignment = { wrapText: true, vertical: "middle" };
  }
  overview.getCell("E4").numFmt = "@";
  overview.getRow(4).height = 30;
  overview.getCell("A6").value = "Email";
  overview.mergeCells("B6:F6");
  overview.getCell("B6").value = employee.email || "Not provided";
  overview.mergeCells("A7:F7");
  overview.getCell("A7").value =
    "Generated: " +
    generatedAt.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour12: false }) +
    " IST";
  overview.getCell("A7").font = { size: 9, color: { argb: palette.muted } };
  overview.getRow(8).height = 8;
  overview.mergeCells("A9:F9");
  overview.getCell("A9").value = "ATTENDANCE AT A GLANCE";
  overview.getCell("A9").font = { bold: true, color: { argb: palette.purple } };
  const last = Math.max(6, ordered.length + 5);
  const statusRange = "'Daily records'!D6:D" + last;
  const entryRange = "'Daily records'!C6:C" + last;
  const lateRange = "'Daily records'!E6:E" + last;
  const rows = ordered.flatMap((day) => (day.row ? [day.row] : []));
  const late = rows.filter((row) => row.entry_at && (row.late_minutes || 0) > 0).length;
  const timely = rows.filter((row) => row.entry_at && row.late_minutes === 0).length;
  const delay = rows.reduce((sum, row) => sum + (row.entry_at ? row.late_minutes || 0 : 0), 0);
  const before = ordered.filter(
    (day) => !day.row && employee.employment_start && day.date < employee.employment_start,
  ).length;
  const missing = ordered.filter((day) => !day.row).length - before;
  const metrics: [string, string, number | string, string?][] = [
    ["Days in period", "COUNTA('Daily records'!A6:A" + last + ")", ordered.length],
    ["Recorded entries", "COUNT(" + entryRange + ")", rows.filter((row) => row.entry_at).length],
    [
      "On-time entries",
      "COUNTIFS(" +
        entryRange +
        ',">=0",' +
        entryRange +
        ',"<>",' +
        lateRange +
        ",0," +
        lateRange +
        ',"<>")',
      timely,
    ],
    ["Late entries", "COUNTIF(" + lateRange + ',">0")', late],
    ["Total delay (h:mm)", "SUM(" + lateRange + ")/1440", delay / 1440, "[h]:mm"],
    [
      "Punctuality",
      'IFERROR(B12/(B12+B13),"N/A")',
      timely + late ? timely / (timely + late) : "N/A",
      "0.0%",
    ],
    [
      "Awaiting scan",
      "COUNTIF(" + statusRange + ',"Awaiting scan")',
      rows.filter((row) => row.status === "awaiting_scan").length,
    ],
    ...["Absent", "On leave", "Off day", "Needs review"].map((status): [string, string, number] => [
      status,
      "COUNTIF(" + statusRange + ',"' + status + '")',
      rows.filter((row) => labels[row.status] === status).length,
    ]),
    ["Missing records", "COUNTIF(" + statusRange + ',"No record")', missing],
    ["Before joining", "COUNTIF(" + statusRange + ',"Before joining")', before],
    [
      "Leave conflicts",
      "COUNTIF('Daily records'!F6:F" + last + ',"Yes")',
      rows.filter((row) => row.leave_conflict).length,
    ],
  ];
  metrics.forEach(([label, formula, result, format], index) => {
    const r = 10 + (index % 7);
    const c = index < 7 ? 1 : 4;
    overview.getCell(r, c).value = label;
    overview.getCell(r, c + 1).value = { formula, result };
    overview.getCell(r, c + 1).numFmt = format || "0";
    overview.getCell(r, c + 1).font = { bold: true, size: 13, color: { argb: palette.ink } };
    overview.getCell(r, c + 1).alignment = { horizontal: "center", vertical: "middle" };
    for (const column of [c, c + 1])
      overview.getCell(r, column).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: index % 2 ? "FFFFFF" : palette.pale },
      };
    overview.getRow(r).height = 25;
  });
  for (const [r, target, text] of [
    [18, "Daily records", "OPEN DAILY ATTENDANCE →"],
    [19, "Report guide", "OPEN REPORT GUIDE →"],
  ] as const) {
    overview.mergeCells(r, 1, r, 6);
    overview.getCell(r, 1).value = { text, hyperlink: "#'" + target + "'!A1" };
    overview.getCell(r, 1).font = { bold: true, color: { argb: palette.purple } };
  }
  overview.mergeCells("A21:F22");
  overview.getCell("A21").value =
    missing || rows.some((row) => row.status === "needs_review" || row.leave_conflict)
      ? "REVIEW REQUIRED: resolve missing records and attendance conflicts before finalizing attendance."
      : "Review daily records and the report guide for attendance classifications and metrics.";
  overview.getCell("A21").alignment = { wrapText: true, vertical: "middle", indent: 1 };
  overview.getCell("A21").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FEF3C7" } };
  overview.pageSetup.printArea = "A1:F22";

  heading(records, `${employee.name} / Daily attendance`, period, 8);
  records.columns = [
    { width: 16 },
    { width: 12 },
    { width: 16 },
    { width: 18 },
    { width: 14 },
    { width: 13 },
    { width: 14 },
    { width: 36 },
  ];
  records.mergeCells("A4:H4");
  records.getCell("A4").value = {
    text: "← Back to overview | Use column filters to explore this report",
    hyperlink: "#'Overview'!A1",
  };
  records.getCell("A4").font = { color: { argb: palette.purple }, underline: true };
  records.addTable({
    name: "EmployeeAttendance",
    ref: "A5",
    headerRow: true,
    totalsRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Date (IST)", totalsRowLabel: "Filtered totals" },
      { name: "Day" },
      { name: "First entry (IST)", totalsRowFunction: "countNums" },
      { name: "Status" },
      { name: "Delay (minutes)", totalsRowFunction: "sum" },
      { name: "Leave conflict" },
      { name: "Delay (h:mm)", totalsRowFunction: "sum" },
      { name: "Notes" },
    ],
    rows: ordered.map(({ date, row }, index) => {
      const localDate = new Date(`${date}T00:00:00Z`);
      let entry: number | null = null;
      if (row?.entry_at) {
        const [hours, minutes, seconds] = new Date(row.entry_at)
          .toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false })
          .split(":")
          .map(Number);
        entry = (hours * 3600 + minutes * 60 + seconds) / 86400;
      }
      return [
        localDate,
        localDate.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long" }),
        entry,
        row
          ? labels[row.status] || row.status
          : employee.employment_start && date < employee.employment_start
            ? "Before joining"
            : "No record",
        row?.entry_at ? row.late_minutes : null,
        row?.leave_conflict ? "Yes" : "No",
        row?.entry_at && row.late_minutes != null
          ? { formula: `E${index + 6}/1440`, result: row.late_minutes / 1440 }
          : null,
        !row
          ? employee.employment_start && date < employee.employment_start
            ? "Before employment start"
            : "Missing attendance; review"
          : row.leave_conflict
            ? "Scan during leave; manager review"
            : row.entry_at && row.late_minutes == null
              ? "Arrival recorded; timing policy needs review"
              : row.status === "needs_review"
                ? "Attendance requires manager review"
                : "",
      ];
    }),
  });
  records.getColumn(1).numFmt = "dd mmm yyyy";
  records.getColumn(3).numFmt = "hh:mm AM/PM";
  records.getCell(ordered.length + 6, 3).numFmt = "0";
  records.getColumn(5).numFmt = '0" min"';
  records.getColumn(5).hidden = true;
  records.getColumn(7).numFmt = "[h]:mm";
  records.getColumn(8).alignment = { wrapText: true, vertical: "middle" };
  for (let index = 6; index <= ordered.length + 5; index++) records.getRow(index).height = 32;
  for (const [status, background, foreground] of [
    ["Present", "DCFCE7", "166534"],
    ["Late", "FEF3C7", "92400E"],
    ["Absent", "FEE2E2", "991B1B"],
    ["On leave", "EDE9FE", "5B21B6"],
    ["Needs review", "FFEDD5", "9A3412"],
    ["No record", "F1F5F9", "475569"],
  ])
    records.addConditionalFormatting({
      ref: `D6:D${last}`,
      rules: [
        {
          type: "expression",
          priority: 1,
          formulae: [`D6="${status}"`],
          style: {
            fill: { type: "pattern", pattern: "solid", fgColor: { argb: background } },
            font: { bold: true, color: { argb: foreground } },
          },
        },
      ],
    });
  records.pageSetup.printTitlesRow = "1:5";
  records.pageSetup.printArea = `A1:H${ordered.length + 6}`;
  heading(guide, "How to use this report", "SIM-KIT OPS / Attendance reporting", 3);
  guide.columns = [{ width: 28 }, { width: 55 }, { width: 35 }];
  const instructions = [
    [
      "Before joining",
      "Dates before the recorded employment start are separated from missing attendance.",
    ],
    [
      "Explore",
      "Open Daily records and use the header arrows to filter or sort dates, status and arrival times.",
    ],
    [
      "Filtered totals",
      "The table footer counts visible recorded entries and sums visible delay in hours:minutes. Overview always summarizes the full period. Raw delay minutes are preserved in hidden column E.",
    ],
    [
      "Time zone",
      "Dates and first entry times use Asia/Kolkata (IST). Delay is stored as a number of minutes.",
    ],
    [
      "Present / Late",
      "A recorded first entry classified using the attendance policy stored for that day.",
    ],
    [
      "On leave / Off day",
      "Approved leave or a non-working day under the configured attendance calendar.",
    ],
    [
      "Absent",
      "Absence is confirmed only when device coverage and the attendance policy permit it.",
    ],
    [
      "Needs review",
      "An unresolved policy, scan or leave conflict. Recorded and late entry counts can overlap with this status.",
    ],
    ["Awaiting scan", "The attendance cutoff has not yet passed. This is not a confirmed absence."],
    [
      "No record",
      "No employee row was returned for that date, for example before employment started. This does not mean absent.",
    ],
    [
      "Record integrity",
      "This workbook is a download snapshot. Changing workbook cells does not update SIM-KIT OPS.",
    ],
  ];
  instructions.forEach(([label, text], index) => {
    const row = index + 4;
    guide.getCell(row, 1).value = label;
    guide.getCell(row, 1).font = { bold: true, color: { argb: palette.ink } };
    guide.mergeCells(row, 2, row, 3);
    guide.getCell(row, 2).value = text;
    guide.getCell(row, 2).alignment = { wrapText: true, vertical: "middle" };
    guide.getRow(row).height = 42;
  });
  finishReport(workbook);
  return workbook;
}

export async function createOverallAttendanceWorkbook(
  rows: AttendanceRow[],
  date: string,
  scope: string,
  generatedAt = new Date(),
) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SIM-KIT OPS";
  workbook.created = generatedAt;
  workbook.calcProperties.fullCalcOnLoad = true;
  const summary = workbook.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  const departments = workbook.addWorksheet("Department analytics", {
    views: [{ state: "frozen", ySplit: 5, xSplit: 1, showGridLines: false }],
  });
  const records = workbook.addWorksheet("Attendance records", {
    views: [{ state: "frozen", ySplit: 5, xSplit: 2, showGridLines: false }],
  });
  const guide = workbook.addWorksheet("Report guide", { views: [{ showGridLines: false }] });
  const ordered = [...rows].sort(
    (a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name),
  );
  const subtitle = `${date} | ${scope} | Asia/Kolkata (IST)`;
  heading(summary, "SIM-KIT OPS / Attendance analytics", subtitle, 6);
  summary.columns = [22, 12, 2, 22, 12, 2].map((width) => ({ width }));
  summary.mergeCells("A4:F4");
  summary.getCell("A4").value =
    `Generated: ${generatedAt.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour12: false })} IST`;
  summary.mergeCells("A5:F5");
  summary.getCell("A5").value =
    "Analyze the selected day, compare departments and filter individual records.";
  const last = Math.max(6, rows.length + 5);
  const range = (column: string) => `'Attendance records'!${column}6:${column}${last}`;
  const recorded = rows.filter((row) => row.entry_at).length;
  const onTime = rows.filter((row) => row.entry_at && row.late_minutes === 0).length;
  const late = rows.filter((row) => row.entry_at && (row.late_minutes || 0) > 0).length;
  const expected = rows.filter((row) => !["on_leave", "off_day"].includes(row.status));
  const covered = expected.filter((row) => row.entry_at).length;
  const delay = rows.reduce((total, row) => total + (row.entry_at ? row.late_minutes || 0 : 0), 0);
  const metrics: [string, string, number | string, boolean?][] = [
    ["Employees in report", `COUNTA(${range("B")})`, rows.length],
    ["Recorded entries", `COUNT(${range("F")})`, recorded],
    [
      "On-time entries",
      `COUNTIFS(${range("F")},">=0",${range("F")},"<>",${range("G")},0,${range("G")},"<>")`,
      onTime,
    ],
    ["Late entries", `COUNTIF(${range("G")},">0")`, late],
    ...["Absent", "On leave", "Off day", "Needs review", "Awaiting scan"].map(
      (status): [string, string, number] => [
        status,
        `COUNTIF(${range("E")},"${status}")`,
        rows.filter((row) => labels[row.status] === status).length,
      ],
    ),
    [
      "Recorded coverage",
      `IFERROR(COUNTIFS(${range("F")},">=0",${range("F")},"<>",${range("E")},"<>On leave",${range("E")},"<>Off day")/COUNTIFS(${range("E")},"<>",${range("E")},"<>On leave",${range("E")},"<>Off day"),"N/A")`,
      expected.length ? covered / expected.length : "N/A",
      true,
    ],
    [
      "Punctuality (assessed entries)",
      'IFERROR(E10/(E10+E11),"N/A")',
      onTime + late ? onTime / (onTime + late) : "N/A",
      true,
    ],
    ["Total delay (minutes)", `SUM(${range("G")})`, delay],
    ["Average delay per late entry", 'IFERROR(E19/E11,"N/A")', late ? delay / late : "N/A"],
  ];
  metrics.forEach(([label, formula, result, percentage], index) => {
    const row = index + 8;
    summary.mergeCells(row, 1, row, 4);
    summary.getCell(row, 1).value = label;
    summary.mergeCells(row, 5, row, 6);
    summary.getCell(row, 5).value = { formula, result };
    summary.getCell(row, 5).numFmt = percentage ? "0.0%" : index === 12 ? "0.0" : "0";
    summary.getCell(row, 5).font = { size: 15, bold: true, color: { argb: palette.purple } };
    summary.getCell(row, 5).alignment = { horizontal: "right" };
    summary.getRow(row).height = 23;
    if (index % 2 === 0)
      summary.getRow(row).eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.pale } };
      });
  });
  for (const [cell, target, text] of [
    ["A23", "Department analytics", "Compare departments →"],
    ["A25", "Attendance records", "Explore employee records →"],
    ["A27", "Report guide", "Read metric definitions →"],
  ]) {
    summary.mergeCells(`${cell}:F${cell.slice(1)}`);
    summary.getCell(cell).value = { text, hyperlink: `#'${target}'!A1` };
    summary.getCell(cell).font = { color: { argb: palette.purple }, underline: true };
  }
  summary.pageSetup.printArea = "A1:F27";

  heading(records, "Employee attendance / Detailed records", subtitle, 9);
  records.columns = [20, 28, 17, 19, 22, 20, 19, 20, 52].map((width) => ({ width }));
  records.mergeCells("A4:I4");
  records.getCell("A4").value = {
    text: "← Summary | Filter by department, employee, status or delay. Footer totals follow your filters.",
    hyperlink: "#'Summary'!A1",
  };
  records.getCell("A4").font = { color: { argb: palette.purple }, underline: true };
  records.addTable({
    name: "OverallAttendance",
    ref: "A5",
    headerRow: true,
    totalsRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Department", totalsRowLabel: "Filtered totals" },
      { name: "Employee", totalsRowFunction: "count" },
      { name: "Enrollment ID" },
      { name: "Date (IST)" },
      { name: "Attendance status" },
      { name: "First entry (IST)", totalsRowFunction: "countNums" },
      { name: "Delay (minutes)", totalsRowFunction: "sum" },
      { name: "Leave conflict" },
      { name: "Review notes" },
    ],
    rows: ordered.map((row) => {
      const time = row.entry_at
        ? new Date(row.entry_at)
            .toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false })
            .split(":")
            .map(Number)
        : null;
      return [
        row.department,
        row.name,
        row.enroll_id,
        new Date(`${date}T00:00:00Z`),
        labels[row.status] || row.status,
        time ? (time[0] * 3600 + time[1] * 60 + time[2]) / 86400 : null,
        row.entry_at ? row.late_minutes : null,
        row.leave_conflict ? "Yes" : "No",
        row.leave_conflict
          ? "Scan during approved leave; manager review required"
          : row.entry_at && row.late_minutes == null
            ? "Timing policy needs review"
            : row.status === "needs_review"
              ? "Attendance requires manager review"
              : "",
      ];
    }),
  });
  records.getColumn(3).numFmt = "@";
  records.getColumn(4).numFmt = "dd mmm yyyy";
  records.getColumn(6).numFmt = "hh:mm AM/PM";
  records.getCell(rows.length + 6, 6).numFmt = "0";
  records.getColumn(7).numFmt = '0" min"';
  records.getColumn(9).alignment = { wrapText: true, vertical: "middle" };
  for (let row = 6; row <= rows.length + 5; row++) records.getRow(row).height = 32;
  for (const [status, color] of [
    ["Present", "DCFCE7"],
    ["Late", "FEF3C7"],
    ["Absent", "FEE2E2"],
    ["On leave", "EDE9FE"],
    ["Needs review", "FFEDD5"],
  ]) {
    records.addConditionalFormatting({
      ref: `E6:E${last}`,
      rules: [
        {
          type: "expression",
          priority: 1,
          formulae: [`E6="${status}"`],
          style: {
            fill: { type: "pattern", pattern: "solid", fgColor: { argb: color } },
            font: { bold: true, color: { argb: palette.ink } },
          },
        },
      ],
    });
  }
  records.pageSetup.printTitlesRow = "1:5";
  records.pageSetup.printArea = `A1:I${rows.length + 6}`;

  heading(departments, "Department analytics / Daily comparison", subtitle, 12);
  departments.columns = [23, 14, 14, 14, 14, 14, 14, 16, 18, 18, 18, 20].map((width) => ({
    width,
  }));
  departments.mergeCells("A4:L4");
  departments.getCell("A4").value = {
    text: "← Summary | Coverage and punctuality are different measures. N/A means there is no eligible denominator.",
    hyperlink: "#'Summary'!A1",
  };
  departments.getCell("A4").font = { color: { argb: palette.purple }, underline: true };
  const names = [...new Set(rows.map((row) => row.department))].sort();
  departments.addTable({
    name: "DepartmentAnalytics",
    ref: "A5",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      "Department",
      "Employees",
      "Recorded",
      "On time",
      "Late",
      "Absent",
      "On leave",
      "Needs review",
      "Coverage",
      "Punctuality",
      "Delay (min)",
      "Avg late (min)",
    ].map((name) => ({ name })),
    rows: names.map((name, index) => {
      const group = rows.filter((row) => row.department === name);
      const r = index + 6;
      const criterion = `$A${r}`;
      const count = (status: string) => group.filter((row) => labels[row.status] === status).length;
      const entries = group.filter((row) => row.entry_at).length;
      const timely = group.filter((row) => row.entry_at && row.late_minutes === 0).length;
      const delayed = group.filter((row) => row.entry_at && (row.late_minutes || 0) > 0).length;
      const planned = group.filter((row) => !["on_leave", "off_day"].includes(row.status));
      const minutes = group.reduce(
        (total, row) => total + (row.entry_at ? row.late_minutes || 0 : 0),
        0,
      );
      return [
        name,
        { formula: `COUNTIF(${range("A")},${criterion})`, result: group.length },
        {
          formula: `COUNTIFS(${range("A")},${criterion},${range("F")},">=0",${range("F")},"<>")`,
          result: entries,
        },
        {
          formula: `COUNTIFS(${range("A")},${criterion},${range("F")},">=0",${range("F")},"<>",${range("G")},0,${range("G")},"<>")`,
          result: timely,
        },
        { formula: `COUNTIFS(${range("A")},${criterion},${range("G")},">0")`, result: delayed },
        ...["Absent", "On leave", "Needs review"].map((status) => ({
          formula: `COUNTIFS(${range("A")},${criterion},${range("E")},"${status}")`,
          result: count(status),
        })),
        {
          formula: `IFERROR(COUNTIFS(${range("A")},${criterion},${range("F")},">=0",${range("F")},"<>",${range("E")},"<>On leave",${range("E")},"<>Off day")/COUNTIFS(${range("A")},${criterion},${range("E")},"<>",${range("E")},"<>On leave",${range("E")},"<>Off day"),"N/A")`,
          result: planned.length
            ? planned.filter((row) => row.entry_at).length / planned.length
            : "N/A",
        },
        {
          formula: `IFERROR(D${r}/(D${r}+E${r}),"N/A")`,
          result: timely + delayed ? timely / (timely + delayed) : "N/A",
        },
        { formula: `SUMIF(${range("A")},${criterion},${range("G")})`, result: minutes },
        { formula: `IFERROR(K${r}/E${r},"N/A")`, result: delayed ? minutes / delayed : "N/A" },
      ];
    }),
  });
  for (const column of [9, 10]) departments.getColumn(column).numFmt = "0.0%";
  departments.getColumn(12).numFmt = "0.0";
  if (names.length)
    for (const column of ["I", "J"])
      departments.addConditionalFormatting({
        ref: `${column}6:${column}${names.length + 5}`,
        rules: [
          {
            type: "dataBar",
            priority: 1,
            showValue: true,
            cfvo: [
              { type: "num", value: 0 },
              { type: "num", value: 1 },
            ],
          },
        ],
      });
  departments.pageSetup.printTitlesRow = "1:5";
  departments.pageSetup.printArea = `A1:L${names.length + 5}`;

  heading(guide, "Report guide / Read the numbers", "SIM-KIT OPS / Attendance analytics", 3);
  guide.columns = [{ width: 28 }, { width: 55 }, { width: 35 }];
  [
    [
      "Scope",
      `${scope}. This workbook contains only records included at download time for ${date}.`,
    ],
    [
      "Navigation",
      "Use Summary links to open Department analytics or Attendance records. Header filters let you sort and compare employees.",
    ],
    [
      "Interactive totals",
      "Attendance records footer totals follow filters. Summary and Department analytics cover the entire exported dataset and recalculate when records are edited.",
    ],
    [
      "Recorded coverage",
      "Recorded entries among expected employees, excluding On leave and Off day. This is scan coverage, not confirmed attendance or payroll eligibility.",
    ],
    [
      "Punctuality",
      "On-time entries divided by assessed entries (on time plus late). Unknown timing is excluded. N/A means there are no assessed entries.",
    ],
    [
      "Review conflicts",
      "Needs review is retained when a scan conflicts with approved leave or the timing policy is missing. Recorded and late counts may overlap with review counts.",
    ],
    [
      "Average delay",
      "Total delay divided by the number of late entries, in minutes. N/A means no late entries.",
    ],
    [
      "Awaiting / Off day",
      "Awaiting scan is not a confirmed absence. Off day is determined by the configured working calendar.",
    ],
    [
      "Time zone",
      "Dates and first-entry times use IST. Enrollment IDs are text to preserve leading zeros.",
    ],
    [
      "Snapshot",
      "This is a downloaded snapshot. Workbook edits do not change SIM-KIT OPS records.",
    ],
  ].forEach(([label, text], index) => {
    const row = index + 4;
    guide.getCell(row, 1).value = label;
    guide.getCell(row, 1).font = { bold: true, color: { argb: palette.ink } };
    guide.mergeCells(row, 2, row, 3);
    guide.getCell(row, 2).value = text;
    guide.getCell(row, 2).alignment = { wrapText: true, vertical: "middle" };
    guide.getRow(row).height = 44;
  });
  finishReport(workbook);
  return workbook;
}
