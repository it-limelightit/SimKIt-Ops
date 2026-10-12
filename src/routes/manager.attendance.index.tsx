import { createFileRoute } from "@tanstack/react-router";
import { AttendancePanel } from "@/components/attendance/AttendancePanel";

export const Route = createFileRoute("/manager/attendance/")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    date: typeof search.date === "string" ? search.date : undefined,
  }),
  head: () => ({ meta: [{ title: "Attendance — SIM-Kit Ops" }] }),
  component: AttendancePanel,
});
