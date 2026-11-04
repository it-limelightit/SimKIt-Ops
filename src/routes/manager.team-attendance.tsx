import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-store";
import { isTeamLead } from "@/lib/attendance-access";
import { TeamAttendance } from "@/components/attendance/TeamAttendance";

export const Route = createFileRoute("/manager/team-attendance")({
  ssr: false,
  head: () => ({ meta: [{ title: "Team attendance — SIM-Kit Ops" }] }),
  component: ManagerTeamAttendanceRoute,
});

function ManagerTeamAttendanceRoute() {
  const navigate = useNavigate();
  const email = useAuth((state) => state.email);
  const allowed = isTeamLead(email);
  useEffect(() => {
    if (email && !allowed) void navigate({ to: "/manager" });
  }, [navigate, email, allowed]);
  return allowed ? (
    <main className="w-full p-4 sm:p-5">
      <TeamAttendance />
    </main>
  ) : null;
}
