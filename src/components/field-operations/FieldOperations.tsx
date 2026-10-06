import { useEffect, useId, useState, type ReactNode } from "react";
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Download,
  IndianRupee,
  Plus,
  TriangleAlert,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button, Input, Label, Select, Textarea } from "@/components/ui-kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-store";
import { useFieldOperations } from "@/hooks/use-field-operations";
import { commissioningDateChanged } from "@/hooks/use-commissioning-work-dates";
import {
  earningsTotal,
  fieldRpc,
  indiaDate,
  indiaTime,
  installationOverdue,
  money,
  monthDays,
  paymentPeriod,
  phaseLabel,
  shifts,
  stageLabel,
  visibleWorkDates,
  type Associate,
  type Earning,
  type FieldBoard,
  type Phase,
  type VisitType,
} from "@/lib/field-operations";
import logoUrl from "../../../image copy.png";
import { FieldVisitScheduler } from "@/components/field-visit-scheduler/FieldVisitScheduler";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const panel = "rounded-2xl border border-border bg-surface p-4 sm:p-6";
const colors = ["#84cc16", "#38bdf8", "#a78bfa"];
const phases: Phase[] = ["assessment", "installation", "commissioning"];
const payablePhases: Phase[] = ["assessment", "commissioning"];
const visitLabels = { ...stageLabel, follow_up: "Follow-up / issue resolution" };

function LoadMessage({
  loading,
  error,
  unavailable,
  reload,
}: ReturnType<typeof useFieldOperations>) {
  return (
    <div className={panel}>
      <p className="text-sm text-text-secondary">
        {loading
          ? "Loading field operations…"
          : unavailable
            ? "Field operations setup is pending. Apply the attendance and earnings database migration to enable this page."
            : error}
      </p>
      {!loading && (
        <Button variant="secondary" onClick={() => void reload()} className="mt-3">
          Retry
        </Button>
      )}
    </div>
  );
}

export function AssociateEntryGate({ children }: { children: ReactNode }) {
  const { ready, userId, role, roles, profile, signOut } = useAuth();
  const state = useFieldOperations();
  const [step, setStep] = useState<"schedule" | "visits" | null>(null);
  const [busy, setBusy] = useState(false);
  const associate = state.board?.users.find((u) => u.id === userId);
  const [currentDay, setCurrentDay] = useState(indiaDate());
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentDay(indiaDate()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!ready || !userId || role !== "worker" || roles.includes("supervisor") || !profile?.is_active)
    return children;
  // Until the additive migration is installed, preserve the current application.
  if (state.unavailable) return children;
  const online = associate?.online && state.board?.today === currentDay;
  if (!state.loading && !state.error && online && !step) return children;
  const markOnline = async () => {
    setBusy(true);
    const { error } = await fieldRpc("field_ops_attendance", { _associate: userId, _online: true });
    if (error) toast.error(error.message);
    else {
      setStep("schedule");
      await state.reload();
    }
    setBusy(false);
  };
  return (
    <main className="min-h-screen bg-background p-4 text-text-primary sm:p-8">
      <div className="mx-auto max-w-5xl space-y-6 motion-safe:animate-in motion-safe:fade-in">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-syne text-xl font-bold">SIM-Kit · Field Associate</span>
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </header>
        {state.loading || state.error || !state.board ? (
          <LoadMessage {...state} />
        ) : !online ? (
          <section className={`${panel} mx-auto max-w-xl py-12 text-center`}>
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-lime/15 text-lime motion-safe:animate-pulse">
              <Activity size={36} />
            </div>
            <p className="text-sm text-text-secondary">{currentDay} · India Standard Time</p>
            <h1 className="mt-3 font-syne text-3xl font-bold">
              Ready for today, {profile.name || "associate"}?
            </h1>
            <p className="my-5 text-text-secondary">
              Mark online to plan your visits and access your workspace.
            </p>
            <Button onClick={() => void markOnline()} disabled={busy}>
              {busy ? "Recording…" : "Mark as online"}
            </Button>
          </section>
        ) : step === "schedule" ? (
          <>
            <h1 className="font-syne text-3xl font-bold">Plan your company visits</h1>
            <p className="text-text-secondary">
              Choose a stage and company. You can schedule several companies or skip this step.
            </p>
            <ScheduleComposer board={state.board} associateId={userId} reload={state.reload} />
            <Button onClick={() => setStep("visits")}>Continue / skip scheduling</Button>
          </>
        ) : (
          <>
            <h1 className="font-syne text-3xl font-bold">Your scheduled visits</h1>
            <VisitList
              board={state.board}
              associateId={userId}
              date={state.board.today}
              reload={state.reload}
            />
            <Button onClick={() => setStep(null)}>Continue to dashboard</Button>
          </>
        )}
      </div>
    </main>
  );
}

