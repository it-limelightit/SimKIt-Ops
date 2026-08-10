import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Input, Label, Select } from "@/components/ui-kit";
import { parseSiteMetadata } from "@/lib/site-metadata";
import {
  Building2,
  CheckCircle2,
  Clock3,
  Download,
  Factory,
  FileText,
  Search,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

type ViewMode = "company" | "consultant";

type Consultant = {
  id: string;
  name: string | null;
  mobile: string | null;
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

const STATUS_OPTIONS = [
  "Assessed",
  "Panel Dispatched",
  "Installed",
  "Commissioned",
  "Submitted",
  "Unsubmitted",
  "Certification Pending",
  "Dropped / Rejected",
] as const;

const isCompletedStatus = (status: string) => status === "Submitted";
const isPendingStatus = (status: string) =>
  ["Pending Assignment", "Assigned", "Assessed", "Panel Dispatched", "Installed", "Commissioned", "Unsubmitted"].includes(status);
const isAwaitingStatus = (status: string) => status === "Certification Pending";

function statusStyle(status: string) {
  if (status === "Submitted") return "border-emerald-250 bg-emerald-50 text-emerald-700";
  if (status === "Dropped / Rejected") return "border-red-200 bg-red-50 text-red-700";
  if (status === "Certification Pending") return "border-purple-200 bg-purple-50 text-purple-700";
  if (status === "Commissioned") return "border-teal-250 bg-teal-50 text-teal-700";
  if (status === "Installed") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (status === "Panel Dispatched" || status === "Assessed") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "Assigned") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (status === "Pending Assignment") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-stone-200 bg-stone-50 text-stone-600";
}

function groupReportRows(rows: FactoryRow[], key: (row: FactoryRow) => string) {
  const groups = new Map<string, FactoryRow[]>();
  rows.forEach((row) => {
    const groupName = key(row) || "Unspecified";
    groups.set(groupName, [...(groups.get(groupName) ?? []), row]);
  });
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

const ASSESSMENT_KEYS = ["mom_uploaded", "media_uploaded", "factory_operations_done"];
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
  const [view, setView] = useState<ViewMode>("company");
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
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
        ] = await Promise.all([
          supabase
            .from("sites")
            .select(
              "id,name,company_name,city,assigned_worker_id,task_notes,consultant_stage,created_at",
            )
            .order("created_at", { ascending: false }),
          supabase.from("profiles").select("id,name,mobile").order("name"),
          supabase.from("assessment").select("data,updated_at,site_id"),
          supabase.from("installation").select("data,updated_at,site_id"),
          supabase.from("commissioning").select("data,updated_at,site_id"),
          supabase
            .from("inventory_materials")
            .select("state,notes,submitted,material_name,created_at")
            .order("created_at", { ascending: false }),
          supabase.from("user_roles").select("user_id").eq("role", "worker"),
        ]);

        if (siteResult.error)
          toast.error("Could not load factory report: " + siteResult.error.message);
        if (consultantResult.error)
          toast.error("Could not load business consultants: " + consultantResult.error.message);

        setSites(siteResult.data ?? []);
        const workerIds = new Set((rolesRes.data ?? []).map((r: any) => r.user_id));
        setConsultants((consultantResult.data ?? []).filter((c: any) => workerIds.has(c.id)));
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

      const isSiteSubmitted = (row: any) => {
        if (row.consultant_stage === "Completion" || row.consultant_stage === "Billing") return true;
        const ar = aMap.get(row.id);
        return !!ar?.data?.assessment_phase_submitted;
      };

      const isSiteCertification = (row: any) => {
        const ar = aMap.get(row.id);
        const cr = cMap.get(row.id);
        const hasCert = !!(cr?.data?.certificate_sent || ar?.data?.certificate_sent);
        return hasCert;
      };

      const isSiteCommissioned = (row: any) => {
        const cr = cMap.get(row.id);
        const cP = pctKeys(cr?.data, COMMISSIONING_KEYS);
        return cP === 100;
      };

      const isSiteInstalled = (row: any) => {
        const ir = iMap.get(row.id);
        const iP = pctKeys(ir?.data, INSTALLATION_KEYS);
        return iP === 100;
      };

      const isSiteAssessment = (row: any) => {
        const ar = aMap.get(row.id);
        const aP = pctKeys(ar?.data, ASSESSMENT_KEYS);
        return aP > 0;
      };

      const isSiteDropped = (row: any) => {
        const meta = parseSiteMetadata(row.task_notes);
        return meta.status === "Dropped / Rejected" || meta.status === "Reject";
      };

      const getCanonicalStatus = (row: any, logisticsStatus: string): string => {
        const meta = parseSiteMetadata(row.task_notes);
        const workerIds = getSiteWorkerIds(row);

        if (meta.status === "Dropped / Rejected" || meta.status === "Reject") return "Dropped / Rejected";
        if (meta.status === "Submitted") return "Submitted";
        if (meta.status === "Certification Pending") return "Certification Pending";
        if (meta.status === "Commissioned") return "Commissioned";
        if (meta.status === "Installed") return "Installed";
        if (meta.status === "Panel Dispatched") return "Panel Dispatched";
        if (meta.status === "Assessed" || meta.status === "In Assessment") return "Assessed";
        if (meta.status === "Unsubmitted") return "Unsubmitted";

        if (logisticsStatus === "Delivered") return "Panel Dispatched";

        if (row.consultant_stage === "Completion" || row.consultant_stage === "Billing") return "Submitted";
        if (isSiteSubmitted(row)) {
          return isSiteCertification(row) ? "Submitted" : "Certification Pending";
        }
        if (isSiteCommissioned(row)) return "Commissioned";
        if (isSiteInstalled(row)) return "Installed";
        if (isSiteAssessment(row)) return "Assessed";
        if (isSiteDropped(row)) return "Dropped / Rejected";

        if (workerIds.length > 0) return "Assigned";
        if (workerIds.length === 0) return "Pending Assignment";

        return "Unsubmitted";
      };

      return sites.map((site) => {
        const consultantIds = getSiteWorkerIds(site);

        // Logistics matching
        const matchingMaterial = materials.find((m) => {
          if (m.submitted === false) return false;
          const normMat = normalizeCompanyName(m.material_name);
          const normComp = normalizeCompanyName(site.company_name);
          const normName = normalizeCompanyName(site.name);
          return normMat === normComp || normMat === normName;
        });
        const logisticsStatus = matchingMaterial ? getLogisticsStatus(matchingMaterial) : "Pending";

        const canonicalStatus = getCanonicalStatus(site, logisticsStatus);

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

  const cities = useMemo(
    () => Array.from(new Set(rows.map((row) => row.city).filter((city) => city !== "—"))).sort(),
    [rows],
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

  const exportCsv = () => {
    const lines = [
      ["Company", "Factory", "City", "Business Associate", "Status", "Created"],
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

  const exportPdf = async () => {
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
            head: [["Company", "Factory", "City", "Business Consultant", "Status"]],
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
        "Business consultant pages",
        "Assignments and workload grouped by business consultant.",
      );
      addGroupedTables("Business consultant breakdown", associateGroups);

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
          <h1 className="mt-2 text-4xl uppercase tracking-tight font-extrabold">Factory Reports</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void exportPdf()} disabled={exportingPdf}>
            <FileText size={16} strokeWidth={1.5} />
            {exportingPdf ? "Building PDF…" : "Export PDF"}
          </Button>
          <Button onClick={exportCsv} variant="secondary">
            <Download size={16} strokeWidth={1.5} /> Export CSV
          </Button>
        </div>
      </header>

      <section className="rounded-[10px] border border-border bg-surface p-5 space-y-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
          <Input
            className="pl-10"
            placeholder="Search company, factory, city, consultant or status…"
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
            <Label>Business Consultant</Label>
            <Select
              value={filters.consultant}
              onChange={(event) => setFilters({ ...filters, consultant: event.target.value })}
            >
              <option value="">All Consultants</option>
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

      <div className="flex w-full max-w-xl rounded-[8px] border border-border bg-surface p-1">
        <ViewButton
          active={view === "company"}
          icon={Building2}
          label="Company-wise"
          onClick={() => setView("company")}
        />
        <ViewButton
          active={view === "consultant"}
          icon={UserRound}
          label="Consultant-wise"
          onClick={() => setView("consultant")}
        />
      </div>

      {loading ? (
        <div className="rounded-[10px] border border-border bg-surface px-6 py-16 text-center text-text-dim">
          Loading factory data…
        </div>
      ) : view === "company" ? (
        <GroupedView
          groups={companyGroups.map(([name, groupRows]) => ({ name, rows: groupRows }))}
          emptyMessage="No companies match the selected filters."
          showCompany={false}
        />
      ) : (
        <GroupedView
          groups={consultantGroups.map(([, group]) => group)}
          emptyMessage="No consultants or factories match the selected filters."
          showCompany
        />
      )}
    </div>
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
                    {!showCompany && <th className="px-5 py-3">Consultant</th>}
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
