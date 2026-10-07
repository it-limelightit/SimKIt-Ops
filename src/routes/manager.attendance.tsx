import { createFileRoute } from "@tanstack/react-router";
import { AttendancePanel } from "@/components/attendance/AttendancePanel";
export const Route = createFileRoute("/manager/attendance")({
  ssr: false,
  head: () => ({ meta: [{ title: "Attendance — SIM-Kit Ops" }] }),
  component: AttendancePanel,
});
