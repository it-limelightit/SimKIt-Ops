import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-store";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  Label,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui-kit";
import { toast } from "sonner";

const stages = [
  "Pending Works",
  "Monitoring",
  "Insights Shared",
  "Meeting Planned",
  "Quotation Sent",
  "Converted",
] as const;
const checklistFields = [
  "Business Profile",
  "Product List",
  "Availability",
  "Performance",
  "Energy",
  "OEE",
] as const;
const stageStyles: Record<
  Stage,
  { accent: string; count: "danger" | "info" | "success" | "warning" }
> = {
  "Pending Works": { accent: "border-t-coral", count: "danger" },
  Monitoring: { accent: "border-t-violet", count: "info" },
  "Insights Shared": { accent: "border-t-[#5b8def]", count: "info" },
  "Meeting Planned": { accent: "border-t-warning", count: "warning" },
  "Quotation Sent": { accent: "border-t-mint", count: "success" },
  Converted: { accent: "border-t-lime", count: "success" },
};
type Stage = (typeof stages)[number];
type Tracker = {
  id: string;
  site_id: string;
  stage: Stage;
  stage_changed_at: string;
  company_name: string;
  city: string | null;
  assignee_id: string;
  assignee_name: string | null;
  issue_checklist: Record<string, boolean>;
  comments: Array<{
    id: string;
    body: string;
    stage: string;
    created_at: string;
    author: string | null;
  }>;
  monitoring_days: Array<{
    day_number: number;
    checklist: Record<string, boolean>;
    result: "pending" | "green" | "red";
    completed_at: string | null;
  }>;
};
type Options = {
  sites: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
};
type TrackerRpc = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export function CompanyTracker() {
  const { ready, userId } = useAuth();
  const [items, setItems] = useState<Tracker[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [isManager, setIsManager] = useState(false);
  const [options, setOptions] = useState<Options>({ sites: [], users: [] });
  const [assignOpen, setAssignOpen] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [assignmentStage, setAssignmentStage] = useState<Stage>("Pending Works");
  const [busy, setBusy] = useState(false);
  const [commentFor, setCommentFor] = useState<Tracker | null>(null);
  const [commentsView, setCommentsView] = useState<Tracker | null>(null);
  const [comment, setComment] = useState("");
  const [monitorFor, setMonitorFor] = useState<Tracker | null>(null);
  const [monitorDetails, setMonitorDetails] = useState<Tracker | null>(null);
  const [day, setDay] = useState(1);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [issueFor, setIssueFor] = useState<Tracker | null>(null);
  const [issueChecks, setIssueChecks] = useState<Record<string, boolean>>({});
  const trackerDb = supabase as unknown as TrackerRpc;
  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [board, manager] = await Promise.all([
      trackerDb.rpc("company_tracker_board"),
      trackerDb.rpc("is_company_tracker_manager"),
    ]);
    if (board.error) toast.error(`Could not load company tracker: ${board.error.message}`);
    else setItems((board.data ?? []) as Tracker[]);
    const managerValue = !!manager.data;
    setIsManager(managerValue);
    if (managerValue) {
      const res = await trackerDb.rpc("company_tracker_assignment_options");
      if (!res.error && res.data) setOptions(res.data as Options);
    }
    setLoading(false);
  }, [trackerDb, userId]);
  useEffect(() => {
    if (ready && userId) void load();
  }, [ready, userId, load]);
  const scopedItems = useMemo(
    () => items.filter((item) => !assigneeFilter || item.assignee_id === assigneeFilter),
    [items, assigneeFilter],
  );
  const filtered = useMemo(
    () =>
      scopedItems.filter((item) =>
        `${item.company_name} ${item.city ?? ""} ${item.assignee_name ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [scopedItems, query],
  );
  const assignableSites = useMemo(
    () =>
      options.sites.filter((site) =>
        site.name.toLowerCase().includes(assignmentSearch.toLowerCase()),
      ),
    [options.sites, assignmentSearch],
  );
  const total = scopedItems.length,
    converted = scopedItems.filter((x) => x.stage === "Converted").length,
    pending = scopedItems.filter((x) => x.stage === "Pending Works").length,
    progress = scopedItems.filter(
      (x) => !["Pending Works", "Converted"].includes(x.stage),
    ).length;
  const assign = async () => {
    if (!siteId || !assigneeId || !assignmentStage) return toast.error("Select a company, assignee, and stage.");
    setBusy(true);
    const { error } = await trackerDb.rpc("company_tracker_assign", {
      _site_id: siteId,
      _assignee_id: assigneeId,
      _stage: assignmentStage,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Company assigned to ${assignmentStage}.`);
    setAssignOpen(false);
    setSiteId("");
    setAssignmentSearch("");
    setAssigneeId("");
    setAssignmentStage("Pending Works");
    void load();
  };
  const deleteTracker = async (item: Tracker) => {
    if (
      !window.confirm(
        `Delete ${item.company_name} from Company Tracker? This also removes its comments and monitoring history.`,
      )
    )
      return;
    setBusy(true);
    const { error } = await trackerDb.rpc("company_tracker_delete", { _tracker_id: item.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Company removed from the tracker.");
    setMonitorDetails(null);
    await load();
  };
  const addComment = async () => {
    if (!commentFor || !comment.trim()) return toast.error("Enter a comment.");
    setBusy(true);
    const { error } = await trackerDb.rpc("company_tracker_add_comment", {
      _tracker_id: commentFor.id,
      _body: comment,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Comment added.");
    setComment("");
    setCommentFor(null);
    void load();
  };
  const move = async (item: Tracker) => {
    const existingComment = item.comments.find((entry) => entry.stage === item.stage)?.body;
    const text =
      existingComment ??
      window.prompt(`Comment required to move ${item.company_name} to the next stage:`);
    if (!text?.trim()) return;
    setBusy(true);
    const { error } = await trackerDb.rpc("company_tracker_transition", {
      _tracker_id: item.id,
      _comment: text,
      _manual: true,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Stage updated.");
    setMonitorDetails(null);
    await load();
  };
  const movePrevious = async (item: Tracker) => {
    const text = window.prompt(
      `Comment required to move ${item.company_name} to the previous stage:`,
    );
    if (!text?.trim()) return;
    setBusy(true);
    const { error } = await trackerDb.rpc("company_tracker_move_previous", {
      _tracker_id: item.id,
      _comment: text,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Company moved to the previous stage.");
    setMonitorDetails(null);
    await load();
  };
  const saveMonitoring = async (outcome?: "work" | "leave") => {
    if (!monitorFor) return;
    setBusy(true);
    const { error, data } = await trackerDb.rpc("company_tracker_complete_monitoring_day", {
      _tracker_id: monitorFor.id,
      _day_number: day,
      _outcome: outcome ?? (checks.outcome === "leave" ? "leave" : "work"),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(
      data === "Insights Shared"
        ? "Monitoring complete — moved to Insights Shared."
        : `Day ${day} saved as ${data}.`,
    );
    setMonitorFor(null);
    setMonitorDetails(null);
    await load();
  };
  const openMonitoring = (item: Tracker, num: number) => {
    const existing = item.monitoring_days.find((x) => x.day_number === num);
    setMonitorFor(item);
    setDay(num);
    setChecks(existing?.checklist ?? {});
  };
  const saveIssueResolution = async () => {
    if (!issueFor) return;
    setBusy(true);
    const { error, data } = await trackerDb.rpc("company_tracker_complete_issue_resolution", {
      _tracker_id: issueFor.id,
      _checklist: issueChecks,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    const completedChecks = checklistFields.filter((field) => issueChecks[field]).length;
    if (data === "Monitoring") {
      toast.success("All six checks are complete — moved to Monitoring.");
    } else {
      toast.error(
        `${completedChecks} of 6 checks selected. Complete all six checks to start Monitoring.`,
      );
    }
    setIssueFor(null);
    setMonitorDetails(null);
    await load();
  };
  const openIssueResolution = (item: Tracker) => {
    setIssueFor(item);
    setIssueChecks(item.issue_checklist ?? {});
  };
  if (!ready || loading)
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-5 rounded-2xl border border-border bg-surface px-5 py-5 shadow-sm md:flex-row md:items-end md:px-6">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-lime">
            Sales & operations
          </p>
          <h1 className="mt-1 font-syne text-3xl font-bold tracking-tight text-text-primary md:text-[32px]">
            Priority Company Tracker
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
            Track company engagement from pending works through conversion.
          </p>
        </div>
        {isManager && (
          <Button onClick={() => setAssignOpen(true)} className="shrink-0 px-5 shadow-sm">
            <Plus size={16} /> Assign Company
          </Button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={Building2} label="Total Companies" value={total} />
        <Kpi icon={ClipboardCheck} label="In Progress" value={progress} />
        <Kpi icon={CheckCircle2} label="Converted" value={converted} />
        <Kpi icon={Users} label="Pending Action" value={pending} />
        <Kpi
          icon={ChevronRight}
          label="Conversion Rate"
          value={total ? `${((converted / total) * 100).toFixed(1)}%` : "0%"}
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex w-full max-w-xl items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm transition-colors focus-within:border-lime/60 focus-within:ring-4 focus-within:ring-lime/10">
          <Search size={16} className="text-text-secondary" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search companies..."
            className="border-0 p-0 text-sm focus:ring-0"
          />
        </div>
        {isManager && (
          <Select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="w-full sm:w-56"
          >
            <option value="">All field associates</option>
            {options.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl pb-3 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
        <div className="grid min-w-max grid-flow-col auto-cols-[280px] grid-rows-1 gap-4">
          {stages.map((stage, index) => (
            <section
              key={stage}
              className={`flex h-[calc(100vh-330px)] min-h-[500px] flex-col rounded-2xl border border-border border-t-4 ${stageStyles[stage].accent} bg-surface-raised/30 p-4 shadow-sm`}
            >
              <div className="mb-4 border-b border-border pb-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold tracking-tight text-text-primary">
                    <span className="mr-1.5 font-mono text-[10px] text-text-secondary">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {stage}
                  </h2>
                  <Badge tone={stageStyles[stage].count}>
                    {filtered.filter((x) => x.stage === stage).length}
                  </Badge>
                </div>
                {stage === "Monitoring" && (
                  <p className="mt-1.5 text-[10px] text-text-secondary">Daily checklist progress</p>
                )}
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
                {filtered
                  .filter((x) => x.stage === stage)
                  .map((item) => (
                    <MonitoringSummaryCard
                      key={item.id}
                      item={item}
                      onOpen={() => setMonitorDetails(item)}
                    />
                  ))}
                {!filtered.some((x) => x.stage === stage) && (
                  <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-xs text-text-dim">
                    No companies in this stage
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
      {!items.length && (
        <EmptyState
          icon={Building2}
          text={
            isManager
              ? "Assign a company to start tracking."
              : "No companies are assigned to you yet."
          }
        />
      )}
      {assignOpen && (
        <Modal title="Assign Company" onClose={() => setAssignOpen(false)}>
          <Label>Company</Label>
          <div className="mb-2 flex items-center gap-2 border border-border bg-surface px-3 py-2 rounded-[6px]">
            <Search size={14} className="text-text-secondary" />
            <Input
              value={assignmentSearch}
              onChange={(e) => setAssignmentSearch(e.target.value)}
              placeholder="Search available companies..."
              className="border-0 p-0 focus:ring-0"
            />
          </div>
          <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">
              {assignableSites.length ? "Select company" : "No available companies found"}
            </option>
            {assignableSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Label className="mt-4">Assignee</Label>
          <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Select assignee</option>
            {options.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Label className="mt-4">Stage</Label>
          <Select value={assignmentStage} onChange={(e) => setAssignmentStage(e.target.value as Stage)}>
            {stages.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </Select>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={assign}>
              Save Assignment
            </Button>
          </div>
        </Modal>
      )}
      {commentFor && (
        <Modal title={`Comment · ${commentFor.company_name}`} onClose={() => setCommentFor(null)}>
          <Label>Comment</Label>
          <Textarea
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add an update…"
          />
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCommentFor(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={addComment}>
              Add Comment
            </Button>
          </div>
        </Modal>
      )}
      {commentsView && (
        <Modal
          title={`Comments · ${commentsView.company_name}`}
          onClose={() => setCommentsView(null)}
        >
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {commentsView.comments.length ? (
              commentsView.comments.map((entry) => (
                <div key={entry.id} className="border-b border-border pb-3 text-sm last:border-0">
                  <p className="font-semibold text-text-primary">
                    {entry.author || "User"}{" "}
                    <span className="font-normal text-text-secondary">· {entry.stage}</span>
                  </p>
                  <p className="mt-1 text-text-secondary">{entry.body}</p>
                  <p className="mt-1 text-[10px] text-text-dim">
                    {new Date(entry.created_at).toLocaleString()}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-text-secondary">No comments yet.</p>
            )}
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="ghost" onClick={() => setCommentsView(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}
      {monitorDetails && (
        <Modal
          title={`Monitoring · ${monitorDetails.company_name}`}
          onClose={() => setMonitorDetails(null)}
        >
          <TrackerCard
            item={monitorDetails}
            onComment={() => {
              setMonitorDetails(null);
              setCommentFor(monitorDetails);
            }}
            onViewComments={() => {
              setMonitorDetails(null);
              setCommentsView(monitorDetails);
            }}
            onMove={() => move(monitorDetails)}
            onMovePrevious={() => movePrevious(monitorDetails)}
            onMonitor={(n) => openMonitoring(monitorDetails, n)}
            onIssueResolution={() => openIssueResolution(monitorDetails)}
            onDelete={() => deleteTracker(monitorDetails)}
            canDelete={isManager}
            canMovePrevious={isManager}
          />
        </Modal>
      )}
      {issueFor && (
        <Modal
          title={`Pending Works · ${issueFor.company_name}`}
          onClose={() => setIssueFor(null)}
        >
          <p className="mb-4 text-sm text-text-secondary">
            Complete all six checks to automatically start Monitoring.
          </p>
          <div className="space-y-3">
            {checklistFields.map((field, index) => (
              <div key={field} className="rounded-lg border border-border bg-surface px-3 py-2.5">
                <Checkbox
                  label={
                    <span>
                      <span className="mr-2 font-mono text-[10px] text-lime">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {field}
                    </span>
                  }
                  checked={!!issueChecks[field]}
                  onCheckedChange={(value) =>
                    setIssueChecks((current) => ({ ...current, [field]: value }))
                  }
                />
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setIssueFor(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={saveIssueResolution}>
              Save checklist
            </Button>
          </div>
        </Modal>
      )}
      {monitorFor && (
        <Modal
          title={`${monitorFor.company_name} · Day ${day}`}
          onClose={() => setMonitorFor(null)}
        >
          <p className="mb-4 text-sm text-text-secondary">
            Record one outcome for today. You can complete only one monitoring day per calendar day.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="danger" disabled={busy} onClick={() => void saveMonitoring("leave")}>
              Leave
            </Button>
            <Button disabled={busy} onClick={() => void saveMonitoring("work")}>
              Work perfect
            </Button>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" onClick={() => setMonitorFor(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Kpi({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="group flex items-center gap-4 border border-border bg-surface p-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-border-bright hover:shadow-md">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-lime/15 bg-lime/10 text-lime">
        <Icon size={20} />
      </div>
      <div>
        <p className="text-xs font-medium text-text-secondary">{label}</p>
        <p className="mt-1 text-[28px] font-bold leading-none tracking-tight text-text-primary">
          {value}
        </p>
      </div>
    </Card>
  );
}
function MonitoringSummaryCard({ item, onOpen }: { item: Tracker; onOpen: () => void }) {
  const failed = item.monitoring_days.some((day) => day.result === "red");
  const totalDays = failed ? 11 : 6;
  const issueChecksComplete = checklistFields.filter(
    (field) => item.issue_checklist?.[field],
  ).length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-border bg-surface p-3.5 text-left shadow-sm transition-all hover:border-violet/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-violet/30"
    >
      <h3 className="break-words text-sm font-bold leading-5 text-text-primary">
        {item.company_name}
      </h3>
      <p className="mt-1 break-words text-[11px] text-text-secondary">
        {item.city || "No city"} · {item.assignee_name || "Unassigned"}
      </p>
      <p className="mt-3 border-t border-border pt-2.5 text-[10px] font-medium text-text-secondary">
        Last change{" "}
        <span className="text-text-primary">
          {new Date(item.stage_changed_at).toLocaleDateString()}
        </span>
      </p>
      {item.stage === "Pending Works" && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-text-secondary">Resolution checklist</span>
          <span className="font-mono text-[10px] text-text-primary">
            {issueChecksComplete} / 6 selected
          </span>
        </div>
      )}
      {item.stage === "Monitoring" && (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium text-text-secondary">Monitoring</span>
            <span className="font-mono text-[10px] text-text-primary">
              {item.monitoring_days.length} / {totalDays}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Array.from({ length: totalDays }, (_, index) => {
              const day = item.monitoring_days.find((entry) => entry.day_number === index + 1);
              return (
                <span
                  key={index}
                  title={`Day ${index + 1}${day?.result ? `: ${day.result}` : ": pending"}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold ${day?.result === "green" ? "bg-mint text-bg" : day?.result === "red" ? "bg-coral text-white" : "border border-border bg-surface-raised text-text-dim"}`}
                >
                  {index + 1}
                </span>
              );
            })}
          </div>
        </>
      )}
    </button>
  );
}
function TrackerCard({
  item,
  onComment,
  onViewComments,
  onMove,
  onMovePrevious,
  onMonitor,
  onIssueResolution,
  onDelete,
  canDelete,
  canMovePrevious,
}: {
  item: Tracker;
  onComment: () => void;
  onViewComments: () => void;
  onMove: () => void;
  onMovePrevious: () => void;
  onMonitor: (n: number) => void;
  onIssueResolution: () => void;
  onDelete: () => void;
  canDelete: boolean;
  canMovePrevious: boolean;
}) {
  const failed = item.monitoring_days.some((d) => d.result === "red"),
    totalDays = failed ? 11 : 6;
  const issueComplete = checklistFields.every((field) => item.issue_checklist?.[field]);
  // Monitoring days advance at the next local calendar date, rather than after
  // a full 24 hours from the time this stage was entered.
  const monitoringStartDate = new Date(item.stage_changed_at);
  monitoringStartDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monitoringDayToday = Math.max(
    1,
    Math.floor((today.getTime() - monitoringStartDate.getTime()) / 86400000) + 1,
  );
  const [showComments] = useState(false);
  return (
    <Card className="group space-y-4 border border-border bg-surface p-4 shadow-sm transition-all duration-150 hover:border-border-bright hover:shadow-md">
      <div>
        <h3 className="break-words text-sm font-bold leading-5 text-text-primary">
          {item.company_name}
        </h3>
        <p className="mt-1.5 break-words text-[11px] leading-4 text-text-secondary">
          {item.city || "No city"} · {item.assignee_name || "Unassigned"}
        </p>
      </div>
      <p className="border-y border-border py-2 text-[10px] font-medium text-text-secondary">
        Stage since{" "}
        <span className="text-text-primary">
          {new Date(item.stage_changed_at).toLocaleDateString()}
        </span>
      </p>
      {item.stage === "Pending Works" && (
        <div className="rounded-xl border border-border bg-surface-raised/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-medium text-text-secondary">Resolution checklist</p>
              <p className="mt-1 text-[11px] text-text-primary">
                {checklistFields.filter((field) => item.issue_checklist?.[field]).length} / 6 items
                complete
              </p>
            </div>
            <Badge tone={issueComplete ? "success" : "warning"}>
              {issueComplete ? "Ready" : "Required"}
            </Badge>
          </div>
          <button
            onClick={onIssueResolution}
            className="mt-3 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[10px] font-bold text-lime transition-colors hover:border-lime/50 hover:bg-lime/10"
          >
            Complete checklist
          </button>
        </div>
      )}
      {item.stage === "Monitoring" && (
        <div className="rounded-xl border border-border bg-surface-raised/40 p-3">
          <div className="mb-2.5 flex items-center justify-between text-[10px] font-medium text-text-secondary">
            <span>Monitoring progress</span>
            <span className="font-mono text-text-primary">
              {item.monitoring_days.length} / {totalDays} days
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: totalDays }, (_, i) => {
              const d = item.monitoring_days.find((x) => x.day_number === i + 1);
              return (
                <button
                  key={i}
                  onClick={() => onMonitor(i + 1)}
                  disabled={i + 1 !== monitoringDayToday}
                  title={
                    i + 1 === monitoringDayToday
                      ? `Complete monitoring day ${i + 1}`
                      : `Monitoring day ${i + 1} is available on its calendar day`
                  }
                  className={`h-6 w-6 rounded-full text-[9px] font-bold shadow-sm transition-transform focus:outline-none focus:ring-2 focus:ring-lime/50 disabled:cursor-not-allowed disabled:opacity-60 ${d?.result === "green" ? "bg-mint text-bg" : d?.result === "red" ? "bg-coral text-white" : i + 1 === monitoringDayToday ? "border border-border bg-surface text-text-secondary hover:scale-110 hover:border-lime/60 hover:bg-lime/10" : "border border-border bg-surface-raised text-text-dim"}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
        <button
          onClick={onViewComments}
          className="inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left text-[10px] text-text-secondary transition-colors hover:bg-lime/10 hover:text-lime focus:outline-none focus:ring-2 focus:ring-lime/30"
        >
          <MessageSquare size={13} className="shrink-0" /> {item.comments.length} comments
        </button>
        {item.stage !== "Pending Works" && item.stage !== "Monitoring" && (
          <button
            onClick={onComment}
            className="rounded-md px-1.5 py-1 text-left text-[10px] font-bold text-text-secondary transition-colors hover:bg-lime/10 hover:text-lime focus:outline-none focus:ring-2 focus:ring-lime/30"
          >
            Add comment
          </button>
        )}
        {!(["Pending Works", "Monitoring", "Converted"] as string[]).includes(item.stage) && (
          <button
            onClick={onMove}
            className="rounded-md px-1.5 py-1 text-left text-[10px] font-bold text-lime transition-colors hover:bg-lime/10 focus:outline-none focus:ring-2 focus:ring-lime/30"
          >
            Next stage
          </button>
        )}
        {canMovePrevious && item.stage !== "Pending Works" && (
          <button
            onClick={onMovePrevious}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-left text-[10px] font-bold text-text-secondary transition-colors hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-lime/30"
          >
            <RotateCcw size={12} /> Previous stage
          </button>
        )}
        {canDelete && (
          <button
            onClick={onDelete}
            title="Delete company from tracker"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-left text-[10px] font-bold text-coral transition-colors hover:bg-coral/10 hover:text-coral/70 focus:outline-none focus:ring-2 focus:ring-coral/30"
          >
            <Trash2 size={13} /> Delete
          </button>
        )}
      </div>
      {showComments && (
        <div className="space-y-2 border-t border-border pt-2">
          {item.comments.length ? (
            item.comments.map((entry) => (
              <div key={entry.id} className="text-[10px] text-text-secondary">
                <p>
                  <span className="font-bold text-text-primary">{entry.author || "User"}</span> ·{" "}
                  {entry.stage}
                </p>
                <p className="mt-0.5">{entry.body}</p>
                <p className="mt-0.5 text-text-dim">
                  {new Date(entry.created_at).toLocaleString()}
                </p>
              </div>
            ))
          ) : (
            <p className="text-[10px] text-text-secondary">No comments yet.</p>
          )}
        </div>
      )}
    </Card>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4">
      <Card className="w-full max-w-md p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-syne text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            ×
          </button>
        </div>
        {children}
      </Card>
    </div>
  );
}
