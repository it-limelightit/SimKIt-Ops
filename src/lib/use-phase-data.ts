import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { createPhaseDraft, persistPhaseChanges } from "@/lib/phase-draft";

export type Phase = "assessment" | "installation" | "commissioning";

export function usePhaseData<T extends Record<string, any>>(
  phase: Phase,
  siteId: string | null,
  workerId: string | null,
  initial: T,
) {
  const [data, updateData] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const initialRef = useRef(initial);
  const scopeRef = useRef<{ phase: Phase; siteId: string; draft: ReturnType<typeof createPhaseDraft<T>> | null } | null>(null);

  useEffect(() => {
    const scope = siteId ? { phase, siteId, draft: null as ReturnType<typeof createPhaseDraft<T>> | null } : null;
    scopeRef.current = scope;
    updateData(initialRef.current);
    setLoaded(false);
    setSaving(false);
    setLastSaved(null);
    if (!scope) return;
    const active = () => scopeRef.current === scope;
    (async () => {
      try {
        const { data: row, error } = await supabase.from(phase).select("data").eq("site_id", scope.siteId).maybeSingle();
        if (!active()) return;
        if (error) throw error;
        const next = { ...initialRef.current, ...((row?.data || {}) as T) };
        scope.draft = createPhaseDraft(next, async (changes, previous, verify) => {
          try {
            const success = await persistPhaseChanges(supabase, phase, scope.siteId, workerId, changes, active, previous, verify);
            if (success && active()) setLastSaved(new Date());
            return success;
          } catch (error) {
            if (active()) toast.error(error instanceof Error ? error.message : "Auto-save failed. Please retry.");
            return false;
          }
        }, active, (value, pending) => {
          updateData(value);
          setSaving(pending > 0);
        });
        updateData(next);
        setLoaded(true);
      } catch {
        if (active()) toast.error("Could not load the saved form. Please reopen it before editing.");
      }
    })();
    return () => { if (active()) scopeRef.current = null; };
  }, [phase, siteId, workerId]);

  const save = useCallback(
    async (next: T) => {
      const scope = scopeRef.current;
      if (!scope?.draft || scope.phase !== phase || scope.siteId !== siteId) {
        toast.error("Please wait until the saved form has loaded.");
        return false;
      }
      return scope.draft.save(next, data);
    },
    [phase, siteId, data],
  );

  const patch = useCallback(
    (delta: Partial<T>) => {
      const scope = scopeRef.current;
      if (scope?.draft && scope.phase === phase && scope.siteId === siteId) void scope.draft.patch(delta);
    },
    [phase, siteId],
  );

  const setData = useCallback((next: T | ((previous: T) => T)) => {
    const scope = scopeRef.current;
    if (scope?.draft && scope.phase === phase && scope.siteId === siteId) {
      const value = typeof next === "function" ? next(scope.draft.value) : next;
      scope.draft.setLocal(value);
    }
  }, [phase, siteId]);

  return { data, setData, save, patch, loaded, lastSaved, saving };
}
