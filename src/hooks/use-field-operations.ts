import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-store";
import { fieldRpc, type FieldBoard } from "@/lib/field-operations";

export function useFieldOperations() {
  const { ready, userId } = useAuth();
  const [board, setBoard] = useState<FieldBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const result = await fieldRpc("field_ops_board");
      if (useAuth.getState().userId !== userId) return;
      if (result.error) {
        setUnavailable(result.error.code === "PGRST202" || result.error.code === "42883");
        setError(result.error.message);
      } else {
        setBoard(result.data as FieldBoard);
        setUnavailable(false);
        setError(null);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load field operations.");
    } finally {
      setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    setBoard(null);
    setLoading(true);
    if (!ready || !userId) return;
    let live = true;
    const refresh = () => {
      if (live) void load();
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [ready, userId, load]);
  return { board, error, unavailable, loading, reload: load };
}
