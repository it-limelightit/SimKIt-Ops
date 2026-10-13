import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-store";
import { isTarunLeaveReviewer } from "@/lib/attendance-access";
import { LeaveWorkspace } from "@/components/attendance/LeaveWorkspace";

export const Route = createFileRoute("/manager/leave")({
  ssr: false,
  head: () => ({ meta: [{ title: "My leave — SIM-Kit Ops" }] }),
  component: ManagerLeaveRoute,
});

function ManagerLeaveRoute() {
  const navigate = useNavigate();
  const email = useAuth((state) => state.email);
  const tarunReviewer = isTarunLeaveReviewer(email);
  useEffect(() => {
    if (tarunReviewer) void navigate({ to: "/manager/attendance", search: { date: undefined } });
  }, [navigate, tarunReviewer]);
  return tarunReviewer ? null : <LeaveWorkspace />;
}
