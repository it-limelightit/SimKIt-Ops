import { createFileRoute } from "@tanstack/react-router";
import { InventoryStockPanel } from "@/components/inventory/InventoryStockPanel";
import { AssociateExtraInventory } from "@/components/inventory/AssociateExtraInventory";
import { InventoryHistoryPanel } from "@/components/inventory/InventoryHistoryPanel";
import { FirmwareInventory } from "@/components/inventory/FirmwareInventory";
import { Button } from "@/components/ui-kit";
import { useState } from "react";

export const Route = createFileRoute("/manager/inventory")({
  ssr: false,
  head: () => ({ meta: [{ title: "Inventory Management — SIM-Kit Ops" }] }),
  component: ManagerInventoryPage,
});

function ManagerInventoryPage() {
  const [tab, setTab] = useState<"stock" | "history" | "associates" | "firmware">("stock");
  return (
    <div className="min-w-0 space-y-5">
      <div className="grid min-w-0 grid-cols-1 gap-2 border-b border-border pb-3 sm:grid-cols-2 xl:flex xl:flex-wrap [&>button]:min-w-0 [&>button]:whitespace-normal">
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
        <Button
          variant={tab === "firmware" ? "primary" : "secondary"}
          onClick={() => setTab("firmware")}
          aria-pressed={tab === "firmware"}
        >
          Firmware Inventory History
        </Button>
      </div>
      {tab === "stock" ? (
        <InventoryStockPanel />
      ) : tab === "history" ? (
        <InventoryHistoryPanel />
      ) : tab === "firmware" ? (
        <FirmwareInventory manager />
      ) : (
        <AssociateExtraInventory manager />
      )}
    </div>
  );
}
