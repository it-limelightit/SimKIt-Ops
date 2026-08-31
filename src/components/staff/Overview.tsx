import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { parseSiteMetadata, recordStatusActivityLog, serializeSiteMetadata } from "@/lib/site-metadata";
import {
  getCanonicalStatus,
  ASSESSMENT_KEYS,
  INSTALLATION_KEYS,
  COMMISSIONING_KEYS,
  pctKeys,
  getSiteWorkerIds,
  getAssessmentPendingReasons,
  getSubmittedLogisticsOrder,
  hasDeviceOrder,
} from "@/utils/status";
import { toast } from "sonner";
import { Skeleton, Button, ProgressBar, Select, Label, Input, Card } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth-store";
import { AssessmentTab } from "@/components/business-consultant/AssessmentTab";
import { InstallationTab } from "@/components/business-consultant/InstallationTab";
import { CommissioningTab } from "@/components/business-consultant/CommissioningTab";
import { OrderTab } from "@/components/business-consultant/OrderTab";
import { parseTaskNotes } from "./TasksPanel";
import logoUrl from "../../../image copy.png";
import {
  Building,
  CheckCircle2,
  AlertCircle,
  Award,
  UserMinus,
  Search,
  MapPin,
  Users,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  XCircle,
  Wrench,
  Truck,
  Download,
  FileText,
  Clock,
  Lock,
  Calendar,
  Mail,
  Phone,
  User,
  BookOpen,
  X,
  Check,
} from "lucide-react";


type Appt = {
  status: "early" | "late" | "ontime" | "scheduled" | "none";
  scheduled: string | null;
  completed: string | null;
};

type SiteRow = {
  id: string;
  name: string;
  company_name: string | null;
  city: string | null;
  address: string | null;
  assigned_worker_id: string | null;
  assigned_at: string | null;
  appt_date: string | null;
  appt_time: string | null;
  task_notes: string | null;
  consultant_stage: string | null;
  progress: {
    a: number;
    i: number;
    c: number;
    updated: string | null;
    appt: Appt;
  };
  workerIds: string[];
  meta: {
    status: string;
    c1_name: string;
    c1_mobile: string;
    c1_email: string;
  };
  logisticsStatus: string;
  hasLogisticsOrder: boolean;
  hasDeviceOrder: boolean;
  assessmentPendingReasons: string[];
  status: string;
};

const FACTORY_STATUS_OPTIONS = [
  "Pending Assignment",
  "Not Started Yet",
  "Assessed",
  "Installed",
  "Commissioned",
  "Certification Pending",
  "Submitted",
  "Unsubmitted",
  "Dropped / Rejected",
] as const;

export function Overview() {
  const navigate = useNavigate();
  const { userId, email, profile, ready: authReady, roles } = useAuth();
  const isDualRole = roles.includes("supervisor") && roles.includes("worker");
  const [rawSites, setRawSites] = useState<any[]>([]);
  const [rawAssessments, setRawAssessments] = useState<any[]>([]);
  const [rawInstallations, setRawInstallations] = useState<any[]>([]);
  const [rawCommissionings, setRawCommissionings] = useState<any[]>([]);
  const [rawProfiles, setRawProfiles] = useState<any[]>([]);
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [workerIds, setWorkerIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Filter States
  const [selectedKpi, setSelectedKpi] = useState<string>("assigned");
  const [cityFilter, setCityFilter] = useState("");
  const [executiveFilter, setExecutiveFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showMyTasks, setShowMyTasks] = useState(false);
  const [kpiSelected, setKpiSelected] = useState(true);

  useEffect(() => {
    if (!authReady) return;
    // Dual-role managers start on their personal tasks. A manager-only user
    // starts directly on the complete Companies Assigned list.
    if (isDualRole) {
      setSelectedKpi("assigned");
      setShowMyTasks(true);
      setKpiSelected(false);
    } else {
      setSelectedKpi("assigned");
      setShowMyTasks(false);
      setKpiSelected(true);
    }
  }, [authReady, isDualRole]);

  // Consultant Modal States
  const [consultantSiteId, setConsultantSiteId] = useState<string | null>(null);
  const [modalTab, setModalTab] = useState<"assessment" | "installation" | "commissioning">("assessment");
  const [modalProgress, setModalProgress] = useState({ assessment: 0, installation: 0, commissioning: 0 });
  const [modalSubmittedPhases, setModalSubmittedPhases] = useState<Set<string>>(new Set());
  const [clientShareEmail, setClientShareEmail] = useState("");
  const [generatedLink, setGeneratedLink] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    if (!consultantSiteId) return;
    const site = rawSites.find(s => s.id === consultantSiteId);
    if (!site) return;

    // Parse client share details
    const siteMeta = parseSiteMetadata(site.task_notes);
    setClientShareEmail(siteMeta.client_email || "");
    if (siteMeta.client_token) {
      setGeneratedLink(`${window.location.origin}/client-form?token=${siteMeta.client_token}`);
    } else {
      setGeneratedLink("");
    }

    // Calculate progress and submitted phases
    const a = rawAssessments.find((x) => x.site_id === site.id);
    const i = rawInstallations.find((x) => x.site_id === site.id);
    const c = rawCommissionings.find((x) => x.site_id === site.id);

    const aData = a?.data as Record<string, any> | undefined;
    const iData = i?.data as Record<string, any> | undefined;
    const cData = c?.data as Record<string, any> | undefined;

    setModalProgress({
      assessment: pctKeys(aData, ASSESSMENT_KEYS),
      installation: pctKeys(iData, INSTALLATION_KEYS),
      commissioning: pctKeys(cData, COMMISSIONING_KEYS),
    });

    const nextSubmitted = new Set<string>();
    if (pctKeys(aData, ASSESSMENT_KEYS) === 100) nextSubmitted.add("assessment");
    if (iData?.installation_phase_submitted) nextSubmitted.add("installation");
    if (cData?.commissioning_phase_submitted) nextSubmitted.add("commissioning");
    setModalSubmittedPhases(nextSubmitted);

    // Default tab to active phase from task_notes
    const { phase: activePhase } = parseTaskNotes(site.task_notes);
    if (activePhase && (activePhase === "assessment" || activePhase === "installation" || activePhase === "commissioning")) {
      setModalTab(activePhase);
    } else {
      setModalTab("assessment");
    }
  }, [consultantSiteId, rawSites, rawAssessments, rawInstallations, rawCommissionings]);

  const handleGenerateShareLink = async () => {
    if (!consultantSiteId) return;
    try {
      const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

      const { error } = await supabase.rpc("save_client_invitation", {
        site_id: consultantSiteId,
        client_email: clientShareEmail.trim(),
        token_val: token
      });

      if (error) {
        toast.error("Failed to generate link: " + error.message);
      } else {
        const link = `${window.location.origin}/client-form?token=${token}`;
        setGeneratedLink(link);
        toast.success("Share link generated successfully!");
        await loadData();
      }
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
  };

  const handleSendEmail = async () => {
    if (!consultantSiteId) return;
    const site = rawSites.find(s => s.id === consultantSiteId);
    if (!site) return;
    if (!clientShareEmail.trim()) {
      toast.error("Please enter a client email address first.");
      return;
    }

    setSendingEmail(true);
    try {
      const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const { error } = await supabase.rpc("save_client_invitation", {
        site_id: site.id,
        client_email: clientShareEmail.trim(),
        token_val: token
      });

      if (error) {
        throw new Error("Failed to save client details: " + error.message);
      }
      await loadData();

      const { sendClientFormEmailFn } = await import("../../routes/client-form");
      const res = await sendClientFormEmailFn({
        data: {
          email: clientShareEmail.trim(),
          token: token,
          siteName: site.company_name || site.name,
          origin: window.location.origin
        }
      });

      if (res.success) {
        if (res.previewUrl) {
          toast.success(res.message, {
            description: `Verify Ethereal mailbox here: ${res.previewUrl}`,
            action: {
              label: "Open Mail Inbox",
              onClick: () => window.open(res.previewUrl!, "_blank")
            },
            duration: 15000
          });
        } else {
          toast.success("Invitation email sent successfully to the client!");
        }
      } else {
        toast.error("Failed to send email: " + res.error);
      }
    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred while sending email.");
    } finally {
      setSendingEmail(false);
    }
  };

  const handleCopyLink = () => {
    if (!generatedLink) return;
    navigator.clipboard.writeText(generatedLink);
    toast.success("Copied client form link to clipboard!");
  };

  const updateConsultantStage = async (stage: "Billing" | "Completion") => {
    if (!consultantSiteId) return;
    const { error } = await supabase.rpc("set_consultant_site_stage", {
      _site_id: consultantSiteId,
      _stage: stage,
    });
    if (error) {
      toast.error("Could not update the site stage: " + error.message);
      return;
    }
    toast.success(`Site moved to ${stage}`);
    await loadData();
  };

  const completeAssessmentAfterDeviceOrder = async (site: any) => {
    if (!site || !userId) return;
    const companyName = site.company_name || site.name;
    const { data: order, error: orderError } = await supabase
      .from("inventory_materials")
      .select("id")
      .eq("submitted", true)
      .eq("material_name", companyName)
      .maybeSingle();

    if (orderError || !order) {
      toast.error("Please submit the device order before completing Assessment.");
      return;
    }

    const { data: assessmentRow } = await supabase
      .from("assessment")
      .select("data")
      .eq("site_id", site.id)
      .maybeSingle();

    const existingData = (assessmentRow?.data ?? {}) as Record<string, any>;
    const { error } = await supabase
      .from("assessment")
      .upsert({
        site_id: site.id,
        worker_id: userId,
        data: {
          ...existingData,
          assessment_phase_submitted: true,
          assessment_details_submitted: true,
          factory_form_submitted_at: existingData.factory_form_submitted_at || new Date().toISOString(),
          device_order_completed: true,
          device_order_completed_at: existingData.device_order_completed_at || new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: "site_id" });

    if (error) {
      toast.error("Device order saved, but assessment status could not be completed.");
      return;
    }

    setModalSubmittedPhases(prev => new Set([...prev, "assessment"]));
    setModalTab("installation");
    toast.success("Assessment phase submitted.");
    await loadData();
  };

  // Sort States
  const [sortField, setSortField] = useState<"name" | "city" | "updated">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const [exportingPdf, setExportingPdf] = useState(false);
  const rowsPerPage = 10;

  const loadData = async () => {
    setLoading(true);
    try {
      const [sitesRes, assessmentsRes, installationsRes, commissioningsRes, profilesRes, materialsRes, rolesRes] = await Promise.all([
        supabase
          .from("sites")
          .select("id,name,company_name,city,address,assigned_worker_id,assigned_at,appt_date,appt_time,created_at,task_notes,consultant_stage")
          .order("created_at", { ascending: false }),
        supabase.from("assessment").select("data,updated_at,site_id"),
        supabase.from("installation").select("data,updated_at,site_id"),
        supabase.from("commissioning").select("data,updated_at,site_id"),
        supabase.from("profiles").select("id,name,mobile,is_active").order("created_at"),
        supabase
          .from("inventory_materials")
          .select("state,notes,submitted,material_name,created_at")
          .order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id").eq("role", "worker"),
      ]);

      setRawSites(sitesRes.data ?? []);
      setRawAssessments(assessmentsRes.data ?? []);
      setRawInstallations(installationsRes.data ?? []);
      setRawCommissionings(commissioningsRes.data ?? []);
      setRawProfiles(profilesRes.data ?? []);
      setRawMaterials(materialsRes.data ?? []);
      const wIds = new Set((rolesRes.data ?? []).map((r: any) => r.user_id));
      setWorkerIds(wIds);
    } catch (err) {
      console.error("Error fetching overview metrics:", err);
    } finally {
      setLoading(false);
    }
  };

  const updateSiteStatus = async (
    siteId: string,
    newStatus: string,
    currentTaskNotes: string | null,
    currentStatus?: string,
  ) => {
    try {
      const meta = parseSiteMetadata(currentTaskNotes);

      let consultantStage: string | null = null;
      let metaStatus: string = "";
      let updatedWorkers: string[] | undefined = undefined;

      if (newStatus === "Dropped / Rejected") {
        consultantStage = null;
        metaStatus = "Dropped / Rejected";
        updatedWorkers = [];
      } else if (newStatus === "Submitted") {
        consultantStage = "Completion";
        metaStatus = "Submitted";
      } else if (newStatus === "In Assessment" || newStatus === "Assessed") {
        consultantStage = null;
        metaStatus = "Assessed";
      } else if (newStatus === "Panel Dispatched") {
        consultantStage = null;
        metaStatus = "Panel Dispatched";
      } else if (newStatus === "Installed") {
        consultantStage = null;
        metaStatus = "Installed";
      } else if (newStatus === "Commissioned") {
        consultantStage = null;
        metaStatus = "Commissioned";
      } else if (newStatus === "Unsubmitted") {
        consultantStage = null;
        metaStatus = "Unsubmitted";
      } else if (newStatus === "Certification Pending") {
        consultantStage = null;
        metaStatus = "Certification Pending";
      } else if (newStatus === "Pending Assignment") {
        consultantStage = null;
        metaStatus = "Pending Assignment";
        updatedWorkers = [];
      } else if (newStatus === "Not Started Yet") {
        consultantStage = null;
        metaStatus = "Not Started Yet";
      }

      const fromStatus = currentStatus || meta.status || "Not Started Yet";
      const newNotes = serializeSiteMetadata(currentTaskNotes, {
        ...meta,
        status: metaStatus,
        ...(updatedWorkers !== undefined ? { worker_ids: updatedWorkers } : {})
      });

      const updatePayload: any = {
        task_notes: newNotes,
        consultant_stage: consultantStage,
      };

      if (updatedWorkers !== undefined) {
        updatePayload.assigned_worker_id = null;
        updatePayload.assigned_at = null;
      }

      const { error } = await supabase
        .from("sites")
        .update(updatePayload as never)
        .eq("id", siteId);

      if (error) {
        toast.error(error.message);
      } else {
        const siteObj = rawSites.find(s => s.id === siteId);
        const workerIds = getSiteWorkerIds(siteObj);
        const workerId = workerIds[0] || siteObj?.assigned_worker_id || null;

        if (metaStatus === "Dropped / Rejected") {
          // Clear all phase ownership and progress when a company is dropped.
          await Promise.all([
            supabase.from("assessment").upsert({
              site_id: siteId,
              worker_id: null,
              data: {}
            }, { onConflict: "site_id" }),
            supabase.from("installation").upsert({
              site_id: siteId,
              worker_id: null,
              data: {}
            }, { onConflict: "site_id" }),
            supabase.from("commissioning").upsert({
              site_id: siteId,
              worker_id: null,
              data: {}
            }, { onConflict: "site_id" })
          ]);
        } else if (metaStatus === "Commissioned") {
          await Promise.all([
            supabase.from("assessment").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: { mom_uploaded: true, media_uploaded: true, factory_operations_done: true, assessment_phase_submitted: true }
            }, { onConflict: "site_id" }),
            supabase.from("installation").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: { delivery_confirmed: true, coordination_done: true, photos_uploaded: true, installation_phase_submitted: true }
            }, { onConflict: "site_id" }),
            supabase.from("commissioning").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: {
                coordination_done: true,
                visit_done: true,
                connection_done: true,
                configure_done: true,
                testing_done: true,
                screenshots_uploaded: true,
                certificate_sent: true,
                final_mom_uploaded: true,
                commissioning_phase_submitted: true
              }
            }, { onConflict: "site_id" })
          ]);
        } else if (metaStatus === "Installed") {
          await Promise.all([
            supabase.from("assessment").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: { mom_uploaded: true, media_uploaded: true, factory_operations_done: true, assessment_phase_submitted: true }
            }, { onConflict: "site_id" }),
            supabase.from("installation").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: { delivery_confirmed: true, coordination_done: true, photos_uploaded: true, installation_phase_submitted: true }
            }, { onConflict: "site_id" }),
            supabase.from("commissioning").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: {}
            }, { onConflict: "site_id" })
          ]);
        } else if (metaStatus === "Assessed") {
          await Promise.all([
            supabase.from("assessment").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: { mom_uploaded: true, media_uploaded: true, factory_operations_done: true, assessment_phase_submitted: true }
            }, { onConflict: "site_id" }),
            supabase.from("installation").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: {}
            }, { onConflict: "site_id" }),
            supabase.from("commissioning").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: {}
            }, { onConflict: "site_id" })
          ]);
        } else if (metaStatus === "Panel Dispatched") {
          await Promise.all([
            supabase.from("assessment").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: { mom_uploaded: true, media_uploaded: true, factory_operations_done: true, assessment_phase_submitted: true }
            }, { onConflict: "site_id" }),
            supabase.from("installation").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: {}
            }, { onConflict: "site_id" }),
            supabase.from("commissioning").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: {}
            }, { onConflict: "site_id" })
          ]);
        } else if (metaStatus === "Not Started Yet" || metaStatus === "Pending Assignment") {
          await Promise.all([
            supabase.from("assessment").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: {}
            }, { onConflict: "site_id" }),
            supabase.from("installation").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: {}
            }, { onConflict: "site_id" }),
            supabase.from("commissioning").upsert({
              site_id: siteId,
              worker_id: workerId,
              data: {}
            }, { onConflict: "site_id" })
          ]);
        }

        await recordStatusActivityLog(siteId, {
          user_id: userId,
          user_name: profile?.name || profile?.mobile || email || userId || "Unknown User",
          from_status: fromStatus,
          to_status: metaStatus,
        });

        toast.success("Site status updated successfully");
        await loadData();
      }
    } catch (err: any) {
      toast.error("Failed to update status: " + err.message);
    }
  };

  const handleBcChange = async (row: SiteRow, workerId: string) => {
    try {
      const workerIds = workerId ? [workerId] : [];
      const meta = parseSiteMetadata(row.task_notes);
      const nextStatus = workerId && row.status === "Pending Assignment" ? "Not Started Yet" : meta.status;
      const newNotes = serializeSiteMetadata(row.task_notes, { ...meta, worker_ids: workerIds, status: nextStatus });
      
      const { error } = await supabase
        .from("sites")
        .update({
          assigned_worker_id: workerId || null,
          assigned_at: new Date().toISOString(),
          task_notes: newNotes,
        } as never)
        .eq("id", row.id);

      if (error) {
        toast.error("Failed to update assignment: " + error.message);
      } else {
        toast.success("Assignment updated");
        await loadData();
      }
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
  };

  const renderBcSelect = (row: SiteRow) => {
    const currentWorkerId = row.workerIds[0] || "";
    return (
      <select
        value={currentWorkerId}
        onClick={(e) => e.stopPropagation()} // Prevent row click navigation
        onChange={(e) => {
          e.stopPropagation();
          handleBcChange(row, e.target.value);
        }}
        className="rounded border border-border px-2 py-0.5 text-[11px] font-semibold cursor-pointer bg-surface text-text-primary outline-none max-w-[150px] truncate"
      >
        <option value="">Unassigned</option>
        {executives.map((exec) => (
          <option key={exec.id} value={exec.id}>
            {exec.name || exec.mobile}
          </option>
        ))}
      </select>
    );
  };

  const renderStatusSelect = (row: any) => {
    const canonicalStatus = row.status;
    if (selectedKpi === "dispatched_actual") {
      const logisticsStatus = row.logisticsStatus || "Pending";
      return (
        <div className="flex flex-col items-start gap-1">
          <select
            value={logisticsStatus}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => e.stopPropagation()}
            className="rounded border px-2 py-0.5 text-[11px] font-semibold cursor-default outline-none transition-colors bg-blue-50 text-blue-700 border-blue-200"
            title="Logistics status"
          >
            <optgroup label="Logistics Category">
              <option value={logisticsStatus}>{logisticsStatus}</option>
            </optgroup>
          </select>
          {row.assessmentPendingReasons.length > 0 && (
            <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              {row.assessmentPendingReasons.join(", ")}
            </span>
          )}
        </div>
      );
    }

    let toneClass = "bg-surface text-text-dim border-border";
    if (canonicalStatus === "Submitted" || canonicalStatus === "Commissioned") {
      toneClass = "bg-emerald-50 text-emerald-700 border-emerald-250";
    } else if (canonicalStatus === "Dropped / Rejected") {
      toneClass = "bg-red-50 text-red-700 border-red-200";
    } else if (canonicalStatus === "Assigned" || canonicalStatus === "Not Started Yet") {
      toneClass = "bg-indigo-50 text-indigo-700 border-indigo-200";
    } else if (canonicalStatus === "Pending Assignment" || canonicalStatus === "Total Assignment Pending on Portal" || canonicalStatus === "Assessed" || canonicalStatus === "Unsubmitted" || canonicalStatus === "Certification Pending" || canonicalStatus === "Panel Dispatched" || canonicalStatus === "Installed") {
      toneClass = "bg-amber-50 text-amber-700 border-amber-250";
    }

    return (
      <div className="flex flex-col items-start gap-1">
        <select
          value={canonicalStatus || ""}
          onClick={(e) => e.stopPropagation()} // Prevent row click navigation
          onChange={(e) => {
            e.stopPropagation(); // Prevent row click navigation
            updateSiteStatus(row.id, e.target.value, row.task_notes, canonicalStatus);
          }}
          className={`rounded border px-2 py-0.5 text-[11px] font-semibold cursor-pointer outline-none transition-colors ${toneClass}`}
        >
          {canonicalStatus === "Panel Dispatched" && (
            <option value="Panel Dispatched" className="bg-surface text-text-primary">
              Pending Panel Dispatched
            </option>
          )}
          {FACTORY_STATUS_OPTIONS.map((status) => (
            <option key={status} value={status} className="bg-surface text-text-primary">
              {status}
            </option>
          ))}
        </select>
        {row.assessmentPendingReasons.length > 0 && (canonicalStatus === "Assessed" || canonicalStatus === "Panel Dispatched") && (
          <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            {row.assessmentPendingReasons.join(", ")}
          </span>
        )}
      </div>
    );
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Process data rows
  const executives = rawProfiles.filter((p) => workerIds.has(p.id));
  const cities = Array.from(new Set(rawSites.map((s) => s.city).filter(Boolean))) as string[];
  const profileNameMap = new Map<string, string>();
  rawProfiles.forEach((p) => {
    profileNameMap.set(p.id, p.name || p.mobile || "—");
  });

  const getLogisticsStatus = (m: any): string => {
    try {
      if (!m.notes) return m.state === "In transit" ? "Transit" : (m.state || "Pending");

      let parsed = m.notes;
      if (typeof m.notes === "string") {
        const trimmed = m.notes.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          parsed = JSON.parse(trimmed);
        } else {
          return m.state === "In transit" ? "Transit" : (m.state || "Pending");
        }
      }

      if (parsed && typeof parsed === "object" && parsed.logistics_status) {
        return parsed.logistics_status;
      }
    } catch (e) {
      console.error("Error parsing logistics status:", e);
    }
    return m.state === "In transit" ? "Transit" : (m.state || "Pending");
  };

  const aMap = new Map<string, any>(rawAssessments.map((r) => [r.site_id, r]));
  const iMap = new Map<string, any>(rawInstallations.map((r) => [r.site_id, r]));
  const cMap = new Map<string, any>(rawCommissionings.map((r) => [r.site_id, r]));

  const isSiteDropped = (row: SiteRow) => {
    const stage = (row.consultant_stage || row.meta.status || "").toLowerCase();
    return stage.includes("drop") || stage.includes("reject");
  };

  const isSiteInstalled = (row: SiteRow) => {
    const stage = (row.consultant_stage || row.meta.status || "").toLowerCase();
    return stage.includes("installed") || row.progress.i === 100;
  };
  const isSiteCommissioned = (row: SiteRow) => {
    const stage = (row.consultant_stage || row.meta.status || "").toLowerCase();
    return stage.includes("commissioned") || row.progress.c === 100;
  };


