import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui-kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  financeRpc,
  dateTime,
  readable,
  salaryTotals,
  settlementDates,
  type DayOverrides,
  type FieldFinance,
  type FinanceDay,
  type FinanceEmployee,
  type FinancePerson,
  type FinanceRole,
  type FinanceEvent,
  type Salary,
} from "@/lib/finance";
import { indiaDate, money, paymentPeriod } from "@/lib/field-operations";
import { salaryDeductionGroups, waiveSalaryDays } from "@/lib/salary-deductions";
import { AuditTrail, Field, Metric, Pill, type Confirm } from "./FinanceUi";

export function SalaryPanel({
  employee,
  month,
  salary,
  role,
  reload,
  confirm,
  events,
}: {
  employee: FinanceEmployee;
  month: string;
  salary?: Salary;
  role: FinanceRole;
  reload: () => Promise<void>;
  confirm: Confirm;
  events: FinanceEvent[];
}) {
  const [days, setDays] = useState<FinanceDay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [base, setBase] = useState(String(salary?.base_salary ?? ""));
  const [overrides, setOverrides] = useState<DayOverrides>(salary?.overrides ?? {});
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<FinanceDay | null>(null);
  const [unit, setUnit] = useState("1");
  const [dayReason, setDayReason] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDays(
        await financeRpc<FinanceDay[]>("finance_calendar", {
          _employee: employee.id,
          _month: `${month}-01`,
          _overrides: {},
        }),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load calendar");
    } finally {
      setLoading(false);
    }
  }, [employee.id, month]);
  useEffect(() => {
    void load();
  }, [load]);
  const totals = salaryTotals(Number(base) || 0, days, overrides);
  const deductionGroups = salaryDeductionGroups(days);
  const changed =
    Number(base) !== Number(salary?.base_salary) ||
    JSON.stringify(overrides) !== JSON.stringify(salary?.overrides ?? {});
  const action = (action: string) => {
    if (!salary) return;
    confirm({
      title:
        action === "forward"
          ? "Verify salary and forward to Tarun?"
          : action === "approve"
            ? "Approve salary?"
            : action === "reject"
              ? "Reject salary?"
              : "Record completed salary payment?",
      detail: `${employee.name} · ${month} · ${money(Number(salary.amount))}`,
      requireReason: action === "reject" || action === "pay",
      reasonLabel: action === "pay" ? "Payment reference / method" : "Rejection reason",
      execute: async (reason) => {
        await financeRpc("salary_action", {
          _id: salary.id,
          _revision: salary.revision,
          _action: action,
          _reason: reason || null,
        });
        await reload();
      },
    });
  };
  const save = async () => {
    setBusy(true);
    try {
      await financeRpc("salary_save", {
        _employee: employee.id,
        _month: `${month}-01`,
        _base: Number(base),
        _overrides: overrides,
        _revision: salary?.revision ?? 0,
        _reason: "Monthly salary calculation",
      });
      toast.success("Salary recalculated and saved. Approval starts with Hardik.");
      await reload();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save salary");
    } finally {
      setBusy(false);
    }
  };
  const editDay = (day: FinanceDay) => {
    setSelected(day);
    setUnit(String(overrides[day.date]?.units ?? day.units ?? 0));
    setDayReason(overrides[day.date]?.reason ?? "");
  };
  const count = (status: string) => days.filter((d) => d.working_day && d.status === status).length;
  return (
    <section>
      <h2>Office attendance & salary</h2>
      <p className="finance-muted mt-1">
        Automatic calculation: late = half day, approved WFH = full paid day, leave = unpaid. Choose
        how many days to allow without deduction for this month.
      </p>
      {loading ? (
        <p role="status" className="finance-notice">
          Loading monthly attendance…
        </p>
      ) : error ? (
        <p role="alert" className="finance-notice text-coral">
          {error}
        </p>
      ) : (
        <>
          <div className="finance-metrics">
            <Metric label="Working days" value={totals.working} />
            <Metric label="Present incl. late" value={count("present") + count("late")} />
            <Metric label="On time" value={count("present")} />
            <Metric label="Late / half day" value={count("late")} />
            <Metric label="Absent" value={count("absent")} />
            <Metric label="WFH" value={count("work_from_home")} />
            <Metric label="Payable day equivalents" value={totals.payable} />
          </div>
          <div className="finance-calendar" aria-label="Monthly salary attendance calendar">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <span key={d} className="text-center text-xs finance-muted">
                {d}
              </span>
            ))}
            {Array.from({ length: new Date(`${month}-01T12:00:00Z`).getUTCDay() }, (_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {days.map((day) => (
              <button
                key={day.date}
                type="button"
                className="finance-day"
                data-status={day.status}
                disabled={
                  !!salary?.paid_at ||
                  !day.working_day ||
                  ["scheduled", "not_employed"].includes(day.status)
                }
                onClick={() => editDay(day)}
                title={`${day.date}: ${readable(day.status)}${day.request_status ? ` · ${day.request_status} ${day.request_type}` : ""}`}
              >
                <strong>{Number(day.date.slice(-2))}</strong>
                <span>{readable(day.status)}</span>
                <span className="block mt-1">
                  {overrides[day.date]
                    ? `${overrides[day.date].units} day · Edited`
                    : day.units === null
                      ? "Needs review"
                      : day.working_day
                        ? `${day.units} day`
                        : "Off"}
                </span>
              </button>
            ))}
          </div>
          <div className="finance-notice flex flex-wrap gap-4">
            <span>Full day: 1</span>
            <span>Late / half day: 0.5</span>
            <span>Absent / unpaid leave: 0</span>
            <span>Click a working day to adjust.</span>
          </div>
          {deductionGroups.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
              <h3>Salary deductions</h3>
              <p className="finance-muted">
                Choose how many days to allow without deduction. Approved WFH is fully paid.
              </p>
              {deductionGroups.map((group) => {
                const allowed = group.days.filter((day) => overrides[day.date]?.units === 1).length;
                const label =
                  group.status === "late"
                    ? "Late days"
                    : group.status === "absent"
                      ? "Absent days"
                      : group.status === "on_leave"
                        ? "Unpaid leave days"
                        : `${readable(group.status)} days`;
                const deduction = group.days.reduce(
                  (sum, day) =>
                    sum + totals.daily * (1 - (overrides[day.date]?.units ?? day.units ?? 0)),
                  0,
                );
                return (
                  <div
                    key={group.status}
                    className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"
                  >
                    <div>
                      <strong>
                        {label}: {group.days.length}
                      </strong>
                      <p className="finance-muted">
                        {allowed} without deduction · {group.days.length - allowed} with deduction
                      </p>
                      <p className="finance-muted">Deduction: {money(deduction)}</p>
                    </div>
                    <Field label={`${label} without deduction`}>
                      <select
                        className="finance-input sm:!w-auto"
                        disabled={!!salary?.paid_at || busy}
                        value={String(allowed)}
                        onChange={(e) => {
                          const count = Number(e.target.value);
                          setOverrides((current) => waiveSalaryDays(group.days, current, count));
                        }}
                      >
                        {Array.from({ length: group.days.length + 1 }, (_, count) => (
                          <option key={count} value={String(count)}>
                            {count} {count === 1 ? "day" : "days"}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                );
              })}
              <p className="finance-muted text-xs">
                Additional allowances apply to the earliest remaining dates. Use the calendar for a
                specific date, then save the salary.
              </p>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="rounded-xl border border-border bg-surface p-5 space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Monthly salary (INR)">
                <input
                  className="finance-input"
                  type="number"
                  min="0"
                  max="9999999999"
                  step="0.01"
                  required
                  value={base}
                  disabled={!!salary?.paid_at}
                  onChange={(e) => setBase(e.target.value)}
                />
              </Field>
              <div>
                <p className="finance-muted">Salary to pay</p>
                <strong className="block text-2xl mt-2">{money(totals.amount)}</strong>
                <p className="finance-muted">
                  {money(totals.daily)} / day × {totals.payable} payable days
                </p>
              </div>
            </div>
            {totals.unresolved > 0 && (
              <p className="text-warning text-sm">
                {totals.unresolved} attendance dates need review. Salary cannot be approved until
                resolved.
              </p>
            )}
            {!totals.working && (
              <p className="text-coral text-sm">
                No configured working days. Check the office working calendar.
              </p>
            )}
            <div className="flex flex-wrap gap-2 items-center">
              {salary && (
                <>
                  <Pill value={salary.paid_at ? "paid" : salary.status} />
                  <span className="finance-muted">
                    Saved {money(Number(salary.amount))} · Revision {salary.revision}
                  </span>
                </>
              )}
              {!salary?.paid_at && (
                <Button disabled={busy || !totals.working || !base}>
                  {busy ? "Saving…" : "Save salary"}
                </Button>
              )}
            </div>
          </form>
          {salary && (
            <div className="finance-notice">
              <p className="finance-muted">
                Hardik verified: {dateTime(salary.hardik_at)} · Tarun reviewed:{" "}
                {dateTime(salary.tarun_at)}
              </p>
              {salary.rejection_reason && (
                <p className="text-coral mt-2">Rejected: {salary.rejection_reason}</p>
              )}
              {salary.paid_at ? (
                <p className="mt-2">
                  Paid {dateTime(salary.paid_at)} · {salary.payment_reference} · Remaining{" "}
                  {money(0)}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-3">
                  {role === "hardik" && ["draft", "rejected"].includes(salary.status) && (
                    <Button disabled={changed || busy} onClick={() => action("forward")}>
                      Verify & forward salary
                    </Button>
                  )}
                  {role === "tarun" && salary.status === "tarun_pending" && (
                    <>
                      <Button disabled={changed || busy} onClick={() => action("approve")}>
                        Approve salary
                      </Button>
                      <Button
                        variant="danger"
                        disabled={changed || busy}
                        onClick={() => action("reject")}
                      >
                        Reject salary
                      </Button>
                    </>
                  )}
                  {salary.status === "approved" && (
                    <Button
                      disabled={changed || busy || indiaDate() < settlementDates(month).due}
                      onClick={() => action("pay")}
                    >
                      {indiaDate() < settlementDates(month).due
                        ? `Payable from ${settlementDates(month).due}`
                        : "Record salary payment"}
                    </Button>
                  )}
                  {changed && (
                    <span className="finance-muted">Save your changes before reviewing.</span>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salary deduction · {selected?.date}</DialogTitle>
            <DialogDescription>
              Add a reason for this change, then save the salary to confirm it.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!selected) return;
              setOverrides((current) => {
                const next = { ...current };
                if (Number(unit) === selected.automatic_units) delete next[selected.date];
                else next[selected.date] = { units: Number(unit), reason: dayReason.trim() };
                return next;
              });
              setSelected(null);
            }}
          >
            <Field label="Salary deduction for this date">
              <select
                className="finance-input"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                <option value="1">No deduction</option>
                <option value="0.5">Half-day deduction</option>
                <option value="0">Full-day deduction</option>
              </select>
            </Field>
            <p className="finance-muted">
              Deduction: {money(totals.daily * (1 - Number(unit)))} · Pay for this date:{" "}
              {money(totals.daily * Number(unit))}.
            </p>
            {Number(unit) !== selected?.automatic_units && (
              <Field label="Reason for adjustment">
                <textarea
                  className="finance-input"
                  required
                  maxLength={1000}
                  value={dayReason}
                  placeholder="For example: Late arrival accepted due to transport delay; full day allowed."
                  onChange={(e) => setDayReason(e.target.value)}
                />
              </Field>
            )}
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (selected)
                    setOverrides((current) => {
                      const next = { ...current };
                      delete next[selected.date];
                      return next;
                    });
                  setSelected(null);
                }}
              >
                Restore automatic
              </Button>
              <Button>Apply change</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function FieldFinancePanel({
  person,
  month,
  role,
  confirm,
  reload,
  events,
}: {
  person: FinancePerson;
  month: string;
  role: FinanceRole;
  confirm: Confirm;
  reload: () => Promise<void>;
  events: FinanceEvent[];
}) {
  const [board, setBoard] = useState<FieldFinance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assessment, setAssessment] = useState("");
  const [commissioning, setCommissioning] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [earning, setEarning] = useState<FieldFinance["earnings"][number] | null>(null);
  const [amount, setAmount] = useState("");
  const [editReason, setEditReason] = useState("");
  const load = useCallback(async () => {
    try {
      const data = await financeRpc<FieldFinance>("finance_field_board", {
        _associate: person.id,
        _month: `${month}-01`,
      });
      setBoard(data);
      setAssessment(String(data.rates?.assessment ?? ""));
      setCommissioning(String(data.rates?.commissioning ?? ""));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load field earnings");
    }
  }, [person.id, month]);
  useEffect(() => {
    void load();
  }, [load]);
  const { start, end, due } = paymentPeriod(`${month}-01`);
  const review = board?.review;
  const isPaid =
    !!board?.payments.length ||
    (!!board?.earnings.length && board.earnings.every((earning) => earning.paid));
  const periodFinished = end < indiaDate();
  const paymentOpen = indiaDate() >= due;
  const action = (action: string) =>
    confirm({
      title:
        action === "forward"
          ? "Verify incentives and forward to Tarun?"
          : action === "approve"
            ? "Approve incentives?"
            : action === "reject"
              ? "Reject incentives?"
              : "Record completed incentive payment?",
      detail: `${person.name} · ${start} to ${end} · ${money((board?.earnings ?? []).filter((earning) => action !== "pay" || !earning.paid).reduce((s, e) => s + Number(e.amount ?? 0), 0))}`,
      requireReason: ["reject", "pay"].includes(action),
      reasonLabel: action === "pay" ? "Payment reference / method" : "Rejection reason",
      execute: async (reason) => {
        await financeRpc("finance_field_action", {
          _associate: person.id,
          _end: end,
          _revision: review?.revision ?? 0,
          _action: action,
          _reason: reason || null,
        });
        await load();
        await reload();
      },
    });
  if (error)
    return (
      <p role="alert" className="finance-notice text-coral">
        {error}
      </p>
    );
  if (!board)
    return (
      <p role="status" className="finance-notice">
        Loading field attendance and incentives…
      </p>
    );
  return (
    <section>
      <h2>Field attendance & incentives</h2>
      <p className="finance-notice">
        Monthly incentives:{" "}
        <strong>
          {start} → {end}
        </strong>
        . Payment clearance: {due}. Attendance and expenses use the same calendar month.
      </p>
      <div className="finance-metrics">
        <Metric
          label="Online days (any online event)"
          value={board.calendar.filter((d) => d.online).length}
        />
        <Metric
          label="Offline days"
          value={
            board.calendar.filter(
              (d) =>
                !d.online &&
                !d.off_day &&
                d.date <= indiaDate() &&
                !board.leaves.some((l) => l.date === d.date && l.status === "approved"),
            ).length
          }
        />
        <Metric
          label="Approved leave days"
          value={
            new Set(board.leaves.filter((l) => l.status === "approved").map((l) => l.date)).size
          }
        />
        <Metric
          label="Rejected leave days"
          value={
            new Set(board.leaves.filter((l) => l.status === "rejected").map((l) => l.date)).size
          }
        />
        <Metric label="Off days" value={board.calendar.filter((day) => day.off_day).length} />
        <Metric
          label="Incentives (month)"
          value={money(board.earnings.reduce((s, e) => s + Number(e.amount ?? 0), 0))}
        />
        <Metric
          label="Incentives paid"
          value={money(
            board.earnings
              .filter((earning) => earning.paid)
              .reduce((s, e) => s + Number(e.amount ?? 0), 0),
          )}
        />
      </div>
      <div className="finance-calendar" aria-label="Field calendar">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <span key={d} className="text-center text-xs finance-muted">
            {d}
          </span>
        ))}
        {Array.from({ length: new Date(`${month}-01T12:00:00Z`).getUTCDay() }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {board.calendar.map((day) => (
          <div
            key={day.date}
            className="finance-day"
            data-status={day.online ? "present" : day.off_day ? "off_day" : "absent"}
          >
            <strong>{Number(day.date.slice(-2))}</strong>
            {day.date > indiaDate()
              ? "Scheduled"
              : day.online
                ? "Online"
                : day.off_day
                  ? "Off day"
                  : "Offline"}
            {board.leaves
              .filter((l) => l.date === day.date)
              .map((leave, i) => (
                <span key={i} className="block mt-1" title={leave.reason}>
                  Leave: {leave.status}
                </span>
              ))}
          </div>
        ))}
      </div>
      <form
        className="rounded-xl border border-border bg-surface p-4 my-4 grid gap-4 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void financeRpc("finance_field_rates", {
            _associate: person.id,
            _assessment: Number(assessment),
            _commissioning: Number(commissioning),
            _reason: reason,
          })
            .then(async () => {
              toast.success(
                "Rates saved. Existing priced work stays unchanged; use Edit amount for corrections.",
              );
              setReason("");
              await load();
            })
            .catch((e) => toast.error(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <Field label="Assessment rate (INR)">
          <input
            className="finance-input"
            type="number"
            step="0.01"
            min="0"
            required
            value={assessment}
            onChange={(e) => setAssessment(e.target.value)}
          />
        </Field>
        <Field label="Commissioning rate (INR)">
          <input
            className="finance-input"
            type="number"
            step="0.01"
            min="0"
            required
            value={commissioning}
            onChange={(e) => setCommissioning(e.target.value)}
          />
        </Field>
        <Field label="Change reason">
          <input
            className="finance-input"
            required
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div className="self-end">
          <Button disabled={busy}>Save rates</Button>
        </div>
      </form>
      <div className="finance-table-scroll">
        <table className="finance-table !min-w-[650px]">
          <thead>
            <tr>
              <th>Date</th>
              <th>Work</th>
              <th>Company</th>
              <th>Amount</th>
              <th>Payment</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {board.earnings.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td>{readable(e.phase)}</td>
                <td>{e.company}</td>
                <td>{e.amount === null ? "Rate pending" : money(Number(e.amount))}</td>
                <td>
                  <Pill value={e.paid ? "paid" : "remaining"} />
                </td>
                <td>
                  {!e.paid && !isPaid && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setEarning(e);
                        setAmount(String(e.amount ?? 0));
                        setEditReason("");
                      }}
                    >
                      Edit amount
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!board.earnings.length && (
              <tr>
                <td colSpan={6}>No eligible completed work in this month.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="finance-notice">
        <Pill value={isPaid ? "paid" : (review?.status ?? "not verified")} />
        {review && (
          <p className="finance-muted mt-2">
            Hardik: {dateTime(review.hardik_at)} · Tarun: {dateTime(review.tarun_at)}
            {review.reason ? ` · ${review.reason}` : ""}
          </p>
        )}
        <div className="flex flex-wrap gap-2 mt-3">
          {!isPaid && role === "hardik" && board.earnings.length > 0 && (
            <Button
              disabled={!periodFinished}
              title={periodFinished ? undefined : "Verification opens after month end"}
              onClick={() => action("forward")}
            >
              Verify & forward incentives
            </Button>
          )}
          {!isPaid && role === "tarun" && review?.status === "tarun_pending" && (
            <>
              <Button onClick={() => action("approve")}>Approve incentives</Button>
              <Button variant="danger" onClick={() => action("reject")}>
                Reject incentives
              </Button>
            </>
          )}
          {!isPaid && review?.status === "approved" && (
            <Button
              disabled={!paymentOpen}
              title={paymentOpen ? undefined : `Payment clearance opens on ${due}`}
              onClick={() => action("pay")}
            >
              Record incentive payment
            </Button>
          )}
        </div>
      </div>
      <Dialog
        open={!!earning}
        onOpenChange={(open) => {
          if (!open && !busy) setEarning(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit incentive amount</DialogTitle>
            <DialogDescription>
              {earning?.company} · {earning?.date}. This updates the existing unpaid earning and
              resets its finance approval.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!earning) return;
              setBusy(true);
              void financeRpc("finance_field_earning", {
                _id: earning.id,
                _amount: Number(amount),
                _reason: editReason,
              })
                .then(async () => {
                  setEarning(null);
                  await load();
                  await reload();
                  toast.success("Incentive updated. Hardik must verify again.");
                })
                .catch((e) => toast.error(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <Field label="Amount (INR)">
              <input
                className="finance-input"
                type="number"
                min="0"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Change reason">
              <textarea
                className="finance-input"
                required
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
              />
            </Field>
            <Button disabled={busy}>Save adjustment</Button>
          </form>
        </DialogContent>
      </Dialog>
      <AuditTrail
        events={events.filter(
          (event) =>
            event.entity_id === person.id ||
            event.entity_id === board.review?.id ||
            board.earnings.some((earning) => earning.id === event.entity_id),
        )}
      />
    </section>
  );
}
