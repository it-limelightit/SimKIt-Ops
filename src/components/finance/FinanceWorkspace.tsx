import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Plus,
  RefreshCw,
  Receipt,
  FileText,
  Paperclip,
  AlertCircle,
  Search,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui-kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-store";
import { indiaDate, money } from "@/lib/field-operations";
import {
  canReapply,
  categories,
  expenseFileRequest,
  expenseReapplication,
  financeRpc,
  dateTime,
  readable,
  canManageFinance,
  settlementDates,
  validateExpenseFile,
  type ExpenseClaim,
  type ExpenseFile,
  type FinanceBoard,
  type FinanceEmployee,
  type FinancePerson,
  type FinanceRole,
} from "@/lib/finance";
import { SalaryPanel, FieldFinancePanel } from "./SalaryPanel";
import { ManagerExpenseReview } from "./ManagerExpenseReview";
import { downloadFinanceBackup, downloadStatement } from "./finance-export";
import {
  Pill,
  Metric,
  Field,
  RecordDetails,
  ReapplicationNotice,
  type Confirmation,
  type Confirm,
} from "./FinanceUi";
import "./finance.css";

export function FinanceWorkspace({
  personal = false,
  embedded = false,
}: {
  personal?: boolean;
  embedded?: boolean;
}) {
  const { userId, email, role } = useAuth();
  const [month, setMonth] = useState(indiaDate().slice(0, 7));
  const [board, setBoard] = useState<FinanceBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<"office" | "field" | "requests">("requests");
  const [person, setPerson] = useState<{ user: FinancePerson; employee?: FinanceEmployee } | null>(
    null,
  );
  const [editor, setEditor] = useState<ExpenseClaim | "new" | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peopleFilter, setPeopleFilter] = useState("all");
  const [requestView, setRequestView] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const ticket = ++generation.current;
    try {
      const next = await financeRpc<FinanceBoard>("finance_board", { _month: `${month}-01` });
      if (ticket !== generation.current || useAuth.getState().userId !== userId) return;
      setBoard(next);
      setError(null);
    } catch (failure) {
      if (ticket === generation.current)
        setError(
          failure instanceof Error ? failure.message : "Could not load salary and expenses.",
        );
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [month, userId]);
  useEffect(() => {
    const requests = generation;
    setBoard(null);
    setLoading(true);
    setError(null);
    setPerson(null);
    setEditor(null);
    setConfirmation(null);
    void reload();
    return () => {
      ++requests.current;
    };
  }, [reload]);
  useEffect(() => {
    const refresh = () => void reload();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [reload]);
  const confirm: Confirm = (value) => {
    setReason("");
    setConfirmation(value);
  };
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  const reviewer = personal ? null : (board?.role ?? null);
  const expenseFocus = !personal && section === "requests" && !person;
  const claims = (board?.claims ?? []).filter((c) =>
    personal ? c.owner_id === userId : !person || c.owner_id === person.user.id,
  );
  const due = settlementDates(month);
  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  const shortDate = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const moveMonth = (offset: number) => {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    const next = date.toISOString().slice(0, 7);
    if (next >= "2000-01" && next <= "2100-12") setMonth(next);
  };
  const scopeClaims = (board?.claims ?? []).filter((c) => !personal || c.owner_id === userId);
  const overview = scopeClaims.filter((c) => c.status === "approved");
  const approvedSalary = (board?.salaries ?? []).filter((s) => s.status === "approved");
  const approvedTotal =
    overview.reduce((s, c) => s + Number(c.amount), 0) +
    (!personal ? approvedSalary.reduce((s, c) => s + Number(c.amount), 0) : 0);
  const paidTotal =
    overview.filter((c) => c.paid_at).reduce((s, c) => s + Number(c.amount), 0) +
    (!personal
      ? approvedSalary.filter((c) => c.paid_at).reduce((s, c) => s + Number(c.amount), 0)
      : 0);
  const pending = scopeClaims.filter((c) => c.status.endsWith("pending")).length;
  const rejectedClaims = scopeClaims.filter((c) => c.status === "rejected");
  const needsReview = scopeClaims.filter(
    (c) => c.status === (board?.role === "tarun" ? "tarun_pending" : "hardik_pending"),
  );
  const verifiedCount = scopeClaims.filter((c) => c.status === "tarun_pending").length;
  const reviewAmount = needsReview.reduce((total, claim) => total + Number(claim.amount), 0);
  const openReview = () => {
    setPerson(null);
    setSection("requests");
    setRequestView(board?.role === "tarun" ? "tarun_pending" : "hardik_pending");
  };
  const officePeople: { employee?: FinanceEmployee; user: FinancePerson }[] = (
    board?.employees ?? []
  ).map((employee) => ({
    employee,
    user: {
      id: employee.auth_user_id ?? `employee:${employee.id}`,
      name: employee.name,
      email: employee.email,
      field: false,
    },
  }));
  const linked = new Set(officePeople.map((p) => p.user.id));
  officePeople.push(
    ...(board?.people ?? []).filter((p) => !p.field && !linked.has(p.id)).map((user) => ({ user })),
  );
  const people =
    section === "office"
      ? officePeople
      : (board?.people ?? []).filter((p) => p.field).map((user) => ({ user, employee: undefined }));
  const visiblePeople = people.filter(
    (p) =>
      `${p.user.name} ${p.user.email ?? ""}`.toLowerCase().includes(peopleQuery.toLowerCase()) &&
      (peopleFilter === "all" ||
        board?.claims.some(
          (c) =>
            c.owner_id === p.user.id &&
            (peopleFilter === "review"
              ? c.status === (board.role === "tarun" ? "tarun_pending" : "hardik_pending")
              : c.status === "approved" && !c.paid_at),
        )),
  );

  return (
    <div
      className={`finance-workspace finance-manager ${expenseFocus ? "finance-expense-focus" : ""} ${personal ? "finance-personal" : ""} ${embedded ? "finance-embedded" : ""}`}
    >
      <div className="finance-toolbar finance-page-header">
        <div>
          {
            <div className="finance-eyebrow">
              {personal ? <Receipt size={13} /> : <ShieldCheck size={13} />}{" "}
              {personal ? "Reimbursements" : "Finance workspace"} <span>/</span> {monthLabel}
            </div>
          }
          <h1>{personal ? "My expenses" : "Salary / Expense"}</h1>
          <p className="finance-muted mt-1">
            {personal
              ? "Submit receipts, follow approvals and track reimbursement."
              : "Monthly salaries, field incentives and expense approvals."}
          </p>
        </div>
        <div className="finance-header-actions flex flex-wrap items-center gap-2">
          {personal && !embedded && (
            <Link
              to={
                role === "employee"
                  ? "/employee"
                  : role === "supervisor"
                    ? "/manager"
                    : "/business-consultant"
              }
              className="finance-back-link finance-muted inline-flex items-center gap-1"
            >
              <ArrowLeft size={14} /> Back to workspace
            </Link>
          )}
          <div className="finance-month-picker">
            {
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => moveMonth(-1)}
                disabled={busy || month === "2000-01"}
              >
                <ChevronLeft size={17} />
              </button>
            }
            <Field label="Settlement month">
              <input
                className="finance-input"
                aria-label="Settlement month"
                type="month"
                min="2000-01"
                max="2100-12"
                value={month}
                onChange={(e) => {
                  if (e.target.value) setMonth(e.target.value);
                }}
              />
            </Field>
            {
              <button
                type="button"
                aria-label="Next month"
                onClick={() => moveMonth(1)}
                disabled={busy || month === "2100-12"}
              >
                <ChevronRight size={17} />
              </button>
            }
          </div>
          <Button
            variant="ghost"
            disabled={loading || busy || refreshing}
            aria-label="Refresh"
            onClick={() => {
              setRefreshing(true);
              void reload().finally(() => setRefreshing(false));
            }}
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          </Button>
          {personal && !canManageFinance(email) && (
            <Button disabled={busy} onClick={() => setEditor("new")}>
              <Plus size={16} /> Add Expense
            </Button>
          )}
          {!personal && board?.role && (
            <Button
              variant="secondary"
              disabled={busy || loading || !!error}
              onClick={() =>
                void run(async () => {
                  await downloadFinanceBackup(board, month);
                  toast.success("Monthly backup downloaded");
                })
              }
            >
              <Download size={16} /> {busy ? "Preparing download…" : "Download monthly ZIP"}
            </Button>
          )}
        </div>
      </div>
      {!expenseFocus && (
        <div className="finance-cycle-bar">
          <div>
            <span className="finance-cycle-icon">
              <CalendarDays size={19} />
            </span>
            <div>
              <strong>{monthLabel}</strong>
              <span>{personal ? "Your reimbursement cycle" : "Salary & reimbursement cycle"}</span>
            </div>
          </div>
          <div>
            <span>Reapply by</span>
            <strong>{shortDate(due.deadline)}</strong>
          </div>
          <div>
            <span>Payment due</span>
            <strong>{shortDate(due.due)}</strong>
          </div>
          <span className="finance-cycle-note">
            <Clock3 size={14} />{" "}
            {personal ? "New claims follow submission month" : "Incentives: 16th–15th"}
          </span>
        </div>
      )}
      {personal && canManageFinance(email) && (
        <p className="finance-notice">
          Your personal expense approval flow is deferred. You can review other users' expenses in
          Salary / Expense.
        </p>
      )}
      {loading ? (
        <div role="status" className="finance-loading">
          <div className="finance-metrics">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="finance-skeleton" />
            ))}
          </div>
          <p className="finance-muted">Loading monthly records…</p>
        </div>
      ) : error ? (
        <div role="alert" className="finance-error">
          <Receipt size={24} />
          <h2>Monthly records are unavailable</h2>
          <p>{error}</p>
          <Button variant="ghost" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : (
        board && (
          <>
            {!personal && !board.role ? (
              <p role="alert">This workspace is available to Hardik and Tarun.</p>
            ) : (
              <>
                {!expenseFocus && (
                  <div className="finance-metrics finance-overview-metrics">
                    <Metric
                      label={personal ? "Approved expenses" : "Approved salary + expenses"}
                      value={money(approvedTotal)}
                      icon={<Wallet size={17} />}
                      detail="Final approvals only"
                    />
                    <Metric
                      label="Paid"
                      value={money(paidTotal)}
                      icon={<CheckCircle2 size={17} />}
                      detail="Recorded payments"
                    />
                    <Metric
                      label="Remaining payable"
                      value={money(approvedTotal - paidTotal)}
                      icon={<Clock3 size={17} />}
                      detail="Approved balance to clear"
                    />
                    <Metric
                      label="Expenses awaiting review"
                      value={pending}
                      icon={<Receipt size={17} />}
                      detail={
                        personal
                          ? "With Hardik or Tarun"
                          : `${needsReview.length} awaiting your decision`
                      }
                    />
                  </div>
                )}
                {personal && (
                  <>
                    <div className="finance-personal-guide">
                      <div>
                        <span className="finance-step-number">1</span>
                        <div>
                          <strong>Submit your expense</strong>
                          <p>Add the amount and supporting receipts.</p>
                        </div>
                      </div>
                      <ChevronRight size={15} />
                      <div>
                        <span className="finance-step-number">2</span>
                        <div>
                          <strong>Follow both approvals</strong>
                          <p>Hardik verifies, then Tarun approves.</p>
                        </div>
                      </div>
                      <ChevronRight size={15} />
                      <div>
                        <span className="finance-step-number">3</span>
                        <div>
                          <strong>Track reimbursement</strong>
                          <p>See the paid amount and remaining balance.</p>
                        </div>
                      </div>
                    </div>
                    {rejectedClaims.length > 0 && (
                      <div className="finance-action-required">
                        <AlertCircle size={19} />
                        <div>
                          <strong>
                            {rejectedClaims.length}{" "}
                            {rejectedClaims.length === 1 ? "expense needs" : "expenses need"} your
                            attention
                          </strong>
                          <p>
                            Read the rejection reason, update the details and reapply before the
                            deadline.
                          </p>
                          {rejectedClaims.map((claim) => (
                            <div key={claim.id} className="finance-rejected-item">
                              <div>
                                <strong>
                                  {claim.title} · {money(Number(claim.amount))}
                                </strong>
                                <p>
                                  {claim.tarun_reason ||
                                    claim.hardik_reason ||
                                    "Open the expense history for the review decision."}
                                </p>
                                <small>
                                  {canReapply(claim, board.today)
                                    ? `Reapply by ${shortDate(settlementDates(claim.settlement_month).deadline)}`
                                    : "Reapplication deadline has passed"}
                                </small>
                              </div>
                              {canReapply(claim, board.today) && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setEditor(claim)}
                                >
                                  Edit & Reapply
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {!personal && !expenseFocus && (
                  <div className="finance-review-banner">
                    <span className="finance-review-icon">
                      <ShieldCheck size={21} />
                    </span>
                    <div>
                      <strong>
                        {needsReview.length
                          ? `${needsReview.length} expense ${needsReview.length === 1 ? "claim needs" : "claims need"} your review`
                          : "Your expense review queue is clear"}
                      </strong>
                      <p>
                        {needsReview.length
                          ? board.role === "tarun"
                            ? `${money(reviewAmount)} to review · Check verified receipts and record your decision.`
                            : `${money(reviewAmount)} to verify · Verify first, then send selected expenses to Tarun.`
                          : `${scopeClaims.filter((c) => c.status === "hardik_verified").length} ready to send · ${verifiedCount} awaiting final approval.`}
                      </p>
                    </div>
                    <Button variant="secondary" onClick={openReview}>
                      Review expenses <ArrowUpRight size={15} />
                    </Button>
                  </div>
                )}
                {!personal && !person && (
                  <>
                    <div
                      className="finance-section-tabs"
                      role="group"
                      aria-label="Salary and expense sections"
                    >
                      {(
                        [
                          ["requests", "All expense requests"],
                          ["office", "Office staff"],
                          ["field", "Field associates"],
                        ] as const
                      ).map(([key, label]) => (
                        <Button
                          key={key}
                          aria-label={label}
                          aria-pressed={section === key}
                          variant={section === key ? "primary" : "secondary"}
                          onClick={() => {
                            setSection(key);
                            setRequestView("all");
                            setPeopleQuery("");
                            setPeopleFilter("all");
                          }}
                        >
                          {key === "requests" ? <Receipt size={16} /> : <Users size={16} />}{" "}
                          {key === "requests" ? "Expenses" : label}
                          <span className="finance-tab-count">
                            {key === "office"
                              ? officePeople.length
                              : key === "field"
                                ? board.people.filter((p) => p.field).length
                                : board.claims.filter((c) => c.status !== "cancelled").length}
                          </span>
                        </Button>
                      ))}
                    </div>
                    {section !== "requests" && (
                      <section className="finance-directory">
                        <div className="finance-directory-header">
                          <div>
                            <h2>{section === "office" ? "Office staff" : "Field associates"}</h2>
                            <p className="finance-muted">
                              {section === "office"
                                ? "Review attendance, calculate salary and verify expenses."
                                : "Review work incentives, availability and expenses."}
                            </p>
                          </div>
                          <div className="finance-directory-filters">
                            <div className="finance-search">
                              <Search size={16} />
                              <input
                                aria-label="Search people"
                                placeholder="Search by name or email"
                                value={peopleQuery}
                                onChange={(event) => setPeopleQuery(event.target.value)}
                              />
                            </div>
                            <select
                              className="finance-input"
                              aria-label="Filter people"
                              value={peopleFilter}
                              onChange={(event) => setPeopleFilter(event.target.value)}
                            >
                              <option value="all">Everyone</option>
                              <option value="review">Needs expense review</option>
                              <option value="unpaid">Unpaid expenses</option>
                            </select>
                          </div>
                        </div>
                        <div className="finance-people">
                          {visiblePeople.map((p) => {
                            const personClaims = board.claims.filter(
                              (c) => c.owner_id === p.user.id && c.status !== "cancelled",
                            );
                            const toReview = personClaims.filter(
                              (c) =>
                                c.status ===
                                (board.role === "tarun" ? "tarun_pending" : "hardik_pending"),
                            ).length;
                            const balance = personClaims
                              .filter((c) => c.status === "approved" && !c.paid_at)
                              .reduce((total, c) => total + Number(c.amount), 0);
                            const salary = board.salaries.find(
                              (s) => s.employee_id === p.employee?.id,
                            );
                            return (
                              <button
                                key={p.user.id}
                                className="finance-person"
                                aria-label={`${p.user.name || p.user.email} ${p.user.email ?? ""} — Open details`}
                                onClick={() => setPerson(p)}
                              >
                                <div className="finance-person-top">
                                  <span className="finance-avatar">
                                    {(p.user.name || p.user.email || "U")
                                      .split(/\s+/)
                                      .filter(Boolean)
                                      .slice(0, 2)
                                      .map((part) => part[0])
                                      .join("")
                                      .toUpperCase()}
                                  </span>
                                  <span
                                    className={`finance-person-state ${toReview ? "needs-review" : ""}`}
                                  >
                                    {toReview
                                      ? `${toReview} to review`
                                      : p.employee
                                        ? salary
                                          ? readable(salary.status)
                                          : "Salary not set"
                                        : "Expense records"}
                                  </span>
                                  <ArrowUpRight size={16} className="finance-person-arrow" />
                                </div>
                                <strong className="finance-person-name">
                                  {p.user.name || p.user.email}
                                </strong>
                                <p className="finance-person-email">
                                  {p.user.email || "No email linked"}
                                </p>
                                <div className="finance-person-totals">
                                  <div>
                                    <span>
                                      {section === "office"
                                        ? "Calculated salary"
                                        : "Incentive cycle"}
                                    </span>
                                    <strong>
                                      {section === "office"
                                        ? salary
                                          ? money(Number(salary.amount))
                                          : "Not set"
                                        : "16th – 15th"}
                                    </strong>
                                  </div>
                                  <div>
                                    <span>Unpaid expenses</span>
                                    <strong>{money(balance)}</strong>
                                  </div>
                                </div>
                                <div className="finance-person-footer">
                                  <span>
                                    {personClaims.length} expense{" "}
                                    {personClaims.length === 1 ? "claim" : "claims"}
                                  </span>
                                  <span>
                                    Open details <ChevronRight size={13} />
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                          {visiblePeople.length === 0 && (
                            <div className="finance-empty">
                              <Users size={25} />
                              <strong>
                                {peopleQuery || peopleFilter !== "all"
                                  ? "No matching people"
                                  : "No people in this section yet"}
                              </strong>
                              <p>Try another name or change the filter.</p>
                              {(peopleQuery || peopleFilter !== "all") && (
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    setPeopleQuery("");
                                    setPeopleFilter("all");
                                  }}
                                >
                                  Clear filters
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </section>
                    )}
                  </>
                )}
                {person && (
                  <>
                    <div className="finance-toolbar finance-person-heading">
                      <Button variant="ghost" onClick={() => setPerson(null)}>
                        <ArrowLeft size={15} /> All{" "}
                        {section === "field" ? "field associates" : "staff"}
                      </Button>
                      <div>
                        <h2>{person.user.name}</h2>
                        <p className="finance-muted">{person.user.email}</p>
                      </div>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () =>
                            downloadStatement(board, month, person.user, person.employee),
                          )
                        }
                      >
                        <Download size={15} /> Statement PDF
                      </Button>
                    </div>
                    {person.employee ? (
                      <SalaryPanel
                        key={`${person.employee.id}:${month}:${board.salaries.find((s) => s.employee_id === person.employee?.id)?.revision ?? 0}`}
                        employee={person.employee}
                        month={month}
                        salary={board.salaries.find((s) => s.employee_id === person.employee?.id)}
                        role={board.role}
                        reload={reload}
                        confirm={confirm}
                        events={board.events}
                      />
                    ) : person.user.field ? (
                      <FieldFinancePanel
                        key={`${person.user.id}:${month}`}
                        person={person.user}
                        month={month}
                        role={board.role}
                        confirm={confirm}
                        reload={reload}
                        events={board.events}
                      />
                    ) : (
                      <p className="finance-notice">
                        Attendance account is not linked for this person. Expense review is
                        available below.
                      </p>
                    )}
                  </>
                )}
                {(personal || person || section === "requests") &&
                  (reviewer ? (
                    <ManagerExpenseReview
                      key={`${month}:${person?.user.id ?? "all"}`}
                      role={reviewer}
                      events={board.events}
                      claims={claims}
                      files={board.files}
                      busy={busy}
                      confirm={confirm}
                      reload={reload}
                      today={board.today}
                    />
                  ) : (
                    <ExpenseTable
                      key={`${month}:${person?.user.id ?? "all"}:${requestView}`}
                      initialStatus={requestView}
                      claims={claims}
                      files={board.files}
                      board={board}
                      role={reviewer}
                      today={board.today}
                      busy={busy}
                      confirm={confirm}
                      reload={reload}
                      onEdit={setEditor}
                      personal={personal}
                    />
                  ))}
              </>
            )}
          </>
        )
      )}
      {editor && board && (
        <ExpenseEditor
          claim={editor === "new" ? null : editor}
          files={board.files}
          today={board.today}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await reload();
          }}
        />
      )}
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmation?.title}</DialogTitle>
            <DialogDescription>{confirmation?.detail}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!confirmation) return;
              void run(async () => {
                await confirmation.execute(reason);
                setConfirmation(null);
                toast.success(confirmation.successMessage || "Saved");
              });
            }}
            className="space-y-4"
          >
            {confirmation?.requireReason && (
              <Field label={confirmation.reasonLabel || "Reason"}>
                <textarea
                  autoFocus
                  className="finance-input"
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </Button>
              <Button disabled={busy}>{busy ? "Saving…" : "Confirm"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExpenseTable({
  claims,
  files,
  board,
  role,
  today,
  busy,
  confirm,
  reload,
  onEdit,
  personal,
  initialStatus = "all",
}: {
  claims: ExpenseClaim[];
  files: ExpenseFile[];
  board: FinanceBoard;
  role: FinanceRole;
  today: string;
  busy: boolean;
  confirm: Confirm;
  reload: () => Promise<void>;
  onEdit: (claim: ExpenseClaim) => void;
  personal: boolean;
  initialStatus?: string;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<ExpenseClaim | null>(null);
  const [sort, setSort] = useState("newest");
  const visible = claims
    .filter(
      (c) =>
        (status === "all" ||
          (status === "paid"
            ? !!c.paid_at
            : status === "unpaid"
              ? c.status === "approved" && !c.paid_at
              : c.status === status)) &&
        `${c.title} ${c.owner_name} ${c.description} ${categories[c.category]}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "amount"
        ? Number(b.amount) - Number(a.amount)
        : sort === "expense_date"
          ? b.expense_date.localeCompare(a.expense_date)
          : b.created_at.localeCompare(a.created_at),
    );
  const reviewable = (c: ExpenseClaim) =>
    role === "hardik"
      ? ["hardik_pending", "hardik_verified"].includes(c.status)
      : role === "tarun"
        ? c.status === "tarun_pending"
        : false;
  useEffect(() => setSelected({}), [board.claims]);
  const action = (claim: ExpenseClaim, action: string) =>
    confirm({
      successMessage:
        action === "approve" && role === "hardik"
          ? "Expense verified. Send it to Tarun when your review is complete."
          : undefined,
      title:
        action === "approve"
          ? role === "hardik"
            ? "Verify expense?"
            : "Approve expense?"
          : action === "reject"
            ? "Reject expense?"
            : action === "pay"
              ? "Record completed payment?"
              : "Delete expense?",
      detail: `${claim.title} · ${claim.owner_name} · ${money(Number(claim.amount))}${action === "cancel" ? ". The claim will be cancelled; its history is retained." : ""}`,
      requireReason: ["reject", "pay"].includes(action),
      reasonLabel: action === "pay" ? "Payment reference / method" : "Rejection reason",
      execute: async (reason) => {
        await financeRpc("expense_action", {
          _id: claim.id,
          _revision: claim.revision,
          _action: action,
          _reason: reason || null,
        });
        await reload();
      },
    });
  const bulk = (action: "approve" | "forward" = "approve") => {
    const rows = claims.filter(
      (c) =>
        selected[c.id] === c.revision &&
        c.status ===
          (action === "forward"
            ? "hardik_verified"
            : role === "hardik"
              ? "hardik_pending"
              : "tarun_pending"),
    );
    if (!rows.length) return;
    confirm({
      successMessage:
        role === "hardik"
          ? action === "forward"
            ? "Selected expenses sent to Tarun"
            : "Selected expenses verified. Ready to send."
          : "Selected expenses approved",
      title:
        role === "hardik"
          ? action === "forward"
            ? "Send verified expenses to Tarun?"
            : "Verify selected expenses?"
          : "Approve selected expenses?",
      detail: `${rows.length} claims · ${money(rows.reduce((s, c) => s + Number(c.amount), 0))}`,
      execute: async () => {
        await financeRpc("expense_batch_action", {
          _claims: rows.map((c) => ({ id: c.id, revision: c.revision })),
          _action: action,
        });
        setSelected({});
        await reload();
      },
    });
  };
  return (
    <section className="finance-expenses-section mt-6">
      <div className="finance-toolbar finance-expenses-heading">
        <div>
          <h2>
            {personal ? "Your expense records" : "Expenses"}{" "}
            <span className="finance-result-count">
              {claims.filter((c) => c.status !== "cancelled").length}
            </span>
          </h2>
          <p className="finance-muted mt-1">
            {personal
              ? "Every claim, review decision and payment in one place."
              : role === "tarun"
                ? "Review Hardik's verified claims and record the final decision."
                : "Review receipts, verify expenses, then send your selection to Tarun."}
          </p>
        </div>
        <div className="finance-expense-controls">
          <label className="finance-expense-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search expenses"
              placeholder="Search expenses or people…"
              className="finance-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Expense status"
            className="finance-input !w-auto"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            {[
              "hardik_pending",
              "hardik_verified",
              "tarun_pending",
              "approved",
              "rejected",
              "cancelled",
            ].map((s) => (
              <option key={s} value={s}>
                {s === "hardik_verified" ? "Ready to send" : readable(s)}
              </option>
            ))}
            <option value="unpaid">Approved · unpaid</option>
            <option value="paid">Paid</option>
          </select>
          <select
            aria-label="Sort expenses"
            className="finance-input !w-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="expense_date">Expense date</option>
            <option value="amount">Highest amount</option>
          </select>
          {role && (
            <>
              <Button
                disabled={
                  busy ||
                  !claims.some(
                    (c) =>
                      selected[c.id] === c.revision &&
                      c.status === (role === "hardik" ? "hardik_pending" : "tarun_pending"),
                  )
                }
                onClick={() => bulk("approve")}
              >
                {role === "hardik" ? "Verify selected" : "Approve selected"}
              </Button>
              {role === "hardik" && (
                <Button
                  disabled={
                    busy ||
                    !claims.some(
                      (c) => selected[c.id] === c.revision && c.status === "hardik_verified",
                    )
                  }
                  onClick={() => bulk("forward")}
                >
                  Send to Tarun (
                  {
                    claims.filter(
                      (c) => selected[c.id] === c.revision && c.status === "hardik_verified",
                    ).length
                  }
                  )
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="finance-table-meta">
        <div className="finance-quick-filters" role="group" aria-label="Quick expense filters">
          {(role === "hardik"
            ? [
                ["hardik_pending", "To verify"],
                ["hardik_verified", "Ready to send"],
                ["tarun_pending", "Sent to Tarun"],
                ["all", "All expenses"],
              ]
            : [
                ["all", "All claims"],
                [role === "tarun" ? "tarun_pending" : "hardik_pending", "Needs your review"],
                ["hardik_verified", "Ready to send"],
                ["approved", "Approved"],
                ["rejected", "Rejected"],
                ["unpaid", "Unpaid"],
                ["paid", "Paid"],
              ]
          )
            .filter(([, label]) => role || label !== "Needs your review")
            .map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={status === key}
                onClick={() => setStatus(key)}
              >
                {label}
                <span>
                  {
                    claims.filter(
                      (c) =>
                        key === "all" ||
                        (key === "paid"
                          ? !!c.paid_at
                          : key === "unpaid"
                            ? c.status === "approved" && !c.paid_at
                            : c.status === key),
                    ).length
                  }
                </span>
              </button>
            ))}
        </div>
        <span className="finance-muted">{visible.length} expenses</span>
      </div>
      {Object.keys(selected).length > 0 && (
        <div className="finance-selection">
          <CheckCircle2 size={16} />
          <strong>{Object.keys(selected).length} selected</strong>
          <span>
            {money(
              claims
                .filter((c) => selected[c.id] === c.revision)
                .reduce((sum, c) => sum + Number(c.amount), 0),
            )}
          </span>
          <span className="finance-selection-help">
            {role === "hardik"
              ? "Only verified expenses will be sent."
              : "Ready for final approval."}
          </span>
          <button className="finance-clear-selection" type="button" onClick={() => setSelected({})}>
            Clear selection
          </button>
        </div>
      )}
      <div className="finance-table-scroll" tabIndex={0} aria-label="Scrollable expense records">
        <table
          className={`finance-table finance-expense-table ${role === "hardik" ? "finance-verification-table" : ""}`}
        >
          <caption className="sr-only">
            Expense records with receipts, approval decisions and payment status
          </caption>
          <colgroup>
            <col style={{ width: 72 }} />
            {role && <col style={{ width: 64 }} />}
            {!personal && <col style={{ width: 190 }} />}
            <col style={{ width: 200 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 210 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 165 }} />
            <col style={{ width: 165 }} />
            <col style={{ width: 165 }} />
            <col style={{ width: 190 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Sr. no.</th>
              {role && (
                <th className="finance-check-cell">
                  <input
                    type="checkbox"
                    aria-label="Select all visible expenses"
                    disabled={busy || !visible.some(reviewable)}
                    checked={
                      visible.some(reviewable) &&
                      visible.filter(reviewable).every((c) => selected[c.id] === c.revision)
                    }
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelected((current) => {
                        const next = { ...current };
                        visible.filter(reviewable).forEach((c) => {
                          if (checked) next[c.id] = c.revision;
                          else delete next[c.id];
                        });
                        return next;
                      });
                    }}
                  />
                </th>
              )}
              {!personal && <th>Person</th>}
              <th>Expense / category</th>
              <th>Expense date</th>
              <th className="finance-amount-cell">Amount</th>
              <th>Evidence</th>
              <th>Description</th>
              <th>Hardik review</th>
              <th>Tarun review</th>
              <th>Payment</th>
              <th className="finance-actions-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c, index) => {
              const reapplied = expenseReapplication(c.id, board.events, role);
              return (
                <tr
                  key={c.id}
                  data-selected={selected[c.id] === c.revision}
                  data-reapplied={!!reapplied}
                >
                  <td>
                    <span className="finance-row-number" title={`Claim ${c.id}`}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {reapplied && <small className="text-warning font-semibold">Reapplied</small>}
                    <small>Rev. {c.revision}</small>
                  </td>
                  {role && (
                    <td className="finance-check-cell">
                      <input
                        aria-label={`Verify ${c.title}`}
                        title={
                          reviewable(c)
                            ? "Select this expense for review"
                            : role === "hardik"
                              ? "Select pending or verified expenses"
                              : "Only claims forwarded by Hardik can be selected"
                        }
                        type="checkbox"
                        disabled={busy || !reviewable(c)}
                        checked={selected[c.id] === c.revision}
                        onChange={(e) =>
                          setSelected((current) => {
                            const next = { ...current };
                            if (e.target.checked) next[c.id] = c.revision;
                            else delete next[c.id];
                            return next;
                          })
                        }
                      />
                    </td>
                  )}
                  {!personal && (
                    <td>
                      {c.owner_name}
                      <small>{c.owner_email}</small>
                    </td>
                  )}
                  <td className="finance-claim-cell">
                    <strong>{c.title}</strong>
                    <small>{categories[c.category]}</small>
                    {reapplied && <ReapplicationNotice info={reapplied} />}
                    <small>
                      <Pill value={c.status} />
                    </small>
                  </td>
                  <td className="whitespace-nowrap">
                    {c.expense_date}
                    <small>Submitted {dateTime(c.created_at)}</small>
                  </td>
                  <td className="finance-amount-cell whitespace-nowrap font-semibold">
                    {money(Number(c.amount))}
                  </td>
                  <td>
                    {c.attachment_ids.map((id) => {
                      const file = files.find((f) => f.id === id);
                      return file ? (
                        <button
                          key={id}
                          className="finance-attachment"
                          title={`${file.filename} · ${(file.size_bytes / 1e6).toFixed(2)} MB`}
                          onClick={() => {
                            void expenseFileRequest({ id })
                              .then((result) => {
                                if (result.url) {
                                  const a = document.createElement("a");
                                  a.href = result.url;
                                  a.target = "_blank";
                                  a.rel = "noopener";
                                  a.click();
                                }
                              })
                              .catch((e) => toast.error(e.message));
                          }}
                        >
                          <Paperclip size={13} />
                          <span>{file.filename}</span>
                          <ArrowUpRight size={12} />
                        </button>
                      ) : (
                        <small key={id}>Attachment unavailable</small>
                      );
                    })}
                    {!c.attachment_ids.length && "—"}
                  </td>
                  <td>
                    <p className="finance-description" title={c.description || undefined}>
                      {c.description || "—"}
                    </p>
                  </td>
                  <td>
                    <Pill value={c.hardik_decision || "pending"} />
                    <small>{dateTime(c.hardik_at)}</small>
                    {c.hardik_reason && (
                      <small className="finance-rejection-reason">
                        <AlertCircle size={12} />
                        {c.hardik_reason}
                      </small>
                    )}
                  </td>
                  <td>
                    <Pill
                      value={
                        c.tarun_decision ||
                        (c.status === "tarun_pending" ? "pending" : "awaiting Hardik")
                      }
                    />
                    <small>{dateTime(c.tarun_at)}</small>
                    {c.tarun_reason && (
                      <small className="finance-rejection-reason">
                        <AlertCircle size={12} />
                        {c.tarun_reason}
                      </small>
                    )}
                  </td>
                  <td>
                    <Pill
                      value={
                        c.paid_at
                          ? "paid"
                          : c.status === "approved"
                            ? "remaining"
                            : "not yet payable"
                      }
                    />
                    {c.status === "approved" && (
                      <small>{money(c.paid_at ? 0 : Number(c.amount))} remaining</small>
                    )}
                    {c.paid_at && (
                      <small>
                        {dateTime(c.paid_at)}
                        <br />
                        {c.payment_reference}
                      </small>
                    )}
                  </td>
                  <td className="finance-actions-cell">
                    <div className="finance-row-actions">
                      <Button
                        className="finance-history-action"
                        variant="ghost"
                        size="sm"
                        onClick={() => setHistory(c)}
                      >
                        History
                      </Button>
                      {personal && canReapply(c, today) && (
                        <Button size="sm" disabled={busy} onClick={() => onEdit(c)}>
                          Edit & Reapply
                        </Button>
                      )}
                      {personal && c.status === "rejected" && !canReapply(c, today) && (
                        <small>Reapply closed {settlementDates(c.settlement_month).deadline}</small>
                      )}
                      {personal && ["hardik_pending", "rejected"].includes(c.status) && (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy}
                          onClick={() => action(c, "cancel")}
                        >
                          Delete
                        </Button>
                      )}
                      {reviewable(c) && (
                        <>
                          {c.status !== "hardik_verified" && (
                            <Button
                              className="finance-approve-action"
                              variant="secondary"
                              size="sm"
                              disabled={busy}
                              onClick={() => action(c, "approve")}
                            >
                              {role === "hardik" ? "Verify" : "Approve"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() => action(c, "reject")}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {role && c.status === "approved" && !c.paid_at && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy || today < settlementDates(c.settlement_month).due}
                          onClick={() => action(c, "pay")}
                        >
                          {today < settlementDates(c.settlement_month).due
                            ? `Payable from ${settlementDates(c.settlement_month).due}`
                            : "Record payment"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr>
                <td
                  colSpan={10 + (role ? 1 : 0) + (!personal ? 1 : 0)}
                  className="text-center !p-10 finance-muted"
                >
                  <div className="finance-empty finance-table-empty">
                    <Receipt size={28} />
                    <strong>
                      {claims.length
                        ? "No matching expenses"
                        : "No expenses submitted for this month"}
                    </strong>
                    <p>
                      {claims.length
                        ? "Try a different search or status filter."
                        : personal
                          ? "Use Add Expense to submit your first claim and receipts."
                          : "New submissions will appear here for review."}
                    </p>
                    {claims.length > 0 && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setQuery("");
                          setStatus("all");
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="finance-sheet-footer">
        <span>
          <span className="finance-sheet-dot" /> {visible.length} of {claims.length} records
        </span>
        <span>
          Filtered total{" "}
          <strong>{money(visible.reduce((sum, claim) => sum + Number(claim.amount), 0))}</strong>
        </span>
      </div>
      <Dialog
        open={!!history}
        onOpenChange={(open) => {
          if (!open) setHistory(null);
        }}
      >
        <DialogContent className="finance-expense-dialog max-h-[85vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Expense history · {history?.title}</DialogTitle>
            <DialogDescription>
              Submission revisions, review decisions and payment records.
            </DialogDescription>
          </DialogHeader>
          {history && (
            <>
              <div className="finance-claim-summary">
                <span className="finance-cycle-icon">
                  <Receipt size={22} />
                </span>
                <div>
                  <span className="finance-muted">
                    {categories[history.category]} · {history.expense_date}
                  </span>
                  <strong>{money(Number(history.amount))}</strong>
                </div>
                <Pill value={history.paid_at ? "paid" : history.status} />
              </div>
              {history.description && (
                <p className="finance-history-description">{history.description}</p>
              )}
              <div className="finance-decision-track">
                {[
                  { name: "Submitted", date: history.created_at, done: true, reason: null },
                  {
                    name: "Hardik verification",
                    date: history.hardik_at,
                    done: history.hardik_decision === "approve",
                    reason: history.hardik_reason,
                  },
                  {
                    name: "Tarun approval",
                    date: history.tarun_at,
                    done: history.tarun_decision === "approve",
                    reason: history.tarun_reason,
                  },
                  { name: "Payment", date: history.paid_at, done: !!history.paid_at, reason: null },
                ].map((step, index) => (
                  <div
                    key={step.name}
                    data-state={step.reason ? "rejected" : step.done ? "complete" : "pending"}
                  >
                    <span className="finance-track-dot">
                      {step.reason ? (
                        <AlertCircle size={14} />
                      ) : step.done ? (
                        <CheckCircle2 size={14} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <div>
                      <strong>{step.name}</strong>
                      <small>{step.date ? dateTime(step.date) : "Pending"}</small>
                      {step.reason && <p className="finance-rejection-reason">{step.reason}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {history.description && (
                <div className="finance-claim-description">
                  <strong>Description</strong>
                  <p>{history.description}</p>
                </div>
              )}
              <div className="finance-claim-summary-footer">
                <span>Payment due {settlementDates(history.settlement_month).due}</span>
                <span>
                  {history.paid_at
                    ? `Reference: ${history.payment_reference || "—"}`
                    : `${money(history.status === "approved" ? Number(history.amount) : 0)} remaining payable`}
                </span>
              </div>
              <h3 className="finance-history-title">Activity & revision history</h3>
            </>
          )}
          {board.events
            .filter((e) => e.entity_id === history?.id)
            .map((event) => (
              <div key={event.id} className="finance-notice">
                <strong>{readable(event.action)}</strong>
                <p className="finance-muted">
                  {event.actor_role || "Claimant"} · {dateTime(event.occurred_at)}
                </p>
                {event.reason && <p>{event.reason}</p>}
                <RecordDetails before={event.before_data} after={event.after_data} />
              </div>
            ))}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ExpenseEditor({
  claim,
  files,
  today,
  onClose,
  onSaved,
}: {
  claim: ExpenseClaim | null;
  files: ExpenseFile[];
  today: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [date, setDate] = useState(claim?.expense_date ?? today);
  const [title, setTitle] = useState(claim?.title ?? "");
  const [category, setCategory] = useState(claim?.category ?? "travel");
  const [amount, setAmount] = useState(claim ? String(claim.amount) : "");
  const [description, setDescription] = useState(claim?.description ?? "");
  const [ids, setIds] = useState(claim?.attachment_ids ?? []);
  const [uploads, setUploads] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!Number.isFinite(Number(amount)) || Number(amount) <= 0)
        throw new Error("Enter a positive amount.");
      const attached = [...ids];
      for (const file of uploads) {
        validateExpenseFile(file);
        const form = new FormData();
        form.set("file", file);
        const result = await expenseFileRequest(form);
        if (!result.id) throw new Error("Upload did not return an attachment ID");
        attached.push(result.id);
        setIds([...attached]);
        setUploads((current) => current.filter((f) => f !== file));
      }
      await financeRpc("expense_save", {
        _id: claim?.id ?? null,
        _revision: claim?.revision ?? 0,
        _date: date,
        _title: title,
        _category: category,
        _amount: Number(amount),
        _description: description,
        _files: attached,
      });
      toast.success(claim ? "Expense reapplied and sent to Hardik" : "Expense submitted to Hardik");
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit expense");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="finance-expense-dialog finance-editor-dialog">
        <DialogHeader>
          <DialogTitle>{claim ? "Edit & Reapply" : "Add Expense"}</DialogTitle>
          <DialogDescription>
            {claim
              ? `Keeps settlement month ${claim.settlement_month.slice(0, 7)}. Both approvals restart with Hardik.`
              : `New claims submitted now belong to ${today.slice(0, 7)}, due ${settlementDates(today).due}.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="finance-editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="finance-editor-body">
            <div className="finance-form-note">
              <ShieldCheck size={16} />
              <span>
                {claim
                  ? "Your updated claim returns to Hardik for verification."
                  : "Your claim goes to Hardik first, then Tarun for final approval."}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Expense date">
                <input
                  type="date"
                  className="finance-input"
                  required
                  min="2000-01-01"
                  max={today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label="Amount (INR)">
                <input
                  type="number"
                  className="finance-input"
                  required
                  min="0.01"
                  max="9999999999"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Expense name">
              <input
                className="finance-input"
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Category">
              <select
                className="finance-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {Object.entries(categories).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description">
              <textarea
                className="finance-input"
                maxLength={4000}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="finance-upload-area">
              <div className="finance-upload-heading">
                <Paperclip size={18} />
                <div>
                  <strong>Supporting receipts</strong>
                  <p>PDF, JPG or PNG · Up to 5 files · 5 MB per file</p>
                </div>
                <span>{ids.length + uploads.length}/5</span>
              </div>
              <Field label="Choose receipt files">
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  multiple
                  disabled={busy}
                  className="finance-input"
                  onChange={(e) => {
                    try {
                      const next = Array.from(e.target.files ?? []);
                      next.forEach(validateExpenseFile);
                      if (ids.length + uploads.length + next.length > 5)
                        throw new Error("Maximum five attachments per claim");
                      setUploads((current) => [...current, ...next]);
                      setError(null);
                    } catch (f) {
                      setError(f instanceof Error ? f.message : "Invalid file");
                    }
                    e.target.value = "";
                  }}
                />
              </Field>
            </div>
            {ids.map((id) => (
              <div key={id} className="finance-uploaded-file">
                <FileText size={16} />
                <span>{files.find((f) => f.id === id)?.filename || "Uploaded attachment"}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setIds((current) => current.filter((x) => x !== id))}
                >
                  Remove
                </button>
              </div>
            ))}
            {uploads.map((file, i) => (
              <div key={i} className="finance-uploaded-file">
                <FileText size={16} />
                <span>
                  {file.name} · {(file.size / 1e6).toFixed(2)} MB
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setUploads((current) => current.filter((_, n) => n !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
            {error && (
              <p role="alert" className="text-sm text-coral">
                {error}
              </p>
            )}
          </div>
          <div className="finance-editor-footer">
            <div className="finance-form-total">
              <span>Claim amount</span>
              <strong>{money(Number(amount) || 0)}</strong>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={busy}>
                {busy
                  ? "Uploading & submitting…"
                  : claim
                    ? "Reapply to Hardik"
                    : "Submit to Hardik"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