const allProcessedRows: SiteRow[] = rawSites.map((site) => {
  const ar = aMap.get(site.id);
  const ir = iMap.get(site.id);
  const cr = cMap.get(site.id);
  const meta = parseSiteMetadata(site.task_notes);

  const isFullyDone = site.consultant_stage === "Completion" || site.consultant_stage === "Billing";

  let aP = isFullyDone ? 100 : pctKeys(ar?.data, ASSESSMENT_KEYS);
  let iP = isFullyDone ? 100 : pctKeys(ir?.data, INSTALLATION_KEYS);
  let cP = isFullyDone ? 100 : pctKeys(cr?.data, COMMISSIONING_KEYS);
  const updated = [ar?.updated_at, ir?.updated_at, cr?.updated_at].filter(Boolean).sort().pop() ?? null;

  const workerIds = getSiteWorkerIds(site);

  let appt: Appt = { status: "none", scheduled: null, completed: null };
  if (site.appt_date) {
    const scheduled = new Date(`${site.appt_date}T${site.appt_time || "00:00"}`);
    const completed = ar?.data?.facility_visit_at ? new Date(ar.data.facility_visit_at) : null;
    if (!completed) {
      appt = { status: "scheduled", scheduled: scheduled.toISOString(), completed: null };
    } else {
      const diffMin = (completed.getTime() - scheduled.getTime()) / 60000;
      const status: Appt["status"] = diffMin < -5 ? "early" : diffMin > 15 ? "late" : "ontime";
      appt = { status, scheduled: scheduled.toISOString(), completed: completed.toISOString() };
    }
  }

  const matchingMaterial = getSubmittedLogisticsOrder(site, rawMaterials);
  const hasLogisticsOrder = !!matchingMaterial;
  const logisticsStatus = matchingMaterial ? getLogisticsStatus(matchingMaterial) : "";
  const deviceOrderExists = hasDeviceOrder(site, ar?.data, rawMaterials);
  const logisticsStatusNormalized = logisticsStatus.trim().toLowerCase();
  const isLogisticsDispatched = ["shipped", "transit", "in transit", "delivered"].includes(logisticsStatusNormalized);
  const canonicalStatus = getCanonicalStatus(site, aMap, iMap, cMap, rawMaterials);
  const assessmentPendingReasons = getAssessmentPendingReasons(ar?.data, deviceOrderExists);

  if (canonicalStatus === "Assessed") {
    aP = 100;
    iP = 0;
    cP = 0;
  } else if (canonicalStatus === "Installed" || canonicalStatus === "Panel Dispatched" || isLogisticsDispatched) {
    aP = 100;
    iP = canonicalStatus === "Installed" ? 100 : 0;
    cP = 0;
  } else if (canonicalStatus === "Commissioned" || canonicalStatus === "Submitted" || canonicalStatus === "Certification Pending") {
    aP = 100;
    iP = 100;
    cP = 100;
  } else if (canonicalStatus === "Not Started Yet" || canonicalStatus === "Pending Assignment" || canonicalStatus === "Dropped / Rejected") {
    aP = 0;
    iP = 0;
    cP = 0;
  }

  return {
    id: site.id,
    name: site.name,
    city: site.city,
    address: site.address ?? null,
    assigned_worker_id: site.assigned_worker_id,
    assigned_at: site.assigned_at,
    appt_date: site.appt_date,
    appt_time: site.appt_time,
    task_notes: site.task_notes,
    consultant_stage: site.consultant_stage,
    progress: { a: aP, i: iP, c: cP, updated, appt },
    workerIds,
    company_name: site.company_name ?? null,
    meta: {
      status: meta.status || "",
      c1_name: meta.c1_name || "",
      c1_mobile: meta.c1_mobile || "",
      c1_email: meta.c1_email || "",
    },
    status: canonicalStatus,
    logisticsStatus,
    hasLogisticsOrder,
    hasDeviceOrder: deviceOrderExists,
    assessmentPendingReasons,
  };
});

