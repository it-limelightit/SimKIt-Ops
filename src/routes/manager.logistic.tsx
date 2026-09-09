import { createFileRoute } from "@tanstack/react-router";
import { InventoryPanel } from "@/components/inventory/InventoryPanel";
import { InventoryStockPanel } from "@/components/inventory/InventoryStockPanel";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Card } from "@/components/ui-kit";
import { toast } from "sonner";
import { Database, UserCheck, RefreshCw, Truck, Boxes, Table2 } from "lucide-react";

export const Route = createFileRoute("/manager/logistic")({
  ssr: false,
  head: () => ({ meta: [{ title: "Logistic — SIM-Kit Ops" }] }),
  component: LogisticPageWithSeeder,
});

function LogisticPageWithSeeder() {
  const [seeding, setSeeding] = useState(false);
  const [activeTab, setActiveTab] = useState<"dispatch" | "deviceInfo" | "inventory">("dispatch");

  const runSeeder = async (isAuto = false) => {
    setSeeding(true);
    const toastId = isAuto 
      ? toast.loading("Auto-syncing logistics and associate records...") 
      : toast.loading("Checking and seeding database data...");
    try {
      // 1. Check or Create Jenil Thakar profile
      let jenilId = "";
      const { data: existingProfiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, name, email")
        .ilike("name", "%Jenil%")
        .limit(1);

      if (profileError) throw profileError;

      if (existingProfiles && existingProfiles.length > 0) {
        jenilId = existingProfiles[0].id;
        if (!isAuto) {
          toast.loading(`Found existing profile for Jenil Thakar (ID: ${jenilId})...`, { id: toastId });
        }
      } else {
        if (!isAuto) {
          toast.loading("Jenil Thakar profile not found. Registering new associate account...", { id: toastId });
        }
        const email = "jenilthakar@gmail.com";
        const password = "Password123!";
        
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: "Jenil Thakar",
              mobile: "9876543210",
              whatsapp: "9876543210",
            }
          }
        });

        if (authError) {
          toast.error("Auth signUp failed: " + authError.message, { id: toastId });
          const { data: retryProfiles } = await supabase
            .from("profiles")
            .select("id")
            .eq("email", email)
            .limit(1);
          if (retryProfiles && retryProfiles.length > 0) {
            jenilId = retryProfiles[0].id;
          } else {
            throw authError;
          }
        } else if (authData?.user) {
          jenilId = authData.user.id;
          
          for (let attempt = 1; attempt <= 3; attempt++) {
            const { error: updateError } = await supabase
              .from("profiles")
              .update({
                is_active: true,
                name: "Jenil Thakar",
                mobile: "9876543210",
                whatsapp: "9876543210"
              } as any)
              .eq("id", jenilId);
              
            if (!updateError) break;
            if (attempt === 3) console.error("Failed to update profile after 3 attempts:", updateError);
            else await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      }

      if (!jenilId) throw new Error("Could not retrieve or create a profile for Jenil Thakar");

      toast.success(
        isAuto 
          ? `Auto-sync complete.` 
          : `Successfully matched and updated logistics entries!`, 
        { id: toastId }
      );
    } catch (err: any) {
      toast.error("Failed to seed/sync data: " + (err.message || err), { id: toastId });
    } finally {
      setSeeding(false);
    }
  };

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
        <button
          onClick={() => setActiveTab("inventory")}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "inventory"
              ? "bg-violet text-white shadow-md"
              : "bg-surface-raised/40 text-text-secondary hover:text-text-primary"
          }`}
        >
          <Boxes size={15} />
          Inventory Management
        </button>
      </div>

      {activeTab === "inventory" ? (
        <InventoryStockPanel />
      ) : (
        <>
          {/* Premium Debug/Data Seeding panel */}
          <Card className="border border-border/80 bg-surface-raised/20 p-5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-md font-bold text-text-primary flex items-center gap-2">
                <Database size={16} className="text-violet" />
                Field Associate & Logistics Synchronization
              </h3>
              <p className="text-xs text-text-secondary">
                Sync client requirements data for Motexo, Hi Will, Lexicon, and Dolphin Polymers. Automatically creates associate <strong>Jenil Thakar</strong>, assigns companies, and lists details in Logistics.
              </p>
            </div>
            <Button
              onClick={() => runSeeder()}
              disabled={seeding}
              className="bg-violet hover:bg-violet-dark text-white font-sans text-xs uppercase font-extrabold tracking-wider px-5 py-2.5 h-10 flex items-center gap-2 rounded-lg cursor-pointer transition-all shrink-0"
            >
              {seeding ? (
                <RefreshCw className="animate-spin" size={14} />
              ) : (
                <UserCheck size={14} />
              )}
              {seeding ? "Syncing..." : "Sync Logistics Data"}
            </Button>
          </Card>
          
          <InventoryPanel
            editable
            defaultFilterState="all"
            viewMode={activeTab === "deviceInfo" ? "table" : "cards"}
            showLogisticsKtas={activeTab !== "deviceInfo"}
          />
        </>
      )}
    </div>
  );
}
