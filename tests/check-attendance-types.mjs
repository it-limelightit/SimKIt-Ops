import ts from "typescript";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const edgeFiles = readdirSync("supabase/functions")
  .filter((name) => name.startsWith("attendance-"))
  .map((name) => resolve(`supabase/functions/${name}/index.ts`));
const files = [
  "src/routeTree.gen.ts",
  "src/components/attendance/AttendancePanel.tsx",
  "src/hooks/use-device-attendance.ts",
  "src/lib/device-attendance.ts",
  "src/lib/attendance-review.ts",
  "src/components/field-operations/FieldAttendanceCalendar.tsx",
  "src/components/field-operations/FieldOperations.tsx",
  "src/routes/employee.tsx",
  "src/lib/attendance-analytics.ts",
  "src/lib/attendance-excel.ts",
  "src/lib/attendance-pdf.ts",
  "src/lib/attendance-report-logo.ts",
  "src/lib/attendance-access.ts",
  "src/routes/manager.attendance.tsx",
  "tests/attendance-deno.d.ts",
  ...edgeFiles,
].map((path) => resolve(path));
const options = { ...parsed.options, noEmit: true };
const host = ts.createCompilerHost(options);
host.resolveModuleNames = (names, containing) =>
  names.map(
    (name) =>
      ts.resolveModuleName(
        name.startsWith("https://esm.sh/@supabase/supabase-js") ? "@supabase/supabase-js" : name,
        containing,
        options,
        host,
      ).resolvedModule,
  );
const program = ts.createProgram(files, options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
const isAttendance = (path) =>
  /FieldAttendanceCalendar|FieldOperations\.tsx|[/\\](attendance|attendance-[^/\\]+)[/\\]|device-attendance|attendance-analytics|attendance-excel|attendance-pdf|attendance-report-logo|attendance-access|manager\.attendance|attendance-deno|[/\\]attendance(?:\.ts|-validation)/.test(
    path,
  );
const relevant = diagnostics.filter((d) => !d.file || isAttendance(d.file.fileName) || /attendance-review\.ts$|[/\\]routes[/\\]employee\.tsx$/.test(d.file.fileName));
if (relevant.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(relevant, {
      getCurrentDirectory: ts.sys.getCurrentDirectory,
      getCanonicalFileName: (path) => path,
      getNewLine: () => "\n",
    }),
  );
  process.exitCode = 1;
} else
  console.info(
    `Attendance frontend and Edge Function types pass. ${diagnostics.length} unrelated project diagnostics excluded.`,
  );
