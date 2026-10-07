import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-store";
import { attendanceRpc, type AttendanceBoard } from "@/lib/device-attendance";

export function useDeviceAttendance(date: string) {
  const { userId, role } = useAuth();
  const [board, setBoard] = useState<AttendanceBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    if (!userId || role !== "supervisor") return;
    const ticket = ++generation.current;
    try {
      const next = await attendanceRpc<AttendanceBoard>("attendance_board", { _date: date });
      if (ticket !== generation.current || useAuth.getState().userId !== userId) return;
      setBoard(next);
      setError(null);
    } catch (failure) {
      if (ticket === generation.current)
        setError(failure instanceof Error ? failure.message : "Could not load attendance.");
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [date, userId, role]);
  useEffect(() => {
    const requests = generation;
    setBoard(null);
    setLoading(true);
    setError(null);
    void reload();
    const timer = window.setInterval(() => void reload(), 15000);
    const refresh = () => void reload();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      ++requests.current;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [reload]);
  return { board, error, loading, reload };
}
