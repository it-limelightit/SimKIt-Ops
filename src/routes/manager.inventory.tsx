import { createFileRoute } from "@tanstack/react-router";
import { InventoryWorkspace } from "@/components/inventory/InventoryWorkspace";

export const Route = createFileRoute("/manager/inventory")({
  ssr: false,
  head: () => ({ meta: [{ title: "Inventory Management — SIM-Kit Ops" }] }),
  component: InventoryWorkspace,
});
