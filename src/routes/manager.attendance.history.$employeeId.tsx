import { createFileRoute } from "@tanstack/react-router";
import { EmployeeAttendancePage } from "@/components/attendance/EmployeeAttendancePage";

export const Route = createFileRoute("/manager/attendance/history/$employeeId")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    date: typeof search.date === "string" ? search.date : undefined,
  }),
  head: () => ({ meta: [{ title: "Employee attendance history — SIM-Kit Ops" }] }),
  component: EmployeeAttendancePage,
});
