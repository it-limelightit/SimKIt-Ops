import { createFileRoute, Outlet } from "@tanstack/react-router";
export const Route = createFileRoute("/manager/attendance")({
  ssr: false,
  head: () => ({ meta: [{ title: "Attendance — SIM-Kit Ops" }] }),
  component: () => <Outlet />,
});