function ScheduleComposer({
  board,
  associateId,
  manager = false,
  initialDate,
  reload,
}: {
  board: FieldBoard;
  associateId: string;
  manager?: boolean;
  initialDate?: string;
  reload: () => Promise<void>;
}) {
  const [stage, setStage] = useState<VisitType | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [date, setDate] = useState(
    initialDate && initialDate >= board.today ? initialDate : board.today,
  );
  const [shift, setShift] = useState("");
  const [arrival, setArrival] = useState("");
  const [end, setEnd] = useState("");
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const companies = board.sites.filter(
    (s) =>
      s.active !== false &&
      s.worker_ids.includes(associateId) &&
      (stage === "follow_up" ? manager : s.phase === stage),
  );
  const selected = companies.find((s) => s.site_id === companyId);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !shift || !arrival || !end || end <= arrival)
      return toast.error("Select a shift and enter an end time after arrival.");
    setBusy(true);
    const { error } = await fieldRpc(
      stage === "follow_up" ? "field_ops_schedule_follow_up" : "field_ops_schedule",
      {
        _site: companyId,
        _associate: associateId,
        ...(stage === "follow_up" ? {} : { _phase: selected.phase }),
        _date: date,
        _shift: shift,
        _arrival: arrival,
        _end: end,
        _priority: manager ? priority : "normal",
        ...(stage === "follow_up" ? { _note: note } : {}),
      },
    );
    if (error) toast.error(error.message);
    else {
      toast.success("Company visit scheduled.");
      setCompanyId("");
      setShift("");
      setArrival("");
      setEnd("");
      setNote("");
      await reload();
    }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <div className={`grid gap-3 ${manager ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3"}`}>
        {phases.map((p) => (
          <button
            key={p}
            onClick={() => setStage(stage === p ? null : p)}
            aria-pressed={stage === p}
            className={`flex flex-col items-start justify-start rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-lime ${stage === p ? "border-lime bg-lime/10" : ""}`}
          >
            <span className="text-xs font-semibold leading-5">{stageLabel[p]}</span>
            <span className="mt-1 block text-[11px] text-text-secondary">
              {
                board.sites.filter(
                  (s) => s.active !== false && s.worker_ids.includes(associateId) && s.phase === p,
                ).length
              }{" "}
              companies
            </span>
          </button>
        ))}
        {manager && (
          <button
            onClick={() => setStage(stage === "follow_up" ? null : "follow_up")}
            aria-pressed={stage === "follow_up"}
            className={`flex flex-col items-start justify-start rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-lime ${stage === "follow_up" ? "border-lime bg-lime/10" : ""}`}
          >
            <span className="text-xs font-semibold leading-5">Company follow-up / issue visit</span>
            <span className="mt-1 block text-[11px] text-text-secondary">
              {
                board.sites.filter((s) => s.active !== false && s.worker_ids.includes(associateId))
                  .length
              }{" "}
              companies
            </span>
            <span className="mt-1 block text-[10px] leading-4 text-text-secondary">
              All assigned companies, including submitted and commissioned
            </span>
          </button>
        )}
      </div>
      {stage && (
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-border bg-surface p-3">
          {companies.length ? (
            companies.map((s) => (
              <button
                key={s.site_id}
                onClick={() => setCompanyId(s.site_id)}
                className="flex w-full items-center justify-between rounded-xl border border-border p-3 text-left hover:border-lime"
              >
                <span className="min-w-0">
                  <span className="block text-xs font-semibold leading-5">{s.company_name}</span>
                  <span className="mt-1 block text-xs text-text-secondary">
                    {s.status || stageLabel[s.phase as Phase]}
                  </span>
                </span>
                <Plus size={14} className="ml-2 shrink-0" />
              </button>
            ))
          ) : (
            <p className="text-sm text-text-secondary">No assigned companies at this stage.</p>
          )}
        </div>
      )}
      <Dialog
        open={!!companyId}
        onOpenChange={(open) => {
          if (!open && !busy) setCompanyId("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule {selected?.company_name}</DialogTitle>
            <DialogDescription>
              {stage === "follow_up"
                ? visitLabels.follow_up
                : selected && selected.phase !== "complete"
                  ? stageLabel[selected.phase]
                  : "Company visit"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void save(e)} className="space-y-4">
            <div>
              <Label>Visit date</Label>
              <Input
                type="date"
                required
                min={board.today}
                value={manager ? date : board.today}
                readOnly={!manager}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <Label>Shift</Label>
              <Select required value={shift} onChange={(e) => setShift(e.target.value)}>
                <option value="">Select shift</option>
                {shifts.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Expected arrival</Label>
                <Input
                  type="time"
                  required
                  value={arrival}
                  onChange={(e) => setArrival(e.target.value)}
                />
              </div>
              <div>
                <Label>Expected end</Label>
                <Input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-text-secondary">
              Arrival and end can be outside your shift. End must follow arrival.
            </p>
            {manager && (
              <div>
                <Label>Daily priority</Label>
                <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="emergency">Emergency</option>
                </Select>
              </div>
            )}
            {stage === "follow_up" && manager && (
              <div>
                <Label>Issue / visit reason</Label>
                <Textarea
                  required
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Describe the issue the associate needs to resolve"
                />
              </div>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Schedule visit"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VisitList({
  board,
  associateId,
  date,
  manager = false,
  history = false,
  reload,
}: {
  board: FieldBoard;
  associateId: string;
  date?: string;
  manager?: boolean;
  history?: boolean;
  reload: () => Promise<void>;
}) {
  const { userId } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const visits = board.visits.filter(
    (v) =>
      (v.assignee_id === associateId ||
        (!manager &&
          board.sites.some(
            (s) =>
              s.site_id === v.site_id &&
              s.worker_ids.includes(associateId) &&
              s.worker_ids.includes(v.assignee_id),
          ))) &&
      (!date || v.scheduled_for === date) &&
      (history || v.status !== "completed"),
  );
  const complete = async (id: string, delayed = false) => {
    const reason = delayed ? window.prompt("Reason for postponing this visit:") : null;
    if (delayed && !reason?.trim()) return;
    setBusy(id);
    const { error } = await fieldRpc("field_ops_complete_visit", {
      _visit: id,
      _delayed: delayed,
      _reason: reason,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(delayed ? "Delay recorded." : "Visit completed.");
      await reload();
    }
    setBusy(null);
  };
  return (
    <div className="space-y-3">
      {!visits.length && (
        <p className="py-4 text-sm text-text-secondary">
          No {history ? "recorded" : "active"} visits{date ? ` for ${date}` : ""}.
        </p>
      )}
      {visits.map((v) => {
        const company = board.sites.find((s) => s.site_id === v.site_id);
        const ready = v.visit_type === "follow_up" || company?.[`${v.visit_type}_ready`];
        return (
          <article key={v.id} className="rounded-xl border border-border bg-surface p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{v.company_name}</h3>
                <p className="mt-1 text-xs text-text-secondary">
                  {visitLabels[v.visit_type]} · {v.scheduled_for}
                </p>
                <p className="mt-1 text-xs">
                  {v.shift ? `Shift ${v.shift} · ` : ""}
                  {v.expected_arrival?.slice(0, 5) || "Time not recorded"}
                  {v.expected_end ? ` – ${v.expected_end.slice(0, 5)}` : ""}
                </p>
                <p className="mt-1 text-xs uppercase text-text-secondary">
                  {v.priority} priority · {v.status}
                  {v.assignee_id !== associateId ? " · Collaborative visit" : ""}
                </p>
                {v.status === "scheduled" && v.scheduled_for < board.today && (
                  <p className="mt-2 text-xs text-amber-600">
                    Visit date passed · awaiting follow-up
                  </p>
                )}
                {v.note && <p className="mt-2 text-sm">{v.note}</p>}
                {v.delay_reason && (
                  <p className="mt-2 text-sm text-amber-600">Delay: {v.delay_reason}</p>
                )}
                {v.completed_at && (
                  <p className="text-xs text-text-secondary">
                    Completed {indiaDate(new Date(v.completed_at))} · {indiaTime(v.completed_at)}
                  </p>
                )}
              </div>
              {manager && v.status !== "completed" && (
                <div className="max-w-40">
                  <Label>Daily priority</Label>
                  <Select
                    aria-label={`Priority for ${v.company_name}`}
                    value={v.priority}
                    disabled={busy === v.id}
                    onChange={async (event) => {
                      setBusy(v.id);
                      const { error } = await fieldRpc("field_visit_schedule_set_priority", {
                        _visit_id: v.id,
                        _priority: event.target.value,
                        _manager_due_date: v.manager_due_date ?? null,
                        _manager_note: v.manager_note ?? null,
                      });
                      if (error) toast.error(error.message);
                      else await reload();
                      setBusy(null);
                    }}
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="emergency">Emergency</option>
                  </Select>
                </div>
              )}
              {!manager && userId === associateId && v.status !== "completed" && (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!ready || busy === v.id} onClick={() => void complete(v.id)}>
                    <CheckCircle2 size={16} /> Mark as complete
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy === v.id}
                    onClick={() => void complete(v.id, true)}
                  >
                    Postpone
                  </Button>
                </div>
              )}
            </div>
            {!manager && !ready && v.visit_type !== "follow_up" && v.status !== "completed" && (
              <p className="mt-3 text-xs text-text-secondary">
                Complete all required {phaseLabel[v.visit_type].toLowerCase()} work
                {v.visit_type === "commissioning" ? " and manager approval" : ""} before marking
                this visit complete.
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function AssociateSchedule() {
  const { userId } = useAuth();
  const state = useFieldOperations();
  const [history, setHistory] = useState(false);
  const [date, setDate] = useState("");
  if (state.unavailable) return <FieldVisitScheduler />;
  if (state.loading || state.error || !state.board || !userId) return <LoadMessage {...state} />;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-syne text-3xl font-bold">My Schedule</h1>
        <p className="mt-2 text-text-secondary">Plan your visits and review completed work.</p>
      </header>
      <ScheduleComposer board={state.board} associateId={userId} reload={state.reload} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={history ? "secondary" : "primary"} onClick={() => setHistory(false)}>
          Active visits
        </Button>
        <Button variant={history ? "primary" : "secondary"} onClick={() => setHistory(true)}>
          Schedule history
        </Button>
        <Input
          aria-label="Filter visits by date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="max-w-48"
        />
        {date && (
          <Button variant="ghost" onClick={() => setDate("")}>
            All dates
          </Button>
        )}
      </div>
      <VisitList
        board={state.board}
        associateId={userId}
        date={date}
        history={history}
        reload={state.reload}
      />
    </div>
  );
}

function DelayedInstallation({ board, associateId }: { board: FieldBoard; associateId: string }) {
  const delayed = board.sites.filter(
    (s) => s.worker_ids.includes(associateId) && installationOverdue(s, board.today),
  );
  if (!delayed.length) return null;
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">
      <h3 className="flex items-center gap-2 font-semibold">
        <TriangleAlert size={18} /> Installation overdue
      </h3>
      {delayed.map((s) => (
        <p className="mt-2 text-sm" key={s.site_id}>
          {s.company_name} · assessed {indiaDate(new Date(s.assessment_completed_at!))}, not
          installed after five calendar days.
        </p>
      ))}
    </div>
  );
}

async function downloadStatement(
  associate: Associate,
  rows: Earning[],
  title: string,
  payments: FieldBoard["payments"],
  dates: string[],
) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  const blob = await fetch(logoUrl).then((r) => r.blob());
  const logo = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const navy: [number, number, number] = [31, 51, 71];
  const muted: [number, number, number] = [102, 120, 138];
  const amount = (value: number) =>
    new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      value,
    );
  const dateLabel = (date: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
  const eligible = rows.filter((entry) => entry.eligible || entry.paid);
  const workDays = dates
    .map((date) => ({ date, entries: eligible.filter((entry) => entry.earning_date === date) }))
    .filter((day) => day.entries.length);
  const total = earningsTotal(eligible);
  const pending = eligible.filter(
    (entry) => entry.phase !== "installation" && entry.amount == null,
  ).length;
  const header = () => {
    doc.setFillColor(...navy);
    doc.rect(0, 0, 210, 22, "F");
    doc.addImage(logo, "PNG", 12, 5, 12, 12);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("LimelightIT Research Pvt. Ltd.", 28, 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("SIM-Kit | Field Associate Earnings Statement", 28, 16);
  };
  const pageDecoration = () => {
    header();
    doc.setDrawColor(224, 230, 238);
    doc.line(12, 282, 198, 282);
    doc.setTextColor(...muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Generated ${dateLabel(indiaDate())} | All amounts in INR`, 12, 288);
    doc.text(`Page ${doc.getNumberOfPages()}`, 198, 288, { align: "right" });
  };
  const tableStyle = {
    margin: { left: 12, right: 12, top: 28, bottom: 20 },
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 1.7,
      textColor: navy,
      lineColor: [230, 235, 242] as [number, number, number],
      lineWidth: 0,
    },
    headStyles: {
      fillColor: navy,
      textColor: [255, 255, 255] as [number, number, number],
      fontStyle: "bold" as const,
    },
    alternateRowStyles: { fillColor: [247, 249, 252] as [number, number, number] },
    didDrawPage: pageDecoration,
    rowPageBreak: "avoid" as const,
  };
  const lastY = () =>
    (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 86;
  const nextSection = (height: number) => {
    const y = lastY() + 7;
    if (y + height > 273) {
      doc.addPage();
      header();
      return 28;
    }
    return y;
  };
  header();
  doc.setTextColor(...navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  const nameLines = doc.splitTextToSize(associate.name, 186) as string[];
  const nameOffset = Math.max(0, nameLines.length - 1) * 5;
  doc.text(nameLines, 12, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(title, 12, 39 + nameOffset);
  doc.setTextColor(...muted);
  doc.text(
    `${workDays.length} work days | ${eligible.length} activities | Installation is not payable${pending ? ` | ${pending} rates pending` : ""}`,
    12,
    45 + nameOffset,
  );
  const detailRows = workDays.flatMap((day, dayIndex) =>
    day.entries.map((entry, index) => ({
      entry,
      date: day.date,
      dayIndex,
      last: index === day.entries.length - 1,
      dailyTotal: earningsTotal(day.entries),
    })),
  );
  autoTable(doc, {
    ...tableStyle,
    startY: 51 + nameOffset,
    head: [["Work date", "Company", "Work type", "Amount", "Status", "Day total"]],
    body: detailRows.map(({ entry, date, last, dailyTotal }) => [
      dateLabel(date),
      entry.company_name,
      phaseLabel[entry.phase],
      entry.phase === "installation"
        ? "-"
        : entry.amount == null
          ? "Rate pending"
          : amount(Number(entry.amount)),
      entry.phase === "installation" ? "Not payable" : entry.paid ? "Paid" : "Unpaid",
      last ? amount(dailyTotal) : "",
    ]),
    foot: [[{ content: "Period total (INR)", colSpan: 5 }, amount(total)]],
    footStyles: { fillColor: [235, 241, 248], textColor: navy, fontStyle: "bold" },
    showFoot: "lastPage",
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 66 },
      2: { cellWidth: 29 },
      3: { cellWidth: 22, halign: "right" },
      4: { cellWidth: 22 },
      5: { cellWidth: 22, halign: "right", fontStyle: "bold" },
    },
    didParseCell: ({ section, row, cell, column }) => {
      if (section !== "body") return;
      const detail = detailRows[row.index];
      cell.styles.fillColor = detail.dayIndex % 2 ? [247, 249, 252] : [255, 255, 255];
      if (detail.last) cell.styles.lineWidth = { bottom: 0.2 };
      if (column.index === 5 && detail.last) cell.styles.fillColor = [237, 247, 240];
    },
  });
  if (payments.length) {
    autoTable(doc, {
      ...tableStyle,
      startY: nextSection(30),
      head: [
        [
          {
            content: "Recorded payments",
            colSpan: 4,
            styles: { fillColor: [235, 241, 248], textColor: navy },
          },
        ],
        ["Cycle ending", "Paid on", "Amount (INR)", "Reference"],
      ],
      body: payments.map((payment) => [
        dateLabel(payment.period_end),
        dateLabel(payment.paid_on),
        amount(Number(payment.amount)),
        payment.reference || "-",
      ]),
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 40 },
        2: { cellWidth: 36, halign: "right" },
        3: { cellWidth: 70 },
      },
    });
  }
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFillColor(255, 255, 255);
    doc.rect(155, 283, 43, 8, "F");
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...muted);
    doc.setFontSize(8);
    doc.text(`Page ${page} of ${pageCount}`, 198, 288, { align: "right" });
  }
  doc.save(`limelight-earnings-${associate.name.replace(/[^a-z0-9]/gi, "-")}-${indiaDate()}.pdf`);
}

function EarningsView({
  board,
  associate,
  manager = false,
  reload,
}: {
  board: FieldBoard;
  associate: Associate;
  manager?: boolean;
  reload: () => Promise<void>;
}) {
  const chartId = useId().replace(/:/g, "");
  const [month, setMonth] = useState(board.today.slice(0, 7));
  const [mode, setMode] = useState("month");
  const [day, setDay] = useState(board.today);
  const [editing, setEditing] = useState<Earning | null>(null);
  const [newDate, setNewDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(board.today);
  const [reference, setReference] = useState("");
  const fullPeriod = paymentPeriod(`${month}-15`);
  const joiningDate = indiaDate(new Date(associate.joined));
  const selectedPeriod = {
    ...fullPeriod,
    start: joiningDate > fullPeriod.start ? joiningDate : fullPeriod.start,
  };
  let start = `${month}-01`,
    end = monthDays(month).at(-1)!;
  if (mode === "cycle") {
    start = selectedPeriod.start;
    end = selectedPeriod.end;
  }
  if (mode === "day") start = end = day;
  if (mode === "week") {
    const anchor = new Date(`${day}T00:00:00Z`);
    const weekday = (anchor.getUTCDay() + 6) % 7;
    anchor.setUTCDate(anchor.getUTCDate() - weekday);
    start = anchor.toISOString().slice(0, 10);
    anchor.setUTCDate(anchor.getUTCDate() + 6);
    end = anchor.toISOString().slice(0, 10);
  }
  const rows = board.earnings.filter(
    (e) => e.associate_id === associate.id && e.earning_date >= start && e.earning_date <= end,
  );
  const eligible = rows.filter((e) => e.eligible || e.paid);
  const workedDates = Array.from(new Set(eligible.map((entry) => entry.earning_date))).sort();
  const recordDates = visibleWorkDates(eligible, board.attendance, associate.id);
  const dates: string[] = [];
  for (
    let d = new Date(`${start}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    dates.push(d.toISOString().slice(0, 10));
  const chart = dates.map((date) => ({
    date: date.slice(5),
    earnings: earningsTotal(eligible.filter((e) => e.earning_date === date)),
  }));
  const distribution = phases.map((p) => ({
    name: phaseLabel[p],
    value: eligible.filter((e) => e.phase === p).length,
  }));
  const payments = board.payments.filter(
    (p) => p.associate_id === associate.id && p.period_end >= start && p.period_end <= end,
  );
  const settled = board.payments.find(
    (p) => p.associate_id === associate.id && p.period_end === selectedPeriod.end,
  );
  const paymentDisabledReason = settled
    ? "Payment has already been recorded for this cycle."
    : selectedPeriod.end >= board.today
      ? `Available after the cycle ends on ${selectedPeriod.end}.`
      : earningsTotal(eligible) <= 0
        ? "This cycle has no payable assessment or commissioning earnings."
        : null;
  const editDate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    const { error } = await fieldRpc("field_ops_edit_commissioning_date", {
      _earning: editing.id,
      _date: newDate,
      _reason: reason,
    });
    if (error) toast.error(error.message);
    else {
      setEditing(null);
      toast.success("Commissioning work date updated.");
      window.dispatchEvent(new Event(commissioningDateChanged));
      await reload();
    }
    setBusy(false);
  };
  const recordPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await fieldRpc("field_ops_record_payment", {
      _associate: associate.id,
      _period_end: selectedPeriod.end,
      _paid_on: paidOn,
      _reference: reference,
    });
    if (error) toast.error(error.message);
    else {
      setPaymentOpen(false);
      toast.success("Payment recorded.");
      await reload();
    }
    setBusy(false);
  };
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface-raised/30 p-4">
        <div>
          <Label>Reporting period</Label>
          <Select
            aria-label="Earnings reporting period"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
            <option value="cycle">Payment cycle (16th–15th)</option>
          </Select>
        </div>
        {mode === "day" || mode === "week" ? (
          <div>
            <Label>{mode === "week" ? "Week containing" : "Work date"}</Label>
            <Input
              type="date"
              required
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
            />
          </div>
        ) : (
          <div>
            <Label>{mode === "cycle" ? "Cycle ending month" : "Month"}</Label>
            <Input
              type="month"
              required
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </div>
        )}
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void downloadStatement(
              associate,
              rows,
              `${start} to ${end}${mode === "cycle" ? ` · Due ${selectedPeriod.due}` : ""}`,
              payments,
              workedDates,
            )
              .catch(() => toast.error("Could not export statement."))
              .finally(() => setBusy(false));
          }}
        >
          <Download size={16} /> PDF statement
        </Button>
        {manager && mode === "cycle" && (
          <Button
            disabled={!!paymentDisabledReason}
            title={paymentDisabledReason || "Record payment already made for this cycle"}
            onClick={() => setPaymentOpen(true)}
          >
            {settled ? "Payment recorded" : "Record payment"}
          </Button>
        )}
      </div>
      {manager && mode === "cycle" && paymentDisabledReason && (
        <p className="text-xs text-text-secondary">{paymentDisabledReason}</p>
      )}
      <p className="text-xs text-text-secondary">
        {start} to {end}
        {mode === "cycle"
          ? ` · Payment due ${selectedPeriod.due}`
          : " · Calendar reporting is separate from the 16th–15th payment cycle."}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Work earnings" value={money(earningsTotal(eligible))} />
        <Metric label="Completed activities" value={String(eligible.length)} />
        <Metric
          label="Rate pending"
          value={String(
            eligible.filter((e) => e.phase !== "installation" && e.amount == null).length,
          )}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`${panel} min-w-0 lg:col-span-2`}>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Daily earnings</h3>
              <p className="mt-1 text-xs text-text-secondary">
                Completed work across the selected period
              </p>
            </div>
            <span className="rounded-full bg-lime/10 px-3 py-1 text-sm font-semibold text-lime">
              {money(earningsTotal(eligible))}
            </span>
          </div>
          <div
            className="h-64"
            role="img"
            aria-label={`Daily earnings chart. Total ${money(earningsTotal(eligible))}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barSize={20}>
                <defs>
                  <linearGradient id={`earnings-${chartId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#84cc16" />
                    <stop offset="100%" stopColor="#4d7c0f" />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--color-border)"
                  strokeDasharray="4 6"
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                  minTickGap={24}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                  width={60}
                  tickFormatter={(v) => `₹${Number(v) >= 1000 ? `${Number(v) / 1000}k` : v}`}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-surface-raised)", radius: 8 }}
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    color: "var(--color-text-primary)",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                  }}
                  formatter={(v) => [money(Number(v)), "Earnings"]}
                  labelFormatter={(label) => `Work date · ${label}`}
                />
                <Bar dataKey="earnings" fill={`url(#earnings-${chartId})`} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={`${panel} min-w-0`}>
          <h3 className="font-semibold">Completed work</h3>
          <p className="mt-1 text-xs text-text-secondary">Activity by company stage</p>
          <div
            className="relative h-52"
            role="img"
            aria-label={`Completed work chart. ${eligible.length} activities`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={distribution}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={84}
                  paddingAngle={distribution.filter((p) => p.value > 0).length > 1 ? 4 : 0}
                  stroke="none"
                >
                  {distribution.map((p, i) => (
                    <Cell key={p.name} fill={colors[i]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    color: "var(--color-text-primary)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {!eligible.length && (
              <div className="pointer-events-none absolute inset-0 m-auto h-[168px] w-[168px] rounded-full border-[22px] border-border/50" />
            )}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold">{eligible.length}</span>
              <span className="text-xs text-text-secondary">activities</span>
            </div>
          </div>
          {distribution.map((p, i) => (
            <p
              key={p.name}
              className="flex items-center justify-between border-t border-border py-3 text-sm"
            >
              <span className="flex items-center gap-2 text-text-secondary">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[i] }} />
                {p.name}
              </span>
              <span className="font-semibold">{p.value}</span>
            </p>
          ))}
        </div>
      </div>
      <section className={panel}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Daily work records</h3>
            <p className="mt-1 text-xs text-text-secondary">
              {start} to {end}
            </p>
          </div>
          <span className="rounded-full bg-lime/10 px-3 py-1 text-sm font-semibold text-lime">
            {money(earningsTotal(eligible))}
          </span>
        </div>
        <div className="mb-3 grid grid-cols-[minmax(0,1fr)_48px_90px] gap-2 border-b border-border px-3 pb-3 text-[10px] font-semibold uppercase tracking-wide text-text-secondary sm:grid-cols-[minmax(0,1fr)_100px_130px] sm:gap-4 sm:text-xs">
          <span>Date</span>
          <span className="text-center">Tasks</span>
          <span className="text-right">Total</span>
        </div>
        {recordDates.map((date) => {
          const daily = eligible.filter((e) => e.earning_date === date);
          return (
            <details
              key={date}
              className="group mb-3 overflow-hidden rounded-xl border border-border open:border-lime/30 open:shadow-sm"
            >
              <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_48px_90px] items-center gap-2 bg-surface-raised/30 px-3 py-4 text-sm transition-colors hover:bg-surface-raised/60 sm:grid-cols-[minmax(0,1fr)_100px_130px] sm:gap-4 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2 font-medium">
                  <ChevronDown
                    size={16}
                    className="shrink-0 text-text-secondary transition-transform group-open:rotate-180"
                  />
                  {date}
                </span>
                <span className="text-center text-text-secondary">{daily.length || ""}</span>
                <span className="min-w-20 text-right font-semibold">
                  {daily.length ? money(earningsTotal(daily)) : ""}
                </span>
              </summary>
              {daily.length > 0 && (
                <div className="overflow-x-auto border-t border-border bg-surface">
                  <table className="w-full min-w-[540px] table-fixed text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-raised/50 text-xs uppercase tracking-wide text-text-secondary">
                        <th className="w-[36%] px-4 py-3 font-semibold">Company</th>
                        <th className="w-[24%] px-4 py-3 font-semibold">Work type</th>
                        <th className="w-[20%] px-4 py-3 text-right font-semibold">Amount</th>
                        <th className="w-[20%] px-4 py-3 text-center font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((e) => (
                        <tr
                          key={e.id}
                          className="border-b border-border/50 even:bg-surface-raised/20 last:border-0"
                        >
                          <td className="px-4 py-4">
                            <span className="block break-words font-semibold">
                              {e.company_name}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className="inline-block rounded-md bg-lime/10 px-2 py-1 text-xs font-medium">
                              {phaseLabel[e.phase]}
                            </span>
                            {manager &&
                              e.phase === "commissioning" &&
                              !e.paid &&
                              e.site_id !== null && (
                                <button
                                  className="ml-2 text-xs text-lime underline"
                                  onClick={() => {
                                    setEditing(e);
                                    setNewDate(e.earning_date);
                                    setReason("");
                                  }}
                                >
                                  Edit date
                                </button>
                              )}
                          </td>
                          <td className="px-4 py-4 text-right font-semibold tabular-nums">
                            {e.phase === "installation"
                              ? "—"
                              : e.amount == null
                                ? "Rate pending"
                                : money(Number(e.amount))}
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span
                              className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${e.phase === "installation" ? "bg-surface-raised text-text-secondary" : e.paid ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                            >
                              {e.phase === "installation"
                                ? "Not payable"
                                : e.paid
                                  ? "Paid"
                                  : "Unpaid"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          );
        })}
        {!recordDates.length && (
          <p className="py-6 text-center text-sm text-text-secondary">
            No work matches the selected period.
          </p>
        )}
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4 font-semibold">
          <span>Total</span>
          <span>{money(earningsTotal(eligible))}</span>
        </div>
      </section>
      {rows.some((e) => !e.eligible && !e.paid) && (
        <p className="text-sm text-amber-600">
          Reopened or incomplete work is excluded from payable earnings.
        </p>
      )}
      {payments.map((p) => (
        <p key={p.id} className="text-sm text-text-secondary">
          Period ending {p.period_end}: {money(Number(p.amount))} paid {p.paid_on}
          {p.reference ? ` · ${p.reference}` : ""}
        </p>
      ))}
      <Dialog open={!!editing} onOpenChange={(open) => !open && !busy && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit commissioning earnings date</DialogTitle>
            <DialogDescription>
              Approval history stays unchanged. Paid work and cleared destination periods cannot be
              edited.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => void editDate(e)}>
            <Label>Actual work date</Label>
            <Input
              type="date"
              required
              max={editing ? indiaDate(new Date(editing.completed_at)) : board.today}
              min={indiaDate(new Date(associate.joined))}
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
            <Label>Reason</Label>
            <Input required value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button type="submit" disabled={busy}>
              Save date
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={paymentOpen} onOpenChange={(open) => !busy && setPaymentOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment already made</DialogTitle>
            <DialogDescription>
              This records payment of per-work earnings; it does not transfer money. Period{" "}
              {selectedPeriod.start} to {selectedPeriod.end}, due {selectedPeriod.due}.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => void recordPayment(e)}>
            <p className="text-xl font-bold">
              {money(earningsTotal(eligible.filter((e) => !e.paid)))}
            </p>
            <Label>Paid on</Label>
            <Input
              required
              type="date"
              max={board.today}
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
            <Label>Payment reference (optional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            <Button type="submit" disabled={busy}>
              Confirm payment record
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={panel}>
      <p className="text-xs uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

export function AssociateEarnings() {
  const { userId } = useAuth();
  const state = useFieldOperations();
  const associate = state.board?.users.find((u) => u.id === userId);
  if (state.loading || state.error || !state.board || !associate) return <LoadMessage {...state} />;
  return (
    <div className="space-y-6">
      <h1 className="flex items-center gap-3 font-syne text-3xl font-bold">
        <IndianRupee /> My Earnings
      </h1>
      <p className="text-text-secondary">
        Earn through completed assessments and approved commissioning.
      </p>
      <EarningsView board={state.board} associate={associate} reload={state.reload} />
    </div>
  );
}

function RatesEditor({
  board,
  associate,
  reload,
}: {
  board: FieldBoard;
  associate: Associate;
  reload: () => Promise<void>;
}) {
  const rate = board.rates.find((r) => r.associate_id === associate.id);
  const [values, setValues] = useState<Record<Phase, string>>({
    assessment: rate ? String(rate.assessment) : "",
    installation: rate ? String(rate.installation) : "",
    commissioning: rate ? String(rate.commissioning) : "",
  });
  const [busy, setBusy] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await fieldRpc("field_ops_set_rates", {
      _associate: associate.id,
      _assessment: Number(values.assessment),
      _installation: 0,
      _commissioning: Number(values.commissioning),
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Rates saved. Existing priced earnings are unchanged.");
      await reload();
    }
    setBusy(false);
  };
  return (
    <form
      onSubmit={(e) => void save(e)}
      className="max-w-3xl rounded-xl border border-border bg-surface p-4"
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-lime/10 text-lime">
          <IndianRupee size={18} />
        </span>
        <div>
          <h3 className="font-semibold">Work prices · {associate.name}</h3>
          <p className="mt-0.5 text-xs text-text-secondary">
            Payment per completed assessment and approved commissioning
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {payablePhases.map((p) => (
          <div key={p} className="rounded-xl border border-border bg-surface-raised/30 p-3">
            <Label>{phaseLabel[p]}</Label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-3 flex items-center text-text-secondary"
              >
                ₹
              </span>
              <Input
                aria-label={`${phaseLabel[p]} price`}
                className="pl-8 font-semibold tabular-nums"
                type="number"
                required
                min="0"
                step="0.01"
                value={values[p]}
                onChange={(e) => setValues({ ...values, [p]: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="max-w-md text-xs text-text-secondary">
          Installation is tracked without payment. Saved prices apply to future completions and
          unpriced work.
        </p>
        <Button type="submit" disabled={busy}>
          Save prices
        </Button>
      </div>
    </form>
  );
}

function AssociateActivityCharts({
  board,
  associate,
  month,
  date,
}: {
  board: FieldBoard;
  associate: Associate;
  month: string;
  date: string;
}) {
  const [period, setPeriod] = useState("month");
  let dates = monthDays(month);
  if (period === "day") dates = [date];
  if (period === "week") {
    const anchor = new Date(`${date}T00:00:00Z`);
    anchor.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
    dates = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(anchor);
      day.setUTCDate(day.getUTCDate() + index);
      return day.toISOString().slice(0, 10);
    });
  }
  const events = board.attendance.filter((event) => event.associate_id === associate.id);
  const earnings = board.earnings.filter(
    (entry) => entry.associate_id === associate.id && (entry.eligible || entry.paid),
  );
  const joined = indiaDate(new Date(associate.joined));
  const data = dates.map((day) => {
    const tracked = day <= board.today && day >= joined && day >= board.tracking_started;
    const online = events.some((event) => event.work_date === day && event.online);
    const daily = earnings.filter((entry) => entry.earning_date === day);
    return {
      date: day.slice(5),
      online: tracked ? Number(online) : null,
      offline: tracked ? Number(!online) : null,
      assessment: earningsTotal(daily.filter((entry) => entry.phase === "assessment")),
      installation: earningsTotal(daily.filter((entry) => entry.phase === "installation")),
      commissioning: earningsTotal(daily.filter((entry) => entry.phase === "commissioning")),
    };
  });
  const onlineDays = data.filter((day) => day.online === 1).length;
  const offlineDays = data.filter((day) => day.offline === 1).length;
  const tooltipStyle = {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 12,
    color: "var(--color-text-primary)",
  };
  const trackedDays = onlineDays + offlineDays;
  const attendance = [
    { name: "Online", value: onlineDays, color: "#10b981" },
    { name: "Offline", value: offlineDays, color: "#f87171" },
  ];
  const periodEarnings = earnings.filter((entry) => dates.includes(entry.earning_date));
  const earningsMix = payablePhases.map((phase) => ({
    name: phaseLabel[phase],
    value: earningsTotal(periodEarnings.filter((entry) => entry.phase === phase)),
    count: periodEarnings.filter((entry) => entry.phase === phase).length,
    color: colors[phases.indexOf(phase)],
  }));
  const total = earningsTotal(periodEarnings);
  const installations = periodEarnings.filter((entry) => entry.phase === "installation").length;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Activity & work insights</h3>
          <p className="mt-0.5 text-xs text-text-secondary">
            {dates[0]} to {dates.at(-1)}
          </p>
        </div>
        <Select
          aria-label="Activity reporting period"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          className="w-auto"
        >
          <option value="month">Monthly</option>
          <option value="week">Weekly</option>
          <option value="day">Daily</option>
        </Select>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <article className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface p-3">
          <h4 className="text-sm font-semibold">Attendance activity</h4>
          <p className="mt-0.5 text-xs text-text-secondary">Check-in share of tracked days</p>
          <div
            className="relative h-40"
            role="img"
            aria-label={`Attendance activity: ${onlineDays} online days, ${offlineDays} offline days`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={attendance}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={66}
                  paddingAngle={onlineDays && offlineDays ? 3 : 0}
                  stroke="none"
                >
                  {attendance.map((item) => (
                    <Cell key={item.name} fill={item.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value, name) => [
                    `${value} days · ${trackedDays ? Math.round((Number(value) / trackedDays) * 100) : 0}%`,
                    name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
            {!trackedDays && (
              <div className="pointer-events-none absolute inset-0 m-auto h-[132px] w-[132px] rounded-full border-[18px] border-border/50" />
            )}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold">
                {trackedDays ? `${Math.round((onlineDays / trackedDays) * 100)}%` : "—"}
              </span>
              <span className="text-[10px] text-text-secondary">online days</span>
            </div>
          </div>
          <div className="space-y-2">
            {attendance.map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2 text-text-secondary">
                  <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                  {item.name}
                </span>
                <span className="font-semibold">
                  {item.value} days{" "}
                  <span className="font-normal text-text-secondary">
                    · {trackedDays ? Math.round((item.value / trackedDays) * 100) : 0}%
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 border-t border-border pt-2 text-[11px] text-text-secondary">
            {trackedDays} tracked days · future dates excluded
          </p>
        </article>
        <article className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface p-3">
          <h4 className="text-sm font-semibold">Earnings by work</h4>
          <p className="mt-0.5 text-xs text-text-secondary">Assessment and commissioning income</p>
          <div
            className="relative h-40"
            role="img"
            aria-label={`Earnings by work: ${money(total)} payable`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={earningsMix}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={66}
                  paddingAngle={earningsMix.every((item) => item.value > 0) ? 3 : 0}
                  stroke="none"
                >
                  {earningsMix.map((item) => (
                    <Cell key={item.name} fill={item.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value, name) => [
                    `${money(Number(value))} · ${total ? Math.round((Number(value) / total) * 100) : 0}%`,
                    name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
            {!total && (
              <div className="pointer-events-none absolute inset-0 m-auto h-[132px] w-[132px] rounded-full border-[18px] border-border/50" />
            )}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="max-w-[92px] truncate text-sm font-bold" title={money(total)}>
                {money(total)}
              </span>
              <span className="text-[10px] text-text-secondary">work earnings</span>
            </div>
          </div>
          <div className="space-y-2">
            {earningsMix.map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2 text-text-secondary">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: item.color }}
                  />
                  {item.name}
                  <span className="text-[10px]">({item.count})</span>
                </span>
                <span className="whitespace-nowrap font-semibold">{money(item.value)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 border-t border-border pt-2 text-[11px] text-text-secondary">
            {installations} installations tracked · no payment
          </p>
        </article>
      </div>
    </section>
  );
}

function AssociateDetails({
  board,
  associate,
  reload,
  compact = false,
}: {
  board: FieldBoard;
  associate: Associate;
  reload: () => Promise<void>;
  compact?: boolean;
}) {
  const [month, setMonth] = useState(board.today.slice(0, 7));
  const [date, setDate] = useState(board.today);
  const [busy, setBusy] = useState(false);
  const events = board.attendance.filter((a) => a.associate_id === associate.id);
  const completedWorkDates = new Set(
    board.earnings
      .filter((entry) => entry.associate_id === associate.id && (entry.eligible || entry.paid))
      .map((entry) => entry.earning_date),
  );
  const days = monthDays(month);
  const offline = async () => {
    setBusy(true);
    const { error } = await fieldRpc("field_ops_attendance", {
      _associate: associate.id,
      _online: false,
    });
    if (error) toast.error(error.message);
    else await reload();
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-raised/50 p-4">
        <div>
          <h2 className="text-xl font-bold">{associate.name}</h2>
          <p className="mt-1 text-xs text-text-secondary">Visits, attendance and work records</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void offline()}
          disabled={busy || !associate.online}
        >
          Mark offline
        </Button>
      </div>
      <DelayedInstallation board={board} associateId={associate.id} />
      <Tabs defaultValue="visits" className="min-w-0">
        <TabsList
          aria-label={`${associate.name} field records`}
          className="mb-3 flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl border border-border bg-surface-raised/50 p-1.5"
        >
          <TabsTrigger value="visits" className="gap-2 px-3 py-2">
            <CalendarDays size={16} />
            Visits & attendance
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2 px-3 py-2">
            <CheckCircle2 size={16} />
            Visit history
          </TabsTrigger>
          {!compact && (
            <TabsTrigger value="earnings" className="gap-2 px-3 py-2">
              <IndianRupee size={16} />
              Earnings
            </TabsTrigger>
          )}
          {!compact && associate.active !== false && (
            <TabsTrigger value="prices" className="gap-2 px-3 py-2">
              <Activity size={16} />
              Work prices
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="visits" className="mt-0">
          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0 space-y-3">
              <h3 className="flex items-center gap-2 font-semibold">
                <CalendarDays size={18} /> {date === board.today ? "Today's" : date} active
                scheduled companies
              </h3>
              <VisitList
                board={board}
                associateId={associate.id}
                date={date}
                manager
                reload={reload}
              />
              {associate.active !== false && (
                <details className="rounded-xl border border-border bg-surface p-3">
                  <summary className="cursor-pointer font-semibold">Schedule company visit</summary>
                  <div className="mt-4">
                    <ScheduleComposer
                      key={`${associate.id}:${date}`}
                      initialDate={date}
                      board={board}
                      associateId={associate.id}
                      manager
                      reload={reload}
                    />
                  </div>
                </details>
              )}

              {!compact && (
                <AssociateActivityCharts
                  board={board}
                  associate={associate}
                  month={month}
                  date={date}
                />
              )}
            </div>
            <aside className="rounded-xl border border-border bg-surface p-3">
              <Label>Attendance calendar</Label>
              <Input
                type="month"
                required
                value={month}
                onChange={(e) => {
                  if (e.target.value) {
                    setMonth(e.target.value);
                    setDate(`${e.target.value}-01`);
                  }
                }}
              />
              <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                  <span key={i} className="py-1 text-text-secondary">
                    {d}
                  </span>
                ))}
                {Array.from(
                  { length: (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7 },
                  (_, i) => (
                    <span key={`pad${i}`} />
                  ),
                )}
                {days.map((d) => {
                  const daily = events.filter((a) => a.work_date === d);
                  const last = daily[0];
                  const future = d > board.today;
                  const beforeJoining =
                    d < indiaDate(new Date(associate.joined)) || d < board.tracking_started;
                  const completedWork = completedWorkDates.has(d);
                  const online = Boolean(last?.online || completedWork);
                  return (
                    <button
                      key={d}
                      onClick={() => setDate(d)}
                      title={`${d}: ${future || beforeJoining ? "No attendance expected" : completedWork ? "Completed work" : online ? "Marked online" : "Offline"}${last ? ` · Latest: ${last.online ? "online" : "offline"}` : ""}`}
                      className={`rounded-lg py-2 ${future || beforeJoining ? "text-text-secondary" : online ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"} ${date === d ? "ring-2 ring-lime" : ""}`}
                    >
                      {Number(d.slice(-2))}
                    </button>
                  );
                })}
              </div>
              <h4 className="mt-3 text-sm font-semibold">Attendance changes · {date}</h4>
              <div className="mt-2 max-h-28 space-y-2 overflow-y-auto">
                {events
                  .filter((a) => a.work_date === date)
                  .map((a) => (
                    <p key={a.id} className="text-xs text-text-secondary">
                      {indiaTime(a.occurred_at)} · {a.online ? "Online" : "Offline"} ·{" "}
                      {a.actor_name}
                    </p>
                  ))}
              </div>
              {!compact && (
                <p className="mt-3 text-xs">
                  Active days this month:{" "}
                  {
                    days.filter(
                      (d) =>
                        events.find((a) => a.work_date === d)?.online || completedWorkDates.has(d),
                    ).length
                  }
                </p>
              )}
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="history" className="mt-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold">Visit history</h3>
              <p className="mt-1 text-sm text-text-secondary">
                Scheduled and completed visits remain available here.
              </p>
            </div>
            <div>
              <Label>Visit date</Label>
              <Input
                aria-label="Visit history date"
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            </div>
          </div>
          <VisitList
            board={board}
            associateId={associate.id}
            date={date}
            manager
            history
            reload={reload}
          />
        </TabsContent>
        {!compact && (
          <>
            {associate.active !== false && (
              <TabsContent value="prices" className="mt-0">
                <RatesEditor
                  key={associate.id}
                  board={board}
                  associate={associate}
                  reload={reload}
                />
              </TabsContent>
            )}
            <TabsContent value="earnings" className="mt-0">
              <EarningsView board={board} associate={associate} manager reload={reload} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

export function ManagerAttendanceBox() {
  const state = useFieldOperations();
  const [selected, setSelected] = useState<string | null>(null);
  if (state.loading) return null;
  if (state.unavailable)
    return (
      <div className={panel}>
        <p className="text-sm text-text-secondary">
          Field associate attendance will be available after the field operations database
          migration.
        </p>
      </div>
    );
  if (state.error || !state.board) return <LoadMessage {...state} />;
  const associate = state.board.users.find((u) => u.id === selected);
  return (
    <section className={panel}>
      <h2 className="mb-4 flex items-center gap-2 font-semibold">
        <Activity size={18} /> Field associates · Today
      </h2>
      <div className="flex flex-wrap gap-3">
        {state.board.users
          .filter((u) => u.active !== false)
          .map((u) => (
            <button
              key={u.id}
              onClick={() => setSelected(u.id)}
              className={`rounded-xl border px-4 py-3 text-sm font-semibold ${u.online ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800"}`}
            >
              {u.name} · {u.online ? "Online" : "Offline"}
            </button>
          ))}
      </div>
      {!state.board.users.some((u) => u.active !== false) && (
        <p className="text-sm text-text-secondary">No active field associates.</p>
      )}
      <Dialog open={!!associate} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Field associate visits</DialogTitle>
            <DialogDescription>Today's work, attendance history and scheduling.</DialogDescription>
          </DialogHeader>
          {associate && (
            <AssociateDetails
              key={associate.id}
              board={state.board}
              associate={associate}
              reload={state.reload}
              compact
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function ManagerFieldOperations() {
  const state = useFieldOperations();
  const [selected, setSelected] = useState<string | null>(null);
  if (state.unavailable) return <FieldVisitScheduler />;
  if (state.loading || state.error || !state.board) return <LoadMessage {...state} />;
  const board = state.board;
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-gradient-to-br from-surface to-lime/5 p-4 sm:p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-lime">
            Field operations
          </p>
          <h1 className="mt-1 font-syne text-2xl font-bold">Field Visit Tracker</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Manage your team's visits, attendance and earnings.
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium">
          <CalendarDays size={16} className="text-lime" />
          {board.today}
        </span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Field associates"
          value={String(board.users.filter((u) => u.active !== false).length)}
        />
        <Metric label="Online today" value={String(board.users.filter((u) => u.online).length)} />
        <Metric
          label="Today's active visits"
          value={String(
            board.visits.filter((v) => v.scheduled_for === board.today && v.status !== "completed")
              .length,
          )}
        />
        <Metric
          label="Installation warnings"
          value={String(board.sites.filter((s) => installationOverdue(s, board.today)).length)}
        />
      </div>
      <div>
        <h2 className="font-semibold">Field associates</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Select an associate to view visits, history, earnings or work prices.
        </p>
      </div>
      {board.users.map((u) => (
        <section
          key={u.id}
          className={`rounded-xl border border-border bg-surface p-4 transition-shadow ${selected === u.id ? "shadow-sm ring-1 ring-lime/20" : "hover:shadow-sm"}`}
        >
          <button
            aria-expanded={selected === u.id}
            onClick={() => setSelected(selected === u.id ? null : u.id)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold ${u.online ? "bg-emerald-100 text-emerald-700" : "bg-surface-raised text-text-secondary"}`}
              >
                {u.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="font-semibold">
                {u.name}{" "}
                <span
                  className={`ml-2 inline-flex rounded-full px-2.5 py-1 text-xs ${u.online ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}
                >
                  {u.active === false ? "Archived" : u.online ? "Online" : "Offline"}
                </span>
              </span>
            </span>
            <ChevronDown className={selected === u.id ? "rotate-180" : ""} size={20} />
          </button>
          {selected === u.id && (
            <div className="mt-3 border-t border-border pt-3">
              <AssociateDetails key={u.id} board={board} associate={u} reload={state.reload} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
