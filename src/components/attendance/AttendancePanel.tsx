import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  ImageIcon,
  Plus,
  RefreshCw,
  Settings2,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
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
  type History,
  type Leave,
  type Settings,
} from "@/lib/device-attendance";

const fieldClass = "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm";
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2 text-sm">
      <span className="text-text-secondary">{label}</span>
      {children}
    </label>
  );
}
function Status({ value }: { value: string }) {
  const tone = ["present", "enrolled", "approved"].includes(value)
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : value === "late"
      ? "bg-amber-500/10 text-amber-600"
      : value === "on_leave"
        ? "bg-blue-500/10 text-blue-500"
        : ["failed", "absent", "rejected"].includes(value)
          ? "bg-red-500/10 text-red-500"
          : "bg-surface text-text-secondary";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {statusLabels[value] || value}
    </span>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="p-12 text-center text-sm text-text-secondary">{children}</div>;
}
type EnrollResponse = { status: string; publishing: { configured: boolean; sent: number } };
function enrollmentNotice(result: EnrollResponse) {
  if (result.status === "enrolled") toast.success("Employee registration confirmed by the device.");
  else if (result.status === "failed")
    toast.error("User saved. Enrollment failed; review device status before retrying.");
  else if (!result.publishing.configured) toast("User saved. Device integration setup is pending.");
  else if (result.publishing.sent) toast.success("Enrollment sent. Awaiting device confirmation.");
  else toast("User saved. Enrollment is queued; check connection and retry status.");
}

