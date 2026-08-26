import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Input, Label, Select } from "@/components/ui-kit";
import { parseSiteMetadata } from "@/lib/site-metadata";
import { getCanonicalStatus } from "@/utils/status";
import logoUrl from "../../../image copy.png";
import {
  Building2,
  CheckCircle2,
  Clock3,
  Download,
  Factory,
  FileText,
  LogIn,
  Search,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

type ViewMode = "company" | "consultant" | "activity" | "loginActivity";

type Consultant = {
  id: string;
  name: string | null;
  mobile: string | null;
  email?: string | null;
  last_login?: string | null;
};

type SiteRecord = {
  id: string;
  name: string;
  company_name: string | null;
  city: string | null;
  assigned_worker_id: string | null;
  task_notes: string | null;
  consultant_stage: string | null;
  created_at: string;
};

type FactoryRow = {
  id: string;
  companyName: string;
  factoryName: string;
  city: string;
  consultantIds: string[];
  consultantNames: string[];
  status: string;
  createdAt: string;
};

type ActivityRow = {
  id: string;
  activityType: "status_change" | "login" | "create" | "update" | "delete" | "logistics_update";
  siteId: string;
  companyName: string;
  factoryName: string;
  city: string;
  userName: string;
  fromStatus: string;
  toStatus: string;
  changedAt: string;
};

type AuditRecord = {
  id: string;
  created_at: string;
  actor_name: string | null;
  action: ActivityRow["activityType"];
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  site_id: string | null;
  company_name: string | null;
  factory_name: string | null;
  from_value: string | null;
  to_value: string | null;
  details: Record<string, any> | null;
};

const STATUS_OPTIONS = [
  "Assessed",
  "Panel Dispatched",
  "Installed",
  "Commissioned",
  "Submitted",
  "Unsubmitted",
  "Certification Pending",
  "Dropped / Rejected",
  "Not Started Yet",
] as const;

const isCompletedStatus = (status: string) => status === "Submitted";
const isPendingStatus = (status: string) =>
  ["Pending Assignment", "Assigned", "Assessed", "Panel Dispatched", "Installed", "Commissioned", "Unsubmitted", "Not Started Yet"].includes(status);
const isAwaitingStatus = (status: string) => status === "Certification Pending";

function statusStyle(status: string) {
  if (status === "Submitted") return "border-emerald-250 bg-emerald-50 text-emerald-700";
  if (status === "Dropped / Rejected") return "border-red-200 bg-red-50 text-red-700";
  if (status === "Certification Pending") return "border-purple-200 bg-purple-50 text-purple-700";
  if (status === "Commissioned") return "border-teal-250 bg-teal-50 text-teal-700";
  if (status === "Installed") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (status === "Panel Dispatched" || status === "Assessed") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "Assigned" || status === "Not Started Yet") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (status === "Pending Assignment") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-stone-200 bg-stone-50 text-stone-600";
}