// Apply filters for counting
const filteredForCounts = allProcessedRows.filter((row) => {
  if (cityFilter && row.city !== cityFilter) return false;
  if (executiveFilter && !row.workerIds.includes(executiveFilter)) return false;
  return true;
});

// Calculate counts based on current filters and canonical status partitioning
const logisticsStatusKey = (r: SiteRow) => r.logisticsStatus.trim().toLowerCase();
const isActualDispatchLogisticsStatus = (r: SiteRow) => ["shipped", "transit", "in transit", "delivered"].includes(logisticsStatusKey(r));

const isPendingPanelDispatched = (r: SiteRow) => {
  return r.hasDeviceOrder &&
    r.status === "Assessed" &&
    ![
    "Submitted",
    "Unsubmitted",
    "Certification Pending",
    "Dropped / Rejected",
    "Pending Assignment",
    "Installed",
    "Commissioned",
  ].includes(r.status) &&
    !isActualDispatchLogisticsStatus(r);
};
const isDispatchedActual = (r: SiteRow) => {
  return r.hasLogisticsOrder &&
    isActualDispatchLogisticsStatus(r) &&
    ![
      "Installed",
      "Commissioned",
      "Submitted",
      "Certification Pending",
      "Unsubmitted",
      "Dropped / Rejected",
    ].includes(r.status);
};
const assignedWorkflowRows = filteredForCounts.filter((r) => ![
  "Submitted",
  "Unsubmitted",
  "Certification Pending",
  "Dropped / Rejected",
  "Pending Assignment",
].includes(r.status));
const activeAssignedRows = assignedWorkflowRows;
const countTotal = filteredForCounts.length; // First card represents total companies count
// Keep the top-level company buckets mutually exclusive for reconciliation.
const countPending = filteredForCounts.filter((r) => r.status === "Pending Assignment").length;
const countSubmitted = filteredForCounts.filter((r) => r.status === "Submitted").length;
const countPendingPortal = filteredForCounts.filter((r) => {
  const status = r.status;
  return status !== "Submitted" && status !== "Dropped / Rejected";
}).length;
const countUnsubmitted = filteredForCounts.filter((r) => r.status === "Unsubmitted").length;
const countCertification = filteredForCounts.filter((r) => r.status === "Certification Pending").length;
const countInstalled = activeAssignedRows.filter((r) => r.status === "Installed").length;
const countCommissioned = activeAssignedRows.filter((r) => r.status === "Commissioned").length;
const countPendingDispatched = activeAssignedRows.filter((r) => isPendingPanelDispatched(r)).length;
const countDispatched = activeAssignedRows.filter((r) => isDispatchedActual(r)).length;
const countAssessment = activeAssignedRows.filter((r) => r.status === "Assessed" || isPendingPanelDispatched(r) || isDispatchedActual(r)).length;
const countDropped = filteredForCounts.filter((r) => r.status === "Dropped / Rejected").length;
const countNotStarted = activeAssignedRows.filter((r) => r.status === "Not Started Yet" && !isPendingPanelDispatched(r) && !isDispatchedActual(r)).length;
const countAssignedBc = activeAssignedRows.length;

// Apply selected KPI filter to table
const filteredByKpi = filteredForCounts.filter((row) => {
  if (selectedKpi === "assigned") return true; // Show total companies list
  const status = row.status;
  switch (selectedKpi) {
    case "submitted":
      return status === "Submitted";
    case "unsubmitted":
      return status === "Unsubmitted";
    case "certification":
      return status === "Certification Pending";
    case "installed":
      return status === "Installed";
    case "commissioned":
      return status === "Commissioned";
    case "pending":
      return status === "Pending Assignment";
    case "pending_portal":
      return status !== "Submitted" && status !== "Dropped / Rejected";
    case "assigned_bc":
      return assignedWorkflowRows.some((r) => r.id === row.id);
    case "not_started":
      return row.workerIds.length > 0 && status === "Not Started Yet" && !isPendingPanelDispatched(row) && !isDispatchedActual(row);
    case "assessment":
      return row.workerIds.length > 0 && (status === "Assessed" || isPendingPanelDispatched(row) || isDispatchedActual(row));
    case "dispatched":
      return isPendingPanelDispatched(row);
    case "dispatched_actual":
      return isDispatchedActual(row);
    case "dropped":
      return status === "Dropped / Rejected";
    default:
      return true;
  }
});

// Apply My Tasks Filter
const myTasksFiltered = isDualRole && showMyTasks && userId
  ? filteredByKpi.filter((row) => row.workerIds.includes(userId))
  : filteredByKpi;

// Apply search query
const searchQueryLower = searchQuery.toLowerCase();
const searchedRows = myTasksFiltered.filter((row) => {
  if (!searchQuery) return true;
  const name = row.name.toLowerCase();
  const companyName = (row.company_name || "").toLowerCase();
  const city = (row.city || "").toLowerCase();
  const status = row.status.toLowerCase();
  const cName = row.meta.c1_name.toLowerCase();
  const cPhone = row.meta.c1_mobile.toLowerCase();

  const workerNames = row.workerIds.map((id) => (profileNameMap.get(id) || "").toLowerCase());
  const matchWorkers = workerNames.some((wName) => wName.includes(searchQueryLower));

  return (
    name.includes(searchQueryLower) ||
    companyName.includes(searchQueryLower) ||
    city.includes(searchQueryLower) ||
    status.includes(searchQueryLower) ||
    cName.includes(searchQueryLower) ||
    cPhone.includes(searchQueryLower) ||
    matchWorkers
  );
});

// Apply Sorting
const sortedRows = [...searchedRows].sort((a, b) => {
  if (selectedKpi === "dispatched_actual") {
    const logisticsRank = (status: string) => {
      const normalized = status.trim().toLowerCase();
      if (normalized === "delivered") return 0;
      if (normalized === "transit" || normalized === "in transit") return 1;
      if (normalized === "shipped") return 2;
      return 3;
    };
    const statusComp = logisticsRank(a.logisticsStatus) - logisticsRank(b.logisticsStatus);
    if (statusComp !== 0) return statusComp;
  }

  // 1. Prioritize by Executive (Worker) Name: Jenil first, then others alphabetically, then unassigned
  const nameA = a.workerIds && a.workerIds.length > 0 ? (profileNameMap.get(a.workerIds[0]) || "") : "";
  const nameB = b.workerIds && b.workerIds.length > 0 ? (profileNameMap.get(b.workerIds[0]) || "") : "";

  const isJenilA = nameA.toLowerCase().includes("jenil");
  const isJenilB = nameB.toLowerCase().includes("jenil");

  if (isJenilA && !isJenilB) return -1;
  if (!isJenilA && isJenilB) return 1;

  if (nameA && !nameB) return -1;
  if (!nameA && nameB) return 1;

  if (nameA && nameB) {
    const workerComp = nameA.localeCompare(nameB);
    if (workerComp !== 0) return workerComp;
  }

  // 2. Fallback to column sorting within the same worker / assignment group
  let comp = 0;
  if (sortField === "name") {
    comp = a.name.localeCompare(b.name);
  } else if (sortField === "city") {
    comp = (a.city || "").localeCompare(b.city || "");
  } else if (sortField === "updated") {
    const tA = a.progress.updated ? new Date(a.progress.updated).getTime() : 0;
    const tB = b.progress.updated ? new Date(b.progress.updated).getTime() : 0;
    comp = tA - tB;
  }
  return sortOrder === "asc" ? comp : -comp;
});

// Apply Pagination
const totalPages = Math.ceil(sortedRows.length / rowsPerPage);
const startIndex = (currentPage - 1) * rowsPerPage;
const paginatedRows = sortedRows.slice(startIndex, startIndex + rowsPerPage);

// Reset page number on filter changes
useEffect(() => {
  setCurrentPage(1);
}, [selectedKpi, cityFilter, executiveFilter, searchQuery, sortField, sortOrder, showMyTasks]);

const handleSort = (field: "name" | "city" | "updated") => {
  if (sortField === field) {
    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
  } else {
    setSortField(field);
    setSortOrder("asc");
  }
};

const renderSortHeader = (field: "name" | "city" | "updated", label: string) => {
  const active = sortField === field;
  return (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 hover:text-text-primary text-text-primary font-bold focus:outline-none transition-colors"
    >
      <span>{label}</span>
      <ArrowUpDown size={12} className={active ? "text-text-primary" : "text-text-dim"} />
    </button>
  );
};

const handleResetFilters = () => {
  setCityFilter("");
  setExecutiveFilter("");
  setSearchQuery("");
  setShowMyTasks(false);
  setKpiSelected(!isDualRole);
};

