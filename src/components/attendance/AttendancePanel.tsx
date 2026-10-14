import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarDays,
  Clock3,
  ChevronLeft,
  ChevronRight,
  Download,
  ImageIcon,
  Plus,
  RefreshCw,
  Settings2,
  Pencil,
  Trash2,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-store";
import { canAccessLeave, canManageAttendance, isTarunLeaveReviewer } from "@/lib/attendance-access";
import { Button, Card, Input, Select, Textarea } from "@/components/ui-kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeviceAttendance } from "@/hooks/use-device-attendance";
import {
  attendanceFunction,
  attendanceRpc,
  dateLabel,
  departments,
  indiaDate,
  statusLabels,
  timeLabel,
  type AttendanceRow,
  type Employee,
  type Leave,
  type Settings,
} from "@/lib/device-attendance";
import { AttendanceOverview } from "./AttendanceOverview";
import { LeaveWorkspace } from "./LeaveWorkspace";
import { AttendanceEvidenceDialogs, type AttendanceRecordView } from "./AttendanceEvidenceDialogs";
import "./attendance.css";
import {
  attendanceSummary,
  formatAttendanceDuration,
  matchesAttendanceStatus,
} from "@/lib/attendance-analytics";

const fieldClass =
  "h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-lime focus:outline-none focus:ring-2 focus:ring-lime/15";
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1.5 text-sm">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
    </label>
  );
}
function Status({ value, lateMinutes }: { value: string; lateMinutes?: number | null }) {
  const tone = ["present", "enrolled", "approved"].includes(value)
    ? "border-mint/20 bg-mint/10 text-mint"
    : value === "late"
      ? "border-warning/20 bg-warning/10 text-warning"
      : value === "on_leave"
        ? "border-violet/20 bg-violet/10 text-violet"
        : value === "work_from_home"
          ? "border-indigo-500/20 bg-indigo-500/10 text-indigo-700"
        : ["failed", "absent", "rejected"].includes(value)
          ? "border-coral/20 bg-coral/10 text-coral"
          : value === "needs_review"
            ? "border-violet/20 bg-violet/10 text-violet"
            : "border-border bg-surface-raised text-text-secondary";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {value === "late" && lateMinutes != null && lateMinutes > 0
        ? `${lateMinutes} min late`
        : statusLabels[value] || value}
    </span>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="p-12 text-center text-sm text-text-secondary">{children}</div>;
}
type EnrollResponse = {
  status: string;
  publishing: { configured: boolean; sent: number };
  command_status?: string | null;
  confirmation_deadline?: string | null;
};
function enrollmentNotice(result: EnrollResponse) {
  if (result.status === "enrolled") toast.success("Employee registration confirmed by the device.");
  else if (result.status === "failed")
    toast.error(
      "Enrollment failed. Check the employee's registration on the device before retrying.",
    );
  else if (result.command_status === "published")
    toast(
      "The enrollment command was already published. Complete face registration at the device. A new command can be requested after the current attempt times out.",
    );
  else if (result.command_status === "publishing")
    toast("The enrollment command is being sent. Wait for the status to update before retrying.");
  else if (!result.publishing.configured)
    toast("Enrollment is pending. Device integration is unavailable; contact your administrator.");
  else if (result.publishing.sent) toast.success("Enrollment sent. Awaiting device confirmation.");
  else
    toast(
      "Enrollment is pending. This request did not confirm a command was sent; check the employee's registration on the device.",
    );
}