function actionLabel(action: ActivityRow["activityType"]) {
  if (action === "login") return "Last Login";
  if (action === "status_change") return "Status Changed";
  if (action === "logistics_update") return "Logistics Updated";
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function groupReportRows(rows: FactoryRow[], key: (row: FactoryRow) => string) {
  const groups = new Map<string, FactoryRow[]>();
  rows.forEach((row) => {
    const groupName = key(row) || "Unspecified";
    groups.set(groupName, [...(groups.get(groupName) ?? []), row]);
  });
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

const ASSESSMENT_KEYS = ["mom_uploaded", "media_uploaded", "factory_operations_done", "device_order_completed"];
const INSTALLATION_KEYS = ["delivery_confirmed", "coordination_done", "photos_uploaded"];
const COMMISSIONING_KEYS = [
  "coordination_done",
  "visit_done",
  "connection_done",
  "configure_done",
  "testing_done",
  "screenshots_uploaded",
  "certificate_sent",
];

const pctKeys = (data: any, keys: string[]) => {
  if (!data) return 0;
  const done = keys.filter((k) => !!data[k]).length;
  return Math.round((done / keys.length) * 100);
};

const getSiteWorkerIds = (site: any): string[] => {
  if (site.assigned_worker_id) return [site.assigned_worker_id];
  const meta = parseSiteMetadata(site.task_notes);
  if (meta.worker_ids && Array.isArray(meta.worker_ids)) {
    return meta.worker_ids;
  }
  return [];
};

export function ReportsPanel() {
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "company";
    const saved = window.localStorage.getItem("managerReportsView");
    return saved === "loginActivity" || saved === "activity" || saved === "consultant" || saved === "company"
      ? saved
      : "company";
  });
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [installations, setInstallations] = useState<any[]>([]);
  const [commissionings, setCommissionings] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    search: "",
    from: "",
    to: "",
    city: "",
    consultant: "",
    status: "",
  });

  const getLogoImages = async () => {
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
    return { logoDataUrl, watermarkDataUrl };
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [
          siteResult,
          consultantResult,
          assessmentsRes,
          installationsRes,
          commissioningsRes,
          materialsRes,
          rolesRes,
          auditLogsRes,
        ] = await Promise.all([
          supabase
            .from("sites")
            .select(
              "id,name,company_name,city,assigned_worker_id,task_notes,consultant_stage,created_at",
            )
            .order("created_at", { ascending: false }),
          supabase.from("profiles").select("id,name,mobile,email,last_login").order("name"),
          supabase.from("assessment").select("data,updated_at,site_id,worker_id"),
          supabase.from("installation").select("data,updated_at,site_id,worker_id"),
          supabase.from("commissioning").select("data,updated_at,site_id,worker_id"),
          supabase
            .from("inventory_materials")
            .select("state,notes,submitted,material_name,created_at")
            .order("created_at", { ascending: false }),
          supabase.from("user_roles").select("user_id").eq("role", "worker"),
          supabase
            .from("activity_logs" as any)
            .select("*")
            .order("created_at", { ascending: false })
            .limit(1000),
        ]);

        if (siteResult.error)
          toast.error("Could not load factory report: " + siteResult.error.message);
        if (consultantResult.error)
          toast.error("Could not load field associates: " + consultantResult.error.message);

        setSites(siteResult.data ?? []);
        const workerIds = new Set((rolesRes.data ?? []).map((r: any) => r.user_id));
        const profiles = consultantResult.data ?? [];
        setConsultants(profiles.filter((c: any) => workerIds.has(c.id)));
        setAuditLogs(auditLogsRes.error ? [] : ((auditLogsRes.data ?? []) as unknown as AuditRecord[]));
        setAssessments(assessmentsRes.data ?? []);
        setInstallations(installationsRes.data ?? []);
        setCommissionings(commissioningsRes.data ?? []);
        setMaterials(materialsRes.data ?? []);
      } catch (err) {
        console.error("Error loading reports data:", err);
      } finally {
        setLoading(false);
      }
    };
    void load();

    const channel = supabase
      .channel("management-report-sites")
      .on("postgres_changes", { event: "*", schema: "public", table: "sites" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_logs" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "assessment" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "installation" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "commissioning" }, () => {
        void load();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const consultantMap = useMemo(
    () => new Map(consultants.map((consultant) => [consultant.id, consultant])),
    [consultants],
  );

  const rows = useMemo<FactoryRow[]>(
    () => {
      const aMap = new Map<string, any>(assessments.map((r) => [r.site_id, r]));
      const iMap = new Map<string, any>(installations.map((r) => [r.site_id, r]));
      const cMap = new Map<string, any>(commissionings.map((r) => [r.site_id, r]));

      return sites.map((site) => {
        const consultantIds = getSiteWorkerIds(site);
        const canonicalStatus = getCanonicalStatus(site, aMap, iMap, cMap, materials);

        return {
          id: site.id,
          companyName: site.company_name?.trim() || site.name,
          factoryName: site.name,
          city: site.city || "—",
          consultantIds,
          consultantNames: consultantIds.map(
            (id: string) =>
              consultantMap.get(id)?.name || consultantMap.get(id)?.mobile || "Unknown",
          ),
          status: canonicalStatus,
          createdAt: site.created_at,
        };
      });
    },
    [sites, consultantMap, assessments, installations, commissionings, materials],
  );

  const filteredRows = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return rows.filter((row) => {
      if (
        search &&
        ![
          row.companyName,
          row.factoryName,
          row.city,
          row.consultantNames.join(" "),
          row.status,
        ].some((value) => value.toLowerCase().includes(search))
      ) {
        return false;
      }
      if (filters.city && row.city !== filters.city) return false;
      if (filters.consultant && !row.consultantIds.includes(filters.consultant)) return false;
      if (filters.status && row.status !== filters.status) return false;
      if (filters.from && row.createdAt.slice(0, 10) < filters.from) return false;
      if (filters.to && row.createdAt.slice(0, 10) > filters.to) return false;
      return true;
    });
  }, [rows, filters]);

  const activityRows = useMemo<ActivityRow[]>(() => {
    const hasValidDate = (value: string | null | undefined) => {
      if (!value) return false;
      const date = new Date(value);
      return !Number.isNaN(date.getTime());
    };
    const siteById = new Map(sites.map((site) => [site.id, site]));
    const profileName = (workerId: string | null | undefined) => {
      if (!workerId) return "Unknown User";
      const profile = consultantMap.get(workerId);
      return profile?.name || profile?.mobile || profile?.email || "Unknown User";
    };
    const statusRows = sites
      .flatMap((site) => {
        const meta = parseSiteMetadata(site.task_notes);
        const logs = Array.isArray(meta.activity_logs) ? meta.activity_logs : [];
        return logs
          .filter((log: any) => log?.type === "status_change")
          .filter((log: any) => hasValidDate(String(log.at || site.created_at)))
          .map((log: any) => ({
            id: String(log.id || `${site.id}-${log.at}`),
            activityType: "status_change" as const,
            siteId: site.id,
            companyName: site.company_name?.trim() || site.name,
            factoryName: site.name,
            city: site.city || "—",
            userName: String(log.user_name || "Unknown User"),
            fromStatus: String(log.from_status || "—"),
            toStatus: String(log.to_status || "—"),
            changedAt: String(log.at || site.created_at),
          }));
      });
    const auditRows = auditLogs.map((log) => ({
      id: log.id,
      activityType: log.action,
      siteId: log.site_id || "",
      companyName: log.company_name || log.entity_name || log.entity_type,
      factoryName: log.factory_name || log.entity_name || log.entity_type,
      city: "—",
      userName: log.actor_name || "Unknown User",
      fromStatus: log.from_value || actionLabel(log.action),
      toStatus: log.to_value || actionLabel(log.action),
      changedAt: log.created_at,
    }));
    const auditKeys = new Set(
      auditRows.map((row) => `${row.activityType}:${row.siteId}:${row.fromStatus}:${row.toStatus}`),
    );
    const hasLoggedStatus = (siteId: string, toStatus: string, changedAt: string) => {
      const targetTime = new Date(changedAt).getTime();
      return statusRows.some((row) => {
        if (row.siteId !== siteId || row.toStatus !== toStatus) return false;
        const rowTime = new Date(row.changedAt).getTime();
        if (Number.isNaN(targetTime) || Number.isNaN(rowTime)) return false;
        return Math.abs(rowTime - targetTime) < 5 * 60 * 1000;
      });
    };
    const makePhaseRow = (
      phase: "assessment" | "installation" | "commissioning",
      row: any,
      fromStatus: string,
      toStatus: string,
    ): ActivityRow | null => {
      const site = siteById.get(row.site_id);
      if (!site) return null;
      const changedAt =
        (phase === "assessment" && row.data?.factory_form_submitted_at) ||
        (phase === "installation" && row.data?.installation_phase_submitted_at) ||
        (phase === "commissioning" && row.data?.commissioning_phase_submitted_at) ||
        row.updated_at ||
        site.created_at;
      if (!hasValidDate(changedAt)) return null;
      if (hasLoggedStatus(site.id, toStatus, changedAt)) return null;
      return {
        id: `${phase}-${site.id}-${changedAt}`,
        activityType: "status_change",
        siteId: site.id,
        companyName: site.company_name?.trim() || site.name,
        factoryName: site.name,
        city: site.city || "—",
        userName: profileName(row.worker_id),
        fromStatus,
        toStatus,
        changedAt,
      };
    };
    const phaseRows = [
      ...assessments
        .filter((row) => row.data?.assessment_phase_submitted)
        .map((row) => makePhaseRow("assessment", row, "Not Started Yet", "Assessed")),
      ...installations
        .filter((row) => row.data?.installation_phase_submitted)
        .map((row) => makePhaseRow("installation", row, "Assessed", "Installed")),
      ...commissionings
        .filter((row) => row.data?.commissioning_phase_submitted)
        .map((row) => makePhaseRow("commissioning", row, "Installed", "Submitted")),
    ]
      .filter((row): row is ActivityRow => !!row)
      .filter((row) => !auditKeys.has(`${row.activityType}:${row.siteId}:${row.fromStatus}:${row.toStatus}`));
    const fallbackStatusRows = statusRows.filter(
      (row) => !auditKeys.has(`${row.activityType}:${row.siteId}:${row.fromStatus}:${row.toStatus}`),
    );
    return [...auditRows, ...fallbackStatusRows, ...phaseRows]
      .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
  }, [sites, assessments, installations, commissionings, auditLogs, consultantMap]);

  const filteredLogRows = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return activityRows.filter((row) => {
      if (
        search &&
        ![
          row.companyName,
          row.factoryName,
          row.city,
          row.userName,
          row.changedAt,
          row.fromStatus,
          row.toStatus,
          actionLabel(row.activityType),
        ].some((value) => value.toLowerCase().includes(search))
      ) {
        return false;
      }
      const rowDate = row.changedAt.slice(0, 10);
      if (filters.from && rowDate < filters.from) return false;
      if (filters.to && rowDate > filters.to) return false;
      return true;
    });
  }, [activityRows, filters.from, filters.search, filters.to]);

  const filteredActivityRows = useMemo(
    () => filteredLogRows.filter((row) => row.activityType !== "login"),
    [filteredLogRows],
  );

  const filteredLoginRows = useMemo(
    () => filteredLogRows.filter((row) => row.activityType === "login"),
    [filteredLogRows],
  );

  const cities = useMemo(
    () => Array.from(new Set(rows.map((row) => row.city).filter((city) => city !== "—"))).sort(),
    [rows],
  );

  const summary = useMemo(
    () => ({
      total: filteredRows.length,
      companies: new Set(filteredRows.map((row) => row.companyName)).size,
      completed: filteredRows.filter((row) => isCompletedStatus(row.status)).length,
      pending: filteredRows.filter((row) => isPendingStatus(row.status)).length,
      awaiting: filteredRows.filter((row) => isAwaitingStatus(row.status)).length,
    }),
    [filteredRows],
  );

  const companyGroups = useMemo(() => {
    const groups = new Map<string, FactoryRow[]>();
    filteredRows.forEach((row) => {
      groups.set(row.companyName, [...(groups.get(row.companyName) ?? []), row]);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRows]);

  const consultantGroups = useMemo(() => {
    const groups = new Map<string, { name: string; rows: FactoryRow[] }>();
    filteredRows.forEach((row) => {
      if (row.consultantIds.length === 0) {
        const current = groups.get("unassigned") ?? { name: "Unassigned", rows: [] };
        current.rows.push(row);
        groups.set("unassigned", current);
        return;
      }
      row.consultantIds.forEach((id, index) => {
        const current = groups.get(id) ?? {
          name: row.consultantNames[index] || "Unknown",
          rows: [],
        };
        current.rows.push(row);
        groups.set(id, current);
      });
    });
    return Array.from(groups.entries()).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  }, [filteredRows]);

  const clearFilters = () =>
    setFilters({ search: "", from: "", to: "", city: "", consultant: "", status: "" });

  const changeView = (nextView: ViewMode) => {
    setView(nextView);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("managerReportsView", nextView);
    }
  };

  const exportCsv = () => {
    const lines = [
      ["Company", "Factory", "City", "Field Associate", "Status", "Created"],
      ...filteredRows.map((row) => [
        row.companyName,
        row.factoryName,
        row.city,
        row.consultantNames.join(" | ") || "Unassigned",
        row.status,
        row.createdAt,
      ]),
    ].map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));

    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    
    let fileNameParts = ["sim-kit-factory-report"];
    if (filters.city) {
      fileNameParts.push(filters.city.toLowerCase().replace(/\s+/g, "-"));
    } else {
      fileNameParts.push("all-cities");
    }
    if (filters.status) {
      fileNameParts.push(filters.status.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    }
    fileNameParts.push(new Date().toISOString().slice(0, 10));

    anchor.download = `${fileNameParts.join("-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportActivityPdf = async () => {
    const rowsToExport = view === "loginActivity" ? filteredLoginRows : filteredActivityRows;
    if (rowsToExport.length === 0) {
      toast.error("There are no activity log rows to export.");
      return;
    }
    setExportingPdf(true);
    try {
      const [{ jsPDF }] = await Promise.all([import("jspdf")]);
      const { logoDataUrl, watermarkDataUrl } = await getLogoImages();
      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const navy: [number, number, number] = [23, 58, 91];
      const ink: [number, number, number] = [31, 51, 71];
      const muted: [number, number, number] = [102, 120, 138];
      const border: [number, number, number] = [215, 224, 232];
      const marginX = 36;
      const tableWidth = pageWidth - marginX * 2;
      const cols = {
        no: marginX,
        date: marginX + 30,
        user: marginX + 118,
        company: marginX + 225,
        change: marginX + 395,
      };
      const rowHeight = 54;
      const firstRowY = 145;
      const headerRowY = 117;
      const headerRowHeight = 28;

      const addHeader = () => {
        doc.addImage(watermarkDataUrl, "PNG", pageWidth / 2 - 145, pageHeight / 2 - 145, 290, 290);
        doc.addImage(logoDataUrl, "PNG", marginX, 26, 42, 42);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...navy);
        doc.text("LimelightIT Research Pvt. Ltd.", marginX + 52, 43);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...muted);
        doc.text("Status change activity log", marginX + 52, 57);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.setTextColor(...navy);
        doc.text("ACTIVITY LOG REPORT", pageWidth / 2, 85, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...muted);
        doc.text(`Total Activities: ${rowsToExport.length}`, pageWidth / 2, 100, { align: "center" });
        doc.text(new Date().toLocaleDateString("en-IN"), pageWidth - marginX, 55, { align: "right" });

        doc.setFillColor(...navy);
        doc.roundedRect(marginX, headerRowY, tableWidth, headerRowHeight, 3, 3, "F");
        doc.setDrawColor(...border);
        doc.line(cols.date, headerRowY, cols.date, headerRowY + headerRowHeight);
        doc.line(cols.user, headerRowY, cols.user, headerRowY + headerRowHeight);
        doc.line(cols.company, headerRowY, cols.company, headerRowY + headerRowHeight);
        doc.line(cols.change, headerRowY, cols.change, headerRowY + headerRowHeight);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);
        doc.text("NO.", cols.no + 15, headerRowY + 18, { align: "center" });
        doc.text("DATE / TIME", cols.date + 8, headerRowY + 18);
        doc.text("USER", cols.user + 8, headerRowY + 18);
        doc.text("COMPANY / SITE", cols.company + 8, headerRowY + 18);
        doc.text("ACTIVITY", cols.change + 8, headerRowY + 18);
      };

      addHeader();
      let y = firstRowY;
      rowsToExport.forEach((row, index) => {
        if (y + rowHeight > pageHeight - 36) {
          doc.addPage();
          addHeader();
          y = firstRowY;
        }
        const changedAt = new Date(row.changedAt);
        const dateText = Number.isNaN(changedAt.getTime())
          ? row.changedAt
          : changedAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

        doc.setDrawColor(...border);
        doc.setLineWidth(0.55);
        doc.line(marginX, y + rowHeight, marginX + tableWidth, y + rowHeight);
        doc.line(cols.date, y, cols.date, y + rowHeight);
        doc.line(cols.user, y, cols.user, y + rowHeight);
        doc.line(cols.company, y, cols.company, y + rowHeight);
        doc.line(cols.change, y, cols.change, y + rowHeight);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.2);
        doc.setTextColor(...ink);
        doc.text(String(index + 1), cols.no + 15, y + 30, { align: "center" });
        doc.text(doc.splitTextToSize(dateText, 76).slice(0, 2), cols.date + 8, y + 22);
        doc.text(doc.splitTextToSize(row.userName, 92).slice(0, 2), cols.user + 8, y + 22);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...navy);
        doc.text(doc.splitTextToSize(row.companyName, 154).slice(0, 2), cols.company + 8, y + 20);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...muted);
        doc.text(doc.splitTextToSize(row.factoryName, 154).slice(0, 1), cols.company + 8, y + 42);
        doc.setTextColor(...ink);
        const activityText =
          row.activityType === "login" ? row.toStatus : `${row.fromStatus} -> ${row.toStatus}`;
        doc.text(doc.splitTextToSize(activityText, 120).slice(0, 2), cols.change + 8, y + 24);
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

      doc.save(`${view === "loginActivity" ? "last-login-activity" : "activity-log"}-report-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success("Activity log PDF exported successfully.");
    } catch (error) {
      console.error(error);
      toast.error("Could not create the activity log PDF.");
    } finally {
      setExportingPdf(false);
    }
  };

  const exportPdf = async () => {
    if (view === "activity" || view === "loginActivity") {
      await exportActivityPdf();
      return;
    }
    if (filteredRows.length === 0) {
      toast.error("There are no report rows to export.");
      return;
    }
    setExportingPdf(true);
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const lime: [number, number, number] = [200, 255, 74];
      const ink: [number, number, number] = [18, 18, 29];
      const muted: [number, number, number] = [104, 101, 119];
      const soft: [number, number, number] = [244, 245, 239];
      const generatedAt = new Intl.DateTimeFormat("en-IN", {
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date());

      const addBrand = (section?: string) => {
        doc.setFillColor(...ink);
        doc.rect(0, 0, pageWidth, 14, "F");
        doc.setFillColor(...lime);
        doc.roundedRect(12, 4, 6, 6, 1.2, 1.2, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(240, 236, 227);
        doc.text("SIM-KIT OPS", 22, 9);
        
        const cityText = `CITY: ${filters.city ? filters.city.toUpperCase() : "ALL CITIES"}`;
        const headerText = section ? `${section.toUpperCase()} | ${cityText}` : cityText;

        doc.setFont("helvetica", "normal");
        doc.setTextColor(175, 172, 184);
        doc.text(headerText, pageWidth - 12, 9, { align: "right" });
      };

      const addSectionPage = (number: string, title: string, description: string) => {
        doc.addPage();
        doc.setFillColor(...ink);
        doc.rect(0, 0, pageWidth, pageHeight, "F");
        doc.setFillColor(...lime);
        doc.rect(0, 0, 7, pageHeight, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.setTextColor(...lime);
        doc.text(number, 24, 56);
        doc.setFontSize(34);
        doc.setTextColor(240, 236, 227);
        doc.text(title.toUpperCase(), 24, 77);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.setTextColor(155, 151, 166);
        doc.text(description, 24, 90);
      };

      const addGroupedTables = (section: string, groups: Array<[string, FactoryRow[]]>) => {
        doc.addPage();
        addBrand(section);
        let y = 25;
        groups.forEach(([groupName, groupRows], index) => {
          if (index > 0 && y > 146) {
            doc.addPage();
            addBrand(section);
            y = 25;
          }
          doc.setFont("helvetica", "bold");
          doc.setFontSize(14);
          doc.setTextColor(...ink);
          doc.text(groupName, 12, y);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(...muted);
          doc.text(
            `${groupRows.length} ${groupRows.length === 1 ? "factory" : "factories"}`,
            pageWidth - 12,
            y,
            { align: "right" },
          );

          autoTable(doc, {
            startY: y + 5,
            margin: { left: 12, right: 12, top: 20, bottom: 14 },
            head: [["Company", "Factory", "City", "Field Associate", "Status"]],
            body: groupRows.map((row) => [
              row.companyName,
              row.factoryName,
              row.city,
              row.consultantNames.join(", ") || "Unassigned",
              row.status,
            ]),
            theme: "grid",
            styles: {
              font: "helvetica",
              fontSize: 8,
              cellPadding: 2.5,
              lineColor: [225, 226, 220],
              lineWidth: 0.2,
              textColor: ink,
              overflow: "linebreak",
            },
            headStyles: { fillColor: ink, textColor: [240, 236, 227], fontStyle: "bold" },
            alternateRowStyles: { fillColor: soft },
            columnStyles: {
              0: { cellWidth: 58 },
              1: { cellWidth: 65 },
              2: { cellWidth: 31 },
              3: { cellWidth: 61 },
              4: { cellWidth: 47 },
            },
            didDrawPage: () => addBrand(section),
          });
          y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
        });
      };

      // Cover and executive summary.
      doc.setFillColor(...ink);
      doc.rect(0, 0, pageWidth, pageHeight, "F");
      doc.setFillColor(...lime);
      doc.rect(0, 0, 8, pageHeight, "F");
      doc.roundedRect(24, 24, 8, 8, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(...lime);
      doc.text("SIM-KIT OPS / MANAGEMENT REPORT", 38, 30);
      doc.setFontSize(34);
      doc.setTextColor(240, 236, 227);
      doc.text("FACTORY OPERATIONS", 24, 67);
      doc.text("REPORT", 24, 82);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(155, 151, 166);
      doc.text(`Generated: ${generatedAt}`, 24, 93);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...lime);
      doc.text(`CITY: ${filters.city ? filters.city.toUpperCase() : "ALL CITIES"}`, 24, 100);

      const metrics = [
        ["FACTORIES", summary.total],
        ["COMPANIES", summary.companies],
        ["COMPLETED", summary.completed],
        ["PENDING", summary.pending],
        ["AWAITING", summary.awaiting],
      ] as const;
      metrics.forEach(([label, value], index) => {
        const x = 24 + index * 51;
        doc.setFillColor(29, 29, 43);
        doc.roundedRect(x, 122, 45, 35, 2, 2, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(19);
        doc.setTextColor(index === 2 ? 61 : 240, index === 2 ? 255 : 236, index === 2 ? 192 : 227);
        doc.text(String(value), x + 5, 138);
        doc.setFontSize(7);
        doc.setTextColor(155, 151, 166);
        doc.text(label, x + 5, 149);
      });

      const cityGroups = groupReportRows(filteredRows, (row) => row.city);
      const orderedStatusGroups = STATUS_OPTIONS.map(
        (status) =>
          [status, filteredRows.filter((row) => row.status === status)] as [string, FactoryRow[]],
      ).filter(([, groupRows]) => groupRows.length > 0);
      const knownStatuses = new Set<string>(STATUS_OPTIONS);
      const otherStatusGroups = groupReportRows(
        filteredRows.filter((row) => !knownStatuses.has(row.status)),
        (row) => row.status,
      );
      const statusGroups = [...orderedStatusGroups, ...otherStatusGroups];
      const associateGroups = consultantGroups.map(
        ([, group]) => [group.name, group.rows] as [string, FactoryRow[]],
      );

      addSectionPage("01", "City pages", "Factory operations grouped geographically by city.");
      addGroupedTables("City breakdown", cityGroups);
      addSectionPage("02", "Status pages", "Factories grouped by their current management status.");
      addGroupedTables("Status breakdown", statusGroups);
      addSectionPage(
        "03",
        "Field Associate pages",
        "Assignments and workload grouped by field associate.",
      );
      addGroupedTables("Field Associate breakdown", associateGroups);

      const totalPages = doc.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(125, 122, 137);
        doc.text("CONFIDENTIAL - INTERNAL OPERATIONS", 12, pageHeight - 7);
        doc.text(`${page} / ${totalPages}`, pageWidth - 12, pageHeight - 7, { align: "right" });
      }

      let pdfFileNameParts = ["sim-kit-factory-report"];
      if (filters.city) {
        pdfFileNameParts.push(filters.city.toLowerCase().replace(/\s+/g, "-"));
      } else {
        pdfFileNameParts.push("all-cities");
      }
      if (filters.status) {
        pdfFileNameParts.push(filters.status.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      }
      pdfFileNameParts.push(new Date().toISOString().slice(0, 10));

      const finalPdfName = `${pdfFileNameParts.join("-")}.pdf`;
      doc.save(finalPdfName);
      toast.success("PDF report exported successfully.");
    } catch (error) {
      console.error(error);
      toast.error("Could not create the PDF report.");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-lime/80">
            Management Dashboard
          </p>
          <h1 className="mt-2 text-4xl uppercase tracking-tight font-extrabold">Report and Logs</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => changeView("company")} variant={view === "company" || view === "consultant" ? "primary" : "secondary"}>
            <Building2 size={16} strokeWidth={1.5} />
            Factory Report
          </Button>
          <Button onClick={() => changeView("activity")} variant={view === "activity" ? "primary" : "secondary"}>
            <Clock3 size={16} strokeWidth={1.5} />
            Activity Log
          </Button>
          <Button onClick={() => changeView("loginActivity")} variant={view === "loginActivity" ? "primary" : "secondary"}>
            <LogIn size={16} strokeWidth={1.5} />
            Last Login Activity Track
          </Button>
          <Button onClick={() => void exportPdf()} disabled={exportingPdf}>
            <FileText size={16} strokeWidth={1.5} />
            {exportingPdf
              ? "Building PDF..."
              : view === "activity" || view === "loginActivity"
                ? "Print Activity PDF"
                : "Export PDF"}
          </Button>
          {view !== "activity" && view !== "loginActivity" && (
            <Button onClick={exportCsv} variant="secondary">
              <Download size={16} strokeWidth={1.5} /> Export CSV
            </Button>
          )}
        </div>
      </header>

      {(view === "activity" || view === "loginActivity") && (
      <section className="rounded-[10px] border border-border bg-surface p-5 space-y-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
          <Input
            className="pl-10"
            placeholder={
              view === "loginActivity"
                ? "Search date, user or login status..."
                : "Search date, user, company, site or activity..."
            }
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>From</Label>
            <Input
              type="date"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </div>
          <div>
            <Label>To</Label>
            <Input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </div>
        </div>
        {Object.values(filters).some(Boolean) && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={clearFilters}
              className="font-mono text-[10px] uppercase tracking-wider text-coral hover:opacity-70"
            >
              Clear all filters
            </button>
          </div>
        )}
      </section>
      )}

      {view !== "activity" && view !== "loginActivity" && (
      <section className="rounded-[10px] border border-border bg-surface p-5 space-y-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
          <Input
            className="pl-10"
            placeholder="Search company, factory, city, Field Associate or status…"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <FilterSelect
            label="City"
            value={filters.city}
            onChange={(city) => setFilters({ ...filters, city })}
            options={cities}
          />
          <div>
            <Label>Field Associate</Label>
            <Select
              value={filters.consultant}
              onChange={(event) => setFilters({ ...filters, consultant: event.target.value })}
            >
              <option value="">All Field Associates</option>
              {consultants.map((consultant) => (
                <option key={consultant.id} value={consultant.id}>
                  {consultant.name || consultant.mobile || "Unnamed"}
                </option>
              ))}
            </Select>
          </div>
          <FilterSelect
            label="Status"
            value={filters.status}
            onChange={(status) => setFilters({ ...filters, status })}
            options={STATUS_OPTIONS}
          />
          <div>
            <Label>From</Label>
            <Input
              type="date"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </div>
          <div>
            <Label>To</Label>
            <Input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </div>
        </div>
        {Object.values(filters).some(Boolean) && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={clearFilters}
              className="font-mono text-[10px] uppercase tracking-wider text-coral hover:opacity-70"
            >
              Clear all filters
            </button>
          </div>
        )}
      </section>
      )}

      {view !== "activity" && view !== "loginActivity" && (
        <div className="flex w-full max-w-xl rounded-[8px] border border-border bg-surface p-1">
          <ViewButton
            active={view === "company"}
            icon={Building2}
            label="Company-wise"
            onClick={() => changeView("company")}
          />
          <ViewButton
            active={view === "consultant"}
            icon={UserRound}
            label="Field Associate-wise"
            onClick={() => changeView("consultant")}
          />
        </div>
      )}

      {loading ? (
        <div className="rounded-[10px] border border-border bg-surface px-6 py-16 text-center text-text-dim">
          Loading factory data…
        </div>
      ) : view === "activity" ? (
        <ActivityLogView rows={filteredActivityRows} title="Activity Log" emptyMessage="No activity has been recorded yet." />
      ) : view === "loginActivity" ? (
        <ActivityLogView rows={filteredLoginRows} title="Last Login Activity Track" emptyMessage="No login activity has been recorded yet." />
      ) : view === "company" ? (
        <GroupedView
          groups={companyGroups.map(([name, groupRows]) => ({ name, rows: groupRows }))}
          emptyMessage="No companies match the selected filters."
          showCompany={false}
        />
      ) : (
        <GroupedView
          groups={consultantGroups.map(([, group]) => group)}
          emptyMessage="No Field Associates or factories match the selected filters."
          showCompany
        />
      )}
    </div>
  );
}

