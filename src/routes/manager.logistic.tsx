import { createFileRoute } from "@tanstack/react-router";
import { InventoryPanel } from "@/components/inventory/InventoryPanel";

export const Route = createFileRoute("/manager/logistic")({
  ssr: false,
  head: () => ({ meta: [{ title: "Logistic — SIM-Kit Ops" }] }),
  component: () => <InventoryPanel editable />,
});