const handleKpiClick = (kpiId: string) => {
  setSelectedKpi(kpiId);
  setShowMyTasks(false);
  setKpiSelected(true);
};

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const exportCsv = async () => {
  if (sortedRows.length === 0) {
    toast.error("No data available to export.");
    return;
  }
  const kpiLabel = kpis.find((k) => k.id === selectedKpi)?.label || "Data";
  {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const generatedDate = new Date();
    const fileDate = generatedDate.toISOString().slice(0, 10);
    const filterAssociate = executiveFilter ? profileNameMap.get(executiveFilter) || "N/A" : "All Field Associates";
    const safeKpi = kpiLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "assigned";
    const reportRows = sortedRows.map((r, index) => {
      const bcNames = r.workerIds.map((id) => profileNameMap.get(id) || "N/A").join(", ");
      return {
        srNo: index + 1,
        company: r.company_name || r.name || "N/A",
        city: r.city || "N/A",
        fieldAssociate: bcNames || "Unassigned",
        status: r.status || "N/A",
        assessment: (r.progress.a || 0) / 100,
        installation: (r.progress.i || 0) / 100,
        commissioning: (r.progress.c || 0) / 100,
      };
    });
    const average = (key: "assessment" | "installation" | "commissioning") =>
      reportRows.length ? reportRows.reduce((sum, row) => sum + row[key], 0) / reportRows.length : 0;
    const submittedCount = reportRows.filter((row) => row.status === "Submitted").length;
    const completedStatuses = new Set(["Submitted", "Commissioned", "Assessed", "Installed"]);
    const completedCount = reportRows.filter((row) => completedStatuses.has(row.status)).length;
    const pendingCount = reportRows.length - completedCount;
    const progressMetrics = [
      { label: "Assessment", value: average("assessment") },
      { label: "Installation", value: average("installation") },
      { label: "Commissioning", value: average("commissioning") },
    ];
    const colors = {
      navy: "121C30",
      teal: "0D869A",
      tealLight: "E8F7FA",
      green: "1F9D45",
      greenLight: "EAF8EF",
      amber: "F59E0B",
      amberLight: "FFF7E6",
      red: "C62828",
      redLight: "FDECEC",
      border: "D6DCE8",
      muted: "667085",
      white: "FFFFFF",
      soft: "F7F9FC",
    };

    workbook.creator = "SimKit Ops";
    workbook.created = generatedDate;
    workbook.modified = generatedDate;

    const dashboard = workbook.addWorksheet("Summary Dashboard", {
      views: [{ state: "frozen", ySplit: 5 }],
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
      pageMargins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 },
    });
    dashboard.columns = Array.from({ length: 10 }, (_, index) => ({
      key: `c${index + 1}`,
      width: index < 2 ? 18 : 14,
    }));
    dashboard.mergeCells("A1:J1");
    dashboard.getCell("A1").value = `${kpiLabel} Status & Progress`;
    dashboard.getCell("A1").font = { bold: true, size: 20, color: { argb: colors.navy } };
    dashboard.getCell("A1").alignment = { horizontal: "center" };
    dashboard.mergeCells("A2:J2");
    dashboard.getCell("A2").value = "LimelightIT Research Pvt. Ltd. - Field Assignment Overview";
    dashboard.getCell("A2").font = { size: 12, color: { argb: colors.teal } };
    dashboard.getCell("A2").alignment = { horizontal: "center" };
    dashboard.addRow([]);
    dashboard.addRow(["Report Date", generatedDate, "City Filter", cityFilter || "All Cities", "Field Associate", filterAssociate, "Search", searchQuery || "None"]);
    dashboard.getRow(4).eachCell((cell, colNumber) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colNumber % 2 ? colors.soft : colors.white } };
      cell.border = { top: { style: "thin", color: { argb: colors.border } }, bottom: { style: "thin", color: { argb: colors.border } } };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (colNumber % 2) cell.font = { bold: true, color: { argb: colors.muted } };
    });
    dashboard.getCell("B4").numFmt = "mmm dd, yyyy";

    const kpiRows = [
      ["Total Records", reportRows.length, "Submitted", submittedCount, "Completed Status", completedCount, "Pending Status", pendingCount],
      ["Avg Assessment", average("assessment"), "Avg Installation", average("installation"), "Avg Commissioning", average("commissioning"), "Completion Rate", reportRows.length ? completedCount / reportRows.length : 0],
    ];
    dashboard.addRows(kpiRows);
    [6, 7].forEach((rowNumber) => {
      dashboard.getRow(rowNumber).height = 24;
      dashboard.getRow(rowNumber).eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: "thin", color: { argb: colors.border } },
          left: { style: "thin", color: { argb: colors.border } },
          bottom: { style: "thin", color: { argb: colors.border } },
          right: { style: "thin", color: { argb: colors.border } },
        };
        cell.alignment = { vertical: "middle", horizontal: colNumber % 2 ? "left" : "center", wrapText: true };
        if (colNumber % 2) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.navy } };
          cell.font = { bold: true, color: { argb: colors.white } };
        } else {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.tealLight } };
          cell.font = { bold: true, color: { argb: colors.navy } };
        }
      });
    });
    ["B7", "D7", "F7", "H7"].forEach((cellRef) => {
      dashboard.getCell(cellRef).numFmt = "0%";
    });

    dashboard.addRow([]);
    dashboard.addRow(["Progress Overview"]);
    dashboard.getCell("A9").font = { bold: true, size: 13, color: { argb: colors.navy } };
    progressMetrics.forEach((metric, metricIndex) => {
      const rowNumber = 10 + metricIndex;
      const row = dashboard.getRow(rowNumber);
      row.getCell(1).value = metric.label;
      row.getCell(2).value = metric.value;
      row.getCell(2).numFmt = "0%";
      row.getCell(1).font = { bold: true, color: { argb: colors.navy } };
      row.getCell(2).font = { bold: true, color: { argb: colors.teal } };
      row.height = 20;
      const filledCells = Math.round(metric.value * 8);
      for (let col = 3; col <= 10; col += 1) {
        const cell = row.getCell(col);
        cell.value = "";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col - 2 <= filledCells ? colors.teal : "EEF2F7" } };
        cell.border = { top: { style: "thin", color: { argb: colors.white } }, bottom: { style: "thin", color: { argb: colors.white } } };
      }
    });

    const detail = workbook.addWorksheet("Detailed Report", {
      views: [{ state: "frozen", ySplit: 1 }],
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      pageMargins: { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 },
    });
    detail.columns = [
      { header: "Sr. No.", key: "srNo", width: 9 },
      { header: "Company", key: "company", width: 38 },
      { header: "City", key: "city", width: 18 },
      { header: "Field Associate", key: "fieldAssociate", width: 24 },
      { header: "Assessment", key: "assessment", width: 14, style: { numFmt: "0%" } },
      { header: "Installation", key: "installation", width: 14, style: { numFmt: "0%" } },
      { header: "Commissioning", key: "commissioning", width: 16, style: { numFmt: "0%" } },
      { header: "Status", key: "status", width: 18 },
    ];
    detail.addRows(reportRows);
    detail.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: detail.columns.length },
    };
    detail.getRow(1).height = 24;
    detail.getRow(1).eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.navy } };
      cell.font = { bold: true, color: { argb: colors.white } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: colors.border } },
        left: { style: "thin", color: { argb: colors.border } },
        bottom: { style: "thin", color: { argb: colors.border } },
        right: { style: "thin", color: { argb: colors.border } },
      };
    });
    detail.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const rowData = reportRows[rowNumber - 2];
      row.height = 28;
      row.eachCell((cell, colNumber) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowNumber % 2 === 0 ? colors.white : colors.soft } };
        cell.alignment = {
          vertical: "middle",
          horizontal: colNumber === 2 || colNumber === 4 ? "left" : "center",
          wrapText: true,
        };
        cell.border = {
          top: { style: "thin", color: { argb: colors.border } },
          left: { style: "thin", color: { argb: colors.border } },
          bottom: { style: "thin", color: { argb: colors.border } },
          right: { style: "thin", color: { argb: colors.border } },
        };
      });
      const statusColor = completedStatuses.has(rowData.status)
        ? { fill: colors.greenLight, font: colors.green }
        : rowData.status === "Dropped / Rejected"
          ? { fill: colors.redLight, font: colors.red }
          : { fill: colors.amberLight, font: colors.amber };
      const statusCell = row.getCell(8);
      statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: statusColor.fill } };
      statusCell.font = { bold: true, color: { argb: statusColor.font } };
      [5, 6, 7].forEach((columnNumber) => {
        const value = Number(row.getCell(columnNumber).value || 0);
        row.getCell(columnNumber).numFmt = "0%";
        row.getCell(columnNumber).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: value >= 1 ? colors.greenLight : value > 0 ? colors.tealLight : "F2F4F7" },
        };
        row.getCell(columnNumber).font = { bold: true, color: { argb: value >= 1 ? colors.green : value > 0 ? colors.teal : colors.muted } };
      });
    });
    const detailSheet = detail as unknown as { addConditionalFormatting?: (rule: unknown) => void };
    detailSheet.addConditionalFormatting?.({
      ref: "E2:G1048576",
      rules: [
        {
          type: "dataBar",
          priority: 1,
          cfvo: [{ type: "num", value: 0 }, { type: "num", value: 1 }],
          color: colors.teal,
          showValue: true,
        },
      ],
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeKpi}-status-progress-${fileDate}.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Excel report exported successfully.");
    return;
  }
  {
    const escapeHtml = (value: unknown) =>
      String(value ?? "N/A")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const generatedAt = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date());
    const reportRows = sortedRows.map((r) => {
      const bcNames = r.workerIds.map((id) => profileNameMap.get(id) || "N/A").join(", ");
      return {
        company: r.company_name || r.name,
        city: r.city || "N/A",
        associate: bcNames || "Unassigned",
        status: r.status,
        submission: r.status === "Submitted" ? "Submitted" : "Pending",
        assessment: `${r.progress.a}%`,
        installation: `${r.progress.i}%`,
        commissioning: `${r.progress.c}%`,
      };
    });
    const workbook = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Arial, sans-serif; color: #101828; }
    table { border-collapse: collapse; width: 100%; }
    .title { font-size: 22px; font-weight: 700; color: #101828; }
    .subtitle { color: #0d869a; font-size: 13px; }
    .summary td { background: #f7f9fc; border: 1px solid #d6dce8; font-weight: 600; }
    th { background: #121c30; color: #ffffff; font-weight: 700; border: 1px solid #d6dce8; padding: 8px; }
    td { border: 1px solid #d6dce8; padding: 8px; vertical-align: top; }
    .status { font-weight: 700; text-align: center; }
    .submitted { background: #ebf9ef; color: #158c37; }
    .pending { background: #fff8e8; color: #f59219; }
    .progress { text-align: center; font-weight: 700; color: #0d869a; }
  </style>
</head>
<body>
  <table>
    <tr><td colspan="8" class="title">${escapeHtml(kpiLabel)} Status & Progress</td></tr>
    <tr><td colspan="8" class="subtitle">LimelightIT Research Pvt. Ltd. - Field Assignment Overview</td></tr>
    <tr><td colspan="8">Generated: ${escapeHtml(generatedAt)}</td></tr>
    <tr class="summary">
      <td colspan="2">Total Records</td><td colspan="2">${sortedRows.length}</td>
      <td colspan="2">City Filter</td><td colspan="2">${escapeHtml(cityFilter || "All Cities")}</td>
    </tr>
    <tr class="summary">
      <td colspan="2">Field Associate</td><td colspan="2">${escapeHtml(executiveFilter ? profileNameMap.get(executiveFilter) || "N/A" : "All Field Associates")}</td>
      <td colspan="2">Search</td><td colspan="2">${escapeHtml(searchQuery || "None")}</td>
    </tr>
    <tr>
      <th>Sr. No.</th>
      <th>Company</th>
      <th>City</th>
      <th>Field Associate</th>
      <th>Status</th>
      <th>Submission</th>
      <th>Assessment</th>
      <th>Installation / Commissioning</th>
    </tr>
    ${reportRows.map((row, index) => {
      const statusClass = row.status === "Submitted" || row.status === "Commissioned" || row.status === "Assessed" || row.status === "Installed"
        ? "submitted"
        : "pending";
      const submissionClass = row.submission === "Submitted" ? "submitted" : "pending";
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.company)}</td>
        <td>${escapeHtml(row.city)}</td>
        <td>${escapeHtml(row.associate)}</td>
        <td class="status ${statusClass}">${escapeHtml(row.status)}</td>
        <td class="status ${submissionClass}">${escapeHtml(row.submission)}</td>
        <td class="progress">${escapeHtml(row.assessment)}</td>
        <td class="progress">Installation: ${escapeHtml(row.installation)}<br/>Commissioning: ${escapeHtml(row.commissioning)}</td>
      </tr>`;
    }).join("")}
  </table>
</body>
</html>`;

    const url = URL.createObjectURL(new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8;" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${kpiLabel.toLowerCase().replace(/\s+/g, "-")}-report-${new Date().toISOString().slice(0, 10)}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Excel report exported successfully.");
    return;
  }
  const headers = ["Company", "Contact Person", "Contact Mobile", "City", "Assigned Field Associate", "Appt Progress", "Assessment Progress", "Installation Progress", "Commissioned Progress", "Status", "Last Updated"];
  const rows = sortedRows.map((r) => {
    const bcNames = r.workerIds.map((id) => profileNameMap.get(id) || "—").join(", ");
    const canonicalStatus = r.status;
    const lastUpdated = formatDate(r.progress.updated || r.assigned_at || r.appt_date);
    return [
      r.name,
      r.meta.c1_name || "—",
      r.meta.c1_mobile || "—",
      r.city || "—",
      bcNames || "Unassigned",
      r.progress.appt.status !== "none" ? r.progress.appt.status : "—",
      `${r.progress.a}%`,
      `${r.progress.i}%`,
      `${r.progress.c}%`,
      canonicalStatus,
      lastUpdated
    ];
  });

  const lines = [headers, ...rows].map((line) =>
    line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")
  );

  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${kpiLabel.toLowerCase().replace(/\s+/g, "-")}-export-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast.success("CSV exported successfully.");
};

const exportPdf = async () => {
  if (sortedRows.length === 0) {
    toast.error("No data available to export.");
    return;
  }
  setExportingPdf(true);
  try {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const navy: [number, number, number] = [18, 28, 48];
    const blue: [number, number, number] = [37, 99, 235];
    const ink: [number, number, number] = [20, 24, 38];
    const muted: [number, number, number] = [85, 96, 115];
    const border: [number, number, number] = [214, 220, 232];
    const soft: [number, number, number] = [247, 249, 252];

    const kpiLabel = kpis.find((k) => k.id === selectedKpi)?.label || "Data";
    const generatedAt = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date());
    const clean = (value: string | null | undefined) => {
      const text = (value || "").trim();
      return text || "N/A";
    };
    const getCityNameOnly = (cityStr: string | null | undefined): string => {
      if (!cityStr) return "N/A";
      const str = cityStr.trim();
      if (!str) return "N/A";
      if (!str.includes(",") && str.length <= 15) {
        return str;
      }
      const parts = str.split(",").map(p => p.trim()).filter(Boolean);
      if (parts.length === 0) return "N/A";
      const knownCities = [
        "ahmedabad", "gandhinagar", "vadodara", "surat", "rajkot", "morbi", "jamnagar", "vapi", "bharuch", "ankleshwar",
        "mumbai", "pune", "nagpur", "nashik", "thane", "navi mumbai",
        "indore", "bhopal", "gwalior", "jabalpur",
        "kolkata", "howrah",
        "delhi", "gurgaon", "gurugram", "noida", "ghaziabad", "faridabad",
        "bangalore", "bengaluru", "mysore", "hubli",
        "chennai", "coimbatore", "madurai",
        "hyderabad", "secunderabad",
        "jaipur", "jodhpur", "udaipur",
        "moradabad", "aligarh"
      ];
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i].toLowerCase();
        const cleanPart = part.replace(/\d+/g, "").replace(/\b(gujarat|maharashtra|madhya pradesh|west bengal|delhi ncr|karnataka|tamil nadu|telangana|rajasthan|uttar pradesh|up|mp|wb|mh|gj)\b/g, "").trim();
        if (!cleanPart) continue;
        if (knownCities.some(kc => cleanPart.includes(kc) || kc.includes(cleanPart))) {
          return parts[i].replace(/\d+/g, "").trim();
        }
      }
      const ignoreKeywords = ["plot", "street", "road", "phase", "gidc", "industrial", "floor", "building", "zone", "sector", "lane", "behind", "near", "opp", "opposite"];
      for (let i = parts.length - 1; i >= 0; i--) {
        const partLower = parts[i].toLowerCase();
        if (!ignoreKeywords.some(kw => partLower.includes(kw))) {
          const cleaned = parts[i].replace(/\d+/g, "").replace(/\b(gujarat|maharashtra|madhya pradesh|west bengal|delhi ncr|karnataka|tamil nadu|telangana|rajasthan|uttar pradesh)\b/gi, "").trim();
          if (cleaned.length > 0 && cleaned.length <= 15) {
            return cleaned;
          }
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const cleaned = parts[i].replace(/\d+/g, "").trim();
        if (cleaned.length > 0) {
          return cleaned;
        }
      }
      return parts[0];
    };
    const progressText = (r: SiteRow) => [
      `Assessment: ${r.progress.a || 0}%`,
      `Installation: ${r.progress.i || 0}%`,
      `Commissioning: ${r.progress.c || 0}%`,
      `Submission: ${r.status === "Submitted" ? "Submitted" : "Pending"}`,
    ].join("\n");

    const logoDataUrl = await fetch(logoUrl)
      .then((response) => response.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }),
      );
    const watermarkDataUrl = await new Promise<string>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 700;
        canvas.height = 700;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Could not prepare watermark."));
          return;
        }
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.globalAlpha = 0.07;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = () => reject(new Error("Could not load company watermark."));
      image.src = logoDataUrl;
    });

    const teal: [number, number, number] = [13, 134, 154];
    const orange: [number, number, number] = [245, 146, 25];
    const green: [number, number, number] = [21, 140, 55];
    const greenBg: [number, number, number] = [235, 249, 239];
    const orangeBg: [number, number, number] = [255, 248, 232];
    const cardShadow: [number, number, number] = [231, 235, 242];

    const statusTone = (status: string): { fg: [number, number, number]; bg: [number, number, number]; label: string } => {
      const normalized = status.toLowerCase();
      if (normalized.includes("commissioned") || normalized.includes("submitted")) {
        return { fg: green, bg: greenBg, label: status.toUpperCase() };
      }
      if (normalized.includes("assessed") || normalized.includes("installed")) {
        return { fg: green, bg: greenBg, label: status.toUpperCase() };
      }
      if (normalized.includes("pending") || normalized.includes("not started")) {
        return { fg: orange, bg: orangeBg, label: status.toUpperCase() };
      }
      return { fg: teal, bg: [232, 247, 250], label: status.toUpperCase() };
    };

    const drawTextFit = (
      text: string,
      x: number,
      y: number,
      maxWidth: number,
      size = 8,
      bold = false,
      maxLines = 2,
      lineHeight = size * 0.42 + 2.3,
    ) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(clean(text), maxWidth).slice(0, maxLines);
      lines.forEach((line: string, i: number) => doc.text(line, x, y + i * lineHeight));
      return lines.length;
    };

    const drawAddressFit = (text: string, x: number, y: number, maxWidth: number, maxLines = 3) => {
      doc.setFont("helvetica", "normal");
      let size = 5.7;
      let lines = doc.splitTextToSize(clean(text), maxWidth);
      while (lines.length > maxLines && size > 4.4) {
        size -= 0.2;
        doc.setFontSize(size);
        lines = doc.splitTextToSize(clean(text), maxWidth);
      }
      doc.setFontSize(size);
      lines.slice(0, maxLines).forEach((line: string, i: number) => doc.text(line, x, y + i * 3.6));
    };

    const drawCenteredWrappedText = (
      text: string,
      x: number,
      y: number,
      maxWidth: number,
      size: number,
      lineHeight: number,
      color: [number, number, number],
    ) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(clean(text), maxWidth).slice(0, 2);
      lines.forEach((line: string, index: number) => {
        doc.text(line, x, y + index * lineHeight, { align: "center" });
      });
      return lines.length;
    };

    const pageMarginX = 9;
    const headerHeight = 31;
    const cardHeight = 26;
    const cardGap = 5;
    const cardWidth = pageWidth - pageMarginX * 2;

    const drawProgress = (label: string, value: number, x: number, y: number) => {
      const width = 14;
      const barX = x + 18;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...ink);
      doc.text(label, x, y);
      doc.setFillColor(229, 232, 238);
      doc.roundedRect(barX, y - 2.0, width, 1.8, 0.9, 0.9, "F");
      if (value > 0) {
        doc.setFillColor(...teal);
        doc.roundedRect(barX, y - 2.0, Math.max(0.8, (width * value) / 100), 1.8, 0.9, 0.9, "F");
      }
    };

    const drawPageHeader = () => {
      doc.addImage(watermarkDataUrl, "PNG", pageWidth / 2 - 48, pageHeight / 2 - 48, 96, 96);
      doc.setFillColor(...navy);
      doc.roundedRect(0, 0, 58, 28, 0, 0, "F");
      doc.setFillColor(...teal);
      doc.triangle(56, 0, 68, 0, 58, 28, "F");
      doc.setFillColor(255, 255, 255);
      doc.triangle(62, 0, 67, 0, 58, 25, "F");
      doc.addImage(logoDataUrl, "PNG", 5, 5, 12, 12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text("LimelightIT", 19, 11);
      doc.setFontSize(7.2);
      doc.text("Research Pvt. Ltd.", 19, 17);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(...navy);
      const titleCenterX = 116;
      const titleLines = drawCenteredWrappedText(`${kpiLabel} Status & Progress`, titleCenterX, 12, 88, 14.5, 6.5, navy);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...muted);
      doc.text("LimelightIT Research Pvt. Ltd.", titleCenterX, titleLines > 1 ? 26 : 21.5, { align: "center" });
      doc.setFontSize(7.8);
      doc.setTextColor(...teal);
      doc.text("Field Assignment Overview", titleCenterX, titleLines > 1 ? 32 : 28, { align: "center" });

      doc.setDrawColor(...border);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(pageWidth - 47, 5.5, 38, 16, 2, 2, "FD");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.2);
      doc.setTextColor(...muted);
      doc.text("Report Date", pageWidth - 28, 12, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.3);
      doc.setTextColor(...navy);
      doc.text(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), pageWidth - 28, 18, { align: "center" });
    };

    const drawCompanyCard = (r: SiteRow, displayIndex: number, y: number) => {
      const x = pageMarginX;
      const h = cardHeight;
      const w = cardWidth;
      const tone = statusTone(r.status);
      const bcNames = r.workerIds.map((id) => profileNameMap.get(id) || "N/A").join(", ") || "Unassigned";

      doc.setFillColor(...cardShadow);
      doc.roundedRect(x + 0.6, y + 0.7, w, h, 2, 2, "F");
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...border);
      doc.roundedRect(x, y, w, h, 2, 2, "FD");
      doc.setFillColor(...teal);
      doc.roundedRect(x, y, 1.8, h, 1.4, 1.4, "F");

      // Column 1: Index and City
      doc.setFillColor(...navy);
      doc.roundedRect(x + 4, y + 3.5, 12, 11, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(255, 255, 255);
      doc.text(String(displayIndex), x + 10, y + 11.5, { align: "center" });

      const cityName = getCityNameOnly(r.city);
      doc.setFillColor(232, 247, 250);
      doc.roundedRect(x + 2, y + 17.5, 16, 5, 1.2, 1.2, "F");
      doc.setFontSize(6.2);
      doc.setTextColor(...teal);
      doc.text(cityName.toUpperCase(), x + 10, y + 21.2, { align: "center" });

      const dividers = [20, 85, 125, 150];
      doc.setDrawColor(...border);
      dividers.forEach((dx) => doc.line(x + dx, y + 3, x + dx, y + h - 3));

      // Column 2: Company details
      doc.setFillColor(232, 247, 250);
      doc.circle(x + 25.5, y + 13, 3.5, "F");
      doc.setDrawColor(...teal);
      doc.rect(x + 24.2, y + 11.9, 2.6, 3.4, "S");
      doc.rect(x + 23.4, y + 13.2, 4.3, 2.1, "S");
      doc.setTextColor(...navy);
      const companyLines = drawTextFit(clean(r.company_name || r.name).toUpperCase(), x + 31, y + 9.5, 50, 7.8, true, 2);

      const fullAddress = r.address || (r.city && r.city.includes(",") ? r.city : "");
      if (fullAddress) {
        doc.setTextColor(...muted);
        drawAddressFit(fullAddress, x + 31, companyLines > 1 ? y + 17.8 : y + 15.8, 52, companyLines > 1 ? 2 : 3);
      }

      // Column 3: Field Associate
      doc.setTextColor(...ink);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.8);
      doc.text("Field Associate", x + 88, y + 8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...teal);
      drawTextFit(clean(bcNames), x + 88, y + 13.5, 34, 7.2, true, 2);

      // Column 4: Status
      doc.setFillColor(...tone.bg);
      doc.setDrawColor(...tone.fg);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5);
      const statusLines = doc.splitTextToSize(tone.label, 18).slice(0, 2);
      const badgeHeight = statusLines.length > 1 ? 11.5 : 10.5;
      const statusBadgeY = y + (h - badgeHeight) / 2;
      doc.roundedRect(x + 127, statusBadgeY, 22, badgeHeight, 2, 2, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5);
      doc.setTextColor(...tone.fg);
      const statusTextStartY =
        statusBadgeY + badgeHeight / 2 - ((statusLines.length - 1) * 3.2) / 2 + 1.7;
      statusLines.forEach((line: string, lineIndex: number) => {
        doc.text(line, x + 138, statusTextStartY + lineIndex * 3.2, { align: "center" });
      });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...ink);

      // Column 5: Progress
      doc.setDrawColor(...border);
      doc.line(x + 152, y + 5.5, x + 188, y + 5.5);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      doc.setTextColor(...navy);
      doc.text("PROGRESS", x + 170, y + 5, { align: "center" });
      drawProgress("Ass.", r.progress.a || 0, x + 152, y + 11.2);
      drawProgress("Inst.", r.progress.i || 0, x + 152, y + 17.2);
      drawProgress("Comm.", r.progress.c || 0, x + 152, y + 23.2);
    };

    let page = 0;
    const rowsPerReportPage = 8;
    for (let offset = 0; offset < sortedRows.length; offset += rowsPerReportPage) {
      if (page > 0) doc.addPage();
      page += 1;
      drawPageHeader();
      sortedRows.slice(offset, offset + rowsPerReportPage).forEach((row, index) => {
        drawCompanyCard(row, offset + index + 1, headerHeight + 5 + index * (cardHeight + cardGap));
      });
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.setFont("helvetica", "normal");
      doc.text(`Page ${page}`, pageWidth - pageMarginX, pageHeight - 6, { align: "right" });
    }

    doc.save(`${kpiLabel.toLowerCase().replace(/\s+/g, "-")}-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success("PDF report downloaded.");
    return;

    const addChrome = () => {
      const pageNumber = doc.getNumberOfPages();
      doc.setFillColor(...navy);
      doc.rect(0, 0, pageWidth, 24, "F");
      doc.setFillColor(...blue);
      doc.rect(0, 24, pageWidth, 1.4, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(255, 255, 255);
      doc.text("SIMKIT OPS", 14, 11);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(204, 213, 226);
      doc.text("Management Report", 14, 17);
      doc.text(kpiLabel.toUpperCase(), pageWidth - 14, 11, { align: "right" });
      doc.text(generatedAt, pageWidth - 14, 17, { align: "right" });
      doc.setDrawColor(...border);
      doc.setLineWidth(0.2);
      doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.text("Generated from SimKit Ops Overview", 14, pageHeight - 7);
      doc.text(`Page ${pageNumber}`, pageWidth - 14, pageHeight - 7, { align: "right" });
    };

    addChrome();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...ink);
    doc.text(`${kpiLabel} Report`, 14, 38);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text("Particular data export with company, assignment, status, and progress details.", 14, 44);
    doc.setFillColor(...soft);
    doc.setDrawColor(...border);
    doc.roundedRect(14, 51, pageWidth - 28, 22, 2, 2, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...ink);
    doc.text(`Total Records: ${sortedRows.length}`, 19, 59);
    doc.text(`City Filter: ${cityFilter || "All Cities"}`, 19, 66);
    doc.text(`Field Associate: ${executiveFilter ? clean(profileNameMap.get(executiveFilter)) : "All Field Associates"}`, 86, 59);
    doc.text(`Search: ${searchQuery || "None"}`, 86, 66);

    autoTable(doc, {
      startY: 82,
      margin: { left: 14, right: 14, top: 31, bottom: 18 },
      head: [["#", "City", "Company Details", "Assignment", "Status & Progress"]],
      body: sortedRows.map((r, index) => {
        const bcNames = r.workerIds.map((id) => profileNameMap.get(id) || "—").join(", ");
        const canonicalStatus = r.status;
        const progressStr = `Appt: ${r.progress.appt.status !== "none" ? r.progress.appt.status : "—"}\nAssmt: ${r.progress.a || 0}%\nInst: ${r.progress.i || 0}%\nComm: ${r.progress.c || 0}%`;
        const lastUpdated = formatDate(r.progress.updated || r.assigned_at || r.appt_date);
        const company = clean(r.company_name || r.name);
        const siteName = clean(r.name);
        const contactLines = [
          `Company: ${company}`,
          company !== siteName ? `Site: ${siteName}` : "",
          `Contact: ${clean(r.meta.c1_name)}`,
          `Mobile: ${clean(r.meta.c1_mobile)}`,
          r.meta.c1_email ? `Email: ${r.meta.c1_email}` : "",
        ].filter(Boolean).join("\n");
        const assignmentLines = [
          `Field Associate: ${bcNames || "Unassigned"}`,
          `Assigned: ${formatDate(r.assigned_at)}`,
          `Last Updated: ${lastUpdated}`,
        ].join("\n");
        const statusLines = [
          `Status: ${canonicalStatus}`,
          r.logisticsStatus ? `Logistics: ${r.logisticsStatus}` : "",
          progressText(r),
        ].filter(Boolean).join("\n");
        return [
          String(index + 1),
          r.city || "—",
          contactLines,
          assignmentLines,
          statusLines
        ];
      }),
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 8.2,
        cellPadding: 3,
        lineColor: border,
        lineWidth: 0.2,
        textColor: ink,
        overflow: "linebreak",
        valign: "top",
      },
      headStyles: {
        fillColor: navy,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8.6,
        cellPadding: 3,
      },
      alternateRowStyles: { fillColor: soft },
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        1: { cellWidth: 22 },
        2: { cellWidth: 62 },
        3: { cellWidth: 43 },
        4: { cellWidth: 45 },
      },
      didDrawPage: () => addChrome(),
    });

    doc.save(`${kpiLabel.toLowerCase().replace(/\s+/g, "-")}-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success("PDF report downloaded.");
  } catch (error) {
    console.error("PDF generation failed", error);
    toast.error("Failed to generate PDF export.");
  } finally {
    setExportingPdf(false);
  }
};

