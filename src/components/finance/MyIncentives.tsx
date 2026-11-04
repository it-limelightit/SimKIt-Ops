import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, IndianRupee, LoaderCircle, RefreshCw } from "lucide-react";
import { Button, Card } from "@/components/ui-kit";
import { financeRpc } from "@/lib/finance";
import { indiaDate, money } from "@/lib/field-operations";
import "./finance.css";

type Phase = "assessment" | "installation" | "commissioning";
export type MyIncentivesData = {
  enabled: boolean;
  all_phases?: boolean;
  rates?: Record<Phase, number | null> | null;
  earnings?: {
    id: string;
    date: string;
    phase: Phase;
    company: string;
    amount: number | null;
    paid: boolean;
  }[];
  review?: { status: string; hardik_at: string | null; tarun_at: string | null; reason: string | null } | null;
  payments?: { amount: number; paid_on: string; reference: string }[];
};

const phases: Phase[] = ["assessment", "installation", "commissioning"];
const reviewLabel: Record<string, string> = {
  tarun_pending: "Verified by Hardik · waiting for Tarun",
  approved: "Approved by Tarun",
  rejected: "Rejected",
};

/** Own field incentives for dual-role people (e.g. Hitesh bhai), shown in the manager workspace. */
export function MyIncentives() {
  const [month, setMonth] = useState(indiaDate().slice(0, 7));
  const [data, setData] = useState<MyIncentivesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    financeRpc<MyIncentivesData>("field_ops_my_incentives", { _month: `${month}-01` })
      .then((next) => !cancelled && setData(next))
      .catch((failure) => !cancelled && setError(failure instanceof Error ? failure.message : "Could not load incentives."));
    return () => {
      cancelled = true;
    };
  }, [month, refresh]);

  const move = (step: number) => {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + step);
    setMonth(date.toISOString().slice(0, 7));
  };
  const label = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const earnings = data?.earnings ?? [];
  const priced = earnings.filter((e) => e.amount !== null);
  const total = priced.reduce((sum, e) => sum + Number(e.amount), 0);
  const paid = priced.filter((e) => e.paid).reduce((sum, e) => sum + Number(e.amount), 0);
  const shown = data?.all_phases ? phases : (["commissioning"] as Phase[]);

  return (
    <section className="space-y-4" aria-label="My incentives">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <IndianRupee size={20} /> My incentives
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Field work you completed this month, priced by phase. Hardik verifies, Tarun approves.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-xl border border-border bg-surface p-1">
            <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => move(-1)}>
              <ChevronLeft size={16} />
            </Button>
            <span className="min-w-32 px-2 text-center text-sm font-medium">{label}</span>
            <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => move(1)}>
              <ChevronRight size={16} />
            </Button>
          </div>
          <Button size="sm" variant="secondary" aria-label="Refresh" onClick={() => setRefresh((n) => n + 1)}>
            <RefreshCw size={15} />
          </Button>
        </div>
      </div>

      {error ? (
        <Card role="alert" className="p-5 text-sm text-coral">
          {error}
        </Card>
      ) : !data ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-text-secondary" role="status">
          <LoaderCircle size={18} className="animate-spin text-lime" /> Loading your incentives…
        </Card>
      ) : !data.enabled ? (
        <Card className="p-6 text-sm text-text-secondary">
          Field incentives are not enabled for your account.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {shown.map((phase) => {
              const items = earnings.filter((e) => e.phase === phase);
              const rate = data.rates?.[phase];
              return (
                <Card key={phase} className="rounded-xl p-4">
                  <p className="text-xs capitalize text-text-secondary">{phase}</p>
                  <p className="mt-1 text-2xl font-semibold">{items.length}</p>
                  <p className="mt-1 text-[11px] text-text-secondary">
                    {rate == null ? "Rate pending" : `${money(Number(rate))} each`}
                  </p>
                </Card>
              );
            })}
            <Card className="rounded-xl p-4">
              <p className="text-xs text-text-secondary">This month</p>
              <p className="mt-1 text-2xl font-semibold text-lime">{money(total)}</p>
              <p className="mt-1 text-[11px] text-text-secondary">
                {money(paid)} paid · {money(total - paid)} remaining
              </p>
            </Card>
          </div>

          <Card className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm">
            <span className="text-text-secondary">Approval</span>
            <strong>
              {data.payments?.length
                ? `Paid${data.payments[0]?.reference ? ` · ${data.payments[0].reference}` : ""}`
                : data.review
                  ? (reviewLabel[data.review.status] ?? data.review.status)
                  : earnings.length
                    ? "Waiting for Hardik to verify"
                    : "No work recorded yet"}
            </strong>
          </Card>

          <Card className="overflow-hidden rounded-xl p-0">
            <div className="finance-table-scroll">
              <table className="finance-table !min-w-[560px]">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Phase</th>
                    <th>Company</th>
                    <th>Amount</th>
                    <th>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {earnings.length ? (
                    earnings.map((e) => (
                      <tr key={e.id}>
                        <td>{e.date}</td>
                        <td>
                          <span className="finance-phase-tag" data-phase={e.phase}>
                            {e.phase}
                          </span>
                        </td>
                        <td>{e.company}</td>
                        <td>{e.amount === null ? "Rate pending" : money(Number(e.amount))}</td>
                        <td>{e.paid ? "Paid" : "Remaining"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="text-center text-text-secondary">
                        No completed field work in {label}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </section>
  );
}
