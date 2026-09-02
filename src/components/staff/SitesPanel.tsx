import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button, Card, Input, Label, Select, Badge, Textarea } from "@/components/ui-kit";
import { toast } from "sonner";
import logoUrl from "../../../image copy.png";
import { useAuth } from "@/lib/auth-store";
import { actorName, recordActivityLog } from "@/lib/activity-log";
import {
  Plus,
  X,
  Edit,
  Phone,
  Calendar,
  Clock,
  Folder,
  ExternalLink,
  ChevronDown,
  Check,
  FileText,
} from "lucide-react";
import { parseSiteMetadata, recordStatusActivityLog, serializeSiteMetadata } from "@/lib/site-metadata";
import { getCanonicalStatus, ASSESSMENT_KEYS, INSTALLATION_KEYS, COMMISSIONING_KEYS, pctKeys, getSiteWorkerIds, isSiteDropped, getAssessmentPendingReasons, hasDeviceOrder } from "@/utils/status";

export { parseSiteMetadata, serializeSiteMetadata };

const DEFAULT_SENDER = {
  name: "LimelightIT",
  address: "A/448, Money Plant High Street,\nGota, Ahmedabad, Gujarat - 382470",
  mobile: "+91 93130 48188",
};

type PdfAddressDraft = {
  site?: any;
  toName: string;
  toAddress: string;
  toMobile: string;
  fromName: string;
  fromAddress: string;
  fromMobile: string;
};

const FACTORY_STATUS_OPTIONS = [
  "Submitted",
  "Unsubmitted",
  "Certification Pending",
  "Installed",
  "Commissioned",
  "Assessed",
  "Dropped / Rejected",
  "Not Started Yet",
] as const;

const CUSTOM_LIST_COLUMNS = [
  { key: "no", label: "NO.", weight: 0.45 },
  { key: "company", label: "COMPANY DETAILS", weight: 2.7 },
  { key: "contact", label: "CONTACT PERSON", weight: 1.15 },
  { key: "mobile", label: "MOBILE", weight: 1.1 },
] as const;

type CustomListColumnKey = (typeof CUSTOM_LIST_COLUMNS)[number]["key"];

const getDefaultCustomListColumns = (): CustomListColumnKey[] =>
  CUSTOM_LIST_COLUMNS.map((column) => column.key);

