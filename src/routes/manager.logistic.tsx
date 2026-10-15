import { createFileRoute } from "@tanstack/react-router";
import { InventoryPanel } from "@/components/inventory/InventoryPanel";
import { UpscaleLogisticsPanel } from "@/components/inventory/UpscaleLogisticsPanel";
import { UpscaleDeviceInfoPanel } from "@/components/inventory/UpscaleDeviceInfoPanel";
import { useState } from "react";
import { Truck, Table2 } from "lucide-react";

export const Route = createFileRoute("/manager/logistic")({
  ssr: false,
  head: () => ({ meta: [{ title: "Logistic — SIM-Kit Ops" }] }),
  component: LogisticPage,
});

function LogisticPage() {
  const [activeTab, setActiveTab] = useState<"dispatch" | "deviceInfo">("dispatch");
  const [selectedSource, setSelectedSource] = useState<"simkit" | "upscale" | null>(null);
  const [resultsHost, setResultsHost] = useState<HTMLDivElement | null>(null);

  return (
    <div className="space-y-6">
      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-border/80 pb-3">
        <button
          onClick={() => setActiveTab("dispatch")}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "dispatch"
              ? "bg-violet text-white shadow-md"
              : "bg-surface-raised/40 text-text-secondary hover:text-text-primary"
          }`}
        >
          <Truck size={15} />
          Logistics Dispatching
        </button>
        <button
          onClick={() => setActiveTab("deviceInfo")}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "deviceInfo"
              ? "bg-violet text-white shadow-md"
              : "bg-surface-raised/40 text-text-secondary hover:text-text-primary"
          }`}
        >
          <Table2 size={15} />
          Device Info
        </button>
      </div>

      {activeTab === "dispatch" ? (
        <div className="space-y-7">
          <section aria-labelledby="simkit-orders-heading" className="space-y-4">
            <div className="border-b border-border/80 pb-3">
              <h2 id="simkit-orders-heading" className="font-syne text-xl font-bold text-text-primary">Simkit</h2>
            </div>
            <InventoryPanel
              editable defaultFilterState="all" viewMode="cards" revealOnMetricClick
              activeOrderSource={selectedSource}
              onMetricSelect={() => setSelectedSource("simkit")}
              resultsHost={resultsHost}
            />
          </section>
          <section aria-labelledby="upscale-orders-heading" className="space-y-4">
            <div className="border-b border-border/80 pb-3">
              <h2 id="upscale-orders-heading" className="font-syne text-xl font-bold text-text-primary">Upscale</h2>
            </div>
            <UpscaleLogisticsPanel
              activeOrderSource={selectedSource}
              onMetricSelect={() => setSelectedSource("upscale")}
              resultsHost={resultsHost}
            />
          </section>
          <div ref={setResultsHost} className="empty:hidden" />
        </div>
      ) : (
        <div className="space-y-7">
          <section aria-labelledby="simkit-device-info-heading" className="space-y-4">
            <div className="border-b border-border/80 pb-3">
              <h2 id="simkit-device-info-heading" className="font-syne text-xl font-bold text-text-primary">Simkit</h2>
            </div>
            <InventoryPanel editable defaultFilterState="all" viewMode="table" showLogisticsKtas={false} />
          </section>
          <section aria-labelledby="upscale-device-info-heading" className="space-y-4">
            <div className="border-b border-border/80 pb-3">
              <h2 id="upscale-device-info-heading" className="font-syne text-xl font-bold text-text-primary">Upscale</h2>
            </div>
            <UpscaleDeviceInfoPanel />
          </section>
        </div>
      )}
    </div>
  );
}
