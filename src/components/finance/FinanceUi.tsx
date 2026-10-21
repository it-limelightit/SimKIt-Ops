import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { dateTime, readable, type FinanceEvent, type expenseReapplication } from "@/lib/finance";
import { RotateCcw, AlertCircle } from "lucide-react";

export function ReapplicationNotice({
  info,
}: {
  info: NonNullable<ReturnType<typeof expenseReapplication>>;
}) {
  return (
    <div className="finance-reapplication">
      <span className="finance-reapplied-badge">
        <RotateCcw size={12} />
        Reapplied
      </span>
      <small>Resubmitted {dateTime(info.reappliedAt)}</small>
      {info.rejections.length ? (
        info.rejections.map((rejection) => (
          <div className="finance-reapply-reason" key={rejection.reviewer}>
            <strong>
              <AlertCircle size={12} /> Previously rejected by {rejection.reviewer}
            </strong>
            {rejection.at && <small>{dateTime(rejection.at)}</small>}
            <p>{rejection.reason}</p>
          </div>
        ))
      ) : (
        <small>Previous rejection reason was not recorded.</small>
      )}
    </div>
  );
}
export function Pill({ value }: { value: string }) {
  return (
    <span
      className="finance-pill"
      data-tone={
        ["approved", "approve", "paid", "present"].includes(value)
          ? "good"
          : ["reject", "rejected", "absent"].includes(value)
            ? "bad"
            : value.includes("pending")
              ? "pending"
              : ""
      }
    >
      {value === "hardik_verified" ? "Ready to send" : readable(value)}
    </span>
  );
}
export function Metric({
  label,
  value,
  icon,
  detail,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  detail?: string;
}) {
  return (
    <div className="finance-metric">
      <div className="finance-metric-label">
        <span className="finance-muted">{label}</span>
        {icon && <span className="finance-metric-icon">{icon}</span>}
      </div>
      <strong>{value}</strong>
      {detail && <span className="finance-metric-detail">{detail}</span>}
    </div>
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="finance-field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string }>, { id })
        : children}
    </div>
  );
}
export type Confirmation = {
  successMessage?: string;
  title: string;
  detail: string;
  requireReason?: boolean;
  reasonLabel?: string;
  execute: (reason: string) => Promise<void>;
};
export type Confirm = (value: Confirmation) => void;

export function RecordDetails({ before, after }: { before: unknown; after: unknown }) {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const old = record(before),
    next = record(after);
  const fields: Record<string, string> = {
    title: "Expense name",
    expense_date: "Expense date",
    category: "Category",
    amount: "Amount (INR)",
    base_salary: "Monthly salary (INR)",
    working_days: "Working days",
    payable_days: "Payable day equivalents",
    status: "Status",
    assessment: "Assessment rate (INR)",
    commissioning: "Commissioning rate (INR)",
    payment_reference: "Payment reference",
  };
  const rows = Object.entries(fields)
    .filter(([key]) => key in next || key in old)
    .map(([key, label]) => [
      label,
      old[key] == null ? "—" : String(old[key]).replaceAll("_", " "),
      next[key] == null ? "—" : String(next[key]).replaceAll("_", " "),
    ]);
  const priorOverrides = record(old.overrides),
    overrides = record(next.overrides);
  for (const date of new Set([...Object.keys(priorOverrides), ...Object.keys(overrides)])) {
    const a = record(priorOverrides[date]),
      b = record(overrides[date]);
    if (JSON.stringify(a) !== JSON.stringify(b))
      rows.push([
        `Attendance ${date}`,
        a.units == null ? "Automatic" : `${a.units} day · ${a.reason}`,
        b.units == null ? "Automatic" : `${b.units} day · ${b.reason}`,
      ]);
  }
  return rows.length ? (
    <details className="mt-2">
      <summary className="text-xs cursor-pointer">View recorded changes</summary>
      <div className="overflow-auto mt-2">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left p-2">Detail</th>
              <th className="text-left p-2">Before</th>
              <th className="text-left p-2">After</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, a, b]) => (
              <tr key={label}>
                <td className="p-2 align-top">{label}</td>
                <td className="p-2 align-top break-words">{a}</td>
                <td className="p-2 align-top break-words">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  ) : null;
}

export function AuditTrail({ events }: { events: FinanceEvent[] }) {
  if (!events.length) return null;
  return (
    <details className="finance-notice">
      <summary className="cursor-pointer font-medium">
        Calculation & approval history ({events.length})
      </summary>
      {events.map((event) => (
        <div key={event.id} className="mt-3 border-t border-border pt-3">
          <strong>{readable(event.action)}</strong>
          <p className="finance-muted">
            {event.actor_role || "User"} · {dateTime(event.occurred_at)}
          </p>
          {event.reason && <p className="text-sm mt-1">{event.reason}</p>}
          <RecordDetails before={event.before_data} after={event.after_data} />
        </div>
      ))}
    </details>
  );
}
