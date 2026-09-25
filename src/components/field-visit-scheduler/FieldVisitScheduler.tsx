import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Plus, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-store";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui-kit";
import { toast } from "sonner";

type SiteStatus = "Not Started" | "Assessed" | "Installed" | "Commissioned";
type Visit = {
  id: string;
  company_name: string;
  city: string | null;
  assignee_id: string;
  assignee_name: string | null;
  visit_type: string;
  scheduled_for: string;
  priority: "normal" | "high" | "emergency";
  status: "scheduled" | "completed" | "delayed";
  note: string | null;
  delay_reason: string | null;
  manager_due_date: string | null;
  manager_note: string | null;
};
type SiteOption = {
  site_id: string;
  company_name: string;
  assignee_id: string | null;
  status: SiteStatus;
};
type UserOption = { id: string; name: string };
type Rpc = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const text = (value: string) => value[0].toUpperCase() + value.slice(1);
const today = () => new Date().toISOString().slice(0, 10);
const suggestedType = (status: SiteStatus) =>
  status === "Assessed"
    ? "installation"
    : status === "Installed" || status === "Commissioned"
      ? "commissioning"
      : "assessment";

export function FieldVisitScheduler() {
  const { ready, userId, role } = useAuth();
  const db = supabase as unknown as Rpc;
  const manager = role === "supervisor";
  const [visits, setVisits] = useState<Visit[]>([]),
    [sites, setSites] = useState<SiteOption[]>([]),
    [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [priorityFor, setPriorityFor] = useState<Visit | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState(""),
    [companyStatusFilter, setCompanyStatusFilter] = useState<"all" | SiteStatus>("all");
  const [visitStatusFilter, setVisitStatusFilter] = useState<"all" | Visit["status"]>("all"),
    [targetFilter, setTargetFilter] = useState<"all" | Visit["priority"]>("all"),
    [dateFilter, setDateFilter] = useState("");
  const [form, setForm] = useState({
    site: "",
    assignee: "",
    type: "assessment",
    date: today(),
    priority: "normal",
    dueDate: "",
    note: "",
  });
  const [priorityForm, setPriorityForm] = useState({ level: "normal", dueDate: "", note: "" });
  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [board, options] = await Promise.all([
      db.rpc("field_visit_schedule_board"),
      db.rpc("field_visit_schedule_options"),
    ]);
    if (board.error) toast.error(board.error.message);
    else setVisits((board.data ?? []) as Visit[]);
    if (!options.error) {
      const data = (options.data ?? { sites: [], users: [] }) as {
        sites: SiteOption[];
        users: UserOption[];
      };
      setSites(data.sites);
      setUsers(data.users);
    }
    setLoading(false);
  }, [db, userId]);
  useEffect(() => {
    if (ready && userId) void load();
  }, [ready, userId, load]);
  const overdue = (visit: Visit) =>
    visit.status !== "completed" && (visit.manager_due_date ?? visit.scheduled_for) < today();
  const visibleVisits = useMemo(
    () =>
      visits.filter(
        (visit) =>
          (!assigneeFilter || visit.assignee_id === assigneeFilter) &&
          (visitStatusFilter === "all" || visit.status === visitStatusFilter) &&
          (targetFilter === "all" || visit.priority === targetFilter) &&
          (!dateFilter ||
            visit.scheduled_for === dateFilter ||
            visit.manager_due_date === dateFilter),
      ),
    [visits, assigneeFilter, visitStatusFilter, targetFilter, dateFilter],
  );
  const companyOptions = useMemo(
    () =>
      sites.filter(
        (site) =>
          !manager ||
          (site.assignee_id === form.assignee &&
            (companyStatusFilter === "all" || site.status === companyStatusFilter)),
      ),
    [sites, manager, form.assignee, companyStatusFilter],
  );
  const selectedCompany = sites.find((site) => site.site_id === form.site);
  const chooseAssociate = (assignee: string) => {
    setForm({ ...form, assignee, site: "", type: "assessment" });
    setCompanyStatusFilter("all");
  };
  const chooseCompany = (siteId: string) => {
    const site = sites.find((item) => item.site_id === siteId);
    setForm({ ...form, site: siteId, type: site ? suggestedType(site.status) : "assessment" });
  };
  const create = async () => {
    if (!form.site || (manager && !form.assignee))
      return toast.error(manager ? "Select Field Associate and company." : "Select a company.");
    setBusy(true);
    const { error } = await db.rpc("field_visit_schedule_create", {
      _site_id: form.site,
      _visit_type: form.type,
      _scheduled_for: form.date,
      _note: form.note,
      _assignee_id: manager ? form.assignee : null,
      _priority: manager ? form.priority : "normal",
      _manager_due_date: manager && form.dueDate ? form.dueDate : null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(manager ? "Priority visit assigned." : "Visit scheduled.");
    setOpen(false);
    setForm({
      site: "",
      assignee: "",
      type: "assessment",
      date: today(),
      priority: "normal",
      dueDate: "",
      note: "",
    });
    void load();
  };
  const updateStatus = async (visit: Visit, status: "completed" | "delayed") => {
    const reason = status === "delayed" ? window.prompt("Delay reason (required):") : null;
    if (status === "delayed" && !reason?.trim()) return;
    setBusy(true);
    const { error } = await db.rpc("field_visit_schedule_update_status", {
      _visit_id: visit.id,
      _status: status,
      _delay_reason: reason,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(status === "completed" ? "Visit completed." : "Delay recorded.");
      void load();
    }
  };
  const savePriority = async () => {
    if (!priorityFor) return;
    setBusy(true);
    const { error } = await db.rpc("field_visit_schedule_set_priority", {
      _visit_id: priorityFor.id,
      _priority: priorityForm.level,
      _manager_due_date: priorityForm.dueDate || null,
      _manager_note: priorityForm.note || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Priority updated.");
    setPriorityFor(null);
    void load();
  };
  const removePriority = async (visit: Visit) => {
    if (
      visit.priority === "normal" ||
      !window.confirm(
        `Remove the priority from ${visit.company_name}? The visit and all of its other details will remain.`,
      )
    )
      return;
    setBusy(true);
    const { error } = await db.rpc("field_visit_schedule_set_priority", {
      _visit_id: visit.id,
      _priority: "normal",
      _manager_due_date: null,
      _manager_note: null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Priority removed. The visit was not deleted.");
    setPriorityFor(null);
    void load();
  };
  const deletePriorityVisit = async (visit: Visit) => {
    if (
      !window.confirm(
        `Delete the priority visit for ${visit.company_name}? Only this visit will be deleted.`,
      )
    )
      return;
    setBusy(true);
    const { error } = await db.rpc("field_visit_schedule_delete", { _visit_id: visit.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Priority visit deleted.");
    setPriorityFor(null);
    void load();
  };
  if (!ready || loading)
    return <div className="py-12 text-sm text-text-secondary">Loading visit schedule…</div>;
  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 rounded-2xl border border-border bg-surface p-5 md:flex-row md:items-center">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-lime">
            Field operations
          </p>
          <h1 className="mt-1 font-syne text-3xl font-bold">
            {manager ? "Field Visit Tracker" : "My Visit Schedule"}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Separate from current company statuses and appointments.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> {manager ? "Assign priority visit" : "Schedule company"}
        </Button>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={CalendarDays} label="Total visits" value={visibleVisits.length} />
        <Metric
          icon={Clock3}
          label="Scheduled"
          value={visibleVisits.filter((v) => v.status === "scheduled").length}
        />
        <Metric
          icon={TriangleAlert}
          label="Overdue"
          value={visibleVisits.filter(overdue).length}
          tone="text-coral"
        />
        <Metric
          icon={CheckCircle2}
          label="Completed"
          value={visibleVisits.filter((v) => v.status === "completed").length}
        />
      </div>
      {manager && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-syne font-bold">Filter visits</h2>
              <p className="text-xs text-text-secondary">
                Filter the table and summary cards together.
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAssigneeFilter("");
                setVisitStatusFilter("all");
                setTargetFilter("all");
                setDateFilter("");
              }}
            >
              Clear
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label>Field Associate</Label>
              <Select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
                <option value="">All Field Associates</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={visitStatusFilter}
                onChange={(e) => setVisitStatusFilter(e.target.value as "all" | Visit["status"])}
              >
                <option value="all">All statuses</option>
                <option value="scheduled">Scheduled</option>
                <option value="completed">Completed</option>
                <option value="delayed">Delayed</option>
              </Select>
            </div>
            <div>
              <Label>Target level</Label>
              <Select
                value={targetFilter}
                onChange={(e) => setTargetFilter(e.target.value as "all" | Visit["priority"])}
              >
                <option value="all">All target levels</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="emergency">Emergency</option>
              </Select>
            </div>
            <div>
              <Label>Scheduled or due date</Label>
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
      {!visibleVisits.length ? (
        <EmptyState
          icon={CalendarDays}
          text={
            manager
              ? "No visits match this Field Associate filter."
              : "Schedule a visit for one of your assigned companies."
          }
        />
      ) : (
        <VisitTable
          visits={visibleVisits}
          manager={manager}
          userId={userId}
          busy={busy}
          overdue={overdue}
          complete={(visit) => updateStatus(visit, "completed")}
          delay={(visit) => updateStatus(visit, "delayed")}
          removePriority={removePriority}
          deletePriorityVisit={deletePriorityVisit}
          editPriority={(visit) => {
            setPriorityFor(visit);
            setPriorityForm({
              level: visit.priority,
              dueDate: visit.manager_due_date ?? "",
              note: visit.manager_note ?? "",
            });
          }}
        />
      )}
      {open && (
        <Modal title={manager ? "Assign priority visit" : "Schedule company visit"}>
          {manager && (
            <>
              <Label>Field Associate</Label>
              <Select value={form.assignee} onChange={(e) => chooseAssociate(e.target.value)}>
                <option value="">Select Field Associate first</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
              <Label className="mt-4">Company status filter</Label>
              <Select
                value={companyStatusFilter}
                disabled={!form.assignee}
                onChange={(e) => {
                  setCompanyStatusFilter(e.target.value as "all" | SiteStatus);
                  setForm({ ...form, site: "" });
                }}
              >
                <option value="all">All statuses</option>
                <option value="Not Started">Not Started</option>
                <option value="Assessed">Assessed</option>
                <option value="Installed">Installed</option>
                <option value="Commissioned">Commissioned</option>
              </Select>
            </>
          )}
          <Label className="mt-4">Company</Label>
          <Select
            value={form.site}
            disabled={manager && !form.assignee}
            onChange={(e) => chooseCompany(e.target.value)}
          >
            <option value="">{manager ? "Select company" : "Select assigned company"}</option>
            {companyOptions.map((site) => (
              <option key={site.site_id} value={site.site_id}>
                {site.company_name} — {site.status}
              </option>
            ))}
          </Select>
          {selectedCompany && (
            <p className="mt-1 text-xs text-lime">
              Current status: {selectedCompany.status}. Suggested visit:{" "}
              {text(suggestedType(selectedCompany.status))}.
            </p>
          )}
          <Label className="mt-4">Visit type</Label>
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {["assessment", "installation", "commissioning"].map((type) => (
              <option key={type} value={type}>
                {text(type)}
              </option>
            ))}
          </Select>
          <Label className="mt-4">Visit date</Label>
          <Input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
          {manager && (
            <>
              <Label className="mt-4">Priority</Label>
              <Select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="emergency">Emergency (red)</option>
              </Select>
              <Label className="mt-4">Due date (optional)</Label>
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </>
          )}
          <Label className="mt-4">Note (optional)</Label>
          <Textarea
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <Actions
            close={() => setOpen(false)}
            save={create}
            busy={busy}
            text={manager ? "Assign visit" : "Schedule visit"}
          />
        </Modal>
      )}
      {priorityFor && (
        <Modal title={`Priority · ${priorityFor.company_name}`}>
          <Label>Priority</Label>
          <Select
            value={priorityForm.level}
            onChange={(e) => setPriorityForm({ ...priorityForm, level: e.target.value })}
          >
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="emergency">Emergency (red)</option>
          </Select>
          <Label className="mt-4">Manager due date (optional)</Label>
          <Input
            type="date"
            value={priorityForm.dueDate}
            onChange={(e) => setPriorityForm({ ...priorityForm, dueDate: e.target.value })}
          />
          <Label className="mt-4">Manager note (optional)</Label>
          <Textarea
            value={priorityForm.note}
            onChange={(e) => setPriorityForm({ ...priorityForm, note: e.target.value })}
          />
          <div className="sticky bottom-0 -mx-5 mt-7 flex flex-col-reverse gap-2 border-t border-border bg-surface px-5 pt-4 sm:-mx-7 sm:flex-row sm:items-center sm:px-7">
            <Button
              variant="ghost"
              onClick={() => setPriorityFor(null)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="ghost"
              disabled={busy || priorityFor.priority === "normal"}
              onClick={() => removePriority(priorityFor)}
              className="w-full text-coral hover:text-coral sm:mr-auto sm:w-auto"
            >
              Remove priority
            </Button>
            <Button disabled={busy} onClick={savePriority} className="w-full sm:w-auto">
              Save priority
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function VisitTable({
  visits,
  manager,
  userId,
  busy,
  overdue,
  complete,
  delay,
  removePriority,
  deletePriorityVisit,
  editPriority,
}: {
  visits: Visit[];
  manager: boolean;
  userId: string | null;
  busy: boolean;
  overdue: (visit: Visit) => boolean;
  complete: (visit: Visit) => void;
  delay: (visit: Visit) => void;
  removePriority: (visit: Visit) => void;
  deletePriorityVisit: (visit: Visit) => void;
  editPriority: (visit: Visit) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="font-syne text-lg font-bold">Visit schedule</h2>
          <p className="mt-0.5 text-xs text-text-secondary">
            {visits.length} visit{visits.length === 1 ? "" : "s"} shown
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="bg-surface-raised text-[10px] font-bold uppercase tracking-widest text-text-secondary">
            <tr>
              <th className="min-w-72 px-5 py-3">Company</th>
              {manager && <th className="px-5 py-3">Field associate</th>}
              <th className="px-5 py-3">Visit</th>
              <th className="px-5 py-3">Scheduled</th>
              <th className="px-5 py-3">Due date</th>
              <th className="px-5 py-3">Priority</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Notes</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visits.map((visit) => (
              <tr
                key={visit.id}
                className={`transition-colors hover:bg-surface-raised/70 ${visit.priority === "emergency" ? "bg-coral/5" : ""}`}
              >
                <td className="min-w-72 px-5 py-4">
                  <p className="whitespace-nowrap text-xs font-semibold text-text-primary">{visit.company_name}</p>
                  {visit.city && <p className="mt-0.5 text-xs text-text-secondary">{visit.city}</p>}
                </td>
                {manager && (
                  <td className="px-5 py-4 text-text-secondary">{visit.assignee_name ?? "—"}</td>
                )}
                <td className="px-5 py-4 font-medium">{text(visit.visit_type)}</td>
                <td className="px-5 py-4 whitespace-nowrap">{visit.scheduled_for}</td>
                <td className="px-5 py-4 whitespace-nowrap">
                  {visit.manager_due_date ? (
                    <span className={overdue(visit) ? "font-semibold text-coral" : ""}>
                      {visit.manager_due_date}
                    </span>
                  ) : (
                    <span className="text-text-secondary">—</span>
                  )}
                </td>
                <td className="px-5 py-4">
                  <Badge
                    tone={
                      visit.priority === "emergency"
                        ? "danger"
                        : visit.priority === "high"
                          ? "warning"
                          : "info"
                    }
                  >
                    {text(visit.priority)}
                  </Badge>
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-1">
                    <Badge
                      tone={
                        visit.status === "completed"
                          ? "success"
                          : visit.status === "delayed"
                            ? "danger"
                            : "info"
                      }
                    >
                      {text(visit.status)}
                    </Badge>
                    {overdue(visit) && <Badge tone="danger">Overdue</Badge>}
                  </div>
                </td>
                <td className="w-48 px-5 py-4 text-[11px] leading-4 text-text-secondary">
                  <div className="space-y-0.5">
                    {visit.manager_note && (
                      <span className="block truncate" title={visit.manager_note}>
                        Manager: {visit.manager_note}
                      </span>
                    )}
                    {visit.note && (
                      <span className="block truncate" title={visit.note}>
                        Note: {visit.note}
                      </span>
                    )}
                    {visit.delay_reason && (
                      <span title={visit.delay_reason} className="block truncate text-coral">
                        Delay: {visit.delay_reason}
                      </span>
                    )}
                    {!visit.manager_note && !visit.note && !visit.delay_reason && <span>—</span>}
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="flex justify-end gap-2">
                    {visit.assignee_id === userId && visit.status === "scheduled" && (
                      <>
                        <Button size="sm" disabled={busy} onClick={() => complete(visit)}>
                          Complete
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => delay(visit)}
                        >
                          Delay
                        </Button>
                      </>
                    )}
                    {manager && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => editPriority(visit)}>
                          Priority
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          className="whitespace-nowrap text-coral hover:text-coral"
                          onClick={() => deletePriorityVisit(visit)}
                        >
                          Delete priority
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  tone = "",
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Icon size={18} className={tone || "text-lime"} />
        <div>
          <p className="text-xs text-text-secondary">{label}</p>
          <p className={`text-xl font-bold ${tone}`}>{value}</p>
        </div>
      </div>
    </Card>
  );
}
function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  const isPriorityAssignment = title === "Assign priority visit";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/80 p-0 backdrop-blur-sm sm:items-center sm:p-5">
      <Card className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-b-none border-border bg-surface p-0 shadow-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 border-b border-border bg-surface px-5 py-4 sm:px-7">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-lime">
            {isPriorityAssignment ? "Manager action" : "Visit planning"}
          </p>
          <h2 className="mt-1 font-syne text-xl font-bold">{title}</h2>
          {isPriorityAssignment && (
            <>
              <p className="mt-1 text-sm text-text-secondary">
                Choose an associate, then select only their company and its current work stage.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px] font-bold uppercase tracking-wide">
                <span className="rounded bg-lime/15 py-1.5 text-lime">1 Associate</span>
                <span className="rounded bg-surface-raised py-1.5 text-text-secondary">
                  2 Company
                </span>
                <span className="rounded bg-surface-raised py-1.5 text-text-secondary">
                  3 Priority
                </span>
              </div>
            </>
          )}
        </div>
        <div className="space-y-3 px-5 py-5 sm:px-7 [&_label]:font-mono [&_label]:text-[10px] [&_label]:font-bold [&_label]:uppercase [&_label]:tracking-wider [&_label]:text-text-secondary [&_select]:min-h-11 [&_textarea]:min-h-20">
          {children}
        </div>
      </Card>
    </div>
  );
}
function Actions({
  close,
  save,
  busy,
  text: buttonText,
}: {
  close: () => void;
  save: () => void;
  busy: boolean;
  text: string;
}) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-7 flex flex-col-reverse gap-2 border-t border-border bg-surface px-5 pt-4 sm:-mx-7 sm:flex-row sm:justify-end sm:px-7">
      <Button variant="ghost" onClick={close} className="w-full sm:w-auto">
        Cancel
      </Button>
      <Button disabled={busy} onClick={save} className="w-full sm:w-auto">
        {buttonText}
      </Button>
    </div>
  );
}
function ManagerVisitTable({
  visits,
  users,
  assigneeFilter,
  setAssigneeFilter,
}: {
  visits: Visit[];
  users: UserOption[];
  assigneeFilter: string;
  setAssigneeFilter: (value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-2xl border border-border bg-surface p-6">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-lime">
            Field operations
          </p>
          <h1 className="mt-1 font-syne text-3xl font-bold">Field Visit Tracker</h1>
        </div>
      </div>
      <div className="max-w-sm">
        <Label>Field Associate</Label>
        <Select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
          <option value="">All Field Associates</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[850px] text-left text-sm">
          <thead className="bg-surface-raised text-[10px] uppercase tracking-wider text-text-secondary">
            <tr>
              {["Company", "Associate", "Visit", "Date", "Priority", "Status"].map((x) => (
                <th key={x} className="px-5 py-3 font-bold">
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.id} className="border-t border-border">
                <td className="px-5 py-4 font-semibold">{v.company_name}</td>
                <td className="px-5 py-4">{v.assignee_name ?? "—"}</td>
                <td className="px-5 py-4">{text(v.visit_type)}</td>
                <td className="px-5 py-4">{v.scheduled_for}</td>
                <td className="px-5 py-4">
                  <Badge
                    tone={
                      v.priority === "emergency"
                        ? "danger"
                        : v.priority === "high"
                          ? "warning"
                          : "info"
                    }
                  >
                    {text(v.priority)}
                  </Badge>
                </td>
                <td className="px-5 py-4">
                  <Badge
                    tone={
                      v.status === "completed"
                        ? "success"
                        : v.status === "delayed"
                          ? "danger"
                          : "info"
                    }
                  >
                    {text(v.status)}
                  </Badge>
                </td>
              </tr>
            ))}
            {!visits.length && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-text-secondary">
                  No scheduled visits.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
