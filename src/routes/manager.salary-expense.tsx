import { createFileRoute } from "@tanstack/react-router";
import { FinanceWorkspace } from "@/components/finance/FinanceWorkspace";
export const Route = createFileRoute("/manager/salary-expense")({
  ssr: false,
  head: () => ({ meta: [{ title: "Salary / Expense — SIM-Kit Ops" }] }),
  component: FinanceWorkspace,
});
