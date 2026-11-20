import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
} from "@/components/ui-kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { usePhaseData } from "@/lib/use-phase-data";
import { advanceSiteVisitStatus } from "@/lib/site-metadata";
import { jsPDF } from "jspdf";
import { Download, FileText } from "lucide-react";
import { useCommissioningVerification } from "@/hooks/use-commissioning-verification";
import { CommissioningDriveCheck } from "./CommissioningDriveCheck";

type Props = {
  siteId: string;
  workerId: string;
  hiddenSections?: string[];
  onSubmit?: () => void | Promise<void>;
  onCommissioned?: () => void | Promise<void>;
  /** Field-associate completion requires full server verification. */
  requireApproval?: boolean;
  viewerEmail?: string | null;
};

function formatCertificateDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function makeDownloadFilename(companyName: string, extension: "doc" | "pdf") {
  const safeCompany = companyName
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "company";
  return `Installation-Commissioning-Certificate-${safeCompany}.${extension}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getCertificateSections(companyName: string, certificateDate: string) {
  return {
    title: "Installation and Commissioning Certificate",
    subtitle: "(Implementation of Shopfloor Insight & Monitoring Kit - SIM Kit)",
    dateLine: `Date: ${certificateDate}`,
    toLines: [
      "To,",
      "National Productivity Council (NPC)",
      "(Under Ministry of Commerce & Industry, Government of India)",
    ],
    subject: "Subject: Certification of Successful Installation & Commissioning of SIM Kit",
    greeting: "Dear Sir,",
    paragraphs: [
      "This is to certify that the Shopfloor Insight & Monitoring Kit (SIM Kit) has been successfully installed and commissioned at our facility under the project \"Scaling up Industry 4.0 Transformation in Gujarat's Manufacturing Sector.\"",
      "We are pleased to confirm that:",
    ],
    bullets: [
      "The SIM Kit device has been successfully installed and integrated with our machine.",
      "Machine data acquisition has commenced, and real-time data is being captured.",
      "The digital dashboard has been developed and is fully functional, providing clear visualization of operational parameters.",
      "The system is currently operational across its key modules, including:",
      "Overall Equipment Effectiveness (OEE) Monitoring",
      "Breakdown Analysis",
      "Condition Monitoring",
      "Energy Monitoring",
    ],
    closingParagraphs: [
      "With the implementation of SIM Kit, we are now able to monitor machine performance, analyze downtime, track energy consumption, and make informed decisions through data-driven insights. The initiative has significantly improved our shopfloor visibility and strengthened our journey towards Industry 4.0 adoption.",
      "We appreciate the efforts of the Service Provider Startup, LimelightIT Research PVT LTD, for their technical support and smooth execution of the installation. We also extend our gratitude to the National Productivity Council (NPC) for their guidance and support throughout the project.",
      "This certificate is issued as a confirmation of successful installation, commissioning, and operationalization of the SIM Kit system at our unit.",
    ],
    signOffLines: ["With regards,", `For ${companyName}`, "Authorized Signatory", "Name:", "Designation:", "Company Seal"],
  };
}

export function CommissioningTab({ siteId, workerId, hiddenSections, onSubmit, onCommissioned, requireApproval = false, viewerEmail }: Props) {
  const { data, patch, save, loaded, lastSaved, saving } = usePhaseData<Record<string, any>>(
    "commissioning",
    siteId,
    workerId,
    {},
  );
  const [approvalRequest, setApprovalRequest] = useState<{ id: string; drive_link: string; status: string } | null>(null);
  const [detectedDriveLink, setDetectedDriveLink] = useState("");
  const { verification, mode: verificationMode, refreshVerification } = useCommissioningVerification(siteId);
  const announcedCompletion = useRef("");
  const [certificateDialogOpen, setCertificateDialogOpen] = useState(false);
  const [certificateCompanyName, setCertificateCompanyName] = useState("");
  const [certificateDate, setCertificateDate] = useState(() => new Date().toISOString().slice(0, 10));
  const canReview = ["nitsanghani1@gmail.com", "info@limelightit.io"].includes((viewerEmail || "").toLowerCase());

  useEffect(() => {
    setDetectedDriveLink("");
  }, [siteId]);

  useEffect(() => {
    if (!requireApproval && !canReview) return;
    let active = true;
    const loadRequest = async () => {
      const { data: request } = await supabase
        .from("commissioning_approval_requests")
        .select("id,drive_link,status")
        .eq("site_id", siteId)
        .maybeSingle();
      if (active) setApprovalRequest(request);
    };
    void loadRequest();

    const channel = supabase
      .channel(`commissioning-approval-${siteId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "commissioning_approval_requests", filter: `site_id=eq.${siteId}` }, () => {
        void loadRequest();
      })
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [canReview, requireApproval, siteId]);

  useEffect(() => {
    if (verification?.status !== "approved") return;
    let active = true;
    void supabase.from("commissioning_approval_requests").select("id,drive_link,status")
      .eq("site_id", siteId).maybeSingle().then(({ data: request }) => {
        if (active && request) setApprovalRequest(request);
      });
    return () => { active = false; };
  }, [verification?.status, siteId]);

  useEffect(() => {
    const completion = `${siteId}:${verification?.id || verification?.created_at || ""}`;
    if (verification?.status !== "approved" || announcedCompletion.current === completion) return;
    announcedCompletion.current = completion;
    toast.success("Commissioned successfully.");
    // The server already saved status and dates; refresh the board without a second status write.
    if (onSubmit) void onSubmit();
  }, [siteId, verification?.status, verification?.id, verification?.created_at, onSubmit]);

  const nowIso = () => new Date().toISOString();

  const openCertificateDialog = async () => {
    const { data: site } = await supabase
      .from("sites")
      .select("company_name,name")
      .eq("id", siteId)
      .maybeSingle();
    setCertificateCompanyName(site?.company_name || site?.name || "");
    setCertificateDate(new Date().toISOString().slice(0, 10));
    setCertificateDialogOpen(true);
  };

  const validateCertificateFields = () => {
    if (!certificateCompanyName.trim()) {
      toast.error("Company name is required.");
      return null;
    }
    if (!certificateDate) {
      toast.error("Date is required.");
      return null;
    }
    return { companyName: certificateCompanyName.trim(), certificateDate: formatCertificateDate(certificateDate) };
  };

  const downloadCertificateWord = () => {
    const fields = validateCertificateFields();
    if (!fields) return;
    const certificate = getCertificateSections(fields.companyName, fields.certificateDate);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${escapeHtml(certificate.title)}</title><style>
      @page { size: A4; margin: 0.45in 0.65in; } body { font-family: "Times New Roman", serif; font-size: 10.5pt; line-height: 1.12; color: #000; }
      h1 { font-size: 14.5pt; font-weight: bold; text-align: center; margin: 0 0 2pt; } .subtitle { text-align: center; margin: 0 0 12pt; } .date { text-align: right; margin: 0 0 12pt; }
      .subject { font-weight: bold; margin: 12pt 0; } p { margin: 0 0 5pt; } ul { margin: 0 0 6pt 0.28in; padding: 0; } li { margin: 0 0 2pt; padding-left: 0.06in; } .signoff { margin-top: 12pt; } .signoff p { margin: 0 0 4pt; }
    </style></head><body><h1>${escapeHtml(certificate.title)}</h1><p class="subtitle">${escapeHtml(certificate.subtitle)}</p><p class="date">${escapeHtml(certificate.dateLine)}</p>${certificate.toLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<p class="subject">${escapeHtml(certificate.subject)}</p><p>${escapeHtml(certificate.greeting)}</p>${certificate.paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<ul>${certificate.bullets.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>${certificate.closingParagraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<div class="signoff">${certificate.signOffLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div></body></html>`;
    downloadBlob(new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" }), makeDownloadFilename(fields.companyName, "doc"));
    toast.success("Word certificate downloaded.");
  };

  const downloadCertificatePdf = () => {
    const fields = validateCertificateFields();
    if (!fields) return;
    const certificate = getCertificateSections(fields.companyName, fields.certificateDate);
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 46;
    const maxWidth = pageWidth - margin * 2;
    let y = 42;
    const addWrappedText = (text: string, options: { size?: number; bold?: boolean; align?: "left" | "center" | "right"; gap?: number; lineGap?: number } = {}) => {
      pdf.setFont("times", options.bold ? "bold" : "normal");
      pdf.setFontSize(options.size ?? 10.5);
      pdf.splitTextToSize(text, maxWidth).forEach((line: string) => {
        if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
        const align = options.align ?? "left";
        pdf.text(line, align === "center" ? pageWidth / 2 : align === "right" ? pageWidth - margin : margin, y, { align });
        y += (options.size ?? 10.5) + (options.lineGap ?? 1.8);
      });
      y += options.gap ?? 3;
    };
    const addBulletText = (text: string) => {
      pdf.setFont("times", "normal"); pdf.setFontSize(10.5);
      const bulletX = margin + 18, textX = margin + 34;
      const lines = pdf.splitTextToSize(text, pageWidth - margin - textX);
      if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
      pdf.text("•", bulletX, y);
      lines.forEach((line: string, index: number) => {
        if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
        pdf.text(line, textX, y);
        if (index < lines.length - 1) y += 12.3;
      });
      y += 14.2;
    };
    addWrappedText(certificate.title, { size: 14.5, bold: true, align: "center", gap: 1 });
    addWrappedText(certificate.subtitle, { align: "center", gap: 12 });
    addWrappedText(certificate.dateLine, { align: "right", gap: 12 });
    certificate.toLines.forEach((line) => addWrappedText(line, { gap: 0 })); y += 6;
    addWrappedText(certificate.subject, { bold: true, gap: 12 }); addWrappedText(certificate.greeting);
    certificate.paragraphs.forEach((line) => addWrappedText(line)); certificate.bullets.forEach(addBulletText); y += 1;
    certificate.closingParagraphs.forEach((line) => addWrappedText(line)); y += 8;
    certificate.signOffLines.forEach((line) => addWrappedText(line, { gap: 0 }));
    pdf.save(makeDownloadFilename(fields.companyName, "pdf"));
    toast.success("PDF certificate downloaded.");
  };

  const isCommissioned = 
    !!data.coordination_done && 
    !!data.visit_done && 
    !!data.connection_done && 
    !!data.configure_done && 
    !!data.testing_done && 
    !!data.screenshots_uploaded && 
    !!data.certificate_sent && 
    !!data.final_mom_uploaded;
  const isApprovalApproved = requireApproval && (approvalRequest?.status === "approved" || verification?.status === "approved");
  const isApprovalRejected = requireApproval && approvalRequest?.status === "rejected";
  const isApprovalPending = requireApproval && approvalRequest?.status === "pending";
  const commissioningLabel = requireApproval
    ? isApprovalApproved
      ? "Commissioned"
      : isApprovalPending
      ? verificationMode === "historical" ? "Approval Pending" : "Verification Pending"
      : isApprovalRejected
        ? "Needs correction"
      : isCommissioned
        ? "Ready for verification"
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

  // Completion is saved atomically by the server. Opening this screen never
  // backfills historical markers or rewrites a server-approved completion date.

  if (!loaded) return null;

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
      <Dialog open={certificateDialogOpen} onOpenChange={setCertificateDialogOpen}>
        <DialogContent className="z-[130] border-border bg-surface text-text-primary sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-syne uppercase tracking-tight">Create Commission Certificate</DialogTitle>
            <DialogDescription className="text-text-secondary">
              Enter the certificate details. This information is used only for the downloaded file.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Company Name</Label>
              <Input value={certificateCompanyName} onChange={(event) => setCertificateCompanyName(event.target.value)} placeholder="Enter company name" />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={certificateDate} onChange={(event) => setCertificateDate(event.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="secondary" onClick={downloadCertificateWord}>
              <Download size={16} /> Download Word
            </Button>
            <Button type="button" onClick={downloadCertificatePdf}>
              <Download size={16} /> Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {(saving || lastSaved) && <div className="flex items-center justify-end gap-2 text-xs text-text-secondary pb-2">
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
        ) : null}
      </div>}

      <Card className="border-l-[3px] border-lime p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-text-primary">Commissioning</h3>
          <Badge tone={(requireApproval ? isApprovalApproved : isCommissioned) ? "success" : "warning"}>
            {commissioningLabel}
          </Badge>
        </div>

        <div>
            <Button
              type="button"
              variant="secondary"
              className="w-full shrink-0 sm:w-auto"
              onClick={() => void openCertificateDialog()}
            >
              <FileText size={16} />
              Create Commission Certificate
            </Button>
        </div>

        {!isApprovalApproved && (
          <div className="flex items-start gap-3 p-4 bg-lime-dim/5 border border-lime/20 rounded-xl">
            <input
              type="checkbox"
              id="confirm-commissioned-checkbox"
              className="h-6 w-6 rounded border-gray-300 text-lime focus:ring-lime mt-0.5 cursor-pointer"
              checked={isCommissioned}
              onChange={(e) => handleToggleCommissioned(e.target.checked)}
            />
            <label htmlFor="confirm-commissioned-checkbox" className="text-base font-semibold text-text-primary select-none cursor-pointer">
              Commissioning completed
            </label>
          </div>
        )}

        {!detectedDriveLink && approvalRequest?.drive_link && (
          <a className="block break-all text-sm underline" href={approvalRequest.drive_link} target="_blank" rel="noreferrer">Open company folder</a>
        )}

      </Card>

      {(requireApproval || canReview) && <CommissioningDriveCheck key={siteId} siteId={siteId} canConfigure={canReview} onFolderResolved={setDetectedDriveLink}
        automatic={requireApproval && verificationMode === "automatic"} canCommission={isCommissioned && !saving}
        onVerificationStarted={() => { void refreshVerification(); }} />}

      {verification && (
        <Card className="mt-4 p-5 space-y-2" role="status" aria-live="polite">
          <p className={`text-sm ${["needs_correction","needs_review","technical_error"].includes(verification.status) ? "text-red-600" : "text-text-secondary"}`}>
            {{ queued: "Verification queued.", checking: "Verifying commissioning evidence.",
              passed: "Final approval setup required.",
              needs_correction: "Update evidence and verify again.",
              needs_review: "Commissioning letter did not pass verification.",
              technical_error: "Verification failed. Please retry.",
              superseded: "Verify the latest evidence again.",
              approved: "Commissioned successfully." }[verification.status]}
          </p>
          {!detectedDriveLink && verification.photo_count != null && <p className="text-sm">Photos: {verification.photo_count} · Videos: {verification.video_count ?? 0}
            {verification.video_total_seconds != null && ` · Total video: ${verification.video_total_seconds.toLocaleString("en", { maximumFractionDigits: 6 })} seconds`}</p>}
        </Card>
      )}

      {!isApprovalApproved && !requireApproval && <div className="mt-8 flex justify-end">
        <Button 
          onClick={async () => {
            if (!isCommissioned) {
              toast.error("Please confirm commissioning before submitting.");
              return;
            }
            const saved = await save(buildCommissionedData());
            if (!saved) return;
            if (onCommissioned) await onCommissioned();
            if (onSubmit) await onSubmit();
          }} 
          className="w-full sm:w-auto text-base py-3 px-8"
        >
          Submit Commissioning Phase
        </Button>
      </div>}
    </>
  );
}
