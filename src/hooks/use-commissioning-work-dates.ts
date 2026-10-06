import { useEffect, useState } from "react";
import { fieldRpc, type FieldBoard } from "@/lib/field-operations";
import { useAuth } from "@/lib/auth-store";

export type CommissioningWorkDate = { id: string; date: string };
export const commissioningDateChanged = "commissioning-work-date-changed";

// Read the existing work ledger; never rewrite approval or audit timestamps.
export function useCommissioningWorkDates() {
  const { ready, userId } = useAuth();
  const [dates, setDates] = useState<Map<string, CommissioningWorkDate>>(new Map());
  useEffect(() => {
    setDates(new Map());
    if (!ready || !userId) return;
    let live = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const { data, error } = await fieldRpc("field_ops_board");
        if (!live || useAuth.getState().userId !== userId) return;
        if (error) {
          // Older databases can still use their existing commissioning dates.
          if (!["42883", "PGRST202"].includes(error.code ?? ""))
            console.error("Could not load commissioning work dates:", error);
          return;
        }
        const next = new Map<string, CommissioningWorkDate>();
        const earnings = (data as FieldBoard | null)?.earnings ?? [];
        for (const row of earnings) {
          if (
            row.phase === "commissioning" &&
            (row.eligible || row.paid) &&
            row.site_id &&
            /^\d{4}-\d{2}-\d{2}$/.test(row.earning_date)
          )
            next.set(row.site_id, { id: row.id, date: row.earning_date });
        }
        setDates((previous) =>
          previous.size === next.size &&
          [...next].every(
            ([site, value]) =>
              previous.get(site)?.id === value.id && previous.get(site)?.date === value.date,
          )
            ? previous
            : next,
        );
      } catch (error) {
        if (live) console.error("Could not load commissioning work dates:", error);
      } finally {
        loading = false;
      }
    };
    const refresh = () => {
      void load();
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener(commissioningDateChanged, refresh);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(commissioningDateChanged, refresh);
    };
  }, [ready, userId]);
  return dates;
}
