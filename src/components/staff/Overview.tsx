import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui-kit";
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
  Sun,
  Moon,
} from "lucide-react";

type Appt = {
  status: "early" | "late" | "ontime" | "scheduled" | "none";
  scheduled: string | null;
  completed: string | null;
};

type SiteRow = {
  id: string;
  name: string;
  city: string | null;
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
};

const ASSESSMENT_KEYS = [
  "factory_call_done",
  "third_party_call_done",
  "appointment_saved",
  "facility_visit_done",
  "explanation_saved",
  "contacts_done",
  "floor_visit_done",
  "business_profile_saved",
  "machines_done",
  "mom_uploaded",
  "media_uploaded",
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

function parseSiteMetadata(taskNotes: string | null) {
  if (!taskNotes) return { status: "", c1_name: "", c1_mobile: "", c1_email: "", worker_ids: [] as string[] };
  const prefix = "[METADATA:";
  const idx = taskNotes.indexOf(prefix);
  if (idx === -1) return { status: "", c1_name: "", c1_mobile: "", c1_email: "", worker_ids: [] as string[] };
  const start = idx + prefix.length;
  let depth = 0;
  for (let i = start; i < taskNotes.length; i++) {
    if (taskNotes[i] === "{") depth++;
    else if (taskNotes[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(taskNotes.slice(start, i + 1));
        } catch {
          return { status: "", c1_name: "", c1_mobile: "", c1_email: "", worker_ids: [] as string[] };
        }
      }
    }
  }
  return { status: "", c1_name: "", c1_mobile: "", c1_email: "", worker_ids: [] as string[] };
}

function getSiteWorkerIds(site: any): string[] {
  const meta = parseSiteMetadata(site.task_notes);
  if (meta.worker_ids && Array.isArray(meta.worker_ids) && meta.worker_ids.length > 0) return meta.worker_ids;
  if (site.assigned_worker_id) return [site.assigned_worker_id];
  return [];
}

