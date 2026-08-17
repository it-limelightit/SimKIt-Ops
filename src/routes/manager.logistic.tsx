import { createFileRoute } from "@tanstack/react-router";
import { InventoryPanel } from "@/components/inventory/InventoryPanel";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Card } from "@/components/ui-kit";
import { toast } from "sonner";
import { Database, UserCheck, RefreshCw, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/manager/logistic")({
  ssr: false,
  head: () => ({ meta: [{ title: "Logistic — SIM-Kit Ops" }] }),
  component: LogisticPageWithSeeder,
});

function LogisticPageWithSeeder() {
  const [seeding, setSeeding] = useState(false);

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
          // Check if user already exists in auth but profile is missing
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
          
          // Retry profile update up to 3 times in case the async db trigger has a slight lag
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
              
            if (!updateError) {
              break;
            }
            if (attempt === 3) {
              console.error("Failed to update profile after 3 attempts:", updateError);
            } else {
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }
      }

      if (!jenilId) {
        throw new Error("Could not retrieve or create a profile for Jenil Thakar");
      }

      // Ensure role is 'worker' (Field Associate) in user_roles
      const { data: userRoles } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", jenilId)
        .eq("role", "worker")
        .limit(1);

      if (!userRoles || userRoles.length === 0) {
        await supabase.from("user_roles").insert({
          user_id: jenilId,
          role: "worker"
        });
      }

      // 2. Fetch all sites to do fuzzy matching
      const { data: sites, error: sitesError } = await supabase.from("sites").select("*");
      if (sitesError) throw sitesError;

      // The 4 companies containing dates:
      const companiesData = [
        {
          shortName: "Motexo",
          date: "2026-07-29",
          ct1: "TRUE", ct2: "TRUE", ct3: "TRUE",
          proxy1: "FALSE", proxy2: "FALSE",
          encoder: "FALSE",
          vibration: "TRUE",
          antenna: "TRUE",
          tower_light: "TRUE",
          energy_meter: "TRUE",
          dispatch: "FALSE"
        },
        {
          shortName: "Hi Will",
          date: "2026-07-29",
          ct1: "TRUE", ct2: "TRUE", ct3: "TRUE",
          proxy1: "FALSE", proxy2: "FALSE",
          encoder: "FALSE",
          vibration: "TRUE",
          antenna: "TRUE",
          tower_light: "TRUE",
          energy_meter: "TRUE",
          dispatch: "FALSE"
        },
        {
          shortName: "Lexicon",
          date: "2026-07-29",
          ct1: "TRUE", ct2: "TRUE", ct3: "TRUE",
          proxy1: "FALSE", proxy2: "FALSE",
          encoder: "FALSE",
          vibration: "TRUE",
          antenna: "TRUE",
          tower_light: "TRUE",
          energy_meter: "TRUE",
          dispatch: "FALSE"
        },
        {
          shortName: "Dolphin",
          date: "2026-08-11",
          ct1: "TRUE", ct2: "TRUE", ct3: "TRUE",
          proxy1: "FALSE", proxy2: "FALSE",
          encoder: "FALSE",
          vibration: "TRUE",
          antenna: "TRUE",
          tower_light: "TRUE",
          energy_meter: "TRUE",
          dispatch: "FALSE"
        }
      ];

      let matchCount = 0;

      for (const comp of companiesData) {
        // Find matching site
        const matchedSite = sites.find(s => 
          s.name.toLowerCase().includes(comp.shortName.toLowerCase()) || 
          (s.company_name && s.company_name.toLowerCase().includes(comp.shortName.toLowerCase()))
        );

        if (!matchedSite) {
          if (!isAuto) toast.error(`Could not find a site in DB matching: ${comp.shortName}`);
          continue;
        }

        matchCount++;
        const companyFullName = matchedSite.company_name || matchedSite.name;
        if (!isAuto) {
          toast.loading(`Processing matched site: ${companyFullName}...`, { id: toastId });
        }

        // A. Assign company to Jenil Thakar and update status
        let taskNotes = matchedSite.task_notes || "";
        let meta = { worker_ids: [] as string[], status: "Assessed" };
        const prefix = "[METADATA:";
        const idx = taskNotes.indexOf(prefix);
        if (idx !== -1) {
          try {
            const start = idx + prefix.length;
            let depth = 0;
            let jsonStr = "";
            for (let i = start; i < taskNotes.length; i++) {
              if (taskNotes[i] === "{") depth++;
              else if (taskNotes[i] === "}") {
                depth--;
                if (depth === 0) {
                  jsonStr = taskNotes.slice(start, i + 1);
                  break;
                }
              }
            }
            meta = { ...meta, ...JSON.parse(jsonStr) };
          } catch (e) {
            console.error("Error parsing metadata:", e);
          }
        }

        if (!meta.worker_ids.includes(jenilId)) {
          meta.worker_ids.push(jenilId);
        }
        meta.status = "Assessed";

        // Strip old metadata block and serialize new one
        let baseNotes = taskNotes;
        if (idx !== -1) {
          const start = idx + prefix.length;
          let depth = 0;
          for (let i = start; i < taskNotes.length; i++) {
            if (taskNotes[i] === "{") depth++;
            else if (taskNotes[i] === "}") {
              depth--;
              if (depth === 0) {
                const end = i + 1 + (taskNotes[i + 1] === "]" ? 1 : 0);
                baseNotes = taskNotes.slice(0, idx) + taskNotes.slice(end);
                break;
              }
            }
          }
        }
        const newNotes = `[METADATA:${JSON.stringify(meta)}]${baseNotes}`;

        // Update site in database
        const { error: siteUpdateError } = await supabase
          .from("sites")
          .update({
            assigned_worker_id: jenilId,
            assigned_at: new Date().toISOString(),
            task_notes: newNotes,
            consultant_stage: "Billing"
          } as any)
          .eq("id", matchedSite.id);

        if (siteUpdateError) throw siteUpdateError;

        // B. Check or Insert inventory_materials entry (Logistics panel)
        const { data: existingMaterials } = await supabase
          .from("inventory_materials")
          .select("id, state, dispatch, tracking_number, notes")
          .eq("material_name", companyFullName)
          .limit(1);

        const payload: any = {
          material_name: companyFullName,
          location: matchedSite.address || matchedSite.city || "Address not specified",
          device_id: "SIM-Kit Gateway V3",
          submitted: true,
          ct1: comp.ct1,
          ct2: comp.ct2,
          ct3: comp.ct3,
          proxy_model: comp.proxy1 === "TRUE" ? "inductive" : null,
          proxy1: comp.proxy1,
          proxy2: comp.proxy2,
          encoder: comp.encoder,
          vibration: comp.vibration,
          vibration_model: comp.vibration === "TRUE" ? "renke" : null,
          antenna: comp.antenna,
          tower_light: comp.tower_light,
          energy_meter: comp.energy_meter,
          plc: "FALSE",
          created_by: jenilId,
          quantity: 1,
          unit: "pcs",
          created_at: `${comp.date}T10:00:00Z`,
          updated_at: `${comp.date}T10:00:00Z`,
          installation_date: comp.date,
        };

        if (existingMaterials && existingMaterials.length > 0) {
          const existing = existingMaterials[0];
          payload.state = existing.state || "Available";
          payload.dispatch = existing.dispatch || null;
          payload.tracking_number = existing.tracking_number || null;
          payload.notes = existing.notes;

          const { error: matUpdateError } = await supabase
            .from("inventory_materials")
            .update(payload)
            .eq("id", existing.id);
          if (matUpdateError) throw matUpdateError;
        } else {
          payload.state = "Available";
          payload.notes = JSON.stringify({
            courier_partner: "",
            packing_date: "",
            transit_date: "",
            arrived_date: "",
            courier_id: "",
            logistics_status: "Pending"
          });

          const { error: matInsertError } = await supabase
            .from("inventory_materials")
            .insert(payload);
          if (matInsertError) throw matInsertError;
        }
      }

      toast.success(
        isAuto 
          ? `Auto-sync: Verified ${matchCount} company logistics entries.` 
          : `Successfully matched and updated ${matchCount} company logistics entries!`, 
        { id: toastId }
      );
    } catch (err: any) {
      toast.error("Failed to seed/sync data: " + (err.message || err), { id: toastId });
    } finally {
      setSeeding(false);
    }
  };

  // Run automatically on component mount if not synced
  useState(() => {
    async function checkAndSync() {
      try {
        const { data: existingProfiles } = await supabase
          .from("profiles")
          .select("id")
          .ilike("name", "%Jenil%")
          .limit(1);

        const jenilId = existingProfiles?.[0]?.id;

        const { data: sites } = await supabase.from("sites").select("id, name, company_name, assigned_worker_id, consultant_stage");
        if (!sites) return;

        const shortNames = ["Motexo", "Hi Will", "Lexicon", "Dolphin"];
        const matchedSites = shortNames.map(name => 
          sites.find(s => 
            s.name.toLowerCase().includes(name.toLowerCase()) || 
            (s.company_name && s.company_name.toLowerCase().includes(name.toLowerCase()))
          )
        ).filter(Boolean);

        const matchedNames = matchedSites.map(s => s!.company_name || s!.name);
        const { data: existingMaterials } = await supabase
          .from("inventory_materials")
          .select("material_name, created_by")
          .in("material_name", matchedNames);

        const needsSync = !jenilId;

        // Cleanup duplicates from inventory_materials
        const { data: allMaterials } = await supabase
          .from("inventory_materials")
          .select("id, material_name, location, created_at");

        if (allMaterials) {
          const groups: { [key: string]: typeof allMaterials } = {};
          for (const mat of allMaterials) {
            const key = mat.material_name.toLowerCase().trim();
            if (!groups[key]) groups[key] = [];
            groups[key].push(mat);
          }

          const idsToDelete: string[] = [];
          for (const key of Object.keys(groups)) {
            const list = groups[key];
            if (list.length > 1) {
              const scored = list.map(item => {
                let score = 0;
                const loc = (item.location || "").toLowerCase().trim();
                const name = item.material_name.toLowerCase().trim();
                
                if (loc.length > 0) score += 10;
                if (name.includes(loc) || loc.includes("m/s")) {
                  score -= 20;
                } else {
                  score += loc.length;
                }
                return { item, score };
              });

              scored.sort((a, b) => b.score - a.score);

              for (let i = 1; i < scored.length; i++) {
                idsToDelete.push(scored[i].item.id);
              }
            }
          }

          if (idsToDelete.length > 0) {
            console.log(`[Cleanup] Deleting duplicate inventory ids:`, idsToDelete);
            await supabase.from("inventory_materials").delete().in("id", idsToDelete);
          }
        }

        if (needsSync) {
          console.log("[Auto-Sync] Logistics/Associate records need update. Running sync...");
          void runSeeder(true);
        }
      } catch (e) {
        console.error("Auto sync check failed:", e);
      }
    }
    void checkAndSync();
  });

  return (
    <div className="space-y-6">
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
          onClick={runSeeder}
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
      
      <InventoryPanel editable defaultFilterState="Pending" />
    </div>
  );
}


