import ts from "typescript";
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const host = ts.createCompilerHost(parsed.options);
host.resolveModuleNames = (names, containing) =>
  names.map(
    (name) =>
      ts.resolveModuleName(
        name.startsWith("https://esm.sh/@supabase/supabase-js") ? "@supabase/supabase-js" : name,
        containing,
        parsed.options,
        host,
      ).resolvedModule,
  );
const program = ts.createProgram(
  [
    ...parsed.fileNames,
    "supabase/functions/expense-files/index.ts",
    "tests/attendance-deno.d.ts",
    "tests/finance-deno.d.ts",
  ],
  parsed.options,
  host,
);
const diagnostics = ts.getPreEmitDiagnostics(program);
const relevant = diagnostics.filter(
  (d) =>
    !d.file ||
    /[/\\]finance[/\\]|expense-files|finance-deno|[/\\]lib[/\\]finance\.ts$|[/\\]routes[/\\](expenses|manager\.salary-expense|manager)\.tsx$|[/\\]StaffShell\.tsx$|[/\\]manager-access\.ts$/.test(
      d.file.fileName,
    ),
);
if (relevant.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(relevant, {
      getCurrentDirectory: ts.sys.getCurrentDirectory,
      getCanonicalFileName: (p) => p,
      getNewLine: () => "\n",
    }),
  );
  process.exitCode = 1;
} else
  console.info(
    `Finance frontend and Edge Function types pass. ${diagnostics.length} existing diagnostics outside the finance change excluded.`,
  );