export function Overview() {
  const [rawSites, setRawSites] = useState<any[]>([]);
  const [rawAssessments, setRawAssessments] = useState<any[]>([]);
  const [rawInstallations, setRawInstallations] = useState<any[]>([]);
  const [rawCommissionings, setRawCommissionings] = useState<any[]>([]);
  const [rawProfiles, setRawProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Initialize theme from localStorage or default to "light" for the requested white theme
  const [themeMode, setThemeMode] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("themeMode");
      return (stored === "dark" || stored === "light") ? stored : "light";
    }
    return "light";
  });

  // Apply root theme class on mount and when theme changes
  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === "light") {
      root.classList.add("light-theme");
    } else {
      root.classList.remove("light-theme");
    }
    localStorage.setItem("themeMode", themeMode);
  }, [themeMode]);

  // Filter States
  const [selectedKpi, setSelectedKpi] = useState<string>("assigned");
  const [cityFilter, setCityFilter] = useState("");
  const [executiveFilter, setExecutiveFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Sort States
  const [sortField, setSortField] = useState<"name" | "city" | "updated">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;

  const loadData = async () => {
    setLoading(true);
    try {
      const [sitesRes, assessmentsRes, installationsRes, commissioningsRes, profilesRes] = await Promise.all([
        supabase
          .from("sites")
          .select("id,name,city,assigned_worker_id,assigned_at,appt_date,appt_time,created_at,task_notes,consultant_stage")
          .order("created_at", { ascending: false }),
        supabase.from("assessment").select("data,updated_at,site_id"),
        supabase.from("installation").select("data,updated_at,site_id"),
        supabase.from("commissioning").select("data,updated_at,site_id"),
        supabase.from("profiles").select("id,name,mobile,is_active").order("created_at"),
      ]);

      setRawSites(sitesRes.data ?? []);
      setRawAssessments(assessmentsRes.data ?? []);
      setRawInstallations(installationsRes.data ?? []);
      setRawCommissionings(commissioningsRes.data ?? []);
      setRawProfiles(profilesRes.data ?? []);
    } catch (err) {
      console.error("Error fetching overview metrics:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Process data rows
  const profileNameMap = new Map<string, string>();
  rawProfiles.forEach((p) => {
    profileNameMap.set(p.id, p.name || p.mobile || "—");
  });

  const aMap = new Map<string, any>(rawAssessments.map((r) => [r.site_id, r]));
  const iMap = new Map<string, any>(rawInstallations.map((r) => [r.site_id, r]));
  const cMap = new Map<string, any>(rawCommissionings.map((r) => [r.site_id, r]));

  const allProcessedRows: SiteRow[] = rawSites.map((site) => {
    const ar = aMap.get(site.id);
    const ir = iMap.get(site.id);
    const cr = cMap.get(site.id);
    const meta = parseSiteMetadata(site.task_notes);

    const isFullyDone = site.consultant_stage === "Completion" || site.consultant_stage === "Billing";

    const aP = isFullyDone || ar?.data?.assessment_phase_submitted ? 100 : pctKeys(ar?.data, ASSESSMENT_KEYS);
    const iP = isFullyDone ? 100 : pctKeys(ir?.data, INSTALLATION_KEYS);
    const cP = isFullyDone ? 100 : pctKeys(cr?.data, COMMISSIONING_KEYS);
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

    return {
      id: site.id,
      name: site.name,
      city: site.city,
      assigned_worker_id: site.assigned_worker_id,
      assigned_at: site.assigned_at,
      appt_date: site.appt_date,
      appt_time: site.appt_time,
      task_notes: site.task_notes,
      consultant_stage: site.consultant_stage,
      progress: { a: aP, i: iP, c: cP, updated, appt },
      workerIds,
      meta: {
        status: meta.status || "",
        c1_name: meta.c1_name || "",
        c1_mobile: meta.c1_mobile || "",
        c1_email: meta.c1_email || "",
      },
    };
  });

  // KPI Category Helpers
  const isSiteSubmitted = (row: SiteRow) => {
    if (row.consultant_stage === "Completion" || row.consultant_stage === "Billing") return true;
    const ar = aMap.get(row.id);
    return !!ar?.data?.assessment_phase_submitted;
  };

  const isSiteCertification = (row: SiteRow) => {
    if (row.consultant_stage === "Completion" || row.consultant_stage === "Billing") return true;
    const cr = cMap.get(row.id);
    return !!cr?.data?.certificate_sent;
  };

  const isSiteAssessment = (row: SiteRow) => {
    const stage = (row.consultant_stage || row.meta.status || "").toLowerCase();
    const hasStartedAssessment = row.progress.a > 0 && row.progress.a < 100;
    return stage.includes("assessment") || hasStartedAssessment;
  };

  const isSiteDropped = (row: SiteRow) => {
    const stage = (row.consultant_stage || row.meta.status || "").toLowerCase();
    return stage.includes("drop") || stage.includes("reject");
  };

  const getCanonicalStatus = (row: SiteRow): string => {
    if (isSiteDropped(row)) return "Dropped / Rejected";
    if (row.consultant_stage === "Completion" || row.consultant_stage === "Billing") return "Submitted";
    if (row.workerIds.length === 0) return "Pending Assignment";
    if (isSiteSubmitted(row)) {
      return isSiteCertification(row) ? "Submitted" : "Certification Pending";
    }
    if (isSiteAssessment(row)) return "In Assessment";
    return "Unsubmitted";
  };

  // Dropdown list options
  const cities = Array.from(new Set(allProcessedRows.map((r) => r.city).filter(Boolean))).sort() as string[];
  const executives = rawProfiles.filter((p) => p.is_active);

  // Apply filters for counting
  const filteredForCounts = allProcessedRows.filter((row) => {
    if (cityFilter && row.city !== cityFilter) return false;
    if (executiveFilter && !row.workerIds.includes(executiveFilter)) return false;
    return true;
  });

  // Calculate counts based on current filters and canonical status partitioning
  const countTotal = filteredForCounts.length; // First card represents total companies count
  const countPending = filteredForCounts.filter((r) => getCanonicalStatus(r) === "Pending Assignment").length;
  const countSubmitted = filteredForCounts.filter((r) => getCanonicalStatus(r) === "Submitted").length;
  const countUnsubmitted = filteredForCounts.filter((r) => getCanonicalStatus(r) === "Unsubmitted").length;
  const countCertification = filteredForCounts.filter((r) => getCanonicalStatus(r) === "Certification Pending").length;
  const countAssessment = filteredForCounts.filter((r) => getCanonicalStatus(r) === "In Assessment").length;
  const countDropped = filteredForCounts.filter((r) => getCanonicalStatus(r) === "Dropped / Rejected").length;

  // Apply selected KPI filter to table
  const filteredByKpi = filteredForCounts.filter((row) => {
    if (selectedKpi === "assigned") return true; // Show total companies list
    const status = getCanonicalStatus(row);
    switch (selectedKpi) {
      case "submitted":
        return status === "Submitted";
      case "unsubmitted":
        return status === "Unsubmitted";
      case "certification":
        return status === "Certification Pending";
      case "pending":
        return status === "Pending Assignment";
      case "assessment":
        return status === "In Assessment";
      case "dropped":
        return status === "Dropped / Rejected";
      default:
        return true;
    }
  });

  // Apply search query
  const searchQueryLower = searchQuery.toLowerCase();
  const searchedRows = filteredByKpi.filter((row) => {
    if (!searchQuery) return true;
    const name = row.name.toLowerCase();
    const city = (row.city || "").toLowerCase();
    const status = getCanonicalStatus(row).toLowerCase();
    const cName = row.meta.c1_name.toLowerCase();
    const cPhone = row.meta.c1_mobile.toLowerCase();

    const workerNames = row.workerIds.map((id) => (profileNameMap.get(id) || "").toLowerCase());
    const matchWorkers = workerNames.some((wName) => wName.includes(searchQueryLower));

    return (
      name.includes(searchQueryLower) ||
      city.includes(searchQueryLower) ||
      status.includes(searchQueryLower) ||
      cName.includes(searchQueryLower) ||
      cPhone.includes(searchQueryLower) ||
      matchWorkers
    );
  });

  // Apply Sorting
  const sortedRows = [...searchedRows].sort((a, b) => {
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
  }, [selectedKpi, cityFilter, executiveFilter, searchQuery, sortField, sortOrder]);

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
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getStatusBadge = (status: string) => {
    let toneClass = "bg-stone-50 text-stone-600 border-stone-200";
    if (status === "Submitted") {
      toneClass = "bg-emerald-50 text-emerald-700 border-emerald-250";
    } else if (status === "Dropped / Rejected") {
      toneClass = "bg-red-50 text-red-700 border-red-200";
    } else if (status === "Pending Assignment" || status === "In Assessment" || status === "Unsubmitted" || status === "Certification Pending") {
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
      desc: "Assessment submission pending",
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
      desc: "Awaiting consultant assignment",
      icon: UserMinus,
      badgeStyle: "text-amber-600 bg-amber-50 border-amber-200",
      dotStyle: "bg-amber-500",
    },
    {
      id: "assessment",
      label: "In Assessment",
      value: countAssessment,
      desc: "Currently undergoing assessment",
      icon: ClipboardList,
      badgeStyle: "text-teal-600 bg-teal-50 border-teal-200",
      dotStyle: "bg-teal-500",
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
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-text-secondary">Dashboard</p>
          <h1 className="mt-2 text-4xl text-text-primary font-syne uppercase tracking-tight font-extrabold">Overview</h1>
        </div>
        <button
          onClick={() => setThemeMode(themeMode === "light" ? "dark" : "light")}
          className="flex items-center gap-2 px-4 py-2 border rounded-full font-mono text-xs font-bold transition-all duration-200 bg-surface hover:bg-surface-raised border-border text-text-primary shadow cursor-pointer self-start sm:self-auto"
        >
          {themeMode === "light" ? (
            <>
              <Moon size={14} className="text-lime" />
              <span>DARK MODE</span>
            </>
          ) : (
            <>
              <Sun size={14} className="text-lime" />
              <span>LIGHT MODE</span>
            </>
          )}
        </button>
      </header>

      {/* Main semantic variables-based analytics dashboard */}
      <div className="bg-surface text-text-primary border border-border rounded-2xl p-6 md:p-8 shadow-sm space-y-8 font-sans transition-all duration-300">
        
        {/* Title / Sync Info */}
        <div className="flex items-center justify-between border-b border-border pb-5">
          <div>
            <h2 className="text-2xl font-extrabold text-text-primary tracking-tight">
              Analytics Dashboard
            </h2>
            <p className="text-sm text-text-secondary mt-1 font-normal">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {loading
            ? Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-32 bg-surface-raised rounded-xl animate-pulse" />
              ))
            : kpis.map((k) => {
                const active = selectedKpi === k.id;
                const Icon = k.icon;
                const cardBorder = active
                  ? "border-lime ring-2 ring-lime/20 bg-surface-raised scale-[1.02]"
                  : "border-border bg-surface hover:border-border-bright hover:shadow-sm";
                return (
                  <button
                    key={k.id}
                    onClick={() => setSelectedKpi(k.id)}
                    className={`flex flex-col justify-between w-full text-left p-5 border rounded-xl shadow-sm transition-all duration-200 group cursor-pointer ${cardBorder}`}
                  >
                    <div className="flex items-start justify-between w-full">
                      <div className={`p-2 rounded-lg border ${k.badgeStyle}`}>
                        <Icon size={18} strokeWidth={2.5} />
                      </div>
                      <span className={`h-2.5 w-2.5 rounded-full ${k.dotStyle}`} />
                    </div>
                    <div className="mt-4">
                      <div className="text-3xl font-extrabold text-text-primary tracking-tight">
                        {k.value}
                      </div>
                      <div className="text-xs font-semibold mt-1 text-text-primary">
                        {k.label}
                      </div>
                      <div className="text-[10px] mt-0.5 leading-snug text-text-secondary">
                        {k.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
        </div>

        {/* Drill-down Table Section */}
        {selectedKpi && (
          <div className="border border-border rounded-xl bg-surface p-5 space-y-5 shadow-sm">
            {/* Table Header and Filters */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-border pb-5">
              <div>
                <h3 className="text-lg font-bold text-text-primary">
                  {kpis.find((k) => k.id === selectedKpi)?.label} Details
                </h3>
                <p className="text-xs text-text-secondary font-normal mt-0.5">
                  Showing {sortedRows.length} of {allProcessedRows.length} total records.
                </p>
              </div>

              {/* Filtering Controls */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Search Bar */}
                <div className="relative min-w-[200px]">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-secondary" />
                  <input
                    type="text"
                    placeholder="Search company, contact, BC..."
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

                {/* Reset Filters */}
                {(searchQuery || cityFilter || executiveFilter) && (
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
                    <th className="px-4 py-3">Assigned BC</th>
                    <th className="px-4 py-3 min-w-[240px]">Phases Progress</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 min-w-[120px]">{renderSortHeader("updated", "Updated")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginatedRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-text-secondary italic">
                        No sites found matching criteria.
                      </td>
                    </tr>
                  ) : (
                    paginatedRows.map((r) => {
                      const bcNames = r.workerIds.map((id) => profileNameMap.get(id) || "—").join(", ");
                      const canonicalStatus = getCanonicalStatus(r);

                      return (
                        <tr key={r.id} className="hover:bg-surface-raised/35 transition-colors">
                          <td className="px-4 py-3.5">
                            <div className="font-bold text-text-primary text-sm">{r.name}</div>
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
                            {r.workerIds.length > 0 ? (
                              <div className="flex items-center">
                                <span className="font-semibold text-text-primary text-xs">{bcNames}</span>
                                {renderApptBadge(r.progress.appt)}
                              </div>
                            ) : (
                              <span className="text-text-dim italic text-xs font-normal">Unassigned</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex flex-wrap gap-1.5">
                              {renderProgressPill("A", r.progress.a)}
                              {renderProgressPill("I", r.progress.i)}
                              {renderProgressPill("C", r.progress.c)}
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            {getStatusBadge(canonicalStatus)}
                          </td>
                          <td className="px-4 py-3.5 text-xs font-mono font-bold text-text-secondary">
                            {formatDate(r.progress.updated || r.assigned_at || r.appt_date)}
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
                        className={`px-2.5 py-0.5 rounded text-xs border transition-colors cursor-pointer ${
                          currentPage === page
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
      </div>
    </div>
  );
}
