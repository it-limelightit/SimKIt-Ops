import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

type Result = {
  status: "checked" | "setup_required" | "check_failed";
  messages: string[];
  company_name?: string;
  folder_url?: string;
  api_setup_url?: string;
  diagnostic?: { category?: string };
  media_precheck_passed?: boolean;
  commissioning_state?:
    "queued" | "checking" | "approved" | "setup_required" | "needs_correction" | "historical";
  commissioning_message?: string;
  photo_count?: number;
  video_count?: number;
  video_average_seconds?: number | null;
  certificate_count?: number;
  videos?: { name: string; duration_seconds: number | null }[];
  certificates?: { name: string }[];
};

function shortNotice(result: Result | null, error: string) {
  if (!result && !error) return null;
  if (result?.commissioning_state === "approved")
    return { text: "Commissioned successfully.", error: false };
  if (result?.commissioning_state === "queued" || result?.commissioning_state === "checking")
    return { text: "Verifying commissioning evidence. Please wait.", error: false };
  if (result?.commissioning_state === "setup_required")
    return {
      text: /letter/i.test(result.commissioning_message ?? "")
        ? "Letter verification needs setup. Contact manager."
        : "Verification service needs setup. Contact manager.",
      error: true,
    };
  if (result?.commissioning_state === "historical")
    return { text: "Historical commissioning records remain protected.", error: false };
  if (result?.commissioning_state === "needs_correction")
    return {
      text: /PDF/i.test(result.commissioning_message ?? "")
        ? "Upload completed letter as PDF."
        : "Complete commissioning steps before verification.",
      error: true,
    };
  if (result?.status === "checked") {
    const photosMissing = (result.photo_count ?? 0) < 4;
    const videosMissing = (result.video_count ?? 0) < 4;
    let text = "";
    if (photosMissing && videosMissing) text = "Upload four photos and four video clips.";
    else if (photosMissing) text = "Upload at least four photos.";
    else if (videosMissing) text = "Upload at least four video clips.";
    else if (result.video_average_seconds == null)
      text = "Video duration unavailable. Retry shortly.";
    else if (result.video_average_seconds < 120) text = "Videos must average at least two minutes.";
    else if (!result.certificate_count) text = "Upload the completed commissioning letter.";
    else if (result.certificate_count > 1) text = "Keep only one final commissioning letter.";
    else if (result.media_precheck_passed === false)
      text = "Files need further verification before approval.";
    return { text: text || "Media checked. Letter approval still required.", error: Boolean(text) };
  }
  const details = [error, ...(result?.messages ?? [])].join(" ");
  const category = result?.diagnostic?.category;
  let text = "Drive check failed. Please try again.";
  if (result?.status === "setup_required") text = "Drive setup incomplete. Contact your manager.";
  else if (/one minute|quota|rate limit/i.test(details) || category === "quota")
    text = "Please wait one minute, then retry.";
  else if (/sign in|session/i.test(details)) text = "Session expired. Please sign in again.";
  else if (category === "api_disabled") text = "Enable Google Drive API, then retry.";
  else if (category === "scope_missing" || category === "authentication")
    text = "Drive authentication needs updating. Contact your manager.";
  else if (category === "folder_access") text = "Grant the service account Viewer access.";
  else if (/loop|circular/i.test(details)) text = "Remove circular Drive shortcuts, then retry.";
  else if (/missing or ambiguous/i.test(details)) text = "Company folder missing or duplicated.";
  return { text, error: true };
}

export function CommissioningDriveCheck({
  siteId,
  canConfigure,
  onFolderResolved,
  automatic = false,
  canCommission = true,
  onVerificationStarted,
}: {
  siteId: string;
  canConfigure: boolean;
  onFolderResolved?: (folderUrl: string) => void;
  automatic?: boolean;
  canCommission?: boolean;
  onVerificationStarted?: () => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [resultSite, setResultSite] = useState(siteId);
  const current = resultSite === siteId ? result : null;
  const notice = shortNotice(current, resultSite === siteId ? error : "");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function check() {
    setChecking(true);
    setError("");
    setResult(null);
    setResultSite(siteId);
    try {
      const { data, error: failure } = await supabase.functions.invoke(
        "commissioning-drive-check",
        {
          body: { site_id: siteId, action: automatic ? "commission" : "check" },
        },
      );
      if (!mounted.current) return;
      if (failure) {
        let message =
          "Drive check is unavailable. Confirm the function is deployed and you are signed in.";
        const response = (failure as { context?: Response }).context;
        if (response?.json) {
          const details = await response.json().catch(() => null);
          if (typeof details?.error === "string") message = details.error;
        }
        setError(message);
      } else if (data && ["checked", "setup_required", "check_failed"].includes(data.status)) {
        setResult(data as Result);
        if (data.status === "checked" && typeof data.folder_url === "string") {
          onFolderResolved?.(data.folder_url);
        }
        if (["queued", "checking", "approved"].includes(data.commissioning_state))
          onVerificationStarted?.();
      } else setError("Drive check returned an unexpected response. Please retry.");
    } catch {
      setError("Drive check could not connect. Please retry.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card className="mt-4 p-5 space-y-3">
      <Button
        variant="secondary"
        disabled={checking || (automatic && !canCommission)}
        onClick={() => void check()}
      >
        {checking ? "Verifying…" : automatic ? "Verify and commission" : "Check Drive evidence"}
      </Button>
      {automatic && !canCommission && (
        <p className="text-sm text-red-600">Confirm commissioning steps before checking.</p>
      )}
      <div role="status" aria-live="polite" className="space-y-2 text-sm">
        {current && (
          <>
            {canConfigure && current.api_setup_url && (
              <a
                href={current.api_setup_url}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Open Google Drive API setup
              </a>
            )}
            {current.folder_url && (
              <a href={current.folder_url} target="_blank" rel="noreferrer" className="underline">
                Open company Drive folder
              </a>
            )}
            {current.photo_count != null && (
              <p>
                Photos: {current.photo_count} · Videos: {current.video_count ?? 0} · Letters:{" "}
                {current.certificate_count ?? 0}
              </p>
            )}
            {current.video_average_seconds != null && (
              <p>Average video: {current.video_average_seconds.toFixed(1)} seconds</p>
            )}
          </>
        )}
        {notice && (
          <p
            className={notice.error ? "text-red-600 font-medium" : "text-text-secondary"}
            role={notice.error ? "alert" : undefined}
          >
            {notice.text}
          </p>
        )}
      </div>
    </Card>
  );
}
