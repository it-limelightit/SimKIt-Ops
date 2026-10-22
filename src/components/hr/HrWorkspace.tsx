import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FileText,
  History,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  ScanFace,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Select, Textarea } from "@/components/ui-kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-store";
import { dateLabel, indiaDate } from "@/lib/device-attendance";
import {
  canManageHr,
  employmentLabel,
  hrAccountRequest,
  hrMoney,
  hrRpc,
  hrDirectory,
  templateLabel,
  type HrBoard,
  type HrEmployee,
  type HrOffer,
  type HrCandidate,
} from "@/lib/hr";
import { HrEmployeeForm, HrField, HrRevisionForm, hrFieldClass } from "./HrEmployeeForm";
import { HrOfferForm } from "./HrOfferForm";
import { HrDirectory } from "./HrDirectory";

type Modal =
  | { kind: "employee"; employee?: HrEmployee; source?: HrCandidate }
  | { kind: "revision" | "account" | "offer" | "enroll" | "left" | "delete"; employee: HrEmployee };
const card = "rounded-xl border border-border bg-surface";
const pretty = (value: string) => value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone === "success" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600" : tone === "warning" ? "border-amber-500/25 bg-amber-500/10 text-amber-600" : "border-border bg-surface-raised text-text-secondary"}`}
    >
      {children}
    </span>
  );
}
const modalTitle = (modal: Modal | null) =>
  modal?.kind === "employee"
    ? modal.employee
      ? "Edit employee details"
      : modal.source
        ? "Complete HR details"
        : "Add employee"
    : modal?.kind === "revision"
      ? "Revise employment / salary"
      : modal?.kind === "account"
        ? "Employee login"
        : modal?.kind === "offer"
          ? "Generate offer letter"
          : modal?.kind === "enroll"
            ? "Start office face enrollment"
            : modal?.kind === "delete"
              ? "Delete employee from HR?"
              : "Mark employee as left";

