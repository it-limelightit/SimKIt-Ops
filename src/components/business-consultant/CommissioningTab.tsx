import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Badge,
  Button,
  Card,
  Input,
} from "@/components/ui-kit";
import { toast } from "sonner";
import { usePhaseData } from "@/lib/use-phase-data";
import { advanceSiteVisitStatus } from "@/lib/site-metadata";

type Props = {
  siteId: string;
  workerId: string;
  hiddenSections?: string[];
  onSubmit?: () => void | Promise<void>;
  /** Field-associate submissions require manager approval. */
  requireApproval?: boolean;
  viewerEmail?: string | null;
};

export function CommissioningTab({ siteId, workerId, hiddenSections, onSubmit, requireApproval = false, viewerEmail }: Props) {
  const { data, patch, save, loaded, lastSaved, saving } = usePhaseData<Record<string, any>>(
    "commissioning",
    siteId,
    workerId,
    {},
  );
  const [approvalRequest, setApprovalRequest] = useState<{ id: string; drive_link: string; status: string } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const canReview = ["patidarnit21@gmail.com", "info@limelightit.io"].includes((viewerEmail || "").toLowerCase());

  useEffect(() => {
    if (!canReview) return;
    void supabase
      .from("commissioning_approval_requests")
      .select("id,drive_link,status")
      .eq("site_id", siteId)
      .maybeSingle()
      .then(({ data }) => setApprovalRequest(data));
  }, [canReview, siteId]);

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
  const commissioningLabel = requireApproval
    ? data.commissioning_approval_status === "pending"
      ? "Approval Pending"
      : isCommissioned
        ? "Ready for Approval"
        : "Pending"
    : isCommissioned
      ? "Commissioned"
      : "Pending";

  const buildCommissionedData = (base: Record<string, any> = data) => {
    const submittedAt = nowIso();
    return {
      ...base,
      coordination_done: true,
      coordination_at: base.coordination_at || submittedAt,
      visit_done: true,
      visit_at: base.visit_at || submittedAt,
      connection_done: true,
      connection_at: base.connection_at || submittedAt,
      configure_done: true,
      configure_at: base.configure_at || submittedAt,
      testing_done: true,
      testing_at: base.testing_at || submittedAt,
      screenshots_uploaded: true,
      screenshots_uploaded_at: base.screenshots_uploaded_at || submittedAt,
      certificate_sent: true,
      certificate_sent_at: base.certificate_sent_at || submittedAt,
      final_mom_uploaded: true,
      final_mom_uploaded_at: base.final_mom_uploaded_at || submittedAt,
      commissioning_phase_submitted: true,
      commissioning_phase_submitted_at: base.commissioning_phase_submitted_at || submittedAt,
    };
  };

  const isGoogleDriveLink = (value: string) =>
    /^https?:\/\/(?:drive|docs)\.google\.com\//i.test(value.trim());

  const submitForApproval = async () => {
    const driveLink = String(data.commissioning_drive_link || "").trim();
    if (!isGoogleDriveLink(driveLink)) {
      toast.error("Please enter a valid Google Drive link before submitting.");
      return;
    }

    const saved = await save({
      ...data,
      commissioning_drive_link: driveLink,
      commissioning_approval_status: "pending",
      commissioning_approval_requested_at: nowIso(),
    });
    if (!saved) return;

    const { error } = await supabase.rpc("submit_commissioning_approval_request", {
      _site_id: siteId,
      _drive_link: driveLink,
    });
    if (error) {
      toast.error(error.message || "Could not submit the approval request.");
      return;
    }

    toast.success("Commissioning request sent for manager approval.");
    if (onSubmit) await onSubmit();
  };

  const reviewRequest = async (approved: boolean) => {
    if (!approvalRequest) return;
    setReviewing(true);
    const { error } = await supabase.rpc("review_commissioning_approval_request", {
      _request_id: approvalRequest.id,
      _approved: approved,
    });
    setReviewing(false);
    if (error) {
      toast.error(error.message || "Could not review the commissioning request.");
      return;
    }
    setApprovalRequest({ ...approvalRequest, status: approved ? "approved" : "rejected" });
    toast.success(approved ? "Commissioning approved." : "Commissioning request rejected.");
    if (onSubmit) await onSubmit();
  };

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
          <Badge tone={requireApproval && data.commissioning_approval_status === "pending" ? "warning" : isCommissioned ? "success" : "warning"}>
            {commissioningLabel}
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

        {requireApproval && (
          <div className="space-y-2">
            <label htmlFor="commissioning-drive-link" className="text-sm font-semibold text-text-primary">
              Google Drive Link <span className="text-red-500">*</span>
            </label>
            <Input
              id="commissioning-drive-link"
              type="url"
              placeholder="https://drive.google.com/..."
              value={data.commissioning_drive_link || ""}
              onChange={(event) => patch({ commissioning_drive_link: event.target.value })}
            />
            <p className="text-xs text-text-secondary">
              Your commissioning will stay at its current status until an approved manager confirms this request.
            </p>
          </div>
        )}
      </Card>

      {canReview && approvalRequest?.status === "pending" && (
        <Card className="mt-4 border-amber-400/40 p-5 space-y-3">
          <div>
            <h4 className="font-bold text-text-primary">Commissioning approval requested</h4>
            <a className="text-sm text-lime underline break-all" href={approvalRequest.drive_link} target="_blank" rel="noreferrer">
              View submitted Google Drive link
            </a>
          </div>
          <div className="flex gap-3">
            <Button disabled={reviewing} onClick={() => void reviewRequest(true)}>Approve commissioning</Button>
            <Button disabled={reviewing} variant="secondary" onClick={() => void reviewRequest(false)}>Reject request</Button>
          </div>
        </Card>
      )}

      <div className="mt-8 flex justify-end">
        <Button 
          onClick={async () => {
            if (!isCommissioned) {
              toast.error("Please confirm commissioning before submitting.");
              return;
            }
            if (requireApproval) {
              await submitForApproval();
              return;
            }
            const saved = await save(buildCommissionedData());
            if (!saved) return;
            if (onSubmit) await onSubmit();
          }} 
          className="w-full sm:w-auto text-base py-3 px-8"
        >
          {requireApproval ? "Request Commissioning Approval" : "Submit Commissioning Phase"}
        </Button>
      </div>
    </>
  );
}
