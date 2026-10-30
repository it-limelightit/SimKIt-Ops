import { useEffect, useState } from "react";
import { Button } from "@/components/ui-kit";
import { Fragment } from "react";
import { Check, X, SlidersHorizontal, Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { indiaDate, money, paymentPeriod } from "@/lib/field-operations";
import { dateTime, financeRpc, type FieldFinance, type FinanceBoard } from "@/lib/finance";
import { Metric, Pill, type Confirm } from "./FinanceUi";
import { FieldFinancePanel } from "./SalaryPanel";
import { ManagerExpenseReview } from "./ManagerExpenseReview";
import { downloadStatement } from "./finance-export";

export function FieldIncentiveDirectory({
  board,
  month,
  query,
  busy,
  confirm,
  reload,
}: {
  board: FinanceBoard;
  month: string;
  query: string;
  busy: boolean;
  confirm: Confirm;
  reload: () => Promise<void>;
}) {
  const [records, setRecords] = useState<Record<string, FieldFinance>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<"view" | "edit">("view");
  const [downloading, setDownloading] = useState(false);
  const { start, end, due } = paymentPeriod(`${month}-01`);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRecords({});
    setErrors({});
    const people = board.people.filter((person) => person.field);
    let cursor = 0;
    const worker = async () => {
      while (!cancelled && cursor < people.length) {
        const person = people[cursor++];
        try {
          const data = await financeRpc<FieldFinance>("finance_field_board", {
            _associate: person.id,
            _month: `${month}-01`,
          });
          if (data.earnings.some((entry) => entry.date < start || entry.date > end))
            throw new Error(
              "Incentive dates do not match this month. Update the finance database before reviewing.",
            );
          if (!cancelled) setRecords((current) => ({ ...current, [person.id]: data }));
        } catch (error) {
          if (!cancelled)
            setErrors((current) => ({
              ...current,
              [person.id]: error instanceof Error ? error.message : "Could not load incentives",
            }));
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, people.length) }, worker)).then(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [board, month, start, end, attempt]);

  const rows = board.people
    .filter((person) => person.field)
    .map((person) => {
      const data = records[person.id];
      const earnings = data?.earnings.filter((entry) => entry.phase === "commissioning") ?? [];
      const total = earnings.reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
      const remaining = earnings
        .filter((entry) => !entry.paid)
        .reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
      const paid =
        !!data &&
        (!!data.payments.length || (!!earnings.length && earnings.every((entry) => entry.paid)));
      const pending = !paid && data?.review?.status === "tarun_pending";
      const ready = !paid && !!earnings.length && earnings.every((entry) => entry.amount !== null);
      return { person, data, earnings, total, remaining, paid, pending, ready };
    });
  const pending = rows.filter((row) => row.pending);
  const visible = rows
    .filter(
      (row) =>
        `${row.person.name} ${row.person.email}`.toLowerCase().includes(query.toLowerCase()) &&
        (filter === "all" ||
          (filter === "review" &&
            (board.role === "tarun"
              ? row.pending
              : row.ready &&
                !["approved", "tarun_pending"].includes(row.data?.review?.status ?? ""))) ||
          (filter === "unpaid" && !row.paid && row.data?.review?.status === "approved") ||
          (filter === "rejected" && row.data?.review?.status === "rejected")),
    )
    .sort(
      (a, b) => Number(b.pending) - Number(a.pending) || a.person.name.localeCompare(b.person.name),
    );
  const action = (row: (typeof rows)[number], action: "approve" | "reject" | "forward" | "pay") =>
    confirm({
      title:
        action === "approve"
          ? "Approve incentives?"
          : action === "reject"
            ? "Reject incentives?"
            : action === "forward"
              ? "Verify incentives and forward to Tarun?"
              : "Record completed incentive payment?",
      detail: `${row.person.name || row.person.email} · ${start} to ${end} · ${money(action === "pay" ? row.remaining : row.total)} · ${row.earnings.length} commissioning(s)`,
      requireReason: action === "reject" || action === "pay",
      reasonLabel: action === "pay" ? "Payment reference / method" : "Rejection reason",
      execute: async (reason) => {
        try {
          await financeRpc("finance_field_action", {
            _associate: row.person.id,
            _end: end,
            _revision: row.data?.review?.revision ?? 0,
            _action: action,
            _reason: reason || null,
          });
        } finally {
          await reload();
        }
      },
    });
  return (
    <section aria-label="Monthly incentive approvals" className="finance-incentive-directory">
      <div className="finance-metrics">
        <Metric
          label="Awaiting Tarun approval"
          value={pending.length}
          detail={money(pending.reduce((sum, row) => sum + row.total, 0))}
        />
        <Metric
          label="Total incentives"
          value={money(rows.reduce((sum, row) => sum + row.total, 0))}
          detail={loading ? "Loading monthly incentives..." : `${rows.length} field associates`}
        />
        <Metric
          label="Incentives outstanding"
          value={money(rows.reduce((sum, row) => sum + row.remaining, 0))}
          detail={`Payment due ${due}`}
        />
      </div>
      <div className="finance-incentive-heading">
        <div>
          <h2>Monthly incentives</h2>
          <p className="finance-muted">Review monthly totals, view the work breakdown and approve incentives.</p>
        </div>
        <select
          className="finance-input"
          aria-label="Filter incentives"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All incentives</option>
          <option value="review">Needs my review</option>
          <option value="unpaid">Approved, unpaid</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      {loading && (
        <p role="status" className="finance-muted">
          Loading incentive records...
        </p>
      )}
      {Object.keys(errors).length > 0 && (
        <div role="alert" className="finance-notice">
          Some incentives could not be loaded.{" "}
          <Button
            variant="ghost"
            disabled={loading || busy}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </Button>
        </div>
      )}
      <div className="finance-table-scroll">
        <table className="finance-table finance-incentive-review-table">
          <colgroup>
            <col style={{ width: "20%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "19%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "34%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Field associate</th>
              <th>Incentive</th>
              <th>Approval status</th>
              <th>Outstanding</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Fragment key={row.person.id}>
                <tr className={row.pending ? "finance-incentive-pending-row" : undefined}>
                  <td className="finance-incentive-person-cell">
                    <strong>{row.person.name || row.person.email}</strong>
                    <p className="finance-muted">{row.person.email}</p>
                  </td>
                  <td>
                    {row.data ? (
                      <>
                        <div className="finance-incentive-cell-total">
                          <strong>{money(row.total)}</strong>
                          <span>
                            {row.earnings.length}{" "}
                            {row.earnings.length === 1 ? "commissioning" : "commissionings"}
                          </span>
                        </div>
                        {!row.earnings.length && (
                          <p className="finance-muted">No commissionings this month</p>
                        )}
                      </>
                    ) : (
                      <span className="finance-muted">{errors[row.person.id] || "Loading..."}</span>
                    )}
                  </td>
                  <td>
                    {row.data && (
                      <>
                        <Pill
                          value={row.paid ? "paid" : (row.data.review?.status ?? "not verified")}
                        />
                        <p className="finance-incentive-review-date">
                          {row.data.review?.hardik_at ? (
                            <>
                              Verified by Hardik<small>{dateTime(row.data.review.hardik_at)}</small>
                            </>
                          ) : (
                            "Awaiting Hardik verification"
                          )}
                        </p>
                        {row.data.review?.tarun_at && (
                          <p className="finance-incentive-review-date">
                            Reviewed by Tarun<small>{dateTime(row.data.review.tarun_at)}</small>
                          </p>
                        )}
                        {row.data.review?.reason && (
                          <p className="finance-rejection-reason">{row.data.review.reason}</p>
                        )}
                      </>
                    )}
                  </td>
                  <td className="finance-incentive-balance">
                    {row.data ? money(row.remaining) : "—"}
                  </td>
                  <td>
                    <div className="finance-incentive-actions">
                      {board.role === "tarun" && row.pending && (
                        <>
                          <Button
                            size="sm"
                            disabled={busy || loading}
                            aria-label="Approve incentives"
                            onClick={() => action(row, "approve")}
                          >
                            <Check size={14} /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            aria-label="Reject incentives"
                            disabled={busy || loading}
                            onClick={() => action(row, "reject")}
                          >
                            <X size={14} /> Reject
                          </Button>
                        </>
                      )}
                      {board.role === "hardik" &&
                        row.ready &&
                        !["approved", "tarun_pending"].includes(row.data?.review?.status ?? "") && (
                          <Button
                            size="sm"
                            disabled={busy || loading}
                            onClick={() => action(row, "forward")}
                          >
                            Verify & forward incentives
                          </Button>
                        )}
                      {!row.paid && row.data?.review?.status === "approved" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy || loading || indiaDate() < due}
                          onClick={() => action(row, "pay")}
                        >
                          {indiaDate() < due ? `Payable from ${due}` : "Record incentive payment"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`${row.person.name || row.person.email} ${row.person.email ?? ""} — Edit incentives`}
                        aria-haspopup="dialog"
                        aria-controls={`incentive-details-${row.person.id}`}
                        onClick={() => {
                          setDetailMode("edit");
                          setExpanded(row.person.id);
                        }}
                      >
                        <SlidersHorizontal size={14} /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || !row.data}
                        aria-label={`${row.person.name || row.person.email} — View details`}
                        aria-haspopup="dialog"
                        onClick={() => {
                          setDetailMode("view");
                          setExpanded(row.person.id);
                        }}
                      >
                        <Eye size={14} /> View details
                      </Button>
                    </div>
                  </td>
                </tr>
                {expanded === row.person.id && (
                  <Dialog
                    open
                    onOpenChange={(open) => {
                      if (!open && !busy) setExpanded(null);
                    }}
                  >
                    <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-5xl">
                      <DialogHeader>
                        <DialogTitle>
                          {detailMode === "view" ? "Incentive details" : "Manage incentives"}
                        </DialogTitle>
                        <DialogDescription>
                          Edit rates, amounts and review expenses.
                        </DialogDescription>
                      </DialogHeader>
                      <div
                        id={`incentive-details-${row.person.id}`}
                        className="finance-incentive-inline-details"
                        role="region"
                        aria-label={`${row.person.name || row.person.email} details`}
                      >
                        <div className="finance-incentive-heading">
                          <h2>{row.person.name || row.person.email}</h2>
                          <div className="finance-incentive-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy || downloading}
                              onClick={async () => {
                                setDownloading(true);
                                try {
                                  await downloadStatement(board, month, row.person);
                                } catch (error) {
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Could not download statement",
                                  );
                                } finally {
                                  setDownloading(false);
                                }
                              }}
                            >
                              Statement PDF
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setExpanded(null)}
                            >
                              Close details
                            </Button>
                          </div>
                        </div>
                        <FieldFinancePanel
                          person={row.person}
                          month={month}
                          role={board.role}
                          confirm={confirm}
                          reload={reload}
                          events={board.events}
                        />
                        <h2>Expense reimbursements</h2>
                        {board.role && (
                          <ManagerExpenseReview
                            role={board.role}
                            events={board.events}
                            claims={board.claims.filter(
                              (claim) => claim.owner_id === row.person.id,
                            )}
                            files={board.files}
                            busy={busy}
                            confirm={confirm}
                            reload={reload}
                            today={board.today}
                          />
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </Fragment>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={5} className="finance-muted">
                  No field associates match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
