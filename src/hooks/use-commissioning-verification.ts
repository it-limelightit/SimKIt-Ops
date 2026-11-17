import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CommissioningVerification = {
  id?: string;
  created_at?: string;
  status:
    | "queued"
    | "checking"
    | "passed"
    | "needs_correction"
    | "needs_review"
    | "technical_error"
    | "superseded"
    | "approved";
  messages: string[];
  photo_count?: number;
  video_count?: number;
  video_average_seconds?: number;
};

// Opt-in after the migration is deployed; legacy installations make no new RPC calls.
const enabled = import.meta.env.VITE_COMMISSIONING_VERIFICATION_ENABLED !== "false";

type Context = {
  mode: "automatic" | "historical" | "completed";
  ready: boolean;
  reason?: string;
  verification: CommissioningVerification | null;
};

export function useCommissioningVerification(siteId: string) {
  const [context, setContext] = useState<Context | null>(null);
  const currentSite = useRef(siteId);
  currentSite.current = siteId;
  const refreshVerification = useCallback(async () => {
    if (!enabled) return null;
    const { data, error } = await supabase.rpc(
      "commissioning_verification_context" as never,
      { _site_id: siteId } as never,
    );
    if (error) return null;
    const result = data as Context | null;
    if (currentSite.current === siteId) setContext(result);
    return result?.verification ?? null;
  }, [siteId]);
  useEffect(() => {
    setContext(null);
    if (!enabled) return;
    let active = true;
    const refresh = async () => {
      if (active) await refreshVerification();
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshVerification]);
  return {
    verification: context?.verification ?? null,
    mode: context?.mode ?? "automatic",
    refreshVerification,
  };
}
