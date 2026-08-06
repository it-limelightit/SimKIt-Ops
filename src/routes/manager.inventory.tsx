import { createFileRoute } from "@tanstack/react-router";
import { InventoryPanel } from "@/components/inventory/InventoryPanel";

export const Route = createFileRoute("/manager/inventory")({
  ssr: false,
  head: () => ({ meta: [{ title: "Inventory — SIM-Kit Ops" }] }),
  component: () => <InventoryPanel editable />,
});
