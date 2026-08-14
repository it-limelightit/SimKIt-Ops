import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button, Card, Input, Label, Select, Badge } from "@/components/ui-kit";
import { toast } from "sonner";
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
} from "lucide-react";
import { parseSiteMetadata, serializeSiteMetadata } from "@/lib/site-metadata";
import { getCanonicalStatus, ASSESSMENT_KEYS, INSTALLATION_KEYS, COMMISSIONING_KEYS, pctKeys, getSiteWorkerIds, isSiteDropped } from "@/utils/status";

export { parseSiteMetadata, serializeSiteMetadata };

const FACTORY_STATUS_OPTIONS = [
  "Submitted",
  "Unsubmitted",
  "Certification Pending",
  "Panel Dispatched",
  "Installed",
  "Commissioned",
  "Assessed",
  "Dropped / Rejected",
  "Not Started Yet",
] as const;

// ── Multi-select BC dropdown ──────────────────────────────────────────────────
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

/*
const ASSESSMENT_KEYS = [
  "mom_uploaded",
  "media_uploaded",
  "factory_operations_done",
];
const INSTALLATION_KEYS = ["delivery_confirmed", "coordination_done", "photos_uploaded"];
const COMMISSIONING_KEYS = [
  "coordination_done",
  "visit_done",
  "connection_done",
  "configure_done",
  "testing_done",
  "screenshots_uploaded",
  "certificate_sent",
  "final_mom_uploaded",
];

function pctKeys(data: any, keys: string[]) {
  if (!data) return 0;
  return Math.round((keys.filter((k) => !!data[k]).length / keys.length) * 100);
}

//
// ── Main panel ────────────────────────────────────────────────────────────────
export function SitesPanel_DELETED() {
  const formRevealRef = useRef<HTMLDivElement>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [businessConsultants, setBusinessConsultants] = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [installations, setInstallations] = useState<any[]>([]);
  const [commissionings, setCommissionings] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingSite, setEditingSite] = useState<any | null>(null);

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

  // Returns the full list of assigned BC IDs for a site row
  const getSiteWorkerIds = (s: any): string[] => {
    const meta = parseSiteMetadata(s.task_notes);
    if (meta.worker_ids?.length > 0) return meta.worker_ids;
    if (s.assigned_worker_id) return [s.assigned_worker_id];
    return [];
  };

  const aMap = new Map<string, any>(assessments.map((r) => [r.site_id, r]));
  const iMap = new Map<string, any>(installations.map((r) => [r.site_id, r]));
  const cMap = new Map<string, any>(commissionings.map((r) => [r.site_id, r]));

  const isSiteSubmitted = (site: any) => {
    if (site.consultant_stage === "Completion" || site.consultant_stage === "Billing") return true;
    const ar = aMap.get(site.id);
    return !!ar?.data?.assessment_phase_submitted;
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


// ── Main panel ────────────────────────────────────────────────────────────────
*/

export function SitesPanel() {
  const formRevealRef = useRef<HTMLDivElement>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [businessConsultants, setBusinessConsultants] = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [installations, setInstallations] = useState<any[]>([]);
  const [commissionings, setCommissionings] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingSite, setEditingSite] = useState<any | null>(null);

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
    return !!ar?.data?.assessment_phase_submitted;
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
    const aP = ar?.data?.assessment_phase_submitted ? 100 : pctKeys(ar?.data, ASSESSMENT_KEYS);
    return stage.includes("assessment") || aP > 0;
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

    const { error } = await supabase.from("sites").insert({
      name: form.name,
      company_name: form.company_name || form.name,
      city: form.city || null,
      address: form.address || null,
      assigned_worker_id: formWorkers[0] || null,
      task_notes: taskNotes,
      consultant_stage: consultantStage,
      appt_date: form.appt_date || null,
      appt_time: form.appt_time || null,
    } as never);

    if (error) toast.error(error.message);
    else {
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

  const assignMultiple = async (
    siteId: string,
    workerIds: string[],
    currentTaskNotes: string | null,
  ) => {
    const meta = parseSiteMetadata(currentTaskNotes);
    const newNotes = serializeSiteMetadata(currentTaskNotes, { ...meta, worker_ids: workerIds });
    await supabase
      .from("sites")
      .update({
        assigned_worker_id: workerIds[0] || null,
        assigned_at: new Date().toISOString(),
        task_notes: newNotes,
      } as never)
      .eq("id", siteId);
    toast.success("Assignment updated");
    setClientUpdateTimes(prev => ({ ...prev, [siteId]: Date.now() }));
    await load();
  };

  const updateSiteStatus = async (
    siteId: string,
    newStatus: string,
    currentTaskNotes: string | null,
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
        const siteObj = sites.find((s: any) => s.id === siteId);
        const workerIds = getSiteWorkerIds(siteObj);
        const workerId = workerIds[0] || siteObj?.assigned_worker_id || null;

        if (metaStatus === "Dropped / Rejected") {
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

        toast.success("Site status updated successfully");
        setClientUpdateTimes(prev => ({ ...prev, [siteId]: Date.now() }));
        await load();
      }
    } catch (err: any) {
      toast.error("Failed to update status: " + err.message);
    }
  };

  const deleteSite = async (siteId: string) => {
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
  // These statuses are manually assignable. "Panel Dispatched" is auto from logistics;
  // "Total Assignment Pending on Portal" is auto = Assigned − Submitted. Neither appears here.
  const statuses = [
    "Submitted",
    "Unsubmitted",
    "Certification Pending",
    "Installed",
    "Commissioned",
    "Assessed",
    "Panel Dispatched",
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

      {(creating || editingSite) && (
        <div ref={formRevealRef} className="scroll-mt-6">
          <Card className="border-l-[3px] border-lime relative">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl uppercase font-bold tracking-tight text-lime">
                {editingSite ? "Edit Site Details" : "New Site Details"}
              </h2>
              <button
                onClick={() => {
                  setCreating(false);
                  setEditingSite(null);
                }}
              >
                <X size={18} strokeWidth={1.5} />
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

      {/* ── Search & Filters ── */}
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
                            onChange={(e) => updateSiteStatus(s.id, e.target.value, s.task_notes)}
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
                            {FACTORY_STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
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
