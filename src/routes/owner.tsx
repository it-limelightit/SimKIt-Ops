import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-store";
import { StaffShell } from "@/components/staff/StaffShell";

export const Route = createFileRoute("/owner")({
  ssr: false,
  head: () => ({ meta: [{ title: "Owner — SIM-Kit Ops" }] }),
  component: OwnerLayout,
});

function OwnerLayout() {
  const navigate = useNavigate();
  const { ready, userId, role } = useAuth();
  useEffect(() => {
    if (!ready) return;
    if (!userId) navigate({ to: "/auth" });
    else if (role !== "owner") navigate({ to: `/${role ?? "worker"}` as "/worker" });
  }, [ready, userId, role, navigate]);
  if (!ready || role !== "owner") return null;
  return (
    <StaffShell role="owner">
      <Outlet />
    </StaffShell>
  );
}