const getStatusBadge = (status: string) => {
  let toneClass = "bg-stone-50 text-stone-600 border-stone-200";
  if (status === "Submitted") {
    toneClass = "bg-emerald-50 text-emerald-700 border-emerald-250";
  } else if (status === "Dropped / Rejected") {
    toneClass = "bg-red-50 text-red-700 border-red-200";
  } else if (status === "Panel Dispatched") {
    toneClass = "bg-blue-50 text-blue-700 border-blue-200";
  } else if (status === "Installed") {
    toneClass = "bg-cyan-50 text-cyan-700 border-cyan-200";
  } else if (status === "Commissioned") {
    toneClass = "bg-teal-50 text-teal-700 border-teal-250";
  } else if (status === "Assigned") {
    toneClass = "bg-indigo-50 text-indigo-700 border-indigo-200";
  } else if (status === "Pending Assignment" || status === "Total Assignment Pending on Portal" || status === "Assessed" || status === "Unsubmitted" || status === "Certification Pending") {
    toneClass = "bg-amber-50 text-amber-700 border-amber-250";
  }
  return (
    <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${toneClass}`}>
      {status}
    </span>
  );
};

const renderProgressPill = (label: string, pct: number) => {
  let style = "bg-surface-raised text-text-secondary border-border";
  if (pct === 100) {
    style = "bg-emerald-50 text-emerald-700 border-emerald-250";
  } else if (pct > 0) {
    style = "bg-amber-50 text-amber-700 border-amber-250";
  }
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-semibold font-mono ${style}`}>
      <span>{label}:</span>
      <span>{pct}%</span>
    </span>
  );
};

