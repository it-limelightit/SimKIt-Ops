import { createFileRoute } from "@tanstack/react-router";
import { EmployeeCalendar } from "@/components/attendance/EmployeeCalendar";

/** Own office attendance for manager-workspace users who are also office staff
 *  (e.g. Hitesh bhai, Aryan). The server only ever returns the caller's own days. */
export const Route = createFileRoute("/manager/my-attendance")({
  ssr: false,
  head: () => ({ meta: [{ title: "My attendance — SIM-Kit Ops" }] }),
  component: () => (
    <main className="w-full p-4 sm:p-5">
      <EmployeeCalendar />
    </main>
  ),
});