export function AttendancePanel() {
  const navigate = useNavigate();
  const { email } = useAuth();
  const tarunReviewer = isTarunLeaveReviewer(email);
  const leaveAllowed = canAccessLeave(email);
  const [date, setDate] = useState(() => {
    const requested =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("date");
    return requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= indiaDate()
      ? requested
      : indiaDate();
  });
  const { board, error, loading, reload } = useDeviceAttendance(date);
  const [tab, setTab] = useState<"daily" | "users" | "leave">("daily");
  const [showOtherLeaveRecords, setShowOtherLeaveRecords] = useState(false);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("name");
  const [employeeState, setEmployeeState] = useState("all");
  const [enrollment, setEnrollment] = useState("all");
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [review, setReview] = useState<{ leave: Leave; decision: string } | null>(null);
  const [activeChange, setActiveChange] = useState<Employee | null>(null);
  const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null);
  const [history, setHistory] = useState<AttendanceRecordView>(null);
  const [photo, setPhoto] = useState<{
    url: string;
    expires_at: string;
    photo_expires_at: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"xlsx" | "pdf">("xlsx");
  const [exportScope, setExportScope] = useState("filtered");
  const [exporting, setExporting] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!leaveAllowed) {
      if (tab === "leave") setTab("daily");
      setLeaveOpen(false);
      setReview(null);
    }
  }, [leaveAllowed, tab]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (photo && Date.parse(photo.expires_at) <= now) setPhoto(null);
  }, [now, photo]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await reload();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }
  async function viewPhoto(eventId: string) {
    await act(async () => {
      setPhoto(await attendanceFunction("attendance-photo-access", { event_id: eventId }));
    });
  }
  function openEmployee(employeeId: string) {
    if (board?.employees.some((item) => item.id === employeeId))
      void navigate({
        to: "/manager/attendance/history/$employeeId",
        params: { employeeId },
        search: { date },
      });
    else toast.error("Employee details are unavailable. Refresh attendance and try again.");
  }
  const overviewRows = (board?.rows || []).filter((row) =>
    `${row.name} ${row.enroll_id}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const attendanceByEmployee = new Map((board?.rows || []).map((row) => [row.employee_id, row]));
  const rows = overviewRows
    .filter(
      (row) =>
        (department === "all" || row.department === department) &&
        matchesAttendanceStatus(row, status) &&
        `${row.name} ${row.enroll_id}`.toLowerCase().includes(search.trim().toLowerCase()),
    )
    .sort((a, b) => {
      if (sort === "late")
        return (b.late_minutes ?? -1) - (a.late_minutes ?? -1) || a.name.localeCompare(b.name);
      if (sort === "entry")
        return (
          (a.entry_at ? Date.parse(a.entry_at) : Infinity) -
            (b.entry_at ? Date.parse(b.entry_at) : Infinity) || a.name.localeCompare(b.name)
        );
      return a.name.localeCompare(b.name);
    });
  const employees = (board?.employees || []).filter(
    (e) =>
      (department === "all" || e.department === department) &&
      (employeeState === "all" || e.active === (employeeState === "active")) &&
      (enrollment === "all" || e.enrollment_status === enrollment) &&
      (status === "all" ||
        !!(
          attendanceByEmployee.get(e.id) &&
          matchesAttendanceStatus(attendanceByEmployee.get(e.id)!, status)
        )) &&
      `${e.name} ${e.enroll_id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const leaves = (board?.leaves || []).filter(
    (l) =>
      !(l.source === "manual" && (l.approver_emails?.length ?? 0) > 0) &&
      (l.status !== "rejected" ||
        !l.reviewed_at ||
        now < Date.parse(l.reviewed_at) + 24 * 60 * 60 * 1000) &&
      (status === "all" || l.status === status) &&
      `${l.employee_name || ""} ${l.sender_email || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const pending = (board?.leaves || []).filter((l) => !(l.source === "manual" && (l.approver_emails?.length ?? 0) > 0) &&
    ["pending", "needs_review"].includes(l.status),
  ).length;
  const deviceState = board?.device.state || "unknown";
  function chooseTab(value: typeof tab) {
    if (value === "leave" && !leaveAllowed) return;
    setTab(value);
    setStatus("all");
    setSearch("");
    setDepartment("all");
    setEmployeeState("all");
    setEnrollment("all");
  }
  function moveDate(offset: number) {
    const next = new Date(date + "T12:00:00+05:30");
    next.setUTCDate(next.getUTCDate() + offset);
    const value = indiaDate(next);
    if (value <= indiaDate()) setDate(value);
  }
  const exportRows = exportScope === "all" ? board?.rows || [] : rows;
  const exportSummary = attendanceSummary(exportRows);
  async function exportReport() {
    if (exporting || loading || error || !board || !exportRows.length) return;
    const userId = useAuth.getState().userId;
    setExporting(true);
    try {
      const scope =
        exportScope === "all"
          ? "All employees"
          : `Filtered employees | Department: ${department} | Status: ${status} | Search: ${search.trim() || "none"}`;
      let buffer: ArrayBuffer | Uint8Array;
      if (exportFormat === "pdf") {
        const [{ createOverallAttendancePdf }, { attendanceReportLogo }] = await Promise.all([
          import("@/lib/attendance-pdf"),
          import("@/lib/attendance-report-logo"),
        ]);
        const pdf = await createOverallAttendancePdf(
          exportRows,
          date,
          scope,
          new Date(),
          await attendanceReportLogo(),
        );
        buffer = pdf.output("arraybuffer");
      } else {
        const { createOverallAttendanceWorkbook } = await import("@/lib/attendance-excel");
        const workbook = await createOverallAttendanceWorkbook(exportRows, date, scope);
        buffer = new Uint8Array(await workbook.xlsx.writeBuffer());
      }
      const session = useAuth.getState();
      if (session.userId !== userId || !canManageAttendance(session.email))
        throw new Error("Session changed. Reopen attendance to download a report.");
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(buffer)], {
          type:
            exportFormat === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `attendance-${date}-${exportScope}.${exportFormat}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportOpen(false);
      toast.success(
        `Downloaded ${exportFormat === "pdf" ? "PDF" : "Excel"} report with ${exportRows.length} employees.`,
      );
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not download the report.");
    } finally {
      setExporting(false);
    }
  }
  const hasFilters =
    !!search ||
    department !== "all" ||
    status !== "all" ||
    (tab === "users" && (employeeState !== "all" || enrollment !== "all"));
  const visibleCount =
    tab === "daily" ? rows.length : tab === "users" ? employees.length : leaves.length;
  function photoAction(row: {
    event_id: string | null;
    photo_status: string | null;
    photo_expires_at: string | null;
  }) {
    if (row.photo_expires_at && Date.parse(row.photo_expires_at) <= now)
      return <span className="text-xs text-text-secondary">Expired at 2:00 am IST</span>;
    if (row.event_id && row.photo_status === "available")
      return (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void viewPhoto(row.event_id!)}
        >
          <ImageIcon size={15} />
          View photo
        </Button>
      );
    return (
      <span className="text-xs text-text-secondary">
        {row.event_id ? "Photo unavailable" : "—"}
      </span>
    );
  }
  return (
    <div className="attendance-page w-full space-y-3 p-3 font-sans text-text-primary sm:p-4 lg:px-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Attendance</h1>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={loading || busy}
            onClick={() => void reload()}
            aria-label="Refresh attendance"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!board || busy}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={16} />
            Office settings
          </Button>
          <Button
            size="sm"
            disabled={!board || busy}
            onClick={() => {
              setEditingEmployee(null);
              setEmployeeOpen(true);
            }}
          >
            <Plus size={17} />
            Add employee
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs sm:px-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span
            className={
              "inline-flex items-center gap-2 font-medium " +
              (deviceState === "online" ? "text-mint" : "text-warning")
            }
          >
            {deviceState === "online" ? <Wifi size={15} /> : <WifiOff size={15} />}Device{" "}
            {deviceState}
          </span>
          <span className="text-text-secondary">
            Last received scan{" "}
            <span className="ml-1 font-medium text-text-primary">
              {board?.device.last_scan_at
                ? new Date(board.device.last_scan_at).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }) + " IST"
                : "No scans yet"}
            </span>
          </span>
        </div>
        <span className="text-text-secondary">
          {board?.server_time ? `Updated ${timeLabel(board.server_time)} IST · ` : ""}Auto-refresh
          15s
        </span>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/25 bg-red-500/5 p-4 text-sm text-red-500"
        >
          {error}
          {board && <p className="mt-1">Showing the last loaded data; refresh to retry.</p>}
        </div>
      )}
      {board && !board.settings && (
        <div className="rounded-lg border border-amber-500/25 bg-warning/5 p-4 text-sm text-warning">
          Complete office timing and working days in Office settings to classify attendance.
        </div>
      )}
      <nav
        aria-label="Attendance sections"
        className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1"
      >
        {(
          [
            ["daily", "Daily attendance", CalendarDays],
            ["users", "Employees", Users],
            ["leave", "Leave requests", Clock3],
          ] as const
        ).filter(([key]) => key !== "leave" || leaveAllowed).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => chooseTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={
              "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-lime " +
              (tab === key
                ? "bg-lime/10 text-lime"
                : "text-text-secondary hover:bg-surface-raised hover:text-text-primary")
            }
          >
            <Icon size={16} />
            {label}
            {key === "leave" && pending > 0 && (
              <span className="rounded-full bg-lime/15 px-2 py-0.5 text-xs text-lime tabular-nums">
                {pending}
              </span>
            )}
          </button>
        ))}
      </nav>
      {tab === "leave" && leaveAllowed && <section>
        <LeaveWorkspace embedded />
        <Button variant="ghost" size="sm" className="mt-3" aria-expanded={showOtherLeaveRecords} aria-controls="other-attendance-leave-records" onClick={() => setShowOtherLeaveRecords((visible) => !visible)}>{showOtherLeaveRecords ? "Hide" : "Show"} other attendance leave records <ChevronRight size={14} className={showOtherLeaveRecords ? "rotate-90" : ""} /></Button>
      </section>}
      {tab === "daily" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight sm:text-lg">
                {date === indiaDate() ? "Today’s attendance" : dateLabel(date)}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Previous day"
                  onClick={() => moveDate(-1)}
                >
                  <ChevronLeft size={17} />
                </Button>
                <input
                  aria-label="Attendance date"
                  type="date"
                  value={date}
                  max={indiaDate()}
                  onChange={(e) => {
                    if (e.target.value && e.target.value <= indiaDate()) setDate(e.target.value);
                  }}
                  className="min-w-0 rounded bg-transparent px-1 py-1 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-lime"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Next day"
                  disabled={date >= indiaDate()}
                  onClick={() => moveDate(1)}
                >
                  <ChevronRight size={17} />
                </Button>
              </div>
              {date !== indiaDate() && (
                <Button variant="secondary" size="sm" onClick={() => setDate(indiaDate())}>
                  Today
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={!board || loading || !!error || !board.rows.length}
                onClick={() => {
                  setExportScope("filtered");
                  setExportOpen(true);
                }}
              >
                <Download size={16} />
                Download report
              </Button>
            </div>
          </div>
          {board && !loading ? (
            <AttendanceOverview
              rows={overviewRows}
              status={status}
              onStatus={setStatus}
              department={department}
              onDepartment={setDepartment}
            />
          ) : loading ? (
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"
              aria-label="Loading overview"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <div
                  key={n}
                  className="h-28 animate-pulse rounded-xl border border-border bg-surface"
                />
              ))}
            </div>
          ) : null}
        </>
      )}
      {board && tab === "users" && (
        <div className="grid grid-cols-3 gap-3">
          {[
                {
                  label: "Active employees",
                  count: board.employees.filter((e) => e.active).length,
                  tone: "text-text-primary",
                },
                {
                  label: "Registered on device",
                  count: board.employees.filter(
                    (e) => e.active && e.enrollment_status === "enrolled",
                  ).length,
                  tone: "text-mint",
                },
                {
                  label: "Needs registration",
                  count: board.employees.filter(
                    (e) => e.active && e.enrollment_status !== "enrolled",
                  ).length,
                  tone: "text-warning",
                },
              ].map((metric) => (
            <Card
              key={metric.label}
              className="flex flex-col justify-between gap-2 rounded-xl p-3 sm:flex-row sm:items-center sm:px-4"
            >
              <p className="text-xs leading-relaxed text-text-secondary">{metric.label}</p>
              <p className={`text-2xl font-semibold tabular-nums ${metric.tone}`}>{metric.count}</p>
            </Card>
          ))}
        </div>
      )}
      {(tab !== "leave" || showOtherLeaveRecords) && <Card id={tab === "leave" ? "other-attendance-leave-records" : undefined} className="overflow-hidden rounded-xl p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">
              {tab === "daily"
                ? "Employee attendance"
                : tab === "users"
                  ? "Employee directory"
                  : "Other attendance leave records"}
            </h2>
            <p className="mt-1 text-xs text-text-secondary">
              {loading
                ? "Loading records…"
                : `${visibleCount} ${tab === "leave" ? "requests" : "employees"} shown`}
              {tab === "daily" && " · Search and status filters apply to this list"}
              {tab === "users" && ` · Attendance status for ${dateLabel(date)}`}
            </p>
          </div>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setDepartment("all");
                setStatus("all");
                setEmployeeState("all");
                setEnrollment("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        <div
          className={`attendance-filters grid gap-3 border-b border-border bg-surface/50 p-3 sm:grid-cols-2 ${tab === "users" ? "xl:grid-cols-[minmax(220px,1.5fr)_repeat(4,minmax(0,1fr))]" : "lg:grid-cols-4"}`}
        >
          <div className="min-w-0">
            <Field label={tab === "leave" ? "Search requests" : "Search employee"}>
              <Input
                className={fieldClass}
                placeholder={
                  tab === "leave" ? "Employee name or email" : "Search name or enrollment ID"
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
          </div>
          {tab !== "leave" && (
            <Field label="Department">
              <Select
                className={fieldClass}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="all">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d[0].toUpperCase() + d.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {
            <Field label={tab === "users" ? "Attendance status" : "Status"}>
              <Select
                className={fieldClass}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                {tab !== "leave" && (
                  <>
                    <option value="recorded">All recorded entries</option>
                    <option value="on_time">All on-time arrivals</option>
                    <option value="late_arrivals">All late arrivals</option>
                  </>
                )}
                {(tab !== "leave"
                  ? ["present", "late", "on_leave", "work_from_home", "absent", "off_day"]
                  : ["pending", "needs_review", "approved", "rejected", "cancelled"]
                ).map((s) => (
                  <option key={s} value={s}>
                    {statusLabels[s]}
                  </option>
                ))}
              </Select>
            </Field>
          }
          {tab === "daily" && (
            <Field label="Sort by">
              <Select className={fieldClass} value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="name">Employee name</option>
                <option value="entry">Earliest entry</option>
                <option value="late">Longest delay</option>
              </Select>
            </Field>
          )}
          {tab === "users" && (
            <>
              <Field label="Employee state">
                <Select
                  className={fieldClass}
                  value={employeeState}
                  onChange={(e) => setEmployeeState(e.target.value)}
                >
                  <option value="all">All employees</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </Field>
              <Field label="Device registration">
                <Select
                  className={fieldClass}
                  value={enrollment}
                  onChange={(e) => setEnrollment(e.target.value)}
                >
                  <option value="all">All registrations</option>
                  <option value="enrolled">Enrolled</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                </Select>
              </Field>
            </>
          )}
          {tab === "leave" && !tarunReviewer && (
            <Button
              disabled={!board || busy}
              variant="secondary"
              size="sm"
              onClick={() => setLeaveOpen(true)}
            >
              <Plus size={15} />
              Record leave
            </Button>
          )}
        </div>
        {loading ? (
          <Empty>Loading attendance…</Empty>
        ) : !board ? (
          <Empty>Attendance will be available after the database setup is complete.</Empty>
        ) : tab === "daily" ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-raised/50 text-xs text-text-secondary">
                  <tr>
                    {[
                      "Employee",
                      "ID",
                      "Department",
                      "First check-in (IST)",
                      "Status",
                      "Late duration",
                      "View details",
                    ].map((h, i) => (
                      <th
                        key={i}
                        className="px-3 py-2.5 text-xs font-semibold whitespace-nowrap sm:px-4"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.employee_id}
                      className={`border-t border-border transition-colors hover:bg-lime/5 ${(row.late_minutes || 0) > 0 ? "bg-warning/5" : ""}`}
                    >
                      <td className="px-3 py-3 sm:px-4">
                        <button
                          type="button"
                          onClick={() => openEmployee(row.employee_id)}
                          className="text-left font-semibold hover:text-lime focus-visible:outline-2 focus-visible:outline-lime"
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-xs text-text-secondary tabular-nums sm:px-4">
                        {row.enroll_id}
                      </td>
                      <td className="px-3 text-text-secondary capitalize sm:px-4">
                        {row.department}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap tabular-nums sm:px-4">
                        {timeLabel(row.entry_at)}
                      </td>
                      <td className="px-3 py-3 sm:px-4">
                        <Status value={row.status} lateMinutes={row.late_minutes} />
                        {row.leave_conflict && <p className="mt-1 text-xs">Scanned during leave</p>}
                      </td>
                      <td
                        className={`px-3 py-3 whitespace-nowrap tabular-nums sm:px-4 ${(row.late_minutes || 0) > 0 ? "text-warning" : "text-text-secondary"}`}
                      >
                        {formatAttendanceDuration(row.late_minutes)}
                      </td>
                      <td className="px-3 py-3 sm:px-4">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => openEmployee(row.employee_id)}
                        >
                          Details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-border md:hidden">
              {rows.map((row) => (
                <div
                  key={row.employee_id}
                  className={`space-y-3 p-4 ${(row.late_minutes || 0) > 0 ? "bg-warning/5" : ""}`}
                >
                  <div className="flex justify-between gap-2">
                    <div>
                      <button
                        type="button"
                        onClick={() => openEmployee(row.employee_id)}
                        className="text-left font-semibold hover:text-lime focus-visible:outline-2 focus-visible:outline-lime"
                      >
                        {row.name}
                      </button>
                      <p className="text-xs capitalize text-text-secondary">
                        {row.department} · ID {row.enroll_id}
                      </p>
                    </div>
                    <Status value={row.status} lateMinutes={row.late_minutes} />
                  </div>
                  <p className="text-sm tabular-nums">
                    {row.entry_at
                      ? `First entry · ${timeLabel(row.entry_at)} IST`
                      : "No entry recorded"}
                    {row.status !== "late" &&
                      (row.late_minutes || 0) > 0 &&
                      ` · ${formatAttendanceDuration(row.late_minutes)} late`}
                  </p>
                  {row.leave_conflict && (
                    <p className="text-xs text-warning">Scanned during approved leave</p>
                  )}
                  <div className="flex gap-2">
                    {photoAction(row)}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => openEmployee(row.employee_id)}
                    >
                      View details
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {!rows.length && (
              <Empty>No matching employees. Try another date or clear your filters.</Empty>
            )}
          </>
        ) : tab === "users" ? (
          <div>
            <div className="overflow-x-auto">
              <table className="employee-directory w-full text-left text-sm">
                <caption className="sr-only">
                  Employee directory with registration, attendance and management actions
                </caption>
                <thead className="border-b border-border bg-surface-raised/60 text-xs text-text-secondary">
                  <tr>
                    {[
                      "Employee",
                      "Enroll ID",
                      "Department",
                      "Registration",
                      "Attendance",
                      "Actions",
                    ].map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className={
                          heading === "Actions"
                            ? "px-4 py-3 text-right font-medium"
                            : "px-4 py-3 font-medium"
                        }
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {employees.map((e) => (
                    <tr key={e.id} className="hover:bg-surface-raised/40">
                      <td className="px-4 py-3">
                        <button
                          className="text-left font-semibold hover:text-lime focus-visible:outline-lime"
                          onClick={() => openEmployee(e.id)}
                        >
                          {e.name}
                        </button>
                        <p className="mt-0.5 text-xs text-text-secondary">
                          {e.email || "No email added"}
                        </p>
                        {!e.active && <span className="text-xs text-text-secondary">Inactive</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums">{e.enroll_id}</td>
                      <td className="px-4 py-3 capitalize text-text-secondary">{e.department}</td>
                      <td className="px-4 py-3">
                        <Status value={e.enrollment_status} />
                      </td>
                      <td className="px-4 py-3">
                        {attendanceByEmployee.get(e.id) ? (
                          <Status
                            value={attendanceByEmployee.get(e.id)!.status}
                            lateMinutes={attendanceByEmployee.get(e.id)!.late_minutes}
                          />
                        ) : (
                          <span className="text-xs text-text-secondary">Unavailable</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          {tarunReviewer && <Button
                            size="sm"
                            variant={e.work_from_home_enabled ? "secondary" : "ghost"}
                            disabled={busy}
                            onClick={() => void act(async () => {
                              await attendanceRpc("attendance_set_wfh_eligibility", { _employee: e.id, _enabled: !e.work_from_home_enabled });
                              toast.success(`${e.name}: work-from-home ${e.work_from_home_enabled ? "disabled" : "enabled"}.`);
                            })}
                          >{e.work_from_home_enabled ? "WFH enabled · Revoke" : "Enable WFH"}</Button>}
                          <Button size="sm" variant="ghost" onClick={() => openEmployee(e.id)}>
                            History
                          </Button>

                          {e.active && e.enrollment_status !== "enrolled" && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  const result = await attendanceFunction<EnrollResponse>(
                                    "attendance-enroll-user",
                                    { action: "retry", employee_id: e.id },
                                  );
                                  enrollmentNotice(result);
                                })
                              }
                            >
                              Retry enrollment
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setActiveChange(e)}
                          >
                            {e.active ? "Deactivate" : "Reactivate"}
                          </Button>

                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            aria-label={"Edit " + e.name}
                            onClick={() => {
                              setEditingEmployee(e);
                              setEmployeeOpen(true);
                            }}
                          >
                            <Pencil size={14} />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            aria-label={"Delete " + e.name}
                            onClick={() => setDeletingEmployee(e)}
                          >
                            <Trash2 size={14} />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!employees.length && (
              <Empty>
                {board.employees.length
                  ? "No employees match your filters. Clear filters to see the directory."
                  : "Add your first employee to begin attendance tracking."}
              </Empty>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {leaves.map((l) => (
              <div key={l.id} className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">
                      {l.employee_name || l.sender_email || "Unmatched employee"}
                    </h3>
                    <Status value={l.status} />
                  </div>
                  <p className="mt-2 text-sm">
                    {dateLabel(l.start_date)} → {dateLabel(l.end_date)}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text-secondary">
                    {l.reason}
                  </p>
                  <p className="mt-2 text-xs text-text-secondary">
                    Source: {l.source}
                    {l.comment && ` · Manager: ${l.comment}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {l.source === "manual" ? (
                    <span className="max-w-56 text-xs text-text-secondary">Review each date in the pending requests above.</span>
                  ) : ["pending", "needs_review"].includes(l.status) ? (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => setReview({ leave: l, decision: "approved" })}
                      >
                        Review & approve
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => setReview({ leave: l, decision: "rejected" })}
                      >
                        Reject
                      </Button>
                    </>
                  ) : l.status === "approved" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setReview({ leave: l, decision: "cancelled" })}
                    >
                      Cancel leave
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            {!leaves.length && <Empty>No leave requests match your filters.</Empty>}
            <p className="px-5 py-3 text-xs text-text-secondary">
              Showing up to 200 recent requests. Incoming emails remain requests until a manager
              approves them. Rejected requests are hidden after 24 hours.
            </p>
          </div>
        )}
      </Card>}
      {tab === "daily" && board && !loading && (
        <AttendanceOverview
          section="analytics"
          rows={overviewRows}
          status={status}
          onStatus={setStatus}
          department={department}
          onDepartment={setDepartment}
        />
      )}
      <Dialog
        open={exportOpen}
        onOpenChange={(open) => {
          if (!exporting) setExportOpen(open);
        }}
      >
        <DialogContent className="attendance-dialog sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Download attendance report</DialogTitle>
            <DialogDescription>
              {dateLabel(date)} · Attendance summary and department analytics.
            </DialogDescription>
          </DialogHeader>
          <Field label="Report format">
            <Select
              className={fieldClass}
              value={exportFormat}
              disabled={exporting}
              onChange={(event) => setExportFormat(event.target.value as "xlsx" | "pdf")}
            >
              <option value="xlsx">Excel (.xlsx) - interactive tables and filters</option>
              <option value="pdf">PDF (.pdf) - branded report for viewing and sharing</option>
            </Select>
          </Field>
          <Field label="Employees to include">
            <Select
              className={fieldClass}
              value={exportScope}
              disabled={exporting}
              onChange={(event) => setExportScope(event.target.value)}
            >
              <option value="filtered">Current filtered results ({rows.length})</option>
              <option value="all">All employees for this date ({board?.rows.length || 0})</option>
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-surface-raised/50 p-3">
            {[
              ["Employees", exportRows.length],
              ["Recorded", exportSummary.recorded],
              ["Late entries", exportSummary.late],
            ].map(([label, count]) => (
              <div key={label} className="space-y-1">
                <p className="text-xs text-text-secondary">{label}</p>
                <p className="text-xl font-semibold tabular-nums">{count}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2 text-sm text-text-secondary">
            <p>
              <span className="font-medium text-text-primary">Summary:</span> attendance counts,
              recorded coverage, punctuality and delay.
            </p>
            <p>
              <span className="font-medium text-text-primary">Department analytics:</span> compare
              teams using coverage and punctuality percentages.
            </p>
            <p>
              <span className="font-medium text-text-primary">Employee records:</span>{" "}
              {exportFormat === "pdf"
                ? "Readable records with repeated table headers and page numbers."
                : "Sort and filter details with totals that follow your filters."}
            </p>
          </div>
          {!exportRows.length && (
            <p role="status" className="text-sm text-warning">
              No employees match this selection. Choose all employees or clear your filters.
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="secondary" disabled={exporting} onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={exporting || loading || !!error || !exportRows.length}
              onClick={() => void exportReport()}
            >
              <Download size={16} />
              {exporting ? "Preparing report…" : `Download .${exportFormat}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={employeeOpen}
        onOpenChange={(open) => {
          if (!busy) setEmployeeOpen(open);
        }}
      >
        <DialogContent className="attendance-dialog max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEmployee ? "Edit employee" : "Add employee"}</DialogTitle>
            <DialogDescription>
              {editingEmployee
                ? "Update employee details. Enrollment ID stays linked to the existing device registration and attendance history."
                : "Save the employee, then request device enrollment."}
            </DialogDescription>
          </DialogHeader>
          <EmployeeForm
            key={`${editingEmployee?.id || "new"}:${employeeOpen}`}
            current={editingEmployee}
            busy={busy}
            submit={(input) =>
              act(async () => {
                if (editingEmployee) {
                  if (input.link_existing_manager === true) {
                    await attendanceFunction("attendance-employee-account", {
                      action: "link_manager", employee_id: editingEmployee.id, email: input.email,
                    });
                    setEmployeeOpen(false);
                    toast.success("Existing SimKit login linked. Password and manager access are unchanged.");
                    return;
                  }
                  await attendanceFunction("attendance-employee-account", {
                    ...input, action: "update", employee_id: editingEmployee.id,
                  });
                  setEmployeeOpen(false);
                  toast.success("Employee details and login saved.");
                  return;
                }
                const result = await attendanceFunction<EnrollResponse>(
                  "attendance-employee-account",
                  { ...input, action: "create" },
                );
                setEmployeeOpen(false);
                enrollmentNotice(result);
              })
            }
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={settingsOpen}
        onOpenChange={(open) => {
          if (!busy) setSettingsOpen(open);
        }}
      >
        <DialogContent className="attendance-dialog max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Office attendance settings</DialogTitle>
            <DialogDescription>
              Changes apply to new records. Existing entry policies remain preserved.
            </DialogDescription>
          </DialogHeader>
          {settingsOpen && (
            <SettingsForm
              current={board?.settings || null}
              busy={busy}
              submit={(input) =>
                act(async () => {
                  await attendanceRpc("attendance_save_settings", input);
                  setSettingsOpen(false);
                  toast.success("Office settings saved.");
                })
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={leaveOpen}
        onOpenChange={(open) => {
          if (!busy) setLeaveOpen(open);
        }}
      >
        <DialogContent className="attendance-dialog">
          <DialogHeader>
            <DialogTitle>Record leave request</DialogTitle>
            <DialogDescription>Create a full-day request for manager review.</DialogDescription>
          </DialogHeader>
          {leaveOpen && (
            <LeaveForm
              employees={board?.employees || []}
              busy={busy}
              submit={(input) =>
                act(async () => {
                  await attendanceRpc("attendance_create_leave", input);
                  setLeaveOpen(false);
                  toast.success("Leave request recorded.");
                })
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null);
        }}
      >
        <DialogContent className="attendance-dialog">
          <DialogHeader>
            <DialogTitle>
              {review?.decision === "approved"
                ? "Approve leave"
                : review?.decision === "cancelled"
                  ? "Cancel approved leave"
                  : "Reject leave"}
            </DialogTitle>
            <DialogDescription>
              {review?.leave.employee_name || review?.leave.sender_email} · {review?.leave.reason}
            </DialogDescription>
          </DialogHeader>
          {review && (
            <ReviewForm
              key={review.leave.id + review.decision}
              request={review.leave}
              decision={review.decision}
              employees={board?.employees || []}
              busy={busy}
              submit={(input) =>
                act(async () => {
                  await attendanceRpc("attendance_review_leave", input);
                  setReview(null);
                  toast.success("Leave decision saved.");
                })
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!activeChange}
        onOpenChange={(open) => {
          if (!open && !busy) setActiveChange(null);
        }}
      >
        <DialogContent className="attendance-dialog">
          <DialogHeader>
            <DialogTitle>
              {activeChange?.active ? "Deactivate" : "Reactivate"} {activeChange?.name}
            </DialogTitle>
            <DialogDescription>
              This changes attendance tracking in SimKit. Device-side employee removal requires a
              supported firmware command and is not synchronized automatically.
            </DialogDescription>
          </DialogHeader>
          <Button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await attendanceRpc("attendance_set_active", {
                  _employee: activeChange!.id,
                  _active: !activeChange!.active,
                });
                setActiveChange(null);
                toast.success("Employee state updated.");
              })
            }
          >
            Confirm
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deletingEmployee}
        onOpenChange={(open) => {
          if (!open && !busy) setDeletingEmployee(null);
        }}
      >
        <DialogContent className="attendance-dialog">
          <DialogHeader>
            <DialogTitle>Delete {deletingEmployee?.name}?</DialogTitle>
            <DialogDescription>
              This removes the employee from the directory and stops attendance tracking. Existing
              attendance records are preserved. Device registration must be removed separately on
              the device.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setDeletingEmployee(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await attendanceRpc("attendance_delete_employee", {
                    _employee: deletingEmployee!.id,
                  });
                  setDeletingEmployee(null);
                  toast.success("Employee deleted.");
                })
              }
            >
              {busy ? "Deleting?" : "Delete employee"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AttendanceEvidenceDialogs
        record={history}
        onCloseRecord={() => setHistory(null)}
        photo={photo}
        onClosePhoto={() => setPhoto(null)}
        onViewPhoto={(eventId) => void viewPhoto(eventId)}
      />
    </div>
  );
}

function EmployeeForm({
  current,
  busy,
  submit,
}: {
  current?: Employee | null;
  busy: boolean;
  submit: (input: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(current?.name || "");
  const [department, setDepartment] = useState<string>(current?.department || "software");
  const [enroll, setEnroll] = useState(current?.enroll_id || "");
  const [email, setEmail] = useState(current?.email || "");
  const [password, setPassword] = useState("");
  const [verified, setVerified] = useState(current?.email_verified || false);
  const [start, setStart] = useState(current?.employment_start || indiaDate());
  const mayLinkExistingManager = !!current && current.department === "manager" && !current.auth_user_id;
  const linkedManager = !!current?.auth_user_id && current.department === "manager";
  const [linkExisting, setLinkExisting] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(linkExisting
          ? { link_existing_manager: true, email }
          : { name, department, enroll_id: enroll, email, password,
              email_verified: verified, employment_start: start });
      }}
    >
      {linkExisting ? (
        <>
          <Field label="Existing SimKit manager login email">
            <Input type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <p className="text-sm text-text-secondary">
            This links the existing manager account to this Attendance record. Its password and manager permissions stay unchanged.
          </p>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Linking…" : "Link existing SimKit login"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} className="w-full" onClick={() => setLinkExisting(false)}>
            Back to employee details
          </Button>
        </>
      ) : (
        <>
      <Field label="Name">
        <Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Department">
        <Select value={department} onChange={(e) => setDepartment(e.target.value)} disabled={linkedManager}>
          {departments.filter((d) => d !== "hardware" || current?.department === "hardware").map((d) => (
            <option key={d} value={d}>
              {d[0].toUpperCase() + d.slice(1)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Enroll ID">
        <Input
          required
          maxLength={64}
          value={enroll}
          readOnly={!!current}
          onChange={(e) => setEnroll(e.target.value)}
          placeholder="Must match the device ID for this employee"
        />
      </Field>
      <Field label="Employment start">
        <Input
          type="date"
          required
          max={indiaDate()}
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </Field>
      <Field label={linkedManager ? "Existing SimKit login email" : "Login email"}>
        <Input
          type="email"
          required
          maxLength={254}
          value={email}
          disabled={linkedManager}
          onChange={(e) => {
            setEmail(e.target.value);
            setVerified(false);
          }}
        />
      </Field>
      {linkedManager ? (
        <p className="text-sm text-text-secondary">The existing manager login and password are linked and unchanged.</p>
      ) : (
        <Field label={current?.auth_user_id ? "New password (leave blank to keep current password)" : "Login password"}>
          <Input type="password" autoComplete="new-password" minLength={8} maxLength={128}
            required={!current?.auth_user_id} value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </Field>
      )}
      {email && !linkedManager && (
        <label className="flex gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />
          I have verified this email belongs to the employee.
        </label>
      )}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Saving…" : current ? "Save changes" : "Save & request enrollment"}
      </Button>
      {mayLinkExistingManager && (
        <Button type="button" variant="secondary" disabled={busy} className="w-full" onClick={() => setLinkExisting(true)}>
          Link existing SimKit manager login
        </Button>
      )}
        </>
      )}
    </form>
  );
}
function SettingsForm({
  current,
  busy,
  submit,
}: {
  current: Settings | null;
  busy: boolean;
  submit: (input: Record<string, unknown>) => Promise<void>;
}) {
  const [start, setStart] = useState(current?.shift_start.slice(0, 5) || "10:00");
  const [grace, setGrace] = useState(current?.grace_minutes ?? 15);
  const [days, setDays] = useState(current?.working_days ?? [1, 2, 3, 4, 5]);
  const [holidays, setHolidays] = useState(current?.holidays.join(", ") || "");
  function save(e: FormEvent) {
    e.preventDefault();
    const dates = holidays
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    if (dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
      toast.error("Enter holidays as YYYY-MM-DD, separated by commas.");
      return;
    }
    if (!days.length) {
      toast.error("Select at least one working day.");
      return;
    }
    void submit({ _start: start, _grace: grace, _cutoff: null, _days: days, _holidays: dates });
  }
  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Office start (IST)">
          <Input type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Grace minutes">
          <Input
            type="number"
            required
            min={0}
            max={120}
            value={grace}
            onChange={(e) => setGrace(Number(e.target.value))}
          />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm text-text-secondary">Confirm working days</legend>
        <div className="flex flex-wrap gap-3">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, i) => (
            <label key={label} className="flex gap-1 text-xs">
              <input
                type="checkbox"
                checked={days.includes(i)}
                onChange={(e) =>
                  setDays(e.target.checked ? [...days, i] : days.filter((d) => d !== i))
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Holidays (YYYY-MM-DD, comma separated)">
        <Input
          value={holidays}
          onChange={(e) => setHolidays(e.target.value)}
          placeholder="2026-10-20, 2026-12-25"
        />
      </Field>
      <p className="text-xs text-text-secondary">
        A working day stays awaiting scan until midnight IST. If no valid face scan is recorded
        during that day, it is marked absent. Approved leave, WFH, holidays and off days are exempt.
        Late minutes are measured after office start plus the grace period. Needs review means a
        scan conflicts with approved leave, its lateness cannot be calculated, or office settings
        are unavailable for that date.
      </p>
      <Button type="submit" disabled={busy} className="w-full">
        Save settings
      </Button>
    </form>
  );
}
function LeaveForm({
  employees,
  busy,
  submit,
}: {
  employees: Employee[];
  busy: boolean;
  submit: (input: Record<string, unknown>) => Promise<void>;
}) {
  const [employee, setEmployee] = useState("");
  const [start, setStart] = useState(indiaDate());
  const [end, setEnd] = useState(indiaDate());
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit({ _employee: employee, _start: start, _end: end, _reason: reason });
      }}
    >
      <Field label="Employee">
        <Select required value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="">Choose employee</option>
          {employees
            .filter((e) => e.active)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.enroll_id}
              </option>
            ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="From">
          <Input type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Through">
          <Input
            type="date"
            required
            min={start}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Reason">
        <Textarea
          required
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        Create pending request
      </Button>
    </form>
  );
}
function ReviewForm({
  request,
  decision,
  employees,
  busy,
  submit,
}: {
  request: Leave;
  decision: string;
  employees: Employee[];
  busy: boolean;
  submit: (input: Record<string, unknown>) => Promise<void>;
}) {
  const [employee, setEmployee] = useState(request.employee_id || "");
  const [start, setStart] = useState(request.start_date || "");
  const [end, setEnd] = useState(request.end_date || "");
  const [comment, setComment] = useState("");
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit({
          _request: request.id,
          _decision: decision,
          _comment: comment,
          _employee: employee || null,
          _start: start || null,
          _end: end || null,
        });
      }}
    >
      {decision === "approved" && (
        <>
          <Field label="Confirm employee">
            <Select required value={employee} onChange={(e) => setEmployee(e.target.value)}>
              <option value="">Choose employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.enroll_id}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="From">
              <Input
                type="date"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="Through">
              <Input
                type="date"
                required
                min={start}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>
        </>
      )}
      <Field label="Manager comment">
        <Textarea maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        Confirm{" "}
        {decision === "approved"
          ? "approval"
          : decision === "cancelled"
            ? "cancellation"
            : "rejection"}
      </Button>
    </form>
  );
}
