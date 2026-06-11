import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type Phase = "assessment" | "installation" | "commissioning";

export function usePhaseData<T extends Record<string, any>>(
  phase: Phase,
  siteId: string | null,
  workerId: string | null,
  initial: T,
) {
  const [data, setData] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const initialRef = useRef(initial);

  useEffect(() => {
    if (!siteId) return;
    (async () => {
      const { data: row } = await supabase.from(phase).select("data").eq("site_id", siteId).maybeSingle();
      if (row?.data) setData({ ...initialRef.current, ...(row.data as T) });
      setLoaded(true);
    })();
  }, [phase, siteId]);

  const save = useCallback(
    async (next: T) => {
      if (!siteId) return;
      setData(next);
      setSaving(true);
      const { error } = await supabase
        .from(phase)
        .upsert({ site_id: siteId, worker_id: workerId, data: next, updated_at: new Date().toISOString() }, { onConflict: "site_id" });
      setSaving(false);
      if (error) {
        toast.error("Auto-save failed");
        return;
      }
      setLastSaved(new Date());
    },
    [phase, siteId, workerId],
  );

  const patch = useCallback(
    (delta: Partial<T>) => {
      void save({ ...data, ...delta });
    },
    [data, save],
  );

  return { data, setData, save, patch, loaded, lastSaved, saving };
}
