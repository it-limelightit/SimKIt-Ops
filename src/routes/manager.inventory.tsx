import { createFileRoute } from "@tanstack/react-router";
import { InventoryStockPanel } from "@/components/inventory/InventoryStockPanel";

export const Route = createFileRoute("/manager/inventory")({
  ssr: false,
  head: () => ({ meta: [{ title: "Inventory Management — SIM-Kit Ops" }] }),
  component: InventoryStockPanel,
});
