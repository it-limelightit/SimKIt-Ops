import { createFileRoute } from "@tanstack/react-router";
import { InventoryStockPanel } from "@/components/inventory/InventoryStockPanel";
import { AssociateExtraInventory } from "@/components/inventory/AssociateExtraInventory";
import { InventoryHistoryPanel } from "@/components/inventory/InventoryHistoryPanel";
import { Button } from "@/components/ui-kit";
import { useState } from "react";

export const Route = createFileRoute("/manager/inventory")({
  ssr: false,
  head: () => ({ meta: [{ title: "Inventory Management — SIM-Kit Ops" }] }),
  component: ManagerInventoryPage,
});

function ManagerInventoryPage() {
  const [tab, setTab] = useState<"stock" | "history" | "associates">("stock");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        <Button
          variant={tab === "stock" ? "primary" : "secondary"}
          onClick={() => setTab("stock")}
          aria-pressed={tab === "stock"}
        >
          Central Inventory
        </Button>
        <Button
          variant={tab === "history" ? "primary" : "secondary"}
          onClick={() => setTab("history")}
          aria-pressed={tab === "history"}
        >
          Inventory History
        </Button>
        <Button
          variant={tab === "associates" ? "primary" : "secondary"}
          onClick={() => setTab("associates")}
          aria-pressed={tab === "associates"}
        >
          Field Associate Inventory
        </Button>
      </div>
      {tab === "stock" ? <InventoryStockPanel /> : tab === "history" ? <InventoryHistoryPanel /> : <AssociateExtraInventory manager />}
    </div>
  );
}