export function HrWorkspace() {
  const { userId, email } = useAuth();
  const allowed = canManageHr(email);
  const [board, setBoard] = useState<HrBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"profile" | "history" | "offers">("profile");
  const [modal, setModal] = useState<Modal | null>(null);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    if (!allowed || !userId) return;
    const ticket = ++generation.current;
    setLoading(true);
    try {
      const next = await hrRpc<HrBoard>("hr_board");
      if (ticket === generation.current && useAuth.getState().userId === userId) {
        setBoard(next);
        setError(null);
      }
    } catch (failure) {
      if (ticket === generation.current)
        setError(failure instanceof Error ? failure.message : "Could not load HR records");
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [allowed, userId]);
  useEffect(() => {
    const requestGeneration = generation;
    setBoard(null);
    void reload();
    return () => {
      requestGeneration.current++;
    };
  }, [reload]);
  useEffect(() => {
    if (!allowed || !selected) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [allowed, selected, reload]);
  async function act(work: () => Promise<unknown>, message: string, close = true) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      toast.success(message);
      if (close) setModal(null);
      await reload();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not save HR changes");
    } finally {
      setBusy(false);
    }
  }
  async function downloadSaved(offer: HrOffer) {
    if (busy) return;
    setBusy(true);
    try {
      const { createOfferPdf, offerFilename } = await import("@/lib/hr-offer-pdf");
      const doc = await createOfferPdf(offer.snapshot, undefined, offer.offer_number);
      doc.save(offerFilename(offer.snapshot.employee.name, offer.offer_number));
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not download offer");
    } finally {
      setBusy(false);
    }
  }
  if (!allowed)
    return <p className="p-6 text-sm text-text-secondary">HR / Hiring access is required.</p>;
  const today = board?.today || indiaDate();
  const employees = hrDirectory(board);
  const person = employees.find((e) => e.id === selected);
  const personTerms = board?.terms.filter((t) => t.employee_id === selected) || [];
  const personOffers = board?.offers.filter((o) => o.employee_id === selected) || [];
  const modalEmployee = modal?.employee;
  const editable = person && !person.directory_source && person.status !== "left";
  return (
    <div className="hr-workspace space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-widest text-lime">
            People & employment
          </p>
          <h1 className="font-syne text-2xl font-bold sm:text-3xl">HR / Hiring</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
            Manage employees, internships, salary revisions and offer letters in one place.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || busy}
            onClick={() => void reload()}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
          <Button
            size="sm"
            disabled={!board || busy || !!error}
            onClick={() => setModal({ kind: "employee" })}
          >
            <Plus size={16} />
            Add employee
          </Button>
        </div>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-coral/25 bg-coral/5 p-4 text-sm text-coral"
        >
          {error}
          <Button className="ml-3" size="sm" variant="secondary" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      )}
      <HrDirectory
        employees={employees}
        today={today}
        loading={loading}
        locked={busy || !board || !!error}
        onView={(e) => {
          setSelected(e.id);
          setDetailTab("profile");
        }}
        onEdit={(e) =>
          setModal(
            e.directory_source
              ? { kind: "employee", source: e.directory_source }
              : { kind: "employee", employee: e },
          )
        }
        onRevise={(e) => setModal({ kind: "revision", employee: e })}
        onOffer={(e) => setModal({ kind: "offer", employee: e })}
        onDelete={(e) => setModal({ kind: "delete", employee: e })}
      />
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-raised/40 p-4">
        <ScanFace size={20} className="mt-0.5 shrink-0 text-lime" />
        <p className="text-xs leading-6 text-text-secondary">
          <span className="font-semibold text-text-primary">Office face enrollment:</span> Create or
          link the login, then start enrollment when the employee is at the office device. Hardik
          does not need a webcam. Field associates use their existing field attendance flow.
        </p>
      </div>

      <Dialog
        open={Boolean(person) && !modal}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{person?.name}</DialogTitle>
            <DialogDescription>
              {person?.employee_code} · {person?.designation || "HR details missing"} ·{" "}
              {person ? pretty(person.status) : ""}
            </DialogDescription>
          </DialogHeader>
          {person && (
            <>
              <div className="flex flex-wrap gap-2 border-b border-border pb-4">
                {(
                  [
                    ["profile", "Profile", Users],
                    ["history", "Employment history", History],
                    ["offers", "Offer letters", FileText],
                  ] as const
                )
                  .filter(([tab]) => !person.directory_source || tab === "profile")
                  .map(([tab, label, Icon]) => (
                    <Button
                      key={tab}
                      size="sm"
                      variant={detailTab === tab ? "primary" : "ghost"}
                      onClick={() => setDetailTab(tab)}
                    >
                      <Icon size={14} />
                      {label}
                    </Button>
                  ))}
              </div>
              {detailTab === "profile" && (
                <>
                  <dl className="grid gap-x-6 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      ["Email", person.email],
                      ["Mobile", person.mobile || "Not set"],
                      [
                        "Joining date",
                        person.directory_source ? "Not set" : dateLabel(person.joining_date),
                      ],
                      ["Department", pretty(person.department)],
                      ["Designation", person.designation || "Not set"],
                      ["Mentor / manager", person.mentor_name || "Not set"],
                      ["Employment type", employmentLabel(person.current_term?.employment_type)],
                      [
                        person.current_term?.employment_type === "internship"
                          ? "Monthly stipend"
                          : "Monthly gross salary",
                        hrMoney(person.current_term?.monthly_amount),
                      ],
                      ["Annual CTC / package", hrMoney(person.current_term?.annual_ctc)],
                      [
                        "Internship duration",
                        person.current_term?.employment_type === "internship"
                          ? `${person.current_term.internship_months} months · Until ${dateLabel(person.current_term.internship_end)}`
                          : "—",
                      ],
                      ["Workspace", pretty(person.app_access)],
                      [
                        "Login",
                        person.auth_user_id
                          ? person.status === "left"
                            ? "Linked · Profile deactivated"
                            : "Linked and active"
                          : "Setup pending",
                      ],
                      [
                        "Attendance",
                        person.attendance_method === "field_online"
                          ? "Field · Mark as online"
                          : `Office device · ${person.enrollment_status || "Not set up"}`,
                      ],
                      ["Device enrollment ID", person.enroll_id || "Assigned when login is linked"],
                      ["College / institute", person.college || "—"],
                      ["Address / location", person.address || "—"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs text-text-secondary">{label}</dt>
                        <dd className="mt-1 break-words font-medium">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {person.directory_source && (
                    <div className="space-y-3 border-t border-border pt-4">
                      <p className="text-sm text-text-secondary">
                        This employee is already in SimKit. Complete their HR details to add
                        compensation and generate offer letters.
                      </p>
                      <Button
                        disabled={busy || !!error}
                        onClick={() =>
                          setModal({ kind: "employee", source: person.directory_source })
                        }
                      >
                        Complete HR details
                      </Button>
                    </div>
                  )}
                  {editable && (
                    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || !!error}
                        onClick={() => setModal({ kind: "employee", employee: person })}
                      >
                        Edit details
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || !!error}
                        onClick={() => setModal({ kind: "revision", employee: person })}
                      >
                        Revise employment / salary
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy || !!error || !personTerms.length}
                        onClick={() => setModal({ kind: "offer", employee: person })}
                      >
                        <FileText size={15} />
                        Generate offer
                      </Button>
                      {!person.auth_user_id && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy || !!error || person.joining_date > today}
                          onClick={() => setModal({ kind: "account", employee: person })}
                        >
                          <KeyRound size={15} />
                          Set up login
                        </Button>
                      )}
                      {person.auth_user_id &&
                        person.attendance_method === "office_device" &&
                        person.enrollment_status !== "enrolled" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || !!error}
                            onClick={() => setModal({ kind: "enroll", employee: person })}
                          >
                            <ScanFace size={15} />
                            Enroll on device
                          </Button>
                        )}
                      {person.app_access !== "manager" && (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy || !!error}
                          onClick={() => setModal({ kind: "left", employee: person })}
                        >
                          Mark as left
                        </Button>
                      )}
                    </div>
                  )}
                  {person.joining_date > today && (
                    <p className="text-xs text-text-secondary">
                      Login setup becomes available on the joining date. You can generate the offer
                      letter now.
                    </p>
                  )}
                </>
              )}
              {detailTab === "history" && (
                <div className="space-y-3">
                  {personTerms.map((t) => (
                    <article key={t.id} className={`${card} p-4`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">
                          {employmentLabel(t.employment_type)} · {hrMoney(t.monthly_amount)}/month
                        </p>
                        <Pill
                          tone={
                            t.effective_from > today
                              ? "warning"
                              : person.current_term?.id === t.id
                                ? "success"
                                : "neutral"
                          }
                        >
                          {t.effective_from > today
                            ? "Scheduled"
                            : person.current_term?.id === t.id
                              ? "Current"
                              : "Previous"}
                        </Pill>
                      </div>
                      <p className="mt-2 text-xs text-text-secondary">
                        Effective {dateLabel(t.effective_from)} · Revision {t.revision}
                        {t.annual_ctc != null
                          ? ` · Annual CTC ${hrMoney(t.annual_ctc)}`
                          : ` · ${t.internship_months} months · Ends ${dateLabel(t.internship_end)}`}
                      </p>
                      <p className="mt-3 whitespace-pre-wrap text-sm">{t.reason}</p>
                    </article>
                  ))}
                </div>
              )}
              {detailTab === "offers" && (
                <div className="space-y-3">
                  {personOffers.map((offer) => (
                    <article
                      key={offer.id}
                      className={`${card} flex flex-wrap items-center justify-between gap-3 p-4`}
                    >
                      <div>
                        <p className="font-semibold">{offer.offer_number}</p>
                        <p className="mt-1 text-xs text-text-secondary">
                          {templateLabel(offer.template)} ·{" "}
                          {dateLabel(offer.snapshot.fields.offer_date)} ·{" "}
                          {employmentLabel(offer.snapshot.term.employment_type)}
                        </p>
                        <p className="mt-1 text-xs text-text-secondary">
                          Saved compensation: {hrMoney(offer.snapshot.term.monthly_amount)}/month
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void downloadSaved(offer)}
                      >
                        <Download size={15} />
                        Download PDF
                      </Button>
                    </article>
                  ))}
                  {!personOffers.length && (
                    <p className="py-8 text-center text-sm text-text-secondary">
                      No offer letters generated yet.
                    </p>
                  )}
                  <p className="text-xs leading-5 text-text-secondary">
                    Each letter keeps the employee details and compensation saved when it was
                    generated. Later salary revisions do not change older letters.
                  </p>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(modal)}
        onOpenChange={(open) => {
          if (!open && !busy) setModal(null);
        }}
      >
        <DialogContent
          className={`max-h-[92vh] overflow-y-auto ${modal?.kind === "offer" ? "sm:max-w-5xl" : "sm:max-w-2xl"}`}
        >
          <DialogHeader>
            <DialogTitle>{modalTitle(modal)}</DialogTitle>
            <DialogDescription>
              {modalEmployee
                ? `${modalEmployee.employee_code} · ${modalEmployee.name}`
                : "Employee information, employment terms and account linking."}
            </DialogDescription>
          </DialogHeader>
          {modal?.kind === "employee" && (
            <HrEmployeeForm
              key={
                modal.employee?.id ||
                modal.source?.auth_user_id ||
                modal.source?.attendance_employee_id ||
                "new"
              }
              employee={modal.employee}
              initialSource={modal.source}
              candidates={board?.candidates || []}
              today={today}
              busy={busy}
              onSave={async (details, initial) => {
                await act(
                  async () => {
                    const id = await hrRpc<string>("hr_save_employee", {
                      _id: modal.employee?.id || null,
                      _revision: modal.employee?.revision || null,
                      _details: details,
                      _initial_terms: initial,
                    });
                    if (modal.source) {
                      setSelected(id);
                      setDetailTab("profile");
                    }
                  },
                  modal.employee
                    ? "Employee details updated."
                    : modal.source
                      ? "HR details completed."
                      : "Employee added.",
                );
              }}
            />
          )}
          {modal?.kind === "revision" && (
            <HrRevisionForm
              employee={modal.employee}
              today={today}
              busy={busy}
              onSave={async (terms, reason) => {
                await act(
                  () =>
                    hrRpc("hr_revise_employment", {
                      _employee: modal.employee.id,
                      _revision: modal.employee.revision,
                      _terms: terms,
                      _reason: reason,
                    }),
                  "Employment revision saved.",
                );
              }}
            />
          )}
          {modal?.kind === "offer" && (
            <HrOfferForm
              employee={modal.employee}
              terms={board?.terms.filter((t) => t.employee_id === modal.employee.id) || []}
              today={today}
              onSaved={reload}
              onBusyChange={setBusy}
            />
          )}
          {modal?.kind === "account" && (
            <AccountForm
              employee={modal.employee}
              busy={busy}
              onSubmit={async (mode, password) => {
                await act(
                  () =>
                    mode === "link"
                      ? hrRpc("hr_attach_login", {
                          _employee: modal.employee.id,
                          _revision: modal.employee.revision,
                        })
                      : hrAccountRequest({
                          action: "create",
                          employee_id: modal.employee.id,
                          revision: modal.employee.revision,
                          password,
                        }),
                  "Employee login linked.",
                );
              }}
            />
          )}
          {modal?.kind === "enroll" && (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-text-secondary">
                The employee must be at the office attendance device. Starting enrollment sends a
                registration request to that device. The employee registers their face there; Hardik
                does not need a webcam.
              </p>
              <p className="text-sm">
                Device enrollment ID:{" "}
                <strong className="font-mono">{modal.employee.enroll_id}</strong>
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const { attendanceFunction } = await import("@/lib/device-attendance");
                    const result = await attendanceFunction<{
                      status: string;
                      publishing: { configured: boolean; sent: number };
                    }>("hr-employee-account", {
                      action: "enroll",
                      employee_id: modal.employee.id,
                      revision: modal.employee.revision,
                    });
                    if (result.status !== "enrolled" && !result.publishing.configured)
                      toast(
                        "Enrollment saved. Device connection is unavailable; the request remains pending.",
                      );
                    else if (result.status !== "enrolled")
                      toast(
                        "Complete face registration at the office device. Refresh to check confirmation.",
                      );
                  }, "Enrollment status updated.")
                }
              >
                <ScanFace size={16} />
                {busy ? "Sending…" : "Start enrollment at office device"}
              </Button>
            </div>
          )}
          {modal?.kind === "delete" && (
            <DeleteEmployeeForm
              employee={modal.employee}
              busy={busy}
              onCancel={() => setModal(null)}
              onDelete={async (reason) => {
                if (busy) return;
                const e = modal.employee;
                setBusy(true);
                try {
                  const deletion = await hrRpc<string>("hr_delete_employee", {
                    _employee: e.directory_source ? null : e.id,
                    _revision: e.directory_source ? null : e.revision,
                    _source_auth: e.directory_source?.auth_user_id || null,
                    _source_attendance: e.directory_source?.attendance_employee_id || null,
                    _reason: reason || null,
                  });
                  setModal(null);
                  setSelected(null);
                  await reload();
                  toast.success(e.name + " deleted from HR.", {
                    duration: 10000,
                    action: {
                      label: "Undo",
                      onClick: () => {
                        void act(
                          () => hrRpc("hr_restore_employee", { _deletion: deletion }),
                          "Employee restored.",
                          false,
                        );
                      },
                    },
                  });
                } catch (failure) {
                  toast.error(
                    failure instanceof Error ? failure.message : "Could not delete employee",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
          {modal?.kind === "left" && (
            <LeavingForm
              employee={modal.employee}
              busy={busy}
              onSave={async (reason) => {
                await act(
                  () =>
                    hrRpc("hr_mark_left", {
                      _employee: modal.employee.id,
                      _revision: modal.employee.revision,
                      _reason: reason,
                    }),
                  "Employee marked as left. History preserved.",
                );
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountForm({
  employee,
  busy,
  onSubmit,
}: {
  employee: HrEmployee;
  busy: boolean;
  onSubmit: (mode: string, password: string) => Promise<void>;
}) {
  const [mode, setMode] = useState("link");
  const [password, setPassword] = useState("");
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(mode, password);
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <HrField label="Login email">
          <Input className={hrFieldClass} value={employee.email} readOnly />
        </HrField>
        <HrField label="Account action">
          <Select
            className={hrFieldClass}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setPassword("");
            }}
          >
            <option value="link">Link and activate existing login</option>
            {employee.app_access !== "manager" && (
              <option value="create">Create a new login</option>
            )}
          </Select>
        </HrField>
        {mode === "create" && (
          <HrField label="Initial login password">
            <Input
              className={hrFieldClass}
              required
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </HrField>
        )}
        <p className="text-sm leading-6 text-text-secondary">
          {mode === "link"
            ? "Links the verified account matching this email and activates its profile. Its existing password and workspace permissions are preserved."
            : "Creates and activates the employee's login. Share the initial password with the employee separately."}{" "}
          {employee.attendance_method === "office_device"
            ? "Face registration starts only when you select Enroll on device."
            : "The field associate can mark online from their field workspace."}
        </p>
        <Button type="submit" className="w-full">
          <Link2 size={16} />
          {busy ? "Saving…" : mode === "link" ? "Link existing login" : "Create employee login"}
        </Button>
      </fieldset>
    </form>
  );
}
function LeavingForm({
  employee,
  busy,
  onSave,
}: {
  employee: HrEmployee;
  busy: boolean;
  onSave: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(reason);
      }}
    >
      <p className="text-sm leading-6 text-text-secondary">
        This marks {employee.name} as left and deactivates their linked app profile and office
        attendance. Their HR record, salary revisions, attendance history and offer letters remain
        available.
      </p>
      <HrField label="Leaving reason">
        <Textarea
          required
          disabled={busy}
          maxLength={2000}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </HrField>
      <Button type="submit" variant="danger" disabled={busy}>
        {busy ? "Saving…" : "Mark as left & deactivate profile"}
      </Button>
    </form>
  );
}

function DeleteEmployeeForm({
  employee,
  busy,
  onDelete,
  onCancel,
}: {
  employee: HrEmployee;
  busy: boolean;
  onDelete: (reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void onDelete(reason);
      }}
    >
      <div className="rounded-xl border border-coral/20 bg-coral/5 p-4">
        <p className="text-sm font-semibold">{employee.name}</p>
        <p className="mt-1 break-all text-xs text-text-secondary">{employee.email}</p>
      </div>
      <p className="text-sm leading-6 text-text-secondary">
        This removes the employee from the HR directory. Their login, attendance, salary revisions
        and saved offer letters are preserved. You can undo immediately after deleting.
      </p>
      <HrField label="Reason (optional)">
        <Textarea
          disabled={busy}
          maxLength={2000}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </HrField>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" disabled={busy}>
          <Trash2 size={15} />
          {busy ? "Deleting…" : "Delete employee"}
        </Button>
      </div>
    </form>
  );
}
