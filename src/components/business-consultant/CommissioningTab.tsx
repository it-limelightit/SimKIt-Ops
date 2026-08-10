import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Badge,
  Button,
  Card,
} from "@/components/ui-kit";
import { toast } from "sonner";
import { usePhaseData } from "@/lib/use-phase-data";
import { advanceSiteVisitStatus } from "@/lib/site-metadata";

type Props = { siteId: string; workerId: string; hiddenSections?: string[]; onSubmit?: () => void };

export function CommissioningTab({ siteId, workerId, hiddenSections, onSubmit }: Props) {
  const { data, patch, save, loaded, lastSaved, saving } = usePhaseData<Record<string, any>>(
    "commissioning",
    siteId,
    workerId,
    {},
  );

  if (!loaded) return null;
  const nowIso = () => new Date().toISOString();

  const isCommissioned = 
    !!data.coordination_done && 
    !!data.visit_done && 
    !!data.connection_done && 
    !!data.configure_done && 
    !!data.testing_done && 
    !!data.screenshots_uploaded && 
    !!data.certificate_sent && 
    !!data.final_mom_uploaded;

  const handleToggleCommissioned = async (checked: boolean) => {
    const patchObj: Record<string, any> = {
      coordination_done: checked,
      coordination_at: checked ? data.coordination_at || nowIso() : null,
      visit_done: checked,
      visit_at: checked ? data.visit_at || nowIso() : null,
      connection_done: checked,
      connection_at: checked ? data.connection_at || nowIso() : null,
      configure_done: checked,
      configure_at: checked ? data.configure_at || nowIso() : null,
      testing_done: checked,
      testing_at: checked ? data.testing_at || nowIso() : null,
      screenshots_uploaded: checked,
      screenshots_uploaded_at: checked ? data.screenshots_uploaded_at || nowIso() : null,
      certificate_sent: checked,
      certificate_sent_at: checked ? data.certificate_sent_at || nowIso() : null,
      final_mom_uploaded: checked,
      final_mom_uploaded_at: checked ? data.final_mom_uploaded_at || nowIso() : null,
    };

    patch(patchObj);
    if (checked) {
      advanceSiteVisitStatus(siteId, "Visit Complete");
    }
  };

  return (
    <>
      <div className="flex items-center justify-end gap-2 text-xs text-text-secondary pb-2">
        {saving ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            Saving…
          </span>
        ) : lastSaved ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
            Auto-saved {lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : (
          <span className="text-text-dim">Auto-save on</span>
        )}
      </div>

      <Card className="border-l-[3px] border-lime p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-text-primary">Commissioning Confirmation</h3>
            <p className="text-sm text-text-secondary mt-1">
              Confirm that all commissioning steps have been completed.
            </p>
          </div>
          <Badge tone={isCommissioned ? "success" : "warning"}>
            {isCommissioned ? "Commissioned" : "Pending"}
          </Badge>
        </div>

        <div className="flex items-start gap-3 p-4 bg-lime-dim/5 border border-lime/20 rounded-xl">
          <input
            type="checkbox"
            id="confirm-commissioned-checkbox"
            className="h-6 w-6 rounded border-gray-300 text-lime focus:ring-lime mt-0.5 cursor-pointer"
            checked={isCommissioned}
            onChange={(e) => handleToggleCommissioned(e.target.checked)}
          />
          <label htmlFor="confirm-commissioned-checkbox" className="text-base font-semibold text-text-primary select-none cursor-pointer">
            I have commissioned
          </label>
        </div>
      </Card>

      <div className="mt-8 flex justify-end">
        <Button 
          onClick={async () => {
            if (!isCommissioned) {
              toast.error("Please confirm commissioning before submitting.");
              return;
            }
            await save({ ...data, commissioning_phase_submitted: true });
            if (onSubmit) onSubmit();
          }} 
          className="w-full sm:w-auto text-base py-3 px-8"
        >
          Submit Commissioning Phase
        </Button>
      </div>
    </>
  );
}