export function AttendancePanel() {
  const [date, setDate] = useState(indiaDate());
  const { board, error, loading, reload } = useDeviceAttendance(date);
  const [tab, setTab] = useState<"daily" | "users" | "leave">("daily");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [review, setReview] = useState<{ leave: Leave; decision: string } | null>(null);
  const [activeChange, setActiveChange] = useState<Employee | null>(null);
  const [history, setHistory] = useState<{ name: string; data: History } | null>(null);
  const [photo, setPhoto] = useState<{
    url: string;
    expires_at: string;
    photo_expires_at: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
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
  const rows = (board?.rows || []).filter(
    (row) =>
      (department === "all" || row.department === department) &&
      (status === "all" || row.status === status) &&
      `${row.name} ${row.enroll_id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const employees = (board?.employees || []).filter(
    (e) =>
      (department === "all" || e.department === department) &&
      `${e.name} ${e.enroll_id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const leaves = (board?.leaves || []).filter(
    (l) =>
      (status === "all" || l.status === status) &&
      `${l.employee_name || ""} ${l.sender_email || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const pending = (board?.leaves || []).filter((l) =>
    ["pending", "needs_review"].includes(l.status),
  ).length;
  const totals = [
    {
      label: "Present",
      count: board?.rows.filter((r) => r.entry_at).length || 0,
      icon: CheckCircle2,
    },
    {
      label: "Late",
      count: board?.rows.filter((r) => (r.late_minutes || 0) > 0).length || 0,
      icon: Clock3,
    },
    {
      label: "On leave",
      count: board?.rows.filter((r) => r.status === "on_leave").length || 0,
      icon: CalendarDays,
    },
    {
      label: "Absent",
      count: board?.rows.filter((r) => r.status === "absent").length || 0,
      icon: Users,
    },
  ];
  const deviceState = board?.device.state || "unknown";
  function chooseTab(value: typeof tab) {
    setTab(value);
    setStatus("all");
  }
  function photoAction(row: {
    event_id: string | null;
    photo_status: string | null;
    photo_expires_at: string | null;
  }) {
    if (row.photo_expires_at && Date.parse(row.photo_expires_at) <= now)
      return <span className="text-xs text-text-dim">Expired after 24 hours</span>;
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
      <span className="text-xs text-text-dim">{row.event_id ? "Photo unavailable" : "—"}</span>
    );
  }
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-mono uppercase tracking-widest text-lime">
            People & attendance
          </p>
          <h1 className="font-syne text-3xl font-bold">Attendance</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Office entries, employee enrollment, and leave requests.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || busy}
            onClick={() => void reload()}
          >
            <RefreshCw size={15} />
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!board || busy}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={15} />
            Office settings
          </Button>
          <Button size="sm" disabled={!board || busy} onClick={() => setEmployeeOpen(true)}>
            <Plus size={16} />
            Add user
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-xs text-text-secondary">
        <span className="flex items-center gap-2">
          {deviceState === "online" ? (
            <Wifi size={15} className="text-emerald-500" />
          ) : (
            <WifiOff size={15} />
          )}
          Device {deviceState} · Last scan: {timeLabel(board?.device.last_scan_at || null)} IST
        </span>
        <span>
          Entry policy:{" "}
          {board?.settings
            ? `${timeLabel(`2000-01-01T${board.settings.shift_start}+05:30`)} + ${board.settings.grace_minutes} min grace`
            : "Not configured"}{" "}
          · Asia/Kolkata
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
      {board && !board.settings?.absence_cutoff && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-600">
          Complete working days and absence cutoff in Office settings. Missing scans require review
          until attendance coverage is confirmed.
        </div>
      )}
      <nav
        aria-label="Attendance sections"
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {(
          [
            ["daily", "Daily Attendance"],
            ["users", "Manage Users"],
            ["leave", "Leave Requests"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => chooseTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${tab === key ? "border-lime text-lime" : "border-transparent text-text-secondary hover:text-text-primary"}`}
          >
            {label}
            {key === "leave" && pending > 0 && (
              <span className="ml-2 rounded-full bg-lime/15 px-2 py-0.5 text-xs text-lime">
                {pending}
              </span>
            )}
          </button>
        ))}
      </nav>
      {tab === "daily" && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {totals.map(({ label, count, icon: Icon }) => (
            <Card key={label} className="p-5">
              <div className="flex items-center justify-between text-text-secondary">
                <span className="text-sm">{label}</span>
                <Icon size={18} />
              </div>
              <p className="mt-3 text-3xl font-bold">{count}</p>
              {label === "Present" && (
                <p className="mt-1 text-xs text-text-dim">Includes late arrivals</p>
              )}
            </Card>
          ))}
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:flex lg:items-end">
          {tab === "daily" && (
            <Field label="Attendance date">
              <Input
                className={fieldClass}
                type="date"
                value={date}
                max={indiaDate()}
                onChange={(e) => {
                  if (e.target.value) setDate(e.target.value);
                }}
              />
            </Field>
          )}
          <div className="lg:flex-1">
            <Field label="Search employee">
              <Input
                className={fieldClass}
                placeholder="Name or enroll ID"
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
          {tab !== "users" && (
            <Field label="Status">
              <Select
                className={fieldClass}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                {(tab === "daily"
                  ? [
                      "present",
                      "late",
                      "on_leave",
                      "awaiting_scan",
                      "absent",
                      "off_day",
                      "needs_review",
                    ]
                  : ["pending", "needs_review", "approved", "rejected", "cancelled"]
                ).map((s) => (
                  <option key={s} value={s}>
                    {statusLabels[s]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {tab === "leave" && (
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
                <thead className="bg-surface text-xs text-text-secondary">
                  <tr>
                    {[
                      "Employee",
                      "Department",
                      "Date",
                      "Entry time (IST)",
                      "Status",
                      "Photo",
                      "",
                    ].map((h, i) => (
                      <th key={i} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.employee_id}
                      className={`border-t border-border ${(row.late_minutes || 0) > 0 ? "bg-amber-500/5" : ""}`}
                    >
                      <td className="px-4 py-4">
                        <p className="font-semibold">{row.name}</p>
                        <p className="text-xs text-text-dim">ID {row.enroll_id}</p>
                      </td>
                      <td className="px-4 capitalize">{row.department}</td>
                      <td className="px-4 whitespace-nowrap">{dateLabel(date)}</td>
                      <td className="px-4 whitespace-nowrap">{timeLabel(row.entry_at)}</td>
                      <td className="px-4">
                        <Status value={row.status} />
                        {(row.late_minutes || 0) > 0 && (
                          <p className="mt-1 text-xs text-amber-600">{row.late_minutes} min late</p>
                        )}
                        {row.leave_conflict && <p className="mt-1 text-xs">Scanned during leave</p>}
                      </td>
                      <td className="px-4">{photoAction(row)}</td>
                      <td className="px-4">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void act(async () =>
                              setHistory({
                                name: row.name,
                                data: await attendanceRpc("attendance_history", {
                                  _employee: row.employee_id,
                                  _date: date,
                                }),
                              }),
                            )
                          }
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
                  className={`space-y-3 p-4 ${(row.late_minutes || 0) > 0 ? "bg-amber-500/5" : ""}`}
                >
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="font-semibold">{row.name}</p>
                      <p className="text-xs capitalize text-text-secondary">
                        {row.department} · ID {row.enroll_id}
                      </p>
                    </div>
                    <Status value={row.status} />
                  </div>
                  <p className="text-sm">
                    {dateLabel(date)} · {timeLabel(row.entry_at)} IST
                    {(row.late_minutes || 0) > 0 && ` · ${row.late_minutes} min late`}
                  </p>
                  {row.leave_conflict && (
                    <p className="text-xs text-amber-600">Scanned during approved leave</p>
                  )}
                  <div className="flex gap-2">
                    {photoAction(row)}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void act(async () =>
                          setHistory({
                            name: row.name,
                            data: await attendanceRpc("attendance_history", {
                              _employee: row.employee_id,
                              _date: date,
                            }),
                          }),
                        )
                      }
                    >
                      Scan history
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {!rows.length && <Empty>No employees match this date and these filters.</Empty>}
          </>
        ) : tab === "users" ? (
          <div className="divide-y divide-border">
            {employees.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-semibold">
                    {e.name}{" "}
                    {!e.active && <span className="text-xs text-text-dim">(Inactive)</span>}
                  </p>
                  <p className="mt-1 text-sm capitalize text-text-secondary">
                    {e.department} · Enroll ID {e.enroll_id}
                  </p>
                  {e.email && (
                    <p className="mt-1 text-xs text-text-dim">
                      {e.email} ·{" "}
                      {e.email_verified ? "Email verified by manager" : "Email unverified"}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Status value={e.enrollment_status} />
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
                </div>
              </div>
            ))}
            {!employees.length && (
              <Empty>Add your first employee to begin attendance tracking.</Empty>
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
                  <p className="mt-2 text-xs text-text-dim">
                    Source: {l.source}
                    {l.comment && ` · Manager: ${l.comment}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {["pending", "needs_review"].includes(l.status) ? (
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
            <p className="px-5 py-3 text-xs text-text-dim">
              Showing up to 200 recent requests. Incoming emails remain requests until a manager
              approves them.
            </p>
          </div>
        )}
      </Card>
      {tab === "daily" && board && board.review_events.length > 0 && (
        <Card className="p-5">
          <h2 className="font-semibold">Device events needing review</h2>
          <p className="mt-1 text-sm text-text-secondary">
            These events were preserved but did not mark attendance.
          </p>
          <div className="mt-3 space-y-2">
            {board.review_events.map((e) => (
              <p key={e.id} className="text-sm">
                Enroll ID {e.enroll_id} · {timeLabel(e.scanned_at)} IST ·{" "}
                {e.validation_state.replaceAll("_", " ")}
              </p>
            ))}
          </div>
        </Card>
      )}
      <Dialog
        open={employeeOpen}
        onOpenChange={(open) => {
          if (!busy) setEmployeeOpen(open);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add attendance user</DialogTitle>
            <DialogDescription>
              Save the employee, then request device enrollment.
            </DialogDescription>
          </DialogHeader>
          <EmployeeForm
            busy={busy}
            submit={(input) =>
              act(async () => {
                const result = await attendanceFunction<EnrollResponse>(
                  "attendance-enroll-user",
                  input,
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
        <DialogContent className="max-h-[90vh] overflow-y-auto">
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
        <DialogContent>
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
        <DialogContent>
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
        <DialogContent>
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
        open={!!history}
        onOpenChange={(open) => {
          if (!open) setHistory(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{history?.name} · Scan history</DialogTitle>
            <DialogDescription>{dateLabel(date)} · Times in IST</DialogDescription>
          </DialogHeader>
          {history?.data.events.map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium">
                Scanned: {timeLabel(e.scanned_at)} · {e.validation_state.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                Received:{" "}
                {new Date(e.received_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
              </p>
              {photoAction({
                event_id: e.id,
                photo_status: e.photo_status || null,
                photo_expires_at: e.photo_expires_at || null,
              })}
            </div>
          ))}
          {history?.data.events.length === 0 && (
            <p className="text-sm text-text-secondary">No scans recorded.</p>
          )}
          {history?.data.audit.map((a) => (
            <p key={a.id} className="text-xs text-text-secondary">
              {a.action.replaceAll("_", " ")} · {timeLabel(a.occurred_at)} ·{" "}
              {JSON.stringify(a.details)}
            </p>
          ))}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!photo}
        onOpenChange={(open) => {
          if (!open) setPhoto(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attendance photo</DialogTitle>
            <DialogDescription>
              Private evidence. Photo expiry:{" "}
              {photo
                ? new Date(photo.photo_expires_at).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })
                : ""}{" "}
              IST
            </DialogDescription>
          </DialogHeader>
          {photo && (
            <img
              src={photo.url}
              alt="Employee attendance scan"
              className="max-h-[60vh] w-full rounded-lg object-contain"
            />
          )}
          <p className="text-xs text-text-secondary">
            This preview closes when its short-lived access expires.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmployeeForm({
  busy,
  submit,
}: {
  busy: boolean;
  submit: (input: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("software");
  const [enroll, setEnroll] = useState("");
  const [email, setEmail] = useState("");
  const [verified, setVerified] = useState(false);
  const [start, setStart] = useState(indiaDate());
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit({
          name,
          department,
          enroll_id: enroll,
          email,
          email_verified: verified,
          employment_start: start,
        });
      }}
    >
      <Field label="Name">
        <Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Department">
        <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
          {departments.map((d) => (
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
      <Field label="Email (optional; used for leave matching)">
        <Input
          type="email"
          maxLength={254}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setVerified(false);
          }}
        />
      </Field>
      {email && (
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
        {busy ? "Saving…" : "Save & request enrollment"}
      </Button>
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
  const [cutoff, setCutoff] = useState(current?.absence_cutoff?.slice(0, 5) || "");
  const [days, setDays] = useState(
    current?.absence_cutoff ? current.working_days : [1, 2, 3, 4, 5],
  );
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
    void submit({ _start: start, _grace: grace, _cutoff: cutoff, _days: days, _holidays: dates });
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
      <Field label="Absence cutoff (IST)">
        <Input type="time" required value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
      </Field>
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
        Automatic absence requires uninterrupted device heartbeats through the cutoff. Otherwise
        missing scans stay in review.
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
