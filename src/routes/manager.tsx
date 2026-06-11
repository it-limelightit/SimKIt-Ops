import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-store";
import { StaffShell } from "@/components/staff/StaffShell";

export const Route = createFileRoute("/manager")({
  ssr: false,
  head: () => ({ meta: [{ title: "Manager — SIM-Kit Ops" }] }),
  component: ManagerLayout,
});

function ManagerLayout() {
  const navigate = useNavigate();
  const { ready, userId, role } = useAuth();
  useEffect(() => {
    if (!ready) return;
    if (!userId) navigate({ to: "/auth" });
    else if (role && role !== "supervisor") navigate({ to: "/business-consultant" });
  }, [ready, userId, role, navigate]);
  if (!ready || !userId || role !== "supervisor") return null;
  return (
    <StaffShell role="supervisor">
      <Outlet />
    </StaffShell>
  );
}