const LOG_PAGE_SIZE = 100;

function ActivityLogView({
  rows,
  title,
  emptyMessage,
}: {
  rows: ActivityRow[];
  title: string;
  emptyMessage: string;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / LOG_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = rows.slice((currentPage - 1) * LOG_PAGE_SIZE, currentPage * LOG_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="rounded-[10px] border border-border bg-surface px-6 py-16 text-center text-text-dim">
        {emptyMessage}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-[12px] border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-raised/60 px-5 py-4">
        <div>
          <h2 className="text-[15px] font-extrabold text-text-primary tracking-tight">
            {title}
          </h2>
          <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-text-secondary">
            {rows.length} {rows.length === 1 ? "record" : "records"}
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr className="bg-surface-raised/30 text-left font-mono text-[9px] uppercase tracking-widest text-text-secondary">
              <th className="px-5 py-3">Date / Time</th>
              <th className="px-5 py-3">User</th>
              <th className="px-5 py-3">Company / Site</th>
              <th className="px-5 py-3">Activity</th>
              <th className="px-5 py-3">Result</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => {
              const changedAt = new Date(row.changedAt);
              const displayDate = Number.isNaN(changedAt.getTime())
                ? row.changedAt
                : changedAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
              return (
                <tr
                  key={row.id}
                  className={`border-b border-border/60 last:border-0 transition-colors hover:bg-surface-raised/30 ${
                    index % 2 === 0 ? "" : "bg-surface-raised/10"
                  }`}
                >
                  <td className="px-5 py-3 font-mono text-[11px] text-text-secondary">
                    {displayDate}
                  </td>
                  <td className="px-5 py-3 font-semibold text-text-primary">{row.userName}</td>
                  <td className="px-5 py-3">
                    <div className="font-bold text-text-primary text-[13px] leading-tight">
                      {row.companyName}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-text-dim">
                      {row.factoryName} - {row.city}
                    </div>
                  </td>
                  <td className="px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                    {row.activityType === "login" ? "Login" : row.fromStatus}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-[5px] border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider ${statusStyle(row.toStatus)}`}>
                      {row.toStatus}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-raised/40 px-5 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
            Showing {(currentPage - 1) * LOG_PAGE_SIZE + 1}-
            {Math.min(currentPage * LOG_PAGE_SIZE, rows.length)} of {rows.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="px-3 py-1 text-xs"
              disabled={currentPage === 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </Button>
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
              Page {currentPage} / {totalPages}
            </span>
            <Button
              variant="secondary"
              className="px-3 py-1 text-xs"
              disabled={currentPage === totalPages}
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Factory;
  label: string;
  value: number;
  tone: "lime" | "violet" | "mint" | "stone" | "warning";
}) {
  const tones = {
    lime: "text-lime bg-lime/10",
    violet: "text-violet bg-violet/10",
    mint: "text-mint bg-mint-dim",
    stone: "text-text-secondary bg-surface-raised",
    warning: "text-warning bg-warning/10",
  };
  return (
    <div className="rounded-[10px] border border-border bg-surface p-4">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-[7px] ${tones[tone]}`}>
        <Icon size={18} strokeWidth={1.8} />
      </div>
      <div className="text-2xl font-extrabold text-text-primary">{value}</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-widest text-text-secondary">
        {label}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All {label}s</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </div>
  );
}

function ViewButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Building2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-[6px] px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors ${
        active ? "bg-lime text-primary-foreground" : "text-text-secondary hover:text-text-primary"
      }`}
    >
      <Icon size={15} /> {label}
    </button>
  );
}

function GroupedView({
  groups,
  emptyMessage,
  showCompany,
}: {
  groups: Array<{ name: string; rows: FactoryRow[] }>;
  emptyMessage: string;
  showCompany: boolean;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-[10px] border border-border bg-surface px-6 py-16 text-center text-text-dim">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const completed = group.rows.filter((row) => isCompletedStatus(row.status)).length;
        const awaiting = group.rows.filter((row) => isAwaitingStatus(row.status)).length;
        const pending = group.rows.filter((row) => isPendingStatus(row.status)).length;
        return (
          <section
            key={group.name}
            className="overflow-hidden rounded-[12px] border border-border bg-surface shadow-sm"
          >
            {/* Group Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-raised/60 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-lime/10 border border-lime/20">
                  <Building2 size={16} className="text-lime" strokeWidth={2} />
                </div>
                <div>
                  <h2 className="text-[15px] font-extrabold text-text-primary tracking-tight leading-tight">
                    {group.name}
                  </h2>
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-text-secondary">
                    {group.rows.length} {group.rows.length === 1 ? "site" : "sites"} registered
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {completed > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-mint-dim border border-mint/20 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-mint">
                    <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                    {completed} done
                  </span>
                )}
                {awaiting > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 border border-warning/20 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-warning">
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                    {awaiting} awaiting
                  </span>
                )}
                {pending > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-raised border border-border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-text-secondary">
                    <span className="h-1.5 w-1.5 rounded-full bg-text-dim" />
                    {pending} pending
                  </span>
                )}
              </div>
            </div>
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr className="text-left font-mono text-[9px] uppercase tracking-widest text-text-secondary bg-surface-raised/30">
                    {showCompany && <th className="px-5 py-3">Company</th>}
                    <th className="px-5 py-3">Factory / Site Name</th>
                    <th className="px-5 py-3">City</th>
                    {!showCompany && <th className="px-5 py-3">Field Associate</th>}
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, idx) => (
                    <tr
                      key={row.id}
                      className={`border-b border-border/60 last:border-0 transition-colors hover:bg-surface-raised/30 ${
                        idx % 2 === 0 ? "" : "bg-surface-raised/10"
                      }`}
                    >
                      {showCompany && (
                        <td className="px-5 py-3">
                          <span className="font-semibold text-text-primary text-[13px]">{row.companyName}</span>
                        </td>
                      )}
                      <td className="px-5 py-3">
                        <div className="font-bold text-text-primary text-[13px] leading-tight">{row.factoryName}</div>
                        {showCompany && row.factoryName !== row.companyName && (
                          <div className="text-[10px] text-text-dim font-mono mt-0.5">{row.companyName}</div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-1.5 text-text-secondary text-[12px]">
                          {row.city}
                        </span>
                      </td>
                      {!showCompany && (
                        <td className="px-5 py-3">
                          {row.consultantNames.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {row.consultantNames.map((name, i) => (
                                <span key={i} className="inline-flex items-center gap-1 rounded-[5px] bg-surface-raised border border-border px-2 py-0.5 text-[10px] font-semibold text-text-primary">
                                  {name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-text-dim italic text-[11px]">Unassigned</span>
                          )}
                        </td>
                      )}
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex rounded-[5px] border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider ${statusStyle(row.status)}`}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