const renderApptBadge = (appt: Appt) => {
  if (!appt || appt.status === "none") return null;
  const map: Record<string, { label: string; bg: string; fg: string; border: string }> = {
    early: { label: "Early", bg: "bg-emerald-50", fg: "text-emerald-700", border: "border-emerald-200" },
    ontime: { label: "On Time", bg: "bg-emerald-50", fg: "text-emerald-700", border: "border-emerald-200" },
    late: { label: "Late", bg: "bg-red-50", fg: "text-red-700", border: "border-red-200" },
    scheduled: { label: "Scheduled", bg: "bg-surface-raised", fg: "text-text-secondary", border: "border-border" },
  };
  const m = map[appt.status] ?? map.scheduled;
  const tooltip = appt.completed
    ? `Visited: ${new Date(appt.completed).toLocaleDateString()} • Scheduled: ${appt.scheduled ? new Date(appt.scheduled).toLocaleDateString() : ""}`
    : appt.scheduled
      ? `Appt: ${new Date(appt.scheduled).toLocaleDateString()}`
      : "";
  return (
    <span
      title={tooltip}
      className={`inline-block px-1.5 py-0.5 rounded border font-mono text-[9px] uppercase tracking-wide font-bold ml-1.5 ${m.bg} ${m.fg} ${m.border}`}
    >
      {m.label}
    </span>
  );
};

const kpis = [
  {
    id: "assigned",
    label: "Companies Assigned",
    value: countTotal,
    desc: "Total registered companies",
    icon: Building,
    badgeStyle: "text-blue-600 bg-blue-50 border-blue-200",
    dotStyle: "bg-blue-500",
  },
  {
    id: "submitted",
    label: "Submitted",
    value: countSubmitted,
    desc: "Assessment phase completed",
    icon: CheckCircle2,
    badgeStyle: "text-emerald-600 bg-emerald-50 border-emerald-200",
    dotStyle: "bg-emerald-500",
  },
  {
    id: "unsubmitted",
    label: "Unsubmitted",
    value: countUnsubmitted,
    desc: "Completed but pending on Portal",
    icon: AlertCircle,
    badgeStyle: "text-orange-600 bg-orange-50 border-orange-200",
    dotStyle: "bg-orange-500",
  },
  {
    id: "certification",
    label: "Certification Pending",
    value: countCertification,
    desc: "Submitted but certificate pending",
    icon: Award,
    badgeStyle: "text-purple-600 bg-purple-50 border-purple-200",
    dotStyle: "bg-purple-500",
  },
  {
    id: "pending",
    label: "Pending Assignment",
    value: countPending,
    desc: "Awaiting Field Associate assignment",
    icon: UserMinus,
    badgeStyle: "text-amber-600 bg-amber-50 border-amber-200",
    dotStyle: "bg-amber-500",
  },
  {
    id: "pending_portal",
    label: "Total Assignment Pending on Portal",
    value: countPendingPortal,
    desc: "Active companies pending submission",
    icon: AlertCircle,
    badgeStyle: "text-amber-600 bg-amber-50 border-amber-200",
    dotStyle: "bg-amber-500",
  },
  {
    id: "assigned_bc",
    label: "Assigned",
    value: countAssignedBc,
    desc: "Field Associate assigned, work pending",
    icon: Users,
    badgeStyle: "text-indigo-600 bg-indigo-50 border-indigo-200",
    dotStyle: "bg-indigo-500",
  },
  {
    id: "assessment",
    label: "Assessed",
    value: countAssessment,
    desc: "Currently undergoing assessment",
    icon: ClipboardList,
    badgeStyle: "text-blue-600 bg-blue-50 border-blue-200",
    dotStyle: "bg-blue-500",
  },
  {
    id: "dispatched",
    label: "Pending Panel Dispatched",
    value: countPendingDispatched,
    desc: "Logistics order in dispatch flow",
    icon: Truck,
    badgeStyle: "text-blue-600 bg-blue-50 border-blue-200",
    dotStyle: "bg-blue-500",
  },
  {
    id: "dispatched_actual",
    label: "Dispatched",
    value: countDispatched,
    desc: "Transit + delivered before installation",
    icon: Truck,
    badgeStyle: "text-blue-600 bg-blue-50 border-blue-200",
    dotStyle: "bg-blue-500",
  },
  {
    id: "installed",
    label: "Installed",
    value: countInstalled,
    desc: "Installation phase completed",
    icon: Wrench,
    badgeStyle: "text-blue-600 bg-blue-50 border-blue-200",
    dotStyle: "bg-blue-500",
  },
  {
    id: "commissioned",
    label: "Commissioned",
    value: countCommissioned,
    desc: "Commissioning phase completed",
    icon: CheckCircle2,
    badgeStyle: "text-emerald-600 bg-emerald-50 border-emerald-200",
    dotStyle: "bg-emerald-500",
  },
  {
    id: "dropped",
    label: "Dropped / Rejected",
    value: countDropped,
    desc: "Sites dropped or rejected",
    icon: XCircle,
    badgeStyle: "text-red-600 bg-red-50 border-red-200",
    dotStyle: "bg-red-500",
  },
  {
    id: "not_started",
    label: "Not Started Yet",
    value: countNotStarted,
    desc: "Assigned but no progress made",
    icon: Clock,
    badgeStyle: "text-indigo-600 bg-indigo-50 border-indigo-200",
    dotStyle: "bg-indigo-500",
  },
];

