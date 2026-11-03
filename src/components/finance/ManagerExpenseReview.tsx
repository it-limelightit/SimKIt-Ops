import { useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, Eye, Pencil, Receipt, RotateCcw, Search, Send, Trash2, Wallet, XCircle } from "lucide-react";
import { Button } from "@/components/ui-kit";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { money } from "@/lib/field-operations";
import {
  canDeleteExpense,
  canEditExpense,
  categories,
  expenseReapplication,
  financeRpc,
  settlementDates,
  type ExpenseClaim,
  type ExpenseFile,
  type FinanceEvent,
} from "@/lib/finance";
import { AuditTrail, Pill, ReapplicationNotice, type Confirm } from "./FinanceUi";
import { ExpenseReceipt } from "./ExpenseReceipt";

export function ManagerExpenseReview({
  claims,
  files,
  busy,
  confirm,
  reload,
  today,
  role,
  events,
  onEdit,
}: {
  claims: ExpenseClaim[];
  files: ExpenseFile[];
  busy: boolean;
  confirm: Confirm;
  reload: () => Promise<void>;
  today: string;
  role: "hardik" | "tarun";
  events: FinanceEvent[];
  /** Opens the expense editor for a claim (Hardik / Tarun corrections). */
  onEdit?: (claim: ExpenseClaim) => void;
}) {
  const [owner, setOwner] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<ExpenseClaim | null>(null);
  const hardik = role === "hardik";
  const reapplications = new Map(
    claims.map((claim) => [claim.id, expenseReapplication(claim.id, events, role)]),
  );
  const sent = claims.filter((c) =>
    hardik
      ? c.status !== "cancelled"
      : !["hardik_pending", "hardik_verified", "cancelled"].includes(c.status),
  );
  const groups = [...new Set(sent.map((c) => c.owner_id))]
    .map((id) => {
      const rows = sent.filter((c) => c.owner_id === id);
      const awaiting = rows.filter(
        (c) => c.status === (hardik ? "hardik_pending" : "tarun_pending"),
      );
      const ready = rows.filter((c) => c.status === "hardik_verified");
      return {
        id,
        name: rows[0].owner_name,
        email: rows[0].owner_email,
        rows,
        awaiting,
        ready,
        reapplied: rows.filter((claim) => reapplications.get(claim.id)).length,
        total: rows.reduce((sum, c) => sum + Number(c.amount), 0),
        pendingTotal: rows
          .filter((c) => c.status.endsWith("pending") || c.status === "hardik_verified")
          .reduce((sum, c) => sum + Number(c.amount), 0),
      };
    })
    .sort((a, b) => b.awaiting.length - a.awaiting.length || a.name.localeCompare(b.name));
  const person = groups.find((g) => g.id === owner);
  const scope = person ? person.rows : sent;
  const awaitingTotal = scope
    .filter((c) => c.status.endsWith("pending") || c.status === "hardik_verified")
    .reduce((sum, c) => sum + Number(c.amount), 0);
  const decide = (
    rows: ExpenseClaim[],
    action: "approve" | "reject" | "forward",
    name?: string,
  ) => {
    if (!rows.length) return;
    confirm({
      title: `${action === "forward" ? "Send verified expenses to Tarun" : action === "approve" ? (hardik ? "Verify expenses" : "Approve expenses") : "Reject expenses"}${name ? ` for ${name}` : ""}?`,
      detail: `${rows.length} expenses · ${money(rows.reduce((sum, c) => sum + Number(c.amount), 0))}`,
      requireReason: action === "reject",
      reasonLabel: "Rejection reason",
      successMessage:
        action === "forward"
          ? "Expenses sent to Tarun"
          : action === "approve"
            ? hardik
              ? "Expenses verified. Ready to send."
              : "Expenses approved"
            : "Expenses rejected",
      execute: async (reason) => {
        await financeRpc("expense_batch_action", {
          _claims: rows.map((c) => ({ id: c.id, revision: c.revision })),
          _action: action,
          _reason: reason || null,
        });
        await reload();
      },
    });
  };
  const recordPayment = (claim: ExpenseClaim) =>
    confirm({
      title: "Record completed payment?",
      detail: `${claim.title} · ${claim.owner_name} · ${money(Number(claim.amount))}`,
      requireReason: true,
      reasonLabel: "Payment reference / method",
      execute: async (reason) => {
        await financeRpc("expense_action", {
          _id: claim.id,
          _revision: claim.revision,
          _action: "pay",
          _reason: reason,
        });
        await reload();
      },
    });
  const removeClaim = (claim: ExpenseClaim) =>
    confirm({
      title: "Delete expense?",
      detail: `${claim.title} · ${claim.owner_name} · ${money(Number(claim.amount))}. The claim will be cancelled; its history is retained.`,
      successMessage: "Expense deleted",
      execute: async () => {
        await financeRpc("expense_action", {
          _id: claim.id,
          _revision: claim.revision,
          _action: "cancel",
          _reason: null,
        });
        await reload();
      },
    });
  return (
    <section
      className={`finance-expenses-section finance-approval-panel finance-tabular-review ${hardik ? "finance-hardik-review" : ""} mt-6`}
    >
      {person && (
        <div className="finance-approval-back">
          <button onClick={() => setOwner(null)}>
            <ArrowLeft size={15} /> All people
          </button>
        </div>
      )}
      <div className={`finance-approval-header ${person ? "finance-approval-person-header" : ""}`}>
        <div>
          <h2>{person ? person.name : hardik ? "Expense verification" : "Expense approvals"}</h2>
          <p className="finance-muted mt-1">
            {person
              ? person.email
              : hardik
                ? "Verify each person's expenses, then send them to Tarun."
                : "Review each person's monthly expenses."}
          </p>
        </div>
        <div className="finance-register-totals">
          <span>
            <small>Expenses</small>
            <strong>{scope.length}</strong>
          </span>
          <span>
            <small>Total amount</small>
            <strong>{money(scope.reduce((sum, c) => sum + Number(c.amount), 0))}</strong>
          </span>
          <span>
            <small>Pending review</small>
            <strong>{money(awaitingTotal)}</strong>
          </span>
        </div>
      </div>
      {!person ? (
        <>
          <label className="finance-expense-search finance-approval-search">
            <Search size={16} />
            <input
              className="finance-input"
              aria-label="Search expense people"
              placeholder="Search people"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div
            className="finance-table-scroll"
            tabIndex={0}
            aria-label="Expense approvals by person"
          >
            <table className="finance-table finance-person-register">
              <colgroup>
                <col style={{ width: hardik ? "22%" : "24%" }} />
                <col style={{ width: hardik ? "7%" : "9%" }} />
                <col style={{ width: hardik ? "12%" : "14%" }} />
                <col style={{ width: hardik ? "12%" : "14%" }} />
                <col style={{ width: hardik ? "14%" : "13%" }} />
                <col style={{ width: hardik ? "33%" : "26%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Expenses</th>
                  <th>Total amount</th>
                  <th>Pending amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups
                  .filter((g) =>
                    (g.name + " " + g.email).toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((g) => (
                    <tr key={g.id} data-reapplied={g.reapplied > 0}>
                      <td>
                        <strong>{g.name}</strong>
                        <small>{g.email}</small>
                        {g.reapplied > 0 && (
                          <span className="finance-reapplied-badge">
                            <RotateCcw size={12} />
                            {g.reapplied} reapplied {g.reapplied === 1 ? "expense" : "expenses"}
                          </span>
                        )}
                      </td>
                      <td>{g.rows.length}</td>
                      <td className="finance-register-money">{money(g.total)}</td>
                      <td className="finance-register-money">{money(g.pendingTotal)}</td>
                      <td>
                        <Pill
                          value={
                            g.awaiting.length
                              ? hardik
                                ? "to verify"
                                : "pending"
                              : g.ready.length
                                ? "hardik_verified"
                                : hardik && g.rows.some((c) => c.status === "tarun_pending")
                                  ? "sent to Tarun"
                                  : "reviewed"
                          }
                        />
                        {hardik && g.awaiting.length > 0 && g.ready.length > 0 && (
                          <small>{g.ready.length} ready to send</small>
                        )}
                      </td>
                      <td>
                        <div className="finance-register-actions finance-action-group">
                          <button
                            type="button"
                            className="finance-action-btn finance-action-history"
                            aria-label={"Review expenses for " + g.name}
                            onClick={() => setOwner(g.id)}
                          >
                            <Eye size={13} />
                            View details
                          </button>
                          <button
                            type="button"
                            className="finance-action-btn finance-action-approve"
                            aria-label={
                              (hardik ? "Verify all expenses for " : "Approve all expenses for ") +
                              g.name
                            }
                            disabled={busy || !g.awaiting.length}
                            onClick={() => decide(g.awaiting, "approve", g.name)}
                          >
                            <CheckCircle2 size={13} />
                            {hardik ? "Verify all" : "Approve all"}
                            {g.awaiting.length > 0 && (
                              <span className="finance-action-count">{g.awaiting.length}</span>
                            )}
                          </button>
                          {hardik && (
                            <button
                              type="button"
                              className="finance-action-btn finance-action-send"
                              aria-label={"Send verified expenses to Tarun for " + g.name}
                              disabled={busy || !g.ready.length}
                              onClick={() => decide(g.ready, "forward", g.name)}
                            >
                              <Send size={13} />
                              Send to Tarun
                              {g.ready.length > 0 && (
                                <span className="finance-action-count">{g.ready.length}</span>
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                {!groups.some((g) =>
                  (g.name + " " + g.email).toLowerCase().includes(query.toLowerCase()),
                ) && (
                  <tr>
                    <td colSpan={6}>
                      <div className="finance-empty p-8">
                        <Receipt size={24} />
                        <strong>
                          {groups.length ? "No matching people" : "No expenses received"}
                        </strong>
                        <p>
                          {groups.length
                            ? "Try another name or email."
                            : hardik
                              ? "Submitted expenses will appear here for verification."
                              : "Expenses appear here after Hardik sends them."}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="finance-table-scroll" tabIndex={0} aria-label="Person expense details">
          <table className="finance-table finance-approval-details">
            <caption className="sr-only">
              Expenses for {person.name}: receipts, status and review actions
            </caption>
            <colgroup>
              <col style={{ width: "13%" }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "17%" }} />
              {/* Fixed width so the review + manage action rows never squeeze. */}
              <col className="finance-approval-actions-col" style={{ width: "290px" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th>Expense</th>
                <th className="finance-approval-amount">Amount</th>
                <th>Receipts</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...person.rows]
                .sort((a, b) => a.expense_date.localeCompare(b.expense_date))
                .map((c) => {
                  const reapplied = reapplications.get(c.id);
                  return (
                    <tr key={c.id} data-reapplied={!!reapplied}>
                      <td data-label="Date" className="finance-approval-date">
                        {c.expense_date}
                      </td>
                      <td data-label="Expense" className="finance-approval-description">
                        <strong>{c.title}</strong>
                        <small>{categories[c.category]}</small>
                        {reapplied && <ReapplicationNotice info={reapplied} />}
                        {c.description && <p title={c.description}>{c.description}</p>}
                        {(c.tarun_reason || c.hardik_reason) && (
                          <small>Rejection reason: {c.tarun_reason || c.hardik_reason}</small>
                        )}
                      </td>
                      <td data-label="Amount" className="finance-approval-amount">
                        {money(Number(c.amount))}
                      </td>
                      <td data-label="Receipts" className="finance-approval-receipts">
                        {c.attachment_ids.length ? (
                          c.attachment_ids.map((id) => {
                            const file = files.find((f) => f.id === id);
                            return file ? (
                              <ExpenseReceipt key={id} file={file} />
                            ) : (
                              <small key={id}>Attachment unavailable</small>
                            );
                          })
                        ) : (
                          <small>No receipt</small>
                        )}
                      </td>
                      <td data-label="Status" className="finance-approval-status">
                        <Pill
                          value={
                            c.paid_at
                              ? "paid"
                              : c.status === "hardik_pending"
                                ? "to verify"
                                : c.status === "tarun_pending"
                                  ? hardik
                                    ? "sent to Tarun"
                                    : "pending"
                                  : c.status
                          }
                        />
                      </td>
                      <td data-label="Actions" className="finance-approval-decision">
                        <div className="finance-row-actions">
                          {((hardik
                            ? ["hardik_pending", "hardik_verified"].includes(c.status)
                            : c.status === "tarun_pending") ||
                            (c.status === "approved" && !c.paid_at)) && (
                            <div className="finance-decision-actions">
                              {(hardik ? c.status === "hardik_pending" : c.status === "tarun_pending") && (
                                <button
                                  type="button"
                                  className="finance-action-btn finance-action-approve"
                                  disabled={busy}
                                  onClick={() => decide([c], "approve")}
                                >
                                  <CheckCircle2 size={13} />
                                  {hardik ? "Verify" : "Approve"}
                                </button>
                              )}
                              {(hardik
                                ? ["hardik_pending", "hardik_verified"].includes(c.status)
                                : c.status === "tarun_pending") && (
                                <button
                                  type="button"
                                  className="finance-action-btn finance-action-reject"
                                  disabled={busy}
                                  onClick={() => decide([c], "reject")}
                                >
                                  <XCircle size={13} />
                                  Reject
                                </button>
                              )}
                              {c.status === "approved" && !c.paid_at && (
                                <button
                                  type="button"
                                  className="finance-action-btn finance-action-pay"
                                  disabled={busy || today < settlementDates(c.settlement_month).due}
                                  onClick={() => recordPayment(c)}
                                >
                                  <Wallet size={13} />
                                  {today < settlementDates(c.settlement_month).due
                                    ? `Payable from ${settlementDates(c.settlement_month).due}`
                                    : "Record payment"}
                                </button>
                              )}
                            </div>
                          )}
                          <div className="finance-manage-actions">
                            <button
                              type="button"
                              className="finance-action-btn finance-action-history"
                              title="View history"
                              onClick={() => setHistory(c)}
                            >
                              <Clock3 size={13} />
                              History
                            </button>
                            {onEdit && canEditExpense(c, role, null, today) && (
                              <button
                                type="button"
                                className="finance-action-btn finance-action-edit"
                                title="Edit expense"
                                disabled={busy}
                                onClick={() => onEdit(c)}
                              >
                                <Pencil size={13} />
                                Edit
                              </button>
                            )}
                            {canDeleteExpense(c, role, null) && (
                              <button
                                type="button"
                                className="finance-action-btn finance-action-delete"
                                title="Delete expense"
                                disabled={busy}
                                onClick={() => removeClaim(c)}
                              >
                                <Trash2 size={13} />
                                Delete
                              </button>
                            )}
                          </div>
                          {c.paid_at ? (
                            <small className="finance-action-note">
                              Paid · locked{c.payment_reference ? ` · ${c.payment_reference}` : ""}
                            </small>
                          ) : c.status === "approved" ? (
                            <small className="finance-action-note">Approved · cannot be deleted</small>
                          ) : ["hardik_verified", "tarun_pending"].includes(c.status) ? (
                            <small className="finance-action-note">Verified · editing locked</small>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={!!history}
        onOpenChange={(open) => {
          if (!open) setHistory(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Expense history · {history?.title}</DialogTitle>
            <DialogDescription>
              Submission, verification, forwarding and payment history.
            </DialogDescription>
          </DialogHeader>
          <AuditTrail events={events.filter((event) => event.entity_id === history?.id)} />
        </DialogContent>
      </Dialog>
    </section>
  );
}