function BCMultiSelect({
  allBCs,
  selectedIds,
  onChange,
}: {
  allBCs: any[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // Local draft — lets user tick multiple boxes before saving
  const [draft, setDraft] = useState<string[]>(selectedIds);
  const ref = useRef<HTMLDivElement>(null);

  // Sync draft when parent refreshes selectedIds (e.g. after a save)
  useEffect(() => {
    if (!open) setDraft(selectedIds);
  }, [selectedIds, open]);

  const close = (save: boolean) => {
    if (save) onChange(draft);
    setOpen(false);
  };

  const toggle = (id: string) => {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const displayNames = allBCs
    .filter((w) => selectedIds.includes(w.id))
    .map((w) => w.name ?? w.mobile);

  return (
    <div ref={ref} className="relative min-w-[160px]">
      <button
        type="button"
        onClick={() => {
          setDraft(selectedIds);
          setOpen((v) => !v);
        }}
        className="flex items-center justify-between w-full gap-2 rounded-[6px] border border-border bg-surface px-2 py-1.5 text-xs text-text-primary hover:border-lime transition-colors"
      >
        <span className="truncate max-w-[140px]">
          {displayNames.length === 0 ? (
            <span className="text-text-dim italic">— Unassigned —</span>
          ) : (
            displayNames.join(", ")
          )}
        </span>
        <ChevronDown size={12} className="shrink-0 text-text-secondary" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-max min-w-full rounded-[6px] border border-border bg-surface shadow-lg">
          <div className="max-h-52 overflow-y-auto">
            {allBCs.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-dim italic">No Field Associates available</div>
            ) : (
              allBCs.map((w) => {
                const checked = draft.includes(w.id);
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => toggle(w.id)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-surface-raised transition-colors"
                  >
                    <span
                      className={`flex items-center justify-center h-3.5 w-3.5 rounded-[3px] border shrink-0 ${checked ? "bg-lime border-lime" : "border-border"}`}
                    >
                      {checked && <Check size={10} strokeWidth={3} className="text-background" />}
                    </span>
                    <span className="text-text-primary">{w.name ?? w.mobile}</span>
                  </button>
                );
              })
            )}
          </div>
          {/* Save / Clear footer */}
          <div className="flex items-center justify-between border-t border-border px-3 py-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft([]);
              }}
              className="text-[10px] text-coral hover:text-coral/70 transition-colors flex items-center gap-1"
            >
              <X size={10} /> Clear
            </button>
            <button
              type="button"
              onClick={() => close(true)}
              className="text-[10px] font-bold text-lime hover:text-lime/70 transition-colors flex items-center gap-1"
            >
              <Check size={10} /> Apply ({draft.length})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function SitesPanel() {
  const formRevealRef = useRef<HTMLDivElement>(null);
  const { userId, email, profile } = useAuth();
  const [sites, setSites] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [businessConsultants, setBusinessConsultants] = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [installations, setInstallations] = useState<any[]>([]);
  const [commissionings, setCommissionings] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingSite, setEditingSite] = useState<any | null>(null);
  const [pdfDraft, setPdfDraft] = useState<PdfAddressDraft | null>(null);
  const [pdfSaving, setPdfSaving] = useState(false);
  const [customLabelDraft, setCustomLabelDraft] = useState<PdfAddressDraft | null>(null);
  const [customLabelDownloading, setCustomLabelDownloading] = useState(false);
  const [customListOpen, setCustomListOpen] = useState(false);
  const [customListSearch, setCustomListSearch] = useState("");
  const [customListSelectedIds, setCustomListSelectedIds] = useState<string[]>([]);
  const [customListTitle, setCustomListTitle] = useState("");
  const [customListColumns, setCustomListColumns] = useState<CustomListColumnKey[]>(getDefaultCustomListColumns);
  const [customListGenerating, setCustomListGenerating] = useState(false);

  const routerState = useRouterState();
  const searchParam = (routerState.location.search as any)?.q || "";

  const [search, setSearch] = useState(searchParam);

  useEffect(() => {
    if (searchParam) {
      setSearch(searchParam);
    }
  }, [searchParam]);
  const [filterCity, setFilterCity] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterAssessor, setFilterAssessor] = useState("");
  const [filterBC, setFilterBC] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [clientUpdateTimes, setClientUpdateTimes] = useState<Record<string, number>>({});

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterCity, filterStatus, filterAssessor, filterBC]);

  const [form, setForm] = useState({
    name: "",
    company_name: "",
    city: "",
    address: "",
    workers: [] as string[],
    c1_name: "",
    c1_mobile: "",
    c1_email: "",
    c2_name: "",
    c2_mobile: "",
    c2_email: "",
    status: "Running",
    appt_date: "",
    appt_time: "",
    create_drive_folder: false,
    drive_folder_link: "",
    assessor_company: "",
    assessor_phone: "",
    assessor_city: "",
    assessor_number: "",
    assessor_email: "",
    assessor_address: "",
  });

  const load = async () => {
    const [s, w, aRes, iRes, cRes, rRes, mRes] = await Promise.all([
      supabase
        .from("sites")
        .select(
          "id,name,company_name,city,address,assigned_worker_id,assigned_at,task_notes,appt_date,appt_time,consultant_stage,created_at",
        )
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,name,mobile,is_active").order("created_at"),
      supabase.from("assessment").select("data,updated_at,site_id"),
      supabase.from("installation").select("data,updated_at,site_id"),
      supabase.from("commissioning").select("data,updated_at,site_id"),
      supabase.from("user_roles").select("user_id").eq("role", "worker"),
      supabase.from("inventory_materials").select("state,notes,submitted,material_name,created_at"),
    ]);
    if (s.error) toast.error("Error loading sites: " + s.error.message);
    if (w.error) toast.error("Error loading profiles: " + w.error.message);
    setSites(s.data ?? []);
    const workerIds = new Set((rRes.data ?? []).map((r: any) => r.user_id));
    setBusinessConsultants((w.data ?? []).filter((x: any) => x.is_active && workerIds.has(x.id)));
    setAssessments(aRes.data ?? []);
    setInstallations(iRes.data ?? []);
    setCommissionings(cRes.data ?? []);
    setMaterials(mRes.data ?? []);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!creating && !editingSite) return;
    const frame = window.requestAnimationFrame(() => {
      formRevealRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const firstField = formRevealRef.current?.querySelector<HTMLInputElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      );
      firstField?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [creating, editingSite]);



  const aMap = new Map<string, any>(assessments.map((r) => [r.site_id, r]));
  const iMap = new Map<string, any>(installations.map((r) => [r.site_id, r]));
  const cMap = new Map<string, any>(commissionings.map((r) => [r.site_id, r]));

  const isSiteSubmitted = (site: any) => {
    if (site.consultant_stage === "Completion" || site.consultant_stage === "Billing") return true;
    const ar = aMap.get(site.id);
    return pctKeys(ar?.data, ASSESSMENT_KEYS) === 100;
  };

  const isSiteCertification = (site: any) => {
    if (site.consultant_stage === "Completion" || site.consultant_stage === "Billing") return true;
    const cr = cMap.get(site.id);
    return !!cr?.data?.certificate_sent;
  };

  const isSiteDropped = (site: any) => {
    const meta = parseSiteMetadata(site.task_notes);
    const stage = (site.consultant_stage || meta.status || "").toLowerCase();
    return stage.includes("drop") || stage.includes("reject");
  };

  const isSiteInstalled = (site: any) => {
    const meta = parseSiteMetadata(site.task_notes);
    const stage = (site.consultant_stage || meta.status || "").toLowerCase();
    const ir = iMap.get(site.id);
    return stage.includes("installed") || pctKeys(ir?.data, INSTALLATION_KEYS) === 100;
  };

  const isSiteCommissioned = (site: any) => {
    const meta = parseSiteMetadata(site.task_notes);
    const stage = (site.consultant_stage || meta.status || "").toLowerCase();
    const cr = cMap.get(site.id);
    return stage.includes("commissioned") || pctKeys(cr?.data, COMMISSIONING_KEYS) === 100;
  };

  const isSiteAssessment = (site: any) => {
    const meta = parseSiteMetadata(site.task_notes);
    const stage = (site.consultant_stage || meta.status || "").toLowerCase();
    const ar = aMap.get(site.id);
    const aP = pctKeys(ar?.data, ASSESSMENT_KEYS);
    return stage.includes("assessment") || aP === 100;
  };

  const normalizeCompanyName = (name: string): string => {
    if (!name) return "";
    return name
      .toLowerCase()
      .replace(/^m\/s\.?\s+|^ms\.?\s+/i, "")
      .replace(/\s+pvt\.?\s*ltd\.?|\s+private\s+limited/i, "")
      .replace(/\s+ltd\.?/i, "")
      .replace(/[^a-z0-9]/g, "")
      .trim();
  };

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



  const create = async () => {
    if (!form.name) return toast.error("Name required");

    const targetName = (form.company_name || form.name).trim();
    const { data: existingName } = await supabase
      .from("sites")
      .select("id")
      .ilike("name", targetName);

    const { data: existingCompany } = await supabase
      .from("sites")
      .select("id")
      .ilike("company_name", targetName);

    if ((existingName && existingName.length > 0) || (existingCompany && existingCompany.length > 0)) {
      toast.error("Company already found");
      return;
    }

    let consultantStage: string | null = null;
    let metaStatus: string = "";
    let formWorkers = [...form.workers];
    if (form.status === "Dropped / Rejected") {
      consultantStage = null;
      metaStatus = "Dropped / Rejected";
    } else if (form.status === "Submitted") {
      consultantStage = "Completion";
      metaStatus = "Submitted";
    } else if (form.status === "In Assessment" || form.status === "Assessed") {
      consultantStage = null;
      metaStatus = "Assessed";
    } else if (form.status === "Installed") {
      consultantStage = null;
      metaStatus = "Installed";
    } else if (form.status === "Commissioned") {
      consultantStage = null;
      metaStatus = "Commissioned";
    } else if (form.status === "Unsubmitted") {
      consultantStage = null;
      metaStatus = "Unsubmitted";
    } else if (form.status === "Certification Pending") {
      consultantStage = null;
      metaStatus = "Certification Pending";
    }

    const meta = {
      c1_name: form.c1_name,
      c1_mobile: form.c1_mobile,
      c1_email: form.c1_email,
      c2_name: form.c2_name,
      c2_mobile: form.c2_mobile,
      c2_email: form.c2_email,
      status: metaStatus,
      create_drive_folder: form.create_drive_folder,
      drive_folder_name: form.name,
      drive_folder_link: form.create_drive_folder ? form.drive_folder_link : "",
      worker_ids: formWorkers,
      assessor_company: form.assessor_company,
      assessor_phone: form.assessor_phone,
      assessor_city: form.assessor_city,
      assessor_number: form.assessor_number,
      assessor_email: form.assessor_email,
      assessor_address: form.assessor_address,
    };
    const taskNotes = serializeSiteMetadata("", meta);

    const { data: createdSite, error } = await supabase.from("sites").insert({
      name: form.name,
      company_name: form.company_name || form.name,
      city: form.city || null,
      address: form.address || null,
      assigned_worker_id: formWorkers[0] || null,
      task_notes: taskNotes,
      consultant_stage: consultantStage,
      appt_date: form.appt_date || null,
      appt_time: form.appt_time || null,
    } as never).select("id").single();

    if (error) toast.error(error.message);
    else {
      await recordActivityLog({
        actor_id: userId,
        actor_name: actorName(profile, email, userId),
        action: "create",
        entity_type: "site",
        entity_id: createdSite?.id,
        entity_name: form.company_name || form.name,
        site_id: createdSite?.id,
        company_name: form.company_name || form.name,
        factory_name: form.name,
        to_value: metaStatus || "Created",
      });
      toast.success("Site created");
      setCreating(false);
      resetForm();
      await load();
    }
  };

  const startEdit = (s: any) => {
    const meta = parseSiteMetadata(s.task_notes);
    const workerIds =
      meta.worker_ids?.length > 0
        ? meta.worker_ids
        : s.assigned_worker_id
          ? [s.assigned_worker_id]
          : [];
    setEditingSite(s);
    setForm({
      name: s.name,
      company_name: s.company_name ?? s.name,
      city: s.city ?? "",
      address: s.address ?? "",
      workers: workerIds,
      c1_name: meta.c1_name,
      c1_mobile: meta.c1_mobile,
      c1_email: meta.c1_email,
      c2_name: meta.c2_name,
      c2_mobile: meta.c2_mobile,
      c2_email: meta.c2_email,
      status: getCanonicalStatus(s, aMap, iMap, cMap, materials),
      appt_date: s.appt_date ?? "",
      appt_time: s.appt_time ?? "",
      create_drive_folder: !!meta.create_drive_folder,
      drive_folder_link: meta.drive_folder_link ?? "",
      assessor_company: meta.assessor_company ?? "",
      assessor_phone: meta.assessor_phone ?? "",
      assessor_city: meta.assessor_city ?? "",
      assessor_number: meta.assessor_number ?? "",
      assessor_email: meta.assessor_email ?? "",
      assessor_address: meta.assessor_address ?? "",
    });
  };


  const updateSite = async () => {
    if (!editingSite) return;

    const targetName = (form.company_name || form.name).trim();
    const { data: existingName } = await supabase
      .from("sites")
      .select("id")
      .ilike("name", targetName)
      .neq("id", editingSite.id);

    const { data: existingCompany } = await supabase
      .from("sites")
      .select("id")
      .ilike("company_name", targetName)
      .neq("id", editingSite.id);

    if ((existingName && existingName.length > 0) || (existingCompany && existingCompany.length > 0)) {
      toast.error("Company already found");
      return;
    }

    let consultantStage: string | null = null;
    let metaStatus: string = "";
    let formWorkers = [...form.workers];
    if (form.status === "Dropped / Rejected") {
      consultantStage = null;
      metaStatus = "Dropped / Rejected";
    } else if (form.status === "Submitted") {
      consultantStage = "Completion";
      metaStatus = "Submitted";
    } else if (form.status === "In Assessment" || form.status === "Assessed") {
      consultantStage = null;
      metaStatus = "Assessed";
    } else if (form.status === "Installed") {
      consultantStage = null;
      metaStatus = "Installed";
    } else if (form.status === "Commissioned") {
      consultantStage = null;
      metaStatus = "Commissioned";
    } else if (form.status === "Assigned") {
      consultantStage = null;
      metaStatus = "Assigned";
    } else if (form.status === "Pending Assignment") {
      consultantStage = null;
      metaStatus = "Pending Assignment";
      formWorkers = [];
    } else if (form.status === "Unsubmitted") {
      consultantStage = null;
      metaStatus = "Unsubmitted";
    } else if (form.status === "Certification Pending") {
      consultantStage = null;
      metaStatus = "Certification Pending";
    }

    const meta = {
      c1_name: form.c1_name,
      c1_mobile: form.c1_mobile,
      c1_email: form.c1_email,
      c2_name: form.c2_name,
      c2_mobile: form.c2_mobile,
      c2_email: form.c2_email,
      status: metaStatus,
      create_drive_folder: form.create_drive_folder,
      drive_folder_name: form.name,
      drive_folder_link: form.create_drive_folder ? form.drive_folder_link : "",
      worker_ids: formWorkers,
      assessor_company: form.assessor_company,
      assessor_phone: form.assessor_phone,
      assessor_city: form.assessor_city,
      assessor_number: form.assessor_number,
      assessor_email: form.assessor_email,
      assessor_address: form.assessor_address,
    };
    const taskNotes = serializeSiteMetadata(editingSite.task_notes, meta);

    const { error } = await supabase
      .from("sites")
      .update({
        name: form.name,
        company_name: form.company_name || form.name,
        city: form.city || null,
        address: form.address || null,
        assigned_worker_id: formWorkers[0] || null,
        task_notes: taskNotes,
        consultant_stage: consultantStage,
        appt_date: form.appt_date || null,
        appt_time: form.appt_time || null,
      } as never)
      .eq("id", editingSite.id);

    if (error) toast.error(error.message);
    else {
      await recordActivityLog({
        actor_id: userId,
        actor_name: actorName(profile, email, userId),
        action: "update",
        entity_type: "site",
        entity_id: editingSite.id,
        entity_name: form.company_name || form.name,
        site_id: editingSite.id,
        company_name: form.company_name || form.name,
        factory_name: form.name,
        from_value: getCanonicalStatus(editingSite, aMap, iMap, cMap, materials),
        to_value: metaStatus || form.status || "Updated",
      });
      if (form.address && form.address.trim()) {
        const targetComp = (form.company_name || form.name).trim();
        await supabase
          .from("inventory_materials")
          .update({ location: form.address.trim() } as never)
          .or(`material_name.eq.${targetComp},material_name.eq.${form.name.trim()}`);
      }
      toast.success("Site updated");
      setClientUpdateTimes(prev => ({ ...prev, [editingSite.id]: Date.now() }));
      setEditingSite(null);
      resetForm();
      await load();
    }
  };

  const resetForm = () => {
    setForm({
      name: "",
      company_name: "",
      city: "",
      address: "",
      workers: [],
      c1_name: "",
      c1_mobile: "",
      c1_email: "",
      c2_name: "",
      c2_mobile: "",
      c2_email: "",
      status: "Running",
      appt_date: "",
      appt_time: "",
      create_drive_folder: false,
      drive_folder_link: "",
      assessor_company: "",
      assessor_phone: "",
      assessor_city: "",
      assessor_number: "",
      assessor_email: "",
      assessor_address: "",
    });
  };

  const openPdfAddressWindow = async (site: any) => {
    const meta = parseSiteMetadata(site.task_notes);
    const normalizeMobileForPdf = (mobile?: string | null) => {
      const value = (mobile || "").trim();
      if (!value) return "";
      return value.startsWith("+") ? value : `+91 ${value}`;
    };

    let address = (site.address || "").trim();
    let mobile = normalizeMobileForPdf(meta.pdf_to_mobile || meta.c1_mobile || meta.c2_mobile);

    try {
      const [{ data: assessment }, { data: contact }] = await Promise.all([
        supabase.from("assessment").select("data").eq("site_id", site.id).limit(1).maybeSingle(),
        supabase.from("contacts").select("mobile").eq("site_id", site.id).limit(1).maybeSingle(),
      ]);

      const aData: any = assessment?.data || {};
      if (!address) {
        const assessmentAddress =
          typeof aData.factory_op_address === "string" && aData.factory_op_address.trim()
            ? aData.factory_op_address
            : typeof aData.registered_address === "string" && aData.registered_address.trim()
              ? aData.registered_address
              : "";
        address = assessmentAddress.trim();
      }

      mobile =
        normalizeMobileForPdf(contact?.mobile) ||
        mobile ||
        normalizeMobileForPdf(Array.isArray(aData.factory_op_owners) ? aData.factory_op_owners[0]?.contact : "") ||
        normalizeMobileForPdf(Array.isArray(aData.factory_op_technicians) ? aData.factory_op_technicians[0]?.contact : "");
    } catch (err) {
      console.error("Failed to prefill PDF address details:", err);
    }

    setPdfDraft({
      site,
      toName: meta.pdf_to_name || site.company_name || site.name || "",
      toAddress: address || site.city || "",
      toMobile: mobile || "N/A",
      fromName: meta.pdf_from_name || DEFAULT_SENDER.name,
      fromAddress: meta.pdf_from_address || DEFAULT_SENDER.address,
      fromMobile: meta.pdf_from_mobile || DEFAULT_SENDER.mobile,
    });
  };

  const savePdfAddress = async (draft: PdfAddressDraft) => {
    if (!draft.site) {
      toast.error("No site selected.");
      return false;
    }

    const nextAddress = draft.toAddress.trim();
    const nextToName = draft.toName.trim();
    const nextToMobile = draft.toMobile.trim();
    const nextFromName = draft.fromName.trim();
    const nextFromAddress = draft.fromAddress.trim();
    const nextFromMobile = draft.fromMobile.trim();

    if (!nextToName) {
      toast.error("Company name is required.");
      return false;
    }

    if (!nextAddress) {
      toast.error("Recipient address is required.");
      return false;
    }

    const companyName = (draft.site.company_name || draft.site.name || "").trim();
    const siteName = (draft.site.name || "").trim();
    const materialNames = Array.from(new Set([companyName, siteName].filter(Boolean)));
    const currentMeta = parseSiteMetadata(draft.site.task_notes);
    const taskNotes = serializeSiteMetadata(draft.site.task_notes, {
      ...currentMeta,
      c1_mobile: nextToMobile && nextToMobile !== "N/A" ? nextToMobile : currentMeta.c1_mobile,
      pdf_to_name: nextToName,
      pdf_to_mobile: nextToMobile,
      pdf_from_name: nextFromName,
      pdf_from_address: nextFromAddress,
      pdf_from_mobile: nextFromMobile,
    });

    const { error } = await supabase
      .from("sites")
      .update({
        company_name: nextToName,
        address: nextAddress,
        task_notes: taskNotes,
      } as never)
      .eq("id", draft.site.id);

    if (error) {
      toast.error("Failed to update site address: " + error.message);
      return false;
    }

    if (nextToMobile && nextToMobile !== "N/A") {
      const { data: contact } = await supabase
        .from("contacts")
        .select("id")
        .eq("site_id", draft.site.id)
        .limit(1)
        .maybeSingle();

      if (contact?.id) {
        const { error: contactError } = await supabase
          .from("contacts")
          .update({ mobile: nextToMobile } as never)
          .eq("id", contact.id);

        if (contactError) {
          toast.error("Site details saved, but contact mobile was not updated: " + contactError.message);
          return false;
        }
      } else {
        const { error: contactError } = await supabase
          .from("contacts")
          .insert({ site_id: draft.site.id, name: nextToName, mobile: nextToMobile } as never);

        if (contactError) {
          toast.error("Site details saved, but contact mobile was not created: " + contactError.message);
          return false;
        }
      }
    }

    if (materialNames.length > 0) {
      const { error: materialError } = await supabase
        .from("inventory_materials")
        .update({ material_name: nextToName, location: nextAddress } as never)
        .in("material_name", materialNames);

      if (materialError) {
        toast.error("Site address saved, but logistics address was not updated: " + materialError.message);
        return false;
      }
    }

    setClientUpdateTimes((prev) => ({ ...prev, [draft.site.id]: Date.now() }));
    await load();
    return true;
  };

  const downloadSiteAddressPdf = async (draft: PdfAddressDraft) => {
    const [{ jsPDF }] = await Promise.all([import("jspdf")]);
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const wrapWidth = 160;
    const toAddress = draft.toAddress.trim();
    const fromAddress = draft.fromAddress.trim();
    const toAddressLines = doc.splitTextToSize(toAddress, wrapWidth);
    const fromAddressLines = doc.splitTextToSize(fromAddress, wrapWidth);
    const maxAddressLines = Math.max(toAddressLines.length, fromAddressLines.length);

    let fontSizeTitle = 20;
    let fontSizeHeader = 15;
    let fontSizeContent = 11;
    let lineSpacing = 7;
    let sectionSpacing = 8;

    if (maxAddressLines <= 2) {
      fontSizeTitle = 22;
      fontSizeHeader = 17;
      fontSizeContent = 12;
      lineSpacing = 9;
      sectionSpacing = 11;
    } else if (maxAddressLines > 5) {
      fontSizeTitle = 18;
      fontSizeHeader = 14;
      fontSizeContent = 10;
      lineSpacing = 6;
      sectionSpacing = 7;
    }

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(fontSizeContent);
    const finalToAddressLines = doc.splitTextToSize(toAddress, wrapWidth);
    const finalFromAddressLines = doc.splitTextToSize(fromAddress, wrapWidth);

    const titleOffset = 10;
    const headerDividerOffset = 16;
    const toHeaderOffset = headerDividerOffset + sectionSpacing;
    const toCompanyOffset = toHeaderOffset + lineSpacing;
    const toAddressStartOffset = toCompanyOffset + lineSpacing;
    const toMobileOffset = toAddressStartOffset + finalToAddressLines.length * lineSpacing;
    const fromToDividerOffset = toMobileOffset + sectionSpacing;
    const fromHeaderOffset = fromToDividerOffset + sectionSpacing;
    const fromCompanyOffset = fromHeaderOffset + lineSpacing;
    const fromAddressStartOffset = fromCompanyOffset + lineSpacing;
    const fromMobileOffset = fromAddressStartOffset + finalFromAddressLines.length * lineSpacing;
    const totalBoxHeight = fromMobileOffset + sectionSpacing;
    const startX = 15;
    const width = 180;

    const renderLabel = (startY: number) => {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.8);
      doc.roundedRect(startX, startY, width, totalBoxHeight, 5, 5, "D");

      doc.setLineWidth(0.5);
      doc.line(startX, startY + headerDividerOffset, startX + width, startY + headerDividerOffset);
      doc.line(startX, startY + fromToDividerOffset, startX + width, startY + fromToDividerOffset);

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(fontSizeTitle);
      doc.text("COURIER ADDRESS LABEL", startX + width / 2, startY + titleOffset, { align: "center" });

      doc.setFontSize(fontSizeHeader);
      doc.text("TO", startX + 7, startY + toHeaderOffset);
      doc.setFontSize(fontSizeContent);
      doc.text((draft.toName || "N/A").toUpperCase(), startX + 7, startY + toCompanyOffset);

      doc.setFont("Helvetica", "normal");
      finalToAddressLines.forEach((line: string, index: number) => {
        doc.text(line, startX + 7, startY + toAddressStartOffset + index * lineSpacing);
      });
      doc.text(`Mobile: ${draft.toMobile || "N/A"}`, startX + 7, startY + toMobileOffset);

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(fontSizeHeader);
      doc.text("FROM", startX + 7, startY + fromHeaderOffset);
      doc.setFontSize(fontSizeContent);
      doc.text((draft.fromName || DEFAULT_SENDER.name).toUpperCase(), startX + 7, startY + fromCompanyOffset);

      doc.setFont("Helvetica", "normal");
      finalFromAddressLines.forEach((line: string, index: number) => {
        doc.text(line, startX + 7, startY + fromAddressStartOffset + index * lineSpacing);
      });
      doc.text(`Mobile: ${draft.fromMobile || "N/A"}`, startX + 7, startY + fromMobileOffset);
    };

    const halfPageHeight = 297 / 2;
    const topStartY = Math.max(10, (halfPageHeight - totalBoxHeight) / 2);
    const bottomStartY = halfPageHeight + Math.max(10, (halfPageHeight - totalBoxHeight) / 2);

    renderLabel(topStartY);
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([2, 2], 0);
    doc.line(10, 148.5, 200, 148.5);
    doc.setLineDashPattern([], 0);
    renderLabel(bottomStartY);

    const safeName = (draft.toName || "company").toLowerCase().replace(/[^a-z0-9]/g, "_");
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
    doc.save(`courier_label_${safeName}_${timestamp}.pdf`);
  };

  const openCustomLabel = () => {
    setCustomLabelDraft({
      toName: "",
      toAddress: "",
      toMobile: "",
      fromName: DEFAULT_SENDER.name,
      fromAddress: DEFAULT_SENDER.address,
      fromMobile: DEFAULT_SENDER.mobile,
    });
  };

  const handleCustomLabelDownload = async () => {
    if (!customLabelDraft) return;

    if (!customLabelDraft.toName.trim()) {
      toast.error("Company name is required.");
      return;
    }

    if (!customLabelDraft.toAddress.trim()) {
      toast.error("Recipient address is required.");
      return;
    }

    if (!customLabelDraft.toMobile.trim()) {
      toast.error("Recipient mobile number is required.");
      return;
    }

    setCustomLabelDownloading(true);
    try {
      await downloadSiteAddressPdf(customLabelDraft);
      toast.success("Custom courier label downloaded.");
      setCustomLabelDraft(null);
    } catch (err: any) {
      toast.error("Failed to generate custom PDF label: " + (err.message || err));
    } finally {
      setCustomLabelDownloading(false);
    }
  };

  const getCustomListCompanyName = (site: any) =>
    String(site.company_name || site.name || "Untitled Company").trim();

  const getCustomListDetails = (site: any) => {
    const parts = [site.address, site.city].map((part) => String(part || "").trim()).filter(Boolean);
    return parts.length ? parts.join(", ") : "-";
  };

  const getCustomListContact = (site: any) => {
    const meta = parseSiteMetadata(site.task_notes);
    return {
      name: String(meta.c1_name || meta.c2_name || "-").trim(),
      mobile: String(meta.c1_mobile || meta.c2_mobile || "-").trim(),
    };
  };

  const toggleCustomListSite = (siteId: string) => {
    setCustomListSelectedIds((prev) =>
      prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId],
    );
  };

  const openCustomList = () => {
    setCustomListSearch("");
    setCustomListSelectedIds([]);
    setCustomListTitle("");
    setCustomListColumns(getDefaultCustomListColumns());
    setCustomListOpen(true);
  };

  const downloadCustomListPdf = async () => {
    const selectedSites = sites
      .filter((site) => customListSelectedIds.includes(site.id))
      .sort((a, b) => getCustomListCompanyName(a).localeCompare(getCustomListCompanyName(b)));

    if (selectedSites.length === 0) {
      toast.error("Select at least one company.");
      return;
    }

    const selectedColumnDefs = CUSTOM_LIST_COLUMNS.filter((column) => customListColumns.includes(column.key));
    if (selectedColumnDefs.length === 0) {
      toast.error("Select at least one column.");
      return;
    }

    setCustomListGenerating(true);
    try {
      const reportTitle = customListTitle.trim() || "SIM KIT FEEDBACK COMPANIES LIST";
      const [{ jsPDF }] = await Promise.all([import("jspdf")]);
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
          context.globalAlpha = 0.14;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        };
        image.onerror = () => reject(new Error("Could not load company watermark."));
        image.src = logoDataUrl;
      });
      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const navy: [number, number, number] = [23, 58, 91];
      const ink: [number, number, number] = [31, 51, 71];
      const muted: [number, number, number] = [102, 120, 138];
      const border: [number, number, number] = [215, 224, 232];

      const marginX = 45;
      const tableWidth = pageWidth - marginX * 2;
      const rowHeight = 111;
      const firstRowY = 145;
      const headerRowY = 117;
      const headerRowHeight = 28;
      const totalColumnWeight = selectedColumnDefs.reduce((sum, column) => sum + column.weight, 0);
      let columnStart = marginX;
      const pdfColumns = selectedColumnDefs.map((column) => {
        const width = (tableWidth * column.weight) / totalColumnWeight;
        const definition = { ...column, x: columnStart, width };
        columnStart += width;
        return definition;
      });

      const addHeader = () => {
        doc.addImage(watermarkDataUrl, "PNG", pageWidth / 2 - 145, pageHeight / 2 - 145, 290, 290);

        doc.addImage(logoDataUrl, "PNG", marginX, 26, 42, 42);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...navy);
        doc.text("LimelightIT Research Pvt. Ltd.", marginX + 52, 43);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.setTextColor(...navy);
        const titleLines = doc.splitTextToSize(reportTitle.toUpperCase(), pageWidth - marginX * 2).slice(0, 2);
        const titleStartY = titleLines.length > 1 ? 80 : 85;
        titleLines.forEach((line: string, index: number) => {
          doc.text(line, pageWidth / 2, titleStartY + index * 16, { align: "center" });
        });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...muted);
        doc.text(`Selected Companies: ${selectedSites.length}`, pageWidth / 2, titleLines.length > 1 ? 112 : 100, { align: "center" });
        doc.text(new Date().toLocaleDateString("en-IN"), pageWidth - marginX, 55, { align: "right" });

        doc.setFillColor(...navy);
        doc.roundedRect(marginX, headerRowY, tableWidth, headerRowHeight, 3, 3, "F");
        doc.setDrawColor(...border);
        doc.setLineWidth(0.55);
        pdfColumns.slice(1).forEach((column) => {
          doc.line(column.x, headerRowY, column.x, headerRowY + headerRowHeight);
        });

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);
        pdfColumns.forEach((column) => {
          if (column.key === "no") {
            doc.text(column.label, column.x + column.width / 2, headerRowY + 18, { align: "center" });
            return;
          }
          doc.text(column.label, column.x + 8, headerRowY + 18);
        });
      };

      addHeader();
      let y = firstRowY;

      selectedSites.forEach((site, index) => {
        if (y + rowHeight > pageHeight - 36) {
          doc.addPage();
          addHeader();
          y = firstRowY;
        }

        const contact = getCustomListContact(site);
        const company = getCustomListCompanyName(site).toUpperCase();

        doc.setDrawColor(...border);
        doc.setLineWidth(0.55);
        doc.line(marginX, y + rowHeight, marginX + tableWidth, y + rowHeight);
        pdfColumns.slice(1).forEach((column) => {
          doc.line(column.x, y, column.x, y + rowHeight);
        });

        pdfColumns.forEach((column) => {
          const left = column.x + 8;
          const usableWidth = Math.max(column.width - 16, 24);

          if (column.key === "no") {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9.2);
            doc.setTextColor(...ink);
            doc.text(String(index + 1), column.x + column.width / 2, y + 55, { align: "center" });
            return;
          }

          if (column.key === "company") {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9.2);
            doc.setTextColor(...navy);
            doc.text(doc.splitTextToSize(company, usableWidth).slice(0, 2), left, y + 28);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.35);
            doc.setTextColor(...muted);
            doc.text(doc.splitTextToSize(getCustomListDetails(site), usableWidth).slice(0, 5), left, y + 48);
            return;
          }

          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.5);
          doc.setTextColor(...ink);
          const value = column.key === "contact" ? contact.name : contact.mobile;
          doc.text(doc.splitTextToSize(value, usableWidth).slice(0, 3), left, y + 50);
        });

        y += rowHeight;
      });

      const totalPages = doc.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...muted);
        doc.text(`Page ${page} / ${totalPages}`, pageWidth - marginX, pageHeight - 22, { align: "right" });
      }

      doc.save("SIM_Kit_Feedback_Companies_List.pdf");
      toast.success("Custom company list PDF downloaded.");
      setCustomListOpen(false);
      setCustomListTitle("");
      setCustomListColumns(getDefaultCustomListColumns());
    } catch (err: any) {
      toast.error("Failed to generate custom list PDF: " + (err.message || err));
    } finally {
      setCustomListGenerating(false);
    }
  };

  const handlePdfSave = async (download = false) => {
    if (!pdfDraft) return;

    setPdfSaving(true);
    try {
      const saved = await savePdfAddress(pdfDraft);
      if (!saved) return;

      if (download) {
        await downloadSiteAddressPdf(pdfDraft);
        toast.success("Address saved and courier label downloaded.");
      } else {
        toast.success("Address saved.");
      }
      setPdfDraft(null);
    } catch (err: any) {
      toast.error("Failed to process address PDF: " + (err.message || err));
    } finally {
      setPdfSaving(false);
    }
  };

  const assignMultiple = async (
    siteId: string,
    workerIds: string[],
    currentTaskNotes: string | null,
  ) => {
    const siteObj = sites.find((s: any) => s.id === siteId);
    const meta = parseSiteMetadata(currentTaskNotes);
    const fromStatus = siteObj
      ? getCanonicalStatus(siteObj, aMap, iMap, cMap, materials)
      : workerIds.length > 0
        ? "Pending Assignment"
        : "Not Started Yet";
    const nextSite = {
      ...(siteObj || {}),
      assigned_worker_id: workerIds[0] || null,
      task_notes: serializeSiteMetadata(currentTaskNotes, { ...meta, worker_ids: workerIds }),
    };
    const toStatus = getCanonicalStatus(nextSite, aMap, iMap, cMap, materials);
    const newNotes = serializeSiteMetadata(currentTaskNotes, { ...meta, worker_ids: workerIds });
    await supabase
      .from("sites")
      .update({
        assigned_worker_id: workerIds[0] || null,
        assigned_at: new Date().toISOString(),
        task_notes: newNotes,
      } as never)
      .eq("id", siteId);
    await recordStatusActivityLog(siteId, {
      user_id: userId,
      user_name: profile?.name || profile?.mobile || email || userId || "Unknown User",
      from_status: fromStatus,
      to_status: toStatus,
    });
    toast.success("Assignment updated");
    setClientUpdateTimes(prev => ({ ...prev, [siteId]: Date.now() }));
    await load();
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
      } else if (newStatus === "Not Started Yet") {
        consultantStage = null;
        metaStatus = "Not Started Yet";
      } else if (newStatus === "Pending Assignment") {
        consultantStage = null;
        metaStatus = "Pending Assignment";
        updatedWorkers = [];
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

      const { data: updatedSite, error } = await supabase
        .from("sites")
        .update(updatePayload as never)
        .eq("id", siteId)
        .select("id")
        .maybeSingle();

      if (error) {
        toast.error(error.message);
      } else if (!updatedSite) {
        toast.error("Status could not be updated. Please refresh and try again.");
      } else {
        await recordStatusActivityLog(siteId, {
          user_id: userId,
          user_name: profile?.name || profile?.mobile || email || userId || "Unknown User",
          from_status: fromStatus,
          to_status: metaStatus,
        });

        toast.success("Site status updated successfully");
        setClientUpdateTimes(prev => ({ ...prev, [siteId]: Date.now() }));
        await load();
      }
    } catch (err: any) {
      toast.error("Failed to update status: " + err.message);
    }
  };

  const deleteSite = async (siteId: string) => {
    const siteToDelete = sites.find((site: any) => site.id === siteId);
    if (
      !window.confirm(
        "Are you sure you want to delete this site? All associated forms, appointments, and progress data will be permanently removed.",
      )
    )
      return;
    try {
      await Promise.all([
        supabase.from("assessment").delete().eq("site_id", siteId),
        supabase.from("commissioning").delete().eq("site_id", siteId),
        supabase.from("contacts").delete().eq("site_id", siteId),
        supabase.from("installation").delete().eq("site_id", siteId),
        supabase.from("machines").delete().eq("site_id", siteId),
        supabase.from("media").delete().eq("site_id", siteId),
      ]);

      const { error } = await supabase.from("sites").delete().eq("id", siteId);
      if (error) throw error;

      await recordActivityLog({
        actor_id: userId,
        actor_name: actorName(profile, email, userId),
        action: "delete",
        entity_type: "site",
        entity_id: siteId,
        entity_name: siteToDelete?.company_name || siteToDelete?.name || "Site",
        company_name: siteToDelete?.company_name || siteToDelete?.name || null,
        factory_name: siteToDelete?.name || null,
        from_value: siteToDelete ? getCanonicalStatus(siteToDelete, aMap, iMap, cMap, materials) : "Existing",
        to_value: "Deleted",
      });
      toast.success("Site deleted successfully");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete site");
    }
  };

  const allMetas = sites.map((s) => ({
    ...parseSiteMetadata(s.task_notes),
    status: s.consultant_stage || parseSiteMetadata(s.task_notes).status,
  }));

  const cities = Array.from(new Set(sites.map((s) => s.city).filter(Boolean))).sort();
  // These statuses are manually assignable. Pending panel dispatch is auto from logistics;
  // "Total Assignment Pending on Portal" is auto = Assigned − Submitted. Neither appears here.
  const statuses = [
    "Submitted",
    "Unsubmitted",
    "Certification Pending",
    "Installed",
    "Commissioned",
    "Assessed",
    "Dropped / Rejected",
  ];
  const assessors = Array.from(
    new Set(allMetas.map((m) => m.assessor_company).filter(Boolean)),
  ).sort();
  const hasFilters = !!(search || filterCity || filterStatus || filterAssessor || filterBC);

  const q = search.toLowerCase().trim();
  const filteredSites = [...sites]
    .filter((s) => {
      const meta = parseSiteMetadata(s.task_notes);
      const assignedIds = getSiteWorkerIds(s);
      if (
        q &&
        ![s.name, meta.assessor_company, s.city].some((v) =>
          (v ?? "").toLowerCase().includes(q),
        )
      )
        return false;
      if (filterCity && s.city !== filterCity) return false;
      const canonicalStatus = getCanonicalStatus(s, aMap, iMap, cMap, materials);
      if (filterStatus && canonicalStatus !== filterStatus) return false;
      if (filterAssessor && meta.assessor_company !== filterAssessor) return false;
      if (filterBC && !assignedIds.includes(filterBC)) return false;
      return true;
    })
    .sort((a, b) => {
      const aTime = clientUpdateTimes[a.id] || 0;
      const bTime = clientUpdateTimes[b.id] || 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      const aDate = new Date(a.created_at || 0).getTime();
      const bDate = new Date(b.created_at || 0).getTime();
      return bDate - aDate;
    });
  const customListQ = customListSearch.toLowerCase().trim();
  const customListSites = [...sites]
    .filter((site) => {
      if (!customListQ) return true;
      const meta = parseSiteMetadata(site.task_notes);
      return [site.name, site.company_name, site.city, site.address, meta.c1_name, meta.c1_mobile].some((value) =>
        String(value || "").toLowerCase().includes(customListQ),
      );
    })
    .sort((a, b) => getCustomListCompanyName(a).localeCompare(getCustomListCompanyName(b)));

  const ITEMS_PER_PAGE = 50;
  const totalItems = filteredSites.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedSites = filteredSites.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-lime/80 font-bold">
            Manage
          </p>
          <h1 className="mt-2 text-4xl uppercase tracking-tight font-extrabold">Sites</h1>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={openCustomList}>
            <FileText size={16} strokeWidth={1.5} /> Custom List
          </Button>
          <Button
            onClick={() => {
              resetForm();
              setCreating(true);
              setEditingSite(null);
            }}
          >
            <Plus size={16} strokeWidth={1.5} /> New Site
          </Button>
        </div>
      </div>

      {(creating || editingSite) && (
        <div ref={formRevealRef} className="scroll-mt-6">
          <Card className="border-l-[3px] border-lime relative">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl uppercase font-bold tracking-tight text-lime">
                {editingSite ? "Edit Site Details" : "New Site Details"}
              </h2>
              <button
                type="button"
                aria-label="Close site form"
                title="Close"
                onClick={() => {
                  setCreating(false);
                  setEditingSite(null);
                }}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-border-bright bg-surface-raised text-text-primary transition-colors hover:border-coral/60 hover:bg-coral-dim hover:text-coral focus:outline-none focus:ring-3 focus:ring-coral/20"
              >
                <X size={18} strokeWidth={2.25} />
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Factory Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Company Name</Label>
                <Input
                  value={form.company_name}
                  onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                  placeholder="Company that owns this factory"
                />
              </div>
              <div>
                <Label>City</Label>
                <Input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>

              <div className="md:col-span-2">
                <Label>Address</Label>
                <Input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>

              <div>
                <Label>Appointment Date</Label>
                <div className="relative flex items-center">
                  <Input
                    type="date"
                    className="pr-10"
                    value={form.appt_date}
                    onChange={(e) => setForm({ ...form, appt_date: e.target.value })}
                  />
                  <Calendar
                    className="absolute right-3 text-text-primary pointer-events-none z-0"
                    size={16}
                    strokeWidth={1.5}
                  />
                </div>
              </div>
              <div>
                <Label>Appointment Time</Label>
                <div className="relative flex items-center">
                  <Input
                    type="time"
                    className="pr-10"
                    value={form.appt_time}
                    onChange={(e) => setForm({ ...form, appt_time: e.target.value })}
                  />
                  <Clock
                    className="absolute right-3 text-text-primary pointer-events-none z-0"
                    size={16}
                    strokeWidth={1.5}
                  />
                </div>
              </div>

              <div className="border-t border-border pt-4 md:col-span-2">
                <h4 className="text-sm font-bold uppercase tracking-wider text-lime mb-3">
                  Primary Contact
                </h4>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <Label>Contact Name</Label>
                    <Input
                      value={form.c1_name}
                      onChange={(e) => setForm({ ...form, c1_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Contact Mobile</Label>
                    <Input
                      value={form.c1_mobile}
                      onChange={(e) => setForm({ ...form, c1_mobile: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Contact Email</Label>
                    <Input
                      value={form.c1_email}
                      onChange={(e) => setForm({ ...form, c1_email: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-4 md:col-span-2">
                <h4 className="text-sm font-bold uppercase tracking-wider text-lime mb-3">
                  Secondary Contact
                </h4>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <Label>Contact Name</Label>
                    <Input
                      value={form.c2_name}
                      onChange={(e) => setForm({ ...form, c2_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Contact Mobile</Label>
                    <Input
                      value={form.c2_mobile}
                      onChange={(e) => setForm({ ...form, c2_mobile: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Contact Email</Label>
                    <Input
                      value={form.c2_email}
                      onChange={(e) => setForm({ ...form, c2_email: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-4 md:col-span-2">
                <h4 className="text-sm font-bold uppercase tracking-wider text-lime mb-3">
                  Assessor
                </h4>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>Company Name</Label>
                    <Input
                      value={form.assessor_company}
                      onChange={(e) => setForm({ ...form, assessor_company: e.target.value })}
                      placeholder="Company name"
                    />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input
                      value={form.assessor_phone}
                      onChange={(e) => setForm({ ...form, assessor_phone: e.target.value })}
                      placeholder="Phone number"
                    />
                  </div>
                  <div>
                    <Label>City</Label>
                    <Input
                      value={form.assessor_city}
                      onChange={(e) => setForm({ ...form, assessor_city: e.target.value })}
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <Label>Contact Number</Label>
                    <Input
                      value={form.assessor_number}
                      onChange={(e) => setForm({ ...form, assessor_number: e.target.value })}
                      placeholder="Contact number"
                    />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input
                      value={form.assessor_email}
                      onChange={(e) => setForm({ ...form, assessor_email: e.target.value })}
                      placeholder="Email address"
                    />
                  </div>
                  <div>
                    <Label>Address</Label>
                    <Input
                      value={form.assessor_address}
                      onChange={(e) => setForm({ ...form, assessor_address: e.target.value })}
                      placeholder="Address (optional)"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-4 md:col-span-2 grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Factory Status</Label>
                  <Select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    <option value="">— None —</option>
                    {FACTORY_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Assign Field Associates</Label>
                  <div className="mt-1 border border-border rounded-[6px] divide-y divide-border max-h-44 overflow-y-auto">
                    {businessConsultants.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-text-dim italic">
                        No active Field Associates available
                      </p>
                    ) : (
                      businessConsultants.map((w) => {
                        const checked = form.workers.includes(w.id);
                        return (
                          <label
                            key={w.id}
                            className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-surface-raised transition-colors"
                          >
                            <span
                              className={`flex items-center justify-center h-4 w-4 rounded-[3px] border shrink-0 transition-colors ${checked ? "bg-lime border-lime" : "border-border bg-surface"}`}
                            >
                              {checked && (
                                <Check size={10} strokeWidth={3} className="text-background" />
                              )}
                            </span>
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={() => {
                                const next = checked
                                  ? form.workers.filter((id) => id !== w.id)
                                  : [...form.workers, w.id];
                                setForm({ ...form, workers: next });
                              }}
                            />
                            <span className="text-sm text-text-primary">{w.name ?? w.mobile}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  {form.workers.length > 0 && (
                    <p className="mt-1 text-[10px] font-mono text-lime/70">
                      {form.workers.length} Field Associate{form.workers.length > 1 ? "s" : ""} selected
                    </p>
                  )}
                </div>
              </div>

              <div className="border-t border-border pt-4 md:col-span-2 grid gap-4 md:grid-cols-2">
                <div className="flex items-center gap-2 mt-6">
                  <input
                    type="checkbox"
                    id="create_drive_folder"
                    checked={form.create_drive_folder}
                    onChange={(e) => setForm({ ...form, create_drive_folder: e.target.checked })}
                    className="rounded border-border bg-surface text-lime focus:ring-lime h-4 w-4"
                  />
                  <label
                    htmlFor="create_drive_folder"
                    className="cursor-pointer text-sm font-medium text-text-primary"
                  >
                    Google Drive Link
                  </label>
                </div>
                {form.create_drive_folder && (
                  <div>
                    <Label>Google Drive Folder Link</Label>
                    <Input
                      placeholder="https://drive.google.com/drive/folders/..."
                      value={form.drive_folder_link}
                      onChange={(e) => setForm({ ...form, drive_folder_link: e.target.value })}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setCreating(false);
                  setEditingSite(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={editingSite ? updateSite : create}>
                {editingSite ? "Save Details" : "Create Site"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {pdfDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-2xl rounded-[10px] border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-syne text-lg font-bold uppercase text-text-primary">
                  Courier Address PDF
                </h2>
                <p className="mt-1 text-xs text-text-secondary">
                  Review the TO and FROM details before saving or downloading.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPdfDraft(null)}
                className="rounded-[6px] p-2 text-text-secondary hover:bg-surface-raised hover:text-text-primary"
                disabled={pdfSaving}
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-5 p-5 md:grid-cols-2">
              <div className="space-y-3">
                <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-lime">
                  To
                </div>
                <div>
                  <Label>Company Name</Label>
                  <Input
                    value={pdfDraft.toName}
                    onChange={(e) => setPdfDraft({ ...pdfDraft, toName: e.target.value })}
                    disabled={pdfSaving}
                  />
                </div>
                <div>
                  <Label>Address</Label>
                  <Textarea
                    value={pdfDraft.toAddress}
                    onChange={(e) => setPdfDraft({ ...pdfDraft, toAddress: e.target.value })}
                    rows={6}
                    disabled={pdfSaving}
                  />
                </div>
                <div>
                  <Label>Mobile</Label>
                  <Input
                    value={pdfDraft.toMobile}
                    onChange={(e) => setPdfDraft({ ...pdfDraft, toMobile: e.target.value })}
                    disabled={pdfSaving}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-violet">
                  From
                </div>
                <div>
                  <Label>Sender Name</Label>
                  <Input
                    value={pdfDraft.fromName}
                    onChange={(e) => setPdfDraft({ ...pdfDraft, fromName: e.target.value })}
                    disabled={pdfSaving}
                  />
                </div>
                <div>
                  <Label>Address</Label>
                  <Textarea
                    value={pdfDraft.fromAddress}
                    onChange={(e) => setPdfDraft({ ...pdfDraft, fromAddress: e.target.value })}
                    rows={6}
                    disabled={pdfSaving}
                  />
                </div>
                <div>
                  <Label>Mobile</Label>
                  <Input
                    value={pdfDraft.fromMobile}
                    onChange={(e) => setPdfDraft({ ...pdfDraft, fromMobile: e.target.value })}
                    disabled={pdfSaving}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-border px-5 py-4">
              <Button
                variant="secondary"
                onClick={() => setPdfDraft(null)}
                disabled={pdfSaving}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handlePdfSave(false)}
                disabled={pdfSaving}
              >
                Save
              </Button>
              <Button onClick={() => void handlePdfSave(true)} disabled={pdfSaving}>
                <FileText size={15} />
                Download PDF
              </Button>
            </div>
          </div>
        </div>
      )}

      {customLabelDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-2xl rounded-[10px] border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-syne text-lg font-bold uppercase text-text-primary">
                  Custom Courier Label
                </h2>
                <p className="mt-1 text-xs text-text-secondary">
                  Create a one-time label without saving these details.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCustomLabelDraft(null)}
                className="rounded-[6px] p-2 text-text-secondary hover:bg-surface-raised hover:text-text-primary"
                disabled={customLabelDownloading}
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-5 p-5 md:grid-cols-2">
              <div className="space-y-3">
                <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-lime">
                  To
                </div>
                <div>
                  <Label>Company Name</Label>
                  <Input
                    value={customLabelDraft.toName}
                    onChange={(e) => setCustomLabelDraft({ ...customLabelDraft, toName: e.target.value })}
                    placeholder="Enter company name"
                    disabled={customLabelDownloading}
                  />
                </div>
                <div>
                  <Label>Address</Label>
                  <Textarea
                    value={customLabelDraft.toAddress}
                    onChange={(e) => setCustomLabelDraft({ ...customLabelDraft, toAddress: e.target.value })}
                    placeholder="Enter delivery address"
                    rows={6}
                    disabled={customLabelDownloading}
                  />
                </div>
                <div>
                  <Label>Number</Label>
                  <Input
                    value={customLabelDraft.toMobile}
                    onChange={(e) => setCustomLabelDraft({ ...customLabelDraft, toMobile: e.target.value })}
                    placeholder="Enter mobile number"
                    disabled={customLabelDownloading}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-violet">
                  From
                </div>
                <div>
                  <Label>Sender Name</Label>
                  <Input
                    value={customLabelDraft.fromName}
                    onChange={(e) => setCustomLabelDraft({ ...customLabelDraft, fromName: e.target.value })}
                    disabled={customLabelDownloading}
                  />
                </div>
                <div>
                  <Label>Address</Label>
                  <Textarea
                    value={customLabelDraft.fromAddress}
                    onChange={(e) => setCustomLabelDraft({ ...customLabelDraft, fromAddress: e.target.value })}
                    rows={6}
                    disabled={customLabelDownloading}
                  />
                </div>
                <div>
                  <Label>Number</Label>
                  <Input
                    value={customLabelDraft.fromMobile}
                    onChange={(e) => setCustomLabelDraft({ ...customLabelDraft, fromMobile: e.target.value })}
                    disabled={customLabelDownloading}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-border px-5 py-4">
              <Button
                variant="secondary"
                onClick={() => setCustomLabelDraft(null)}
                disabled={customLabelDownloading}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleCustomLabelDownload()} disabled={customLabelDownloading}>
                <FileText size={15} />
                Download PDF
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Search & Filters ── */}
      {customListOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-4 sm:items-center sm:py-6">
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[10px] border border-border bg-surface shadow-2xl sm:max-h-[calc(100vh-3rem)]">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0 pt-1">
                <h2 className="font-syne text-lg font-bold uppercase text-text-primary">
                  Custom List
                </h2>
                <p className="mt-1 text-xs text-text-secondary">
                  Select companies from the sites list and print the feedback company list PDF.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close custom list"
                title="Close"
                onClick={() => {
                  setCustomListOpen(false);
                  setCustomListTitle("");
                  setCustomListColumns(getDefaultCustomListColumns());
                }}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] border border-border-bright bg-surface-raised text-text-primary transition-colors hover:border-coral/60 hover:bg-coral-dim hover:text-coral focus:outline-none focus:ring-3 focus:ring-coral/20"
                disabled={customListGenerating}
              >
                <X size={20} strokeWidth={2.5} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              <div>
                <Label>PDF Title</Label>
                <Input
                  value={customListTitle}
                  onChange={(e) => setCustomListTitle(e.target.value)}
                  placeholder="SIM KIT FEEDBACK COMPANIES LIST"
                  disabled={customListGenerating}
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <Label>PDF Columns</Label>
                  <Button
                    variant="secondary"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setCustomListColumns(getDefaultCustomListColumns())}
                    disabled={customListGenerating}
                  >
                    Select All
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {CUSTOM_LIST_COLUMNS.map((column) => {
                    const checked = customListColumns.includes(column.key);
                    return (
                      <label
                        key={column.key}
                        className="flex cursor-pointer items-center gap-2 rounded-[6px] border border-border bg-background/30 px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-raised/60"
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border ${checked ? "border-lime bg-lime" : "border-border bg-surface"}`}
                        >
                          {checked && <Check size={11} strokeWidth={3} className="text-background" />}
                        </span>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => {
                            setCustomListColumns((prev) =>
                              prev.includes(column.key)
                                ? prev.filter((key) => key !== column.key)
                                : [...prev, column.key],
                            );
                          }}
                          disabled={customListGenerating}
                        />
                        <span className="truncate">{column.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Input
                    value={customListSearch}
                    onChange={(e) => setCustomListSearch(e.target.value)}
                    placeholder="Search company, site, city or mobile"
                    disabled={customListGenerating}
                    className="pr-8"
                  />
                  {customListSearch && (
                    <button
                      type="button"
                      onClick={() => setCustomListSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-primary"
                      disabled={customListGenerating}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <Button
                  variant="secondary"
                  className="text-xs"
                  onClick={() => {
                    const visibleIds = customListSites.map((site) => site.id);
                    setCustomListSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
                  }}
                  disabled={customListGenerating || customListSites.length === 0}
                >
                  Select Visible
                </Button>
                <Button
                  variant="secondary"
                  className="text-xs"
                  onClick={() => setCustomListSelectedIds([])}
                  disabled={customListGenerating || customListSelectedIds.length === 0}
                >
                  Clear
                </Button>
              </div>

              <div className="max-h-[52vh] overflow-y-auto rounded-[8px] border border-border">
                {customListSites.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm italic text-text-dim">
                    No companies match your search.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {customListSites.map((site) => {
                      const checked = customListSelectedIds.includes(site.id);
                      const contact = getCustomListContact(site);
                      return (
                        <label
                          key={site.id}
                          className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-raised/60"
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border ${checked ? "border-lime bg-lime" : "border-border bg-surface"}`}
                          >
                            {checked && <Check size={11} strokeWidth={3} className="text-background" />}
                          </span>
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={() => toggleCustomListSite(site.id)}
                            disabled={customListGenerating}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-text-primary">
                              {getCustomListCompanyName(site)}
                            </span>
                            <span className="mt-1 block truncate text-xs text-text-secondary">
                              {getCustomListDetails(site)}
                            </span>
                          </span>
                          <span className="hidden shrink-0 text-right text-xs text-text-secondary sm:block">
                            <span className="block font-semibold text-text-primary">{contact.name}</span>
                            <span className="mt-1 block font-mono text-[10px]">{contact.mobile}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
              <p className="font-mono text-xs text-text-secondary">
                {customListSelectedIds.length} selected
              </p>
              <div className="flex flex-wrap justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCustomListOpen(false);
                    setCustomListTitle("");
                    setCustomListColumns(getDefaultCustomListColumns());
                  }}
                  disabled={customListGenerating}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void downloadCustomListPdf()}
                  disabled={customListGenerating || customListSelectedIds.length === 0 || customListColumns.length === 0}
                >
                  <FileText size={15} />
                  Print PDF
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search by site name, assessor or city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-[6px] border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-dim focus:border-lime focus:outline-none transition-colors pr-8"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-primary"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {hasFilters && (
            <button
              onClick={() => {
                setSearch("");
                setFilterCity("");
                setFilterStatus("");
                setFilterAssessor("");
                setFilterBC("");
              }}
              className="text-xs font-mono text-coral hover:text-coral/70 transition-colors whitespace-nowrap flex items-center gap-1"
            >
              <X size={12} /> Clear all
            </button>
          )}
          <Button
            variant="secondary"
            className="text-xs"
            onClick={openCustomLabel}
          >
            <FileText size={14} />
            Custom Label
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "City", value: filterCity, set: setFilterCity, options: cities },
            { label: "Status", value: filterStatus, set: setFilterStatus, options: statuses },
            {
              label: "Assessor",
              value: filterAssessor,
              set: setFilterAssessor,
              options: assessors,
            },
          ].map(({ label, value, set, options }) => (
            <select
              key={label}
              value={value}
              onChange={(e) => set(e.target.value)}
              className={`rounded-[6px] border px-2.5 py-1.5 text-xs font-mono focus:outline-none transition-colors cursor-pointer ${value ? "border-lime bg-lime/5 text-lime" : "border-border bg-surface text-text-secondary"}`}
            >
              <option value="">All {label}s</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ))}
          <select
            value={filterBC}
            onChange={(e) => setFilterBC(e.target.value)}
            className={`rounded-[6px] border px-2.5 py-1.5 text-xs font-mono focus:outline-none transition-colors cursor-pointer ${filterBC ? "border-lime bg-lime/5 text-lime" : "border-border bg-surface text-text-secondary"}`}
          >
            <option value="">All Field Associates</option>
            {businessConsultants.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name ?? w.mobile}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border border-border bg-surface rounded-[10px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-raised">
              <tr className="text-left font-mono text-[9px] uppercase tracking-widest text-text-secondary">
                <th className="px-4 py-3">Site / Factory</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Primary Contact</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">BC Assignment</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sites.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-text-dim italic">
                    No sites created yet.
                  </td>
                </tr>
              ) : paginatedSites.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-text-dim italic">
                    No sites match your search or filters.
                  </td>
                </tr>
              ) : (
                paginatedSites.map((s) => {
                  const meta = parseSiteMetadata(s.task_notes);
                  const canonicalStatus = getCanonicalStatus(s, aMap, iMap, cMap, materials);
                  const assessmentData = aMap.get(s.id)?.data;
                  const assessmentPendingReasons = getAssessmentPendingReasons(assessmentData, hasDeviceOrder(s, assessmentData, materials));
                  const assignedIds = getSiteWorkerIds(s);
                  return (
                    <tr
                      key={s.id}
                      className="border-b border-border last:border-0 hover:bg-surface-raised/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-text-primary">{s.name}</div>
                        <div className="text-xs text-text-secondary mt-0.5 truncate max-w-[200px]">
                          {s.address || "—"}
                        </div>
                        {(meta.assessor_company || meta.assessor_phone) && (
                          <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                            {meta.assessor_company && (
                              <span className="text-xs font-bold text-violet tracking-wide">
                                {meta.assessor_company}
                              </span>
                            )}
                            {meta.assessor_phone && (
                              <a
                                href={`tel:${meta.assessor_phone}`}
                                className="text-xs font-mono font-semibold text-text-primary hover:text-violet transition-colors flex items-center gap-1"
                              >
                                <Phone size={11} className="text-violet" />
                                {meta.assessor_phone}
                              </a>
                            )}
                          </div>
                        )}
                        {meta.drive_folder_link && (
                          <button
                            onClick={() => window.open(meta.drive_folder_link, "_blank")}
                            className="text-xs text-lime hover:underline flex items-center gap-1 mt-1 font-mono text-left"
                          >
                            <Folder size={12} className="inline mr-1" /> Open Drive Folder{" "}
                            <ExternalLink size={10} className="inline ml-1" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-primary font-medium">{s.city || "—"}</td>
                      <td className="px-4 py-3 text-xs">
                        {meta.c1_name || meta.c1_mobile || meta.c1_email ? (
                          <div>
                            {meta.c1_name && (
                              <div className="font-semibold text-text-primary">{meta.c1_name}</div>
                            )}
                            {meta.c1_mobile && (
                              <a
                                href={`tel:${meta.c1_mobile}`}
                                className="text-lime hover:underline flex items-center gap-1 mt-0.5 font-mono text-[10px]"
                              >
                                <Phone size={10} /> {meta.c1_mobile}
                              </a>
                            )}
                            {meta.c1_email && (
                              <a
                                href={`mailto:${meta.c1_email}`}
                                className="text-text-secondary hover:text-lime block mt-0.5 font-mono text-[10px]"
                              >
                                {meta.c1_email}
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-text-dim">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <select
                            value={canonicalStatus || ""}
                            onChange={(e) => updateSiteStatus(s.id, e.target.value, s.task_notes, canonicalStatus)}
                            className={`appearance-none rounded-[4px] px-2 py-1 font-mono text-[10px] uppercase tracking-wider font-bold border outline-none cursor-pointer transition-all ${
                              canonicalStatus === "Submitted"
                                ? "bg-mint-dim text-mint border-mint/20"
                                : canonicalStatus === "Dropped / Rejected"
                                  ? "bg-coral-dim text-coral border-coral/20"
                                  : canonicalStatus === "Certification Pending"
                                    ? "bg-violet/10 text-violet border-violet/20"
                                    : canonicalStatus === "Commissioned"
                                      ? "bg-mint-dim text-mint border-mint/20"
                                      : canonicalStatus === "Installed"
                                        ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                        : canonicalStatus === "Assigned"
                                          ? "bg-violet/10 text-violet border-violet/20"
                                          : canonicalStatus === "Pending Assignment" || canonicalStatus === "Total Assignment Pending on Portal"
                                            ? "bg-warning/8 text-warning border-warning/20"
                                            : canonicalStatus === "Panel Dispatched"
                                              ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                              : canonicalStatus === "Assessed"
                                              ? "bg-lime/10 text-lime border-lime/20"
                                              : "bg-surface text-text-dim border-border"
                            }`}
                          >
                            <option value="">— None —</option>
                            {canonicalStatus === "Panel Dispatched" && (
                              <option value="Panel Dispatched">
                                Pending Panel Dispatched
                              </option>
                            )}
                            {FACTORY_STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                          {assessmentPendingReasons.length > 0 && (canonicalStatus === "Assessed" || canonicalStatus === "Panel Dispatched") && (
                            <span className="w-fit rounded border border-warning/20 bg-warning/8 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-warning">
                              {assessmentPendingReasons.join(", ")}
                            </span>
                          )}
                          {meta.visit_status && (
                            <span
                              className={`font-mono text-[9px] uppercase tracking-wider ${
                                meta.visit_status === "Visit Complete"
                                  ? "text-mint"
                                  : meta.visit_status === "Installation Done"
                                    ? "text-violet"
                                    : "text-warning"
                              }`}
                            >
                              {meta.visit_status}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <BCMultiSelect
                          allBCs={businessConsultants}
                          selectedIds={assignedIds}
                          onChange={(ids) => assignMultiple(s.id, ids, s.task_notes)}
                        />
                        {assignedIds.length > 1 && (
                          <p className="mt-1 font-mono text-[9px] text-lime/60">
                            {assignedIds.length} Field Associates assigned
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="secondary"
                            className="h-8 w-8 p-0"
                            onClick={() => void openPdfAddressWindow(s)}
                            title="Courier address PDF"
                            aria-label="Courier address PDF"
                          >
                            <FileText size={14} />
                          </Button>
                          <Button
                            variant="secondary"
                            className="p-1 px-2.5 text-xs"
                            onClick={() => startEdit(s)}
                          >
                            <Edit size={12} /> Edit
                          </Button>
                          <Button
                            variant="danger"
                            className="py-1 px-2.5 text-xs"
                            onClick={() => deleteSite(s.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border bg-surface-raised px-4 py-3 sm:px-6">
            <div className="flex flex-1 justify-between sm:hidden">
              <Button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                variant="secondary"
                className="text-xs"
              >
                Previous
              </Button>
              <Button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                variant="secondary"
                className="text-xs"
              >
                Next
              </Button>
            </div>
            <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
              <div>
                <p className="text-xs text-text-secondary font-mono">
                  Showing <span className="font-bold text-text-primary">{startIndex + 1}</span> to{" "}
                  <span className="font-bold text-text-primary">
                    {Math.min(startIndex + ITEMS_PER_PAGE, totalItems)}
                  </span>{" "}
                  of <span className="font-bold text-text-primary">{totalItems}</span> results
                </p>
              </div>
              <div>
                <nav className="isolate inline-flex -space-x-px rounded-[6px] shadow-sm gap-1" aria-label="Pagination">
                  <Button
                    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    variant="secondary"
                    className="h-8 w-8 p-0 flex items-center justify-center border border-border bg-surface hover:bg-surface-raised"
                  >
                    &lt;
                  </Button>
                  
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                    const isActive = page === currentPage;
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`inline-flex items-center justify-center text-xs font-mono font-bold h-8 w-8 rounded-[6px] transition-all ${
                          isActive
                            ? "bg-lime text-background shadow-sm"
                            : "border border-border bg-surface text-text-secondary hover:bg-surface-raised"
                        }`}
                      >
                        {page}
                      </button>
                    );
                  })}

                  <Button
                    onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    variant="secondary"
                    className="h-8 w-8 p-0 flex items-center justify-center border border-border bg-surface hover:bg-surface-raised"
                  >
                    &gt;
                  </Button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
