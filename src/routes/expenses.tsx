import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FinanceWorkspace } from "@/components/finance/FinanceWorkspace";
import { useAuth } from "@/lib/auth-store";
import { canManageFinance } from "@/lib/finance";
export const Route = createFileRoute("/expenses")({
  ssr: false,
  head: () => ({ meta: [{ title: "My Expenses — SIM-Kit Ops" }] }),
  component: ExpensesPage,
});
function ExpensesPage() {
  const { ready, userId, email } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    document.documentElement.classList.toggle(
      "light-theme",
      localStorage.getItem("themeMode") !== "dark",
    );
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (!userId) void navigate({ to: "/auth" });
    else if (canManageFinance(email)) void navigate({ to: "/manager/salary-expense" });
  }, [ready, userId, email, navigate]);
  if (!ready || !userId || canManageFinance(email)) return null;
  return (
    <div className="min-h-screen bg-background text-text-primary">
      <FinanceWorkspace personal />
    </div>
  );
}
