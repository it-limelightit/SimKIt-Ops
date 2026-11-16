import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, LoaderCircle, Receipt } from "lucide-react";
import { Card } from "@/components/ui-kit";
import { financeRpc } from "@/lib/finance";
import { money } from "@/lib/field-operations";

type AppRecord = { phase: "assessment" | "commissioning"; date: string; amount: number | null };
type Settled = {
  id: string;
  paid_month: string;
  sr_no: number;
  company: string;
  city: string | null;
  amount: number;
  remark: string | null;
  app: AppRecord[];
};

const monthLabel = (date: string) =>
  new Date(`${date.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** Why this company was settled in this month, compared with the app's incentive records. */
function reason(row: Settled) {
  if (row.remark) return { text: row.remark, tone: "bg-slate-100 text-slate-700" };
  const commissioned = row.app.find((r) => r.phase === "commissioning");
  if (!row.app.length)
    return {
      text: "Settled from tracker sheet · no app record",
      tone: "bg-slate-100 text-slate-700",
    };
  if (!commissioned)
    return { text: "Assessment in app · settled", tone: "bg-slate-100 text-slate-700" };
  const paid = row.paid_month.slice(0, 7);
  const done = commissioned.date.slice(0, 7);
  if (done === paid)
    return { text: "Commissioned & paid same month", tone: "bg-emerald-50 text-emerald-700" };
  return done > paid
    ? {
        text: `Paid in advance · commissioned ${shortDate(commissioned.date)}`,
        tone: "bg-sky-50 text-sky-700",
      }
    : {
        text: `Commissioned ${shortDate(commissioned.date)} · paid next month`,
        tone: "bg-amber-50 text-amber-700",
      };
}

/**
 * Settled company-wise payments (from the commissioning tracker sheet) for a
 * field associate. Read-only. Renders nothing when the associate has no list.
 * Shown to Tarun/Hardik in the finance workspace and to the associate themself.
 */
export function SettledCompanyPayments({
  associateId,
  own = false,
}: {
  associateId: string;
  own?: boolean;
}) {
  const [rows, setRows] = useState<Settled[] | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    financeRpc<Settled[]>("field_settled_payments_list", { _associate: associateId })
      .then((next) => !cancelled && setRows(next ?? []))
      // Not deployed yet or no access: show nothing rather than break the page.
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [associateId]);

  if (rows === null)
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-text-secondary" role="status">
        <LoaderCircle size={16} className="animate-spin text-lime" /> Loading settled payments…
      </Card>
    );
  if (!rows.length) return null;

  const months = [...new Set(rows.map((r) => r.paid_month))].sort();
  const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <Card className="overflow-hidden rounded-xl p-0" aria-label="Settled company payments">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Receipt size={17} className="text-lime" />
            {own ? "My settled company payments" : "Settled company payments"}
          </h2>
          <p className="mt-0.5 text-xs text-text-secondary">
            Company-wise incentive already paid
            {own ? " to you" : ""} · ₹5,000 per company (assessment + commissioning). Source:
            commissioning tracker sheet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {months.map((m) => {
            const list = rows.filter((r) => r.paid_month === m);
            return (
              <div key={m} className="rounded-lg border border-border bg-surface px-3 py-1.5">
                <p className="text-[11px] text-text-secondary">{monthLabel(m)} · paid</p>
                <p className="text-sm font-semibold tabular-nums">
                  {money(list.reduce((s, r) => s + Number(r.amount), 0))}
                  <span className="ml-1 text-xs font-normal text-text-secondary">
                    {list.length} companies
                  </span>
                </p>
              </div>
            );
          })}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-800">
            <p className="text-[11px]">Total paid</p>
            <p className="text-sm font-semibold tabular-nums">
              {money(total)}
              <span className="ml-1 text-xs font-normal">{rows.length} companies</span>
            </p>
          </div>
        </div>
      </div>

      {months.map((m) => {
        const list = rows.filter((r) => r.paid_month === m);
        const isCollapsed = collapsed[m];
        return (
          <section key={m} className="border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [m]: !c[m] }))}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center justify-between gap-3 bg-surface/60 px-4 py-2.5 text-left hover:bg-surface-raised"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <ChevronDown
                  size={15}
                  className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                />
                Paid in {monthLabel(m)}
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  <CheckCircle2 size={12} /> Paid
                </span>
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {money(list.reduce((s, r) => s + Number(r.amount), 0))}
                <span className="ml-1 text-xs font-normal text-text-secondary">
                  · {list.length} companies
                </span>
              </span>
            </button>
            {!isCollapsed && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-text-secondary">
                    <tr className="border-t border-border">
                      <th className="w-12 px-4 py-2 font-medium">#</th>
                      <th className="px-2 py-2 font-medium">Company</th>
                      <th className="px-2 py-2 font-medium">App record</th>
                      <th className="px-2 py-2 font-medium">Reason</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((row) => {
                      const why = reason(row);
                      return (
                        <tr key={row.id} className="border-t border-border hover:bg-surface-raised">
                          <td className="px-4 py-2 text-xs text-text-secondary tabular-nums">
                            {row.sr_no}
                          </td>
                          <td className="px-2 py-2">
                            <p className="font-medium">{row.company}</p>
                            {row.city && (
                              <p className="text-[11px] text-text-secondary">{row.city}</p>
                            )}
                          </td>
                          <td className="px-2 py-2 text-xs text-text-secondary">
                            {row.app.length
                              ? row.app
                                  .map(
                                    (r) =>
                                      `${r.phase === "assessment" ? "Assessed" : "Commissioned"} ${shortDate(r.date)}`,
                                  )
                                  .join(" · ")
                              : "—"}
                          </td>
                          <td className="px-2 py-2">
                            <span
                              className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${why.tone}`}
                            >
                              {why.text}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums">
                            {money(Number(row.amount))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </Card>
  );
}
