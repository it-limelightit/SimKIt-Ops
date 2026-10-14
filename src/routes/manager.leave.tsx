import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-store";
import { canAccessLeave, isTarunLeaveReviewer } from "@/lib/attendance-access";
import { LeaveWorkspace } from "@/components/attendance/LeaveWorkspace";

export const Route = createFileRoute("/manager/leave")({
  ssr: false,
  head: () => ({ meta: [{ title: "My leave — SIM-Kit Ops" }] }),
  component: ManagerLeaveRoute,
});

function ManagerLeaveRoute() {
  const navigate = useNavigate();
  const email = useAuth((state) => state.email);
  const leaveAllowed = canAccessLeave(email);
  const tarunReviewer = isTarunLeaveReviewer(email);
  useEffect(() => {
    if (tarunReviewer) void navigate({ to: "/manager/attendance", search: { date: undefined } });
    else if (email && !leaveAllowed) void navigate({ to: "/manager" });
  }, [navigate, tarunReviewer, email, leaveAllowed]);
  return tarunReviewer || !leaveAllowed ? null : <LeaveWorkspace />;
}