return (
  <div className="space-y-5">
    <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">Dashboard</p>
        <h1 className="mt-1 text-3xl text-text-primary font-syne uppercase tracking-tight font-extrabold">Overview</h1>
      </div>
    </header>

    {/* Main semantic variables-based analytics dashboard */}
    <div className="bg-surface text-text-primary border border-border rounded-2xl p-4 md:p-5 shadow-sm space-y-6 font-sans transition-all duration-300">

      {/* Title / Sync Info */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-extrabold text-text-primary tracking-tight">
            Analytics Dashboard
          </h2>
          <p className="text-xs text-text-secondary mt-0.5 font-normal">
            Interactive metrics overview and site verification trackers.
          </p>
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-xs text-text-secondary font-mono">
            <span className="h-2 w-2 rounded-full bg-text-secondary animate-pulse" />
            Syncing...
          </div>
        )}
      </div>

      {/* KPI Cards Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 bg-surface-raised rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {/* ROW 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Companies Assigned */}
            <div className="lg:col-span-4 h-full">
              {(() => {
                const k = kpis.find(x => x.id === "assigned")!;
                if (!k) return null;
                const active = selectedKpi === k.id;
                const Icon = k.icon;
                const cardBorder = active
                  ? "border-blue-500 ring-2 ring-blue-500/10 bg-white scale-[1.01] shadow-md"
                  : "border-border bg-white hover:border-blue-400 hover:shadow-md transition-all";
                return (
                  <button
                    onClick={() => handleKpiClick(k.id)}
                    className={`flex flex-col justify-between w-full text-left p-4 border rounded-xl shadow-xs transition-all duration-200 group cursor-pointer h-full min-h-[130px] ${cardBorder}`}
                  >
                    <div className="flex items-start justify-between w-full">
                      <div className={`p-2 rounded-xl border ${k.badgeStyle}`}>
                        <Icon size={16} strokeWidth={2.5} />
                      </div>
                      <span className={`h-2 w-2 rounded-full ${k.dotStyle}`} />
                    </div>
                    <div className="mt-4">
                      <div className="text-3xl font-extrabold text-text-primary tracking-tight font-mono">
                        {k.value}
                      </div>
                      <div className="text-xs font-bold mt-1 text-text-primary">
                        {k.label}
                      </div>
                      <div className="text-[10px] mt-0.5 leading-snug text-text-secondary">
                        {k.desc}
                      </div>
                    </div>
                  </button>
                );
              })()}
            </div>

            {/* Right Box: Submitted & Stack */}
            <div className="lg:col-span-8 border border-border bg-surface/30 rounded-2xl p-4 flex flex-col justify-between h-full">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 flex-1">
                {/* Submitted */}
                <div className="md:col-span-6 h-full">
                  {(() => {
                    const k = kpis.find(x => x.id === "submitted")!;
                    if (!k) return null;
                    const active = selectedKpi === k.id;
                    const Icon = k.icon;
                    const cardBorder = active
                      ? "border-emerald-500 ring-2 ring-emerald-500/10 bg-white scale-[1.01] shadow-md"
                      : "border-border bg-white hover:border-emerald-400 hover:shadow-md transition-all";
                    return (
                      <button
                        onClick={() => handleKpiClick(k.id)}
                        className={`flex flex-col justify-between w-full text-left p-4 border rounded-xl shadow-xs transition-all duration-200 group cursor-pointer h-full min-h-[130px] ${cardBorder}`}
                      >
                        <div className="flex items-start justify-between w-full">
                          <div className={`p-2 rounded-xl border ${k.badgeStyle}`}>
                            <Icon size={16} strokeWidth={2.5} />
                          </div>
                          <span className={`h-2 w-2 rounded-full ${k.dotStyle}`} />
                        </div>
                        <div className="mt-4">
                          <div className="text-3xl font-extrabold text-text-primary tracking-tight font-mono">
                            {k.value}
                          </div>
                          <div className="text-xs font-bold mt-1 text-text-primary">
                            {k.label}
                          </div>
                          <div className="text-[10px] mt-0.5 leading-snug text-text-secondary">
                            {k.desc}
                          </div>
                        </div>
                      </button>
                    );
                  })()}
                </div>

                {/* Unsubmitted & Certification Pending Stack */}
                <div className="md:col-span-6 flex flex-col gap-3 justify-between h-full">
                  {[
                    kpis.find(x => x.id === "unsubmitted")!,
                    kpis.find(x => x.id === "certification")!
                  ].filter(Boolean).map((k) => {
                    const active = selectedKpi === k.id;
                    const Icon = k.icon;
                    const isPurple = k.id === "certification";
                    const hoverColor = isPurple ? "hover:border-purple-400" : "hover:border-orange-400";
                    const cardBorder = active
                      ? (isPurple
                        ? "border-purple-500 ring-2 ring-purple-500/10 bg-white scale-[1.01] shadow-md"
                        : "border-orange-500 ring-2 ring-orange-500/10 bg-white scale-[1.01] shadow-md")
                      : `border-border bg-white ${hoverColor} hover:shadow-md transition-all`;
                    return (
                      <button
                        key={k.id}
                        onClick={() => handleKpiClick(k.id)}
                        className={`flex items-center justify-between w-full text-left px-3 py-2.5 border rounded-xl shadow-xs transition-all duration-200 group cursor-pointer flex-1 ${cardBorder}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`p-1.5 rounded-lg border shrink-0 ${k.badgeStyle}`}>
                            <Icon size={14} strokeWidth={2.5} />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-text-primary">
                              {k.label}
                            </div>
                            <div className="text-[9px] text-text-secondary leading-tight mt-0.5">
                              {k.desc}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-xl font-extrabold text-text-primary font-mono">
                            {k.value}
                          </div>
                          <span className={`h-2 w-2 rounded-full ${k.dotStyle} shrink-0`} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ROW 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Column 1: Dropped / Rejected & Assigned Stack */}
            <div className="lg:col-span-3 flex flex-col gap-3 justify-between h-full">
              {[
                kpis.find(x => x.id === "dropped")!,
                kpis.find(x => x.id === "assigned_bc")!
              ].filter(Boolean).map((k) => {
                const active = selectedKpi === k.id;
                const Icon = k.icon;
                const isIndigo = k.id === "assigned_bc";
                const hoverColor = isIndigo ? "hover:border-blue-400" : "hover:border-red-400";
                const cardBorder = active
                  ? (isIndigo
                    ? "border-blue-500 ring-2 ring-blue-500/10 bg-white scale-[1.01] shadow-md"
                    : "border-red-500 ring-2 ring-red-500/10 bg-white scale-[1.01] shadow-md")
                  : `border-border bg-white ${hoverColor} hover:shadow-md transition-all`;
                return (
                  <button
                    key={k.id}
                    onClick={() => handleKpiClick(k.id)}
                    className={`flex items-center justify-between w-full text-left px-3 py-2.5 border rounded-xl shadow-xs transition-all duration-200 group cursor-pointer flex-1 ${cardBorder}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-1.5 rounded-lg border shrink-0 ${k.badgeStyle}`}>
                        <Icon size={14} strokeWidth={2.5} />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-text-primary">
                          {k.label}
                        </div>
                        <div className="text-[9px] text-text-secondary leading-tight mt-0.5">
                          {k.desc}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-xl font-extrabold text-text-primary font-mono">
                        {k.value}
                      </div>
                      <span className={`h-2 w-2 rounded-full ${k.dotStyle} shrink-0`} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Column 2: Pending Assignment & Not Started Yet Stack */}
            <div className="lg:col-span-3 flex flex-col gap-3 justify-between h-full">
              {[
                kpis.find(x => x.id === "pending")!,
                kpis.find(x => x.id === "not_started")!
              ].filter(Boolean).map((k) => {
                const active = selectedKpi === k.id;
                const Icon = k.icon;
                const isAmber = k.id === "pending";
                const hoverColor = isAmber ? "hover:border-amber-400" : "hover:border-indigo-400";
                const cardBorder = active
                  ? (isAmber
                    ? "border-amber-500 ring-2 ring-amber-500/10 bg-white scale-[1.01] shadow-md"
                    : "border-indigo-500 ring-2 ring-indigo-500/10 bg-white scale-[1.01] shadow-md")
                  : `border-border bg-white ${hoverColor} hover:shadow-md transition-all`;
                return (
                  <button
                    key={k.id}
                    onClick={() => handleKpiClick(k.id)}
                    className={`flex items-center justify-between w-full text-left px-3 py-2.5 border rounded-xl shadow-xs transition-all duration-200 group cursor-pointer flex-1 ${cardBorder}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-1.5 rounded-lg border shrink-0 ${k.badgeStyle}`}>
                        <Icon size={14} strokeWidth={2.5} />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-text-primary">
                          {k.label}
                        </div>
                        <div className="text-[9px] text-text-secondary leading-tight mt-0.5">
                          {k.desc}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-xl font-extrabold text-text-primary font-mono">
                        {k.value}
                      </div>
                      <span className={`h-2 w-2 rounded-full ${k.dotStyle} shrink-0`} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Column 3: Middle Container Box (Logistics + workflow cards) */}
            <div className="lg:col-span-6 border border-border bg-surface/30 rounded-2xl p-4 flex flex-col justify-between h-full">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 flex-1">
                {[
                  [
                    kpis.find(x => x.id === "assessment")!,
                    kpis.find(x => x.id === "dispatched_actual")!,
                    kpis.find(x => x.id === "dispatched")!,
                  ],
                  [
                    kpis.find(x => x.id === "installed")!,
                    kpis.find(x => x.id === "commissioned")!,
                  ],
                ].map((group, groupIndex) => (
                  <div
                    key={groupIndex}
                    className={groupIndex === 0
                      ? "md:col-span-6 grid grid-cols-1 gap-2"
                      : "md:col-span-6 grid grid-cols-1 gap-2"}
                  >
                    {group.filter(Boolean).map((k) => {
                      const active = selectedKpi === k.id;
                      const Icon = k.icon;
                      const isGreen = k.id === "commissioned";
                      const hoverColor = isGreen ? "hover:border-emerald-400" : "hover:border-blue-400";
                      const cardBorder = active
                        ? (isGreen
                          ? "border-emerald-500 ring-2 ring-emerald-500/10 bg-white scale-[1.01] shadow-md"
                          : "border-blue-500 ring-2 ring-blue-500/10 bg-white scale-[1.01] shadow-md")
                        : `border-border bg-white ${hoverColor} hover:shadow-md transition-all`;
                      return (
                        <button
                          key={k.id}
                          onClick={() => handleKpiClick(k.id)}
                          className={`flex min-h-20 flex-col justify-between w-full text-left px-3 py-2 border rounded-xl shadow-xs transition-all duration-200 group cursor-pointer ${cardBorder}`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className={`p-1.5 rounded-lg border shrink-0 ${k.badgeStyle}`}>
                              <Icon size={15} strokeWidth={2.5} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-text-primary leading-tight break-words">
                                {k.label}
                              </div>
                              <div className="text-[10px] text-text-secondary leading-tight mt-0.5 break-words">
                                {k.desc}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-end justify-between gap-2 pt-1.5">
                            <div className="text-2xl font-extrabold text-text-primary font-mono leading-none">
                              {k.value}
                            </div>
                            <span className={`h-2.5 w-2.5 rounded-full ${k.dotStyle} shrink-0 mb-1`} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* My Tasks Section — shown by default before any KPI card is clicked */}
      {isDualRole && !kpiSelected && (() => {
        const myRows = allProcessedRows.filter(r => r.workerIds.includes(userId ?? ""));
        return (
          <div className="border border-border rounded-xl bg-surface p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-text-primary font-syne uppercase tracking-wide">My Tasks</h3>
                <p className="text-xs text-text-secondary mt-0.5">{myRows.length} site{myRows.length !== 1 ? "s" : ""} assigned to you</p>
              </div>
            </div>
            {myRows.length === 0 ? (
              <div className="py-10 text-center text-text-secondary text-sm">No sites are currently assigned to you.</div>
            ) : (
              <div className="divide-y divide-border">
                {myRows.map(row => {
                  const status = row.status;
                  const statusCls = status === "Submitted" || status === "Commissioned" || status === "Installed"
                    ? "bg-lime/10 text-lime border-lime/30"
                    : status === "Dropped / Rejected"
                      ? "bg-coral/10 text-coral border-coral/30"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/30";
                  return (
                    <div key={row.id} className="flex items-center justify-between py-3 gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-text-primary truncate">{row.company_name || row.name}</p>
                        <p className="text-xs text-text-secondary mt-0.5 font-mono">{row.city || "—"}</p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-widest border shrink-0 ${statusCls}`}>
                        {status}
                      </span>
                      <button
                        onClick={() => setConsultantSiteId(row.id)}
                        className="shrink-0 px-3 py-1.5 text-xs font-bold bg-lime text-black rounded-lg hover:bg-lime/90 transition-colors uppercase tracking-wider"
                      >
                        Start Consultant
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Drill-down Table Section — only shows after a KPI card is clicked */}
      {kpiSelected && (
        <div className="border border-border rounded-xl bg-surface p-4 space-y-4 shadow-sm">
          {/* Table Header and Filters */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-border pb-4">
            <div className="flex items-center justify-between w-full lg:w-auto">
              <div>
                <h3 className="text-lg font-bold text-text-primary">
                  {kpis.find((k) => k.id === selectedKpi)?.label} Details
                </h3>
                <p className="text-xs text-text-secondary font-normal mt-0.5">
                  Showing {sortedRows.length} of {allProcessedRows.length} total records.
                </p>
              </div>
              <div className="flex items-center gap-2 ml-6 shrink-0">
                <button
                  onClick={exportCsv}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-[#E8F5E9] hover:bg-[#C8E6C9] text-[#2E7D32] border border-[#A5D6A7] rounded-md transition-colors shadow-xs cursor-pointer"
                  title="Export to Excel / CSV"
                >
                  <Download size={14} />
                  <span>Excel</span>
                </button>
                <button
                  onClick={exportPdf}
                  disabled={exportingPdf}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-[#FFEBEE] hover:bg-[#FFCDD2] text-[#C62828] border border-[#EF9A9A] rounded-md transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Export to PDF"
                >
                  <FileText size={14} />
                  <span>{exportingPdf ? "Generating..." : "PDF"}</span>
                </button>
              </div>
            </div>

            {/* Filtering Controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Search Bar */}
              <div className="relative min-w-[200px]">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-secondary" />
                <input
                  type="text"
                  placeholder="Search company, contact, Field Associate..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 text-xs bg-surface-raised border border-border rounded-md focus:border-lime focus:outline-none transition-colors text-text-primary placeholder:text-text-dim font-semibold"
                />
              </div>

              {/* City Filter */}
              <div className="flex items-center gap-1 bg-surface-raised border border-border rounded-md px-2 py-1">
                <MapPin className="h-3.5 w-3.5 text-text-secondary" />
                <select
                  value={cityFilter}
                  onChange={(e) => setCityFilter(e.target.value)}
                  className="bg-transparent text-xs focus:outline-none border-none pr-4 font-semibold text-text-primary cursor-pointer"
                >
                  <option value="">All Cities</option>
                  {cities.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </div>

              {/* Executive Filter */}
              <div className="flex items-center gap-1 bg-surface-raised border border-border rounded-md px-2 py-1">
                <Users className="h-3.5 w-3.5 text-text-secondary" />
                <select
                  value={executiveFilter}
                  onChange={(e) => setExecutiveFilter(e.target.value)}
                  className="bg-transparent text-xs focus:outline-none border-none pr-4 font-semibold text-text-primary cursor-pointer"
                >
                  <option value="">All Executives</option>
                  {executives.map((exec) => (
                    <option key={exec.id} value={exec.id}>
                      {exec.name || exec.mobile}
                    </option>
                  ))}
                </select>
              </div>

              {/* Show My Tasks Toggle */}
              {isDualRole && userId && (
                <button
                  onClick={() => setShowMyTasks((prev) => !prev)}
                  className={`flex items-center gap-1.5 border rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${showMyTasks
                      ? "bg-lime text-black border-lime font-bold shadow-[0_0_10px_rgba(200,255,74,0.2)]"
                      : "bg-surface-raised border-border text-text-secondary hover:text-text-primary hover:border-border-bright"
                    }`}
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  Show My Tasks
                </button>
              )}

              {/* Reset Filters */}
              {(searchQuery || cityFilter || executiveFilter || showMyTasks) && (
                <button
                  onClick={handleResetFilters}
                  className="text-xs text-coral hover:text-coral/80 font-bold px-2 py-1.5 transition-colors border border-dashed border-coral/30 rounded cursor-pointer"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Structured Table */}
          <div className="overflow-x-auto border border-border rounded-lg bg-surface">
            <table className="w-full text-left text-sm text-text-primary border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface-raised/50 text-[10px] uppercase tracking-widest text-text-secondary font-bold">
                  <th className="px-4 py-3 min-w-[200px]">{renderSortHeader("name", "Company")}</th>
                  <th className="px-4 py-3">{renderSortHeader("city", "City")}</th>
                  <th className="px-4 py-3">Assigned Field Associate</th>
                  <th className="px-4 py-3 min-w-[240px]">Phases Progress</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 min-w-[120px]">{renderSortHeader("updated", "Updated")}</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-text-secondary italic">
                      No sites found matching criteria.
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r) => {
                    const bcNames = r.workerIds.map((id) => profileNameMap.get(id) || "—").join(", ");
                    const canonicalStatus = r.status;

                    return (
                      <tr
                        key={r.id}
                        onClick={() => navigate({ to: "/manager/sites" as any, search: { q: r.name } as any })}
                        className="hover:bg-surface-raised/35 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3.5">
                          <div className="font-bold text-text-primary text-sm hover:text-lime transition-colors">{r.name}</div>
                          {r.meta.c1_name && (
                            <div className="text-[11px] text-text-secondary font-normal mt-0.5">
                              {r.meta.c1_name} {r.meta.c1_mobile ? `· ${r.meta.c1_mobile}` : ""}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 font-semibold text-text-primary">
                          {r.city || <span className="text-text-dim">—</span>}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            {renderBcSelect(r)}
                            {r.workerIds.length > 0 && renderApptBadge(r.progress.appt)}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex flex-wrap gap-1.5">
                            {renderProgressPill("A", r.progress.a)}
                            {renderProgressPill("I", r.progress.i)}
                            {renderProgressPill("C", r.progress.c)}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          {renderStatusSelect(r)}
                        </td>
                        <td className="px-4 py-3.5 text-xs font-mono font-bold text-text-secondary">
                          {formatDate(r.progress.updated || r.assigned_at || r.appt_date)}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {userId && r.workerIds.includes(userId) ? (
                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConsultantSiteId(r.id);
                              }}
                              className="py-1 px-3 text-xs bg-lime text-black hover:bg-lime/90 font-bold uppercase tracking-wider shrink-0"
                            >
                              Start Consultant
                            </Button>
                          ) : (
                            <span className="text-text-dim text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border pt-4">
              <span className="text-xs text-text-secondary font-medium">
                Showing {startIndex + 1} to {Math.min(startIndex + rowsPerPage, sortedRows.length)} of {sortedRows.length} sites
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="p-1 border border-border rounded hover:bg-surface-raised disabled:opacity-40 transition-colors cursor-pointer text-text-primary"
                >
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: totalPages }).map((_, i) => {
                  const page = i + 1;
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-2.5 py-0.5 rounded text-xs border transition-colors cursor-pointer ${currentPage === page
                          ? "bg-lime border-lime text-primary-foreground font-bold"
                          : "border-border hover:bg-surface-raised text-text-secondary font-semibold"
                        }`}
                    >
                      {page}
                    </button>
                  );
                })}
                <button
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="p-1 border border-border rounded hover:bg-surface-raised disabled:opacity-40 transition-colors cursor-pointer text-text-primary"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hybrid Associate Consultant Portal Modal */}
      {consultantSiteId && (() => {
        const modalSite = rawSites.find(s => s.id === consultantSiteId);
        // Use enriched row for status (has .meta, .progress, .logisticsStatus)
        const modalEnrichedRow = allProcessedRows.find(r => r.id === consultantSiteId);
        if (!modalSite) return null;
        const modalMeta = parseSiteMetadata(modalSite.task_notes);
        const modalCleanNotes = modalSite.task_notes ? modalSite.task_notes.replace(/\{.*\}/, "").trim() : "";
        const isAssessmentDone = modalProgress.assessment === 100 || modalSubmittedPhases.has("assessment");
        const isInstallationDone = isAssessmentDone && (modalProgress.installation === 100 || modalSubmittedPhases.has("installation"));
        const modalStatus = modalEnrichedRow ? modalEnrichedRow.status : "Not Started Yet";

        const segments = [
          { k: "assessment", label: "ASSESSMENT", pct: modalProgress.assessment },
          { k: "installation", label: "INSTALLATION", pct: modalProgress.installation },
          { k: "commissioning", label: "COMMISSIONING", pct: modalProgress.commissioning },
        ] as const;

        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
            <div className="relative w-full max-w-5xl bg-surface border border-border rounded-xl shadow-2xl overflow-hidden my-8 flex flex-col max-h-[90vh]">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-raised/40">
                <div className="flex items-center gap-2">
                  <Building className="text-lime w-5 h-5" />
                  <h3 className="text-lg font-bold font-syne text-text-primary uppercase tracking-wide">
                    Consultant Portal — {modalSite.name}
                  </h3>
                </div>
                <button
                  onClick={() => setConsultantSiteId(null)}
                  className="text-text-secondary hover:text-text-primary p-1 bg-surface border border-border hover:border-border-bright rounded-md transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Content - Scrollable */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">

                {/* Factory Details Box matching Mockup */}
                <div className="bg-surface-raised/30 p-6 rounded-xl border border-border/80 space-y-6">
                  <div className="flex items-center justify-between border-b border-border/60 pb-3">
                    <div>
                      <div className="text-[10px] uppercase font-mono tracking-widest text-lime font-bold">
                        Details of the Factory
                      </div>
                      <h3 className="text-xl font-extrabold font-syne text-text-primary uppercase tracking-tight mt-1">
                        {modalSite.name}
                      </h3>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-widest border ${modalStatus === "Submitted" || modalStatus === "Commissioned" || modalStatus === "Installed"
                        ? "bg-lime/10 text-lime border-lime/30"
                        : modalStatus === "Dropped / Rejected"
                          ? "bg-coral/10 text-coral border-coral/30"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      }`}>
                      {modalStatus}
                    </span>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    {/* Location Address Card */}
                    <div className="bg-surface/50 p-4 rounded-xl border border-border flex gap-3">
                      <MapPin className="text-lime w-5 h-5 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-wider text-text-secondary">Location & Address</div>
                        <p className="mt-1 font-semibold text-text-primary text-sm leading-snug">{modalSite.address || "—"}</p>
                        <span className="inline-block mt-2 font-mono text-[10px] bg-surface-raised px-2 py-0.5 border border-border rounded text-text-secondary font-bold uppercase">{modalSite.city || "—"}</span>
                      </div>
                    </div>

                    {/* Primary Contact Card */}
                    <div className="bg-surface/50 p-4 rounded-xl border border-border flex gap-3">
                      <User className="text-lime w-5 h-5 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[9px] uppercase tracking-wider text-text-secondary">Primary Contact</div>
                        {(modalMeta.c1_name || modalMeta.c1_mobile || modalMeta.c1_email) ? (
                          <div className="mt-1 space-y-1 text-sm">
                            {modalMeta.c1_name && <p className="font-semibold text-text-primary truncate">{modalMeta.c1_name}</p>}
                            {modalMeta.c1_mobile && (
                              <a href={`tel:${modalMeta.c1_mobile}`} className="text-lime hover:underline font-mono text-xs flex items-center gap-1.5 mt-0.5 font-bold">
                                <Phone size={11} /> {modalMeta.c1_mobile}
                              </a>
                            )}
                            {modalMeta.c1_email && (
                              <div className="text-text-secondary text-xs truncate flex items-center gap-1.5 mt-0.5 font-mono">
                                <Mail size={11} /> {modalMeta.c1_email}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-text-dim italic">No contact details</p>
                        )}
                      </div>
                    </div>

                    {/* Secondary Contact Card */}
                    <div className="bg-surface/50 p-4 rounded-xl border border-border flex gap-3">
                      <User className="text-lime w-5 h-5 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[9px] uppercase tracking-wider text-text-secondary">Secondary Contact</div>
                        {(modalMeta.c2_name || modalMeta.c2_mobile || modalMeta.c2_email) ? (
                          <div className="mt-1 space-y-1 text-sm">
                            {modalMeta.c2_name && <p className="font-semibold text-text-primary truncate">{modalMeta.c2_name}</p>}
                            {modalMeta.c2_mobile && (
                              <a href={`tel:${modalMeta.c2_mobile}`} className="text-lime hover:underline font-mono text-xs flex items-center gap-1.5 mt-0.5 font-bold">
                                <Phone size={11} /> {modalMeta.c2_mobile}
                              </a>
                            )}
                            {modalMeta.c2_email && (
                              <div className="text-text-secondary text-xs truncate flex items-center gap-1.5 mt-0.5 font-mono">
                                <Mail size={11} /> {modalMeta.c2_email}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-text-dim italic">No contact details</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Client Form Sharing */}
                  <div className="bg-surface/50 p-4 rounded-xl border border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Mail className="text-lime w-5 h-5 shrink-0" />
                      <div>
                        <h4 className="font-syne font-bold text-xs uppercase tracking-wider text-text-primary">
                          Client Self-Submission Link
                        </h4>
                        <p className="text-[10px] text-text-secondary mt-0.5">
                          Generate a secure access key to invite the client to fill their factory details directly.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center w-full md:max-w-lg">
                      <div className="flex-1">
                        <Input
                          placeholder="Client email address"
                          value={clientShareEmail}
                          onChange={(e) => setClientShareEmail(e.target.value)}
                          className="h-8 text-xs bg-surface"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={handleGenerateShareLink}
                          className="py-1 px-3 text-xs bg-surface border border-border text-text-primary hover:bg-surface-raised font-bold uppercase tracking-wider shrink-0"
                        >
                          Link Only
                        </Button>
                        <Button
                          onClick={handleSendEmail}
                          disabled={sendingEmail}
                          className="py-1 px-3 text-xs bg-lime text-black hover:bg-lime/90 font-bold uppercase tracking-wider shrink-0"
                        >
                          {sendingEmail ? "Sending..." : "Send Mail"}
                        </Button>
                        {generatedLink && (
                          <Button
                            onClick={handleCopyLink}
                            className="py-1 px-3 text-xs bg-surface border border-border text-text-primary hover:bg-surface-raised shrink-0 font-mono"
                          >
                            Copy
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 pt-4 border-t border-border/60 items-center">
                    {/* Appointment Pills */}
                    <div className="flex flex-wrap gap-2">
                      <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary bg-surface px-3 py-1.5 border border-border rounded-full font-semibold shadow-sm">
                        <Calendar size={13} className="text-lime shrink-0" />
                        Appt: {modalSite.appt_date ? modalSite.appt_date : "Not scheduled"}
                      </span>
                      <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary bg-surface px-3 py-1.5 border border-border rounded-full font-semibold shadow-sm">
                        <Clock size={13} className="text-lime shrink-0" />
                        Time: {modalSite.appt_time ? modalSite.appt_time.slice(0, 5) : "No time set"}
                      </span>
                    </div>

                    {/* Update Stage dropdown */}
                    <div className="flex flex-col gap-1.5 md:items-end">
                      <div className="flex items-center gap-2 w-full md:max-w-xs justify-between md:justify-end">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary font-bold shrink-0">Workflow Stage:</span>
                        <Select
                          value={modalSite.consultant_stage ?? ""}
                          onChange={(e) => {
                            const stage = e.target.value;
                            if (stage === "Billing" || stage === "Completion") void updateConsultantStage(stage);
                          }}
                          className="py-1 px-2 text-xs h-8 max-w-[160px]"
                        >
                          <option value="">Select reached…</option>
                          <option value="Billing">Billing</option>
                          <option value="Completion">Completion</option>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {modalCleanNotes && (
                    <div className="pt-4 border-t border-border/60 flex gap-2 text-sm text-text-secondary">
                      <BookOpen size={16} className="text-lime shrink-0 mt-0.5" />
                      <p>{modalCleanNotes}</p>
                    </div>
                  )}
                </div>

                {/* Chunky Horizontal Phase Progress Tabs */}
                <nav className="flex flex-col md:flex-row gap-4 mt-6">
                  {segments.map((s) => {
                    const isActive = modalTab === s.k;
                    // Submission-only lock — no progress % dependency
                    const isLocked = (() => {
                      if (s.k === "installation") return !modalSubmittedPhases.has("assessment");
                      if (s.k === "commissioning") return !modalSubmittedPhases.has("installation");
                      return false;
                    })();

                    return (
                      <button
                        key={s.k}
                        onClick={() => {
                          if (isLocked) {
                            const needed = (s.k === "commissioning") ? "Installation" : "Assessment";
                            toast.error(`Please submit the ${needed} phase first to unlock this tab.`);
                            return;
                          }
                          setModalTab(s.k);
                        }}
                        className={`relative flex-1 h-[58px] bg-surface border rounded-xl overflow-hidden flex items-center px-5 transition-all duration-300 ${isLocked
                            ? "opacity-50 border-border/40 cursor-not-allowed"
                            : isActive
                              ? "border-lime ring-2 ring-lime/20 scale-[1.02] shadow-[0_0_20px_rgba(200,255,74,0.1)] cursor-pointer"
                              : "border-border hover:border-border-bright hover:bg-surface-raised/20 cursor-pointer"
                          }`}
                      >
                        <div
                          className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-lime/30 to-mint/30 transition-all duration-500 ease-out"
                          style={{ width: `${s.pct}%` }}
                        />
                        <div className="relative z-10 w-full flex items-center justify-between font-mono text-[11px] font-bold tracking-widest text-text-primary">
                          <span className="flex items-center gap-2">
                            {isLocked ? (
                              <Lock size={12} className="text-text-secondary" />
                            ) : (
                              <span className={`w-2 h-2 rounded-full ${isActive ? "bg-lime animate-pulse" : "bg-text-dim"}`} />
                            )}
                            {s.label}
                          </span>
                          <span className="bg-surface-raised px-2 py-0.5 rounded text-[10px] border border-border">
                            {s.pct}%
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </nav>

                {/* Phase Name Label matching Mockup */}
                <div className="pt-4 border-t border-border">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-text-secondary font-bold mb-2">Phase Name</p>
                  <h2 className="text-xl uppercase tracking-tight font-extrabold text-text-primary font-syne">
                    {modalTab === "assessment" ? "Assessment Visit" : modalTab === "installation" ? "Installation Phase" : "Commissioning Phase"}
                  </h2>
                </div>

                {/* Tab content inside modal */}
                <div className="mt-6 space-y-4 pb-8">
                  {modalTab === "assessment" && (
                    <>
                      <AssessmentTab
                        siteId={modalSite.id}
                        workerId={userId!}
                        requireDeviceOrderCompletion
                        onSubmit={() => {
                          void completeAssessmentAfterDeviceOrder(modalSite);
                        }}
                      >
                        <OrderTab
                          site={{ id: modalSite.id, name: modalSite.name, company_name: modalSite.company_name, city: modalSite.city, address: modalSite.address }}
                          workerId={userId!}
                        />
                      </AssessmentTab>
                    </>
                  )}

                  {modalTab === "installation" && (
                    !modalSubmittedPhases.has("assessment") ? (
                      <Card className="p-8 text-center space-y-4 border border-border flex flex-col items-center">
                        <div className="w-12 h-12 rounded-full bg-surface-raised border border-border flex items-center justify-center text-text-secondary">
                          <Lock size={20} />
                        </div>
                        <h3 className="text-lg font-bold text-text-primary font-syne uppercase">Phase Locked</h3>
                        <p className="text-sm text-text-secondary max-w-md mx-auto">
                          Please submit the Assessment phase first to unlock Installation.
                        </p>
                        <Button onClick={() => setModalTab("assessment")}>Go to Assessment</Button>
                      </Card>
                    ) : (
                      <InstallationTab siteId={modalSite.id} workerId={userId!} onSubmit={() => { loadData(); }} />
                    )
                  )}

                  {modalTab === "commissioning" && (
                    !modalSubmittedPhases.has("installation") ? (
                      <Card className="p-8 text-center space-y-4 border border-border flex flex-col items-center">
                        <div className="w-12 h-12 rounded-full bg-surface-raised border border-border flex items-center justify-center text-text-secondary">
                          <Lock size={20} />
                        </div>
                        <h3 className="text-lg font-bold text-text-primary font-syne uppercase">Phase Locked</h3>
                        <p className="text-sm text-text-secondary max-w-md mx-auto">
                          Please submit the Installation phase first to unlock Commissioning.
                        </p>
                        <Button onClick={() => setModalTab("installation")}>Go to Installation</Button>
                      </Card>
                    ) : (
                      <CommissioningTab siteId={modalSite.id} workerId={userId!} onSubmit={() => { loadData(); }} />
                    )
                  )}

                </div>

              </div>
            </div>
          </div>
        );
      })()}
    </div>
  </div>
);
}
