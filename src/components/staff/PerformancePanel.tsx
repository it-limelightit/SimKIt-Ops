import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge, Button, Input, Select, Skeleton } from "@/components/ui-kit";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Filter,
  RotateCcw,
  Search,
} from "lucide-react";
import { getCanonicalStatus, getSiteWorkerIds } from "@/utils/status";

type Consultant = { id: string; name: string | null; is_active: boolean };
type Site = {
  id: string;
  name: string;
  company_name: string | null;
  city: string | null;
  assigned_worker_id: string | null;
  assigned_at: string | null;
  appt_date: string | null;
  appt_time: string | null;
  task_notes: string | null;
  consultant_stage: string | null;
  created_at: string;
};
type PhaseData = Record<string, any> | null;
type PhaseRecord = { site_id: string; data: PhaseData; updated_at: string };
type Contact = { id: string; name: string | null; designation: string | null; mobile: string | null; whatsapp: string | null; email: string | null };
type Machine = { id: string; name: string | null; brand: string | null; model: string | null; serial: string | null; year: number | null; condition: string | null };
type Material = { material_name: string; state: string | null; notes: string | null; submitted: boolean | null };

type SiteDetail = {
  site: Site;
  assessment: PhaseData;
  installation: PhaseData;
  commissioning: PhaseData;
  assessmentUpdatedAt: string | null;
  installationUpdatedAt: string | null;
  commissioningUpdatedAt: string | null;
  status: string;
  assessmentPct: number;
  installationPct: number;
  commissioningPct: number;
  contacts: Contact[];
  machines: Machine[];
};

type ConsultantRow = { consultant: Consultant; sites: SiteDetail[] };

export function getAppointmentTimingStatus(scheduledDateStr: string | null, scheduledTimeStr: string | null, completedAtIso: string | null) {
  if (!scheduledDateStr || !completedAtIso) return null;
  try {
    const timePart = scheduledTimeStr ? (scheduledTimeStr.length === 5 ? scheduledTimeStr + ":00" : scheduledTimeStr) : "00:00:00";
    const scheduledDate = new Date(`${scheduledDateStr}T${timePart}`);
    const completedDate = new Date(completedAtIso);

    if (isNaN(scheduledDate.getTime()) || isNaN(completedDate.getTime())) return null;

    const diffMins = (completedDate.getTime() - scheduledDate.getTime()) / (60 * 1000);
    if (diffMins < -15) return "Early";
    if (diffMins <= 30) return "On Time";
    return "Late";
  } catch (e) {
    return null;
  }
}

export function PerformancePanel() {
  const [rows, setRows] = useState<ConsultantRow[] | null>(null);
  const [allSiteDetails, setAllSiteDetails] = useState<SiteDetail[]>([]);
  const [openConsultant, setOpenConsultant] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [associateFilter, setAssociateFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [factoryPeriod, setFactoryPeriod] = useState("aug_2026_to_today");
  const [analysisView, setAnalysisView] = useState("stage");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data: workerRoles } = await supabase.from("user_roles").select("user_id").eq("role", "worker");
      const ids = ((workerRoles ?? []) as any[]).map((r) => r.user_id);
      if (ids.length === 0) {
        setRows([]);
        return;
      }

      const [profsRes, sitesRes, aRes, iRes, cRes, contactsRes, machinesRes, materialsRes] = await Promise.all([
        supabase.from("profiles").select("id,name,is_active").in("id", ids),
        supabase.from("sites").select("id,name,company_name,city,assigned_worker_id,assigned_at,appt_date,appt_time,task_notes,consultant_stage,created_at"),
        supabase.from("assessment").select("site_id,data,updated_at"),
        supabase.from("installation").select("site_id,data,updated_at"),
        supabase.from("commissioning").select("site_id,data,updated_at"),
        supabase.from("contacts").select("*"),
        supabase.from("machines").select("*"),
        supabase.from("inventory_materials").select("material_name,state,notes,submitted"),
      ]);

      const aMap = new Map<string, PhaseRecord>(((aRes.data ?? []) as any[]).map((r) => [r.site_id, r]));
      const iMap = new Map<string, PhaseRecord>(((iRes.data ?? []) as any[]).map((r) => [r.site_id, r]));
      const cMap = new Map<string, PhaseRecord>(((cRes.data ?? []) as any[]).map((r) => [r.site_id, r]));
      const materials = (materialsRes.data ?? []) as Material[];

      const contactsBySite: Record<string, Contact[]> = {};
      for (const c of (contactsRes.data ?? []) as any[]) {
        if (!contactsBySite[c.site_id]) contactsBySite[c.site_id] = [];
        contactsBySite[c.site_id].push(c);
      }

      const machinesBySite: Record<string, Machine[]> = {};
      for (const m of (machinesRes.data ?? []) as any[]) {
        if (!machinesBySite[m.site_id]) machinesBySite[m.site_id] = [];
        machinesBySite[m.site_id].push(m);
      }

      const sitesByWorker: Record<string, Site[]> = {};
      for (const s of (sitesRes.data ?? []) as any[]) {
        for (const workerId of getSiteWorkerIds(s).filter((id) => ids.includes(id))) {
          if (!sitesByWorker[workerId]) sitesByWorker[workerId] = [];
          sitesByWorker[workerId].push(s);
        }
      }

      const buildSiteDetail = (site: Site): SiteDetail => {
        const ar = aMap.get(site.id);
        const ir = iMap.get(site.id);
        const cr = cMap.get(site.id);
        const assessment = ar?.data ?? null;
        const installation = ir?.data ?? null;
        const commissioning = cr?.data ?? null;
        const assessmentPct = completionPct(assessment, ASSESSMENT_KEYS);
        const installationPct = installation?.installation_phase_submitted ? 100 : completionPct(installation, INSTALLATION_KEYS);
        const commissioningPct = commissioning?.commissioning_phase_submitted ? 100 : completionPct(commissioning, COMMISSIONING_KEYS);

        return {
          site,
          assessment,
          installation,
          commissioning,
          assessmentUpdatedAt: ar?.updated_at ?? null,
          installationUpdatedAt: ir?.updated_at ?? null,
          commissioningUpdatedAt: cr?.updated_at ?? null,
          status: getCanonicalStatus(site, aMap, iMap, cMap, materials),
          assessmentPct,
          installationPct,
          commissioningPct,
          contacts: contactsBySite[site.id] ?? [],
          machines: machinesBySite[site.id] ?? [],
        };
      };

      const out: ConsultantRow[] = ((profsRes.data ?? []) as Consultant[]).map((p) => ({
        consultant: p,
        sites: (sitesByWorker[p.id] ?? []).map(buildSiteDetail),
      }));

      setAllSiteDetails(((sitesRes.data ?? []) as Site[]).map(buildSiteDetail));
      setRows(out.sort((a, b) => b.sites.length - a.sites.length));
    };

    void load();
    const channel = supabase
      .channel("performance-analytics-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sites" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "assessment" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "installation" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "commissioning" }, () => void load())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const term = search.trim().toLowerCase();
    return rows
      .map((row) => ({
        ...row,
        sites: row.sites.filter((sd) => {
          const matchesAssociate = associateFilter === "all" || row.consultant.id === associateFilter;
          const matchesStatus = statusFilter === "all" ||
            performanceStatusGroup(sd) === statusFilter ||
            (statusFilter === "assigned" && getSiteWorkerIds(sd.site).length > 0) ||
            (statusFilter === "dropped" && sd.status === "Dropped / Rejected");
          const matchesTime = siteMatchesTimeFilter(sd, timeFilter);
          const matchesSearch = !term || [
            row.consultant.name || "",
            sd.site.name,
            sd.site.company_name || "",
            sd.site.city || "",
            sd.status,
          ].some((value) => value.toLowerCase().includes(term));
          return matchesAssociate && matchesStatus && matchesTime && matchesSearch;
        }),
      }))
      .filter((row) => row.sites.length > 0 || (!term && statusFilter === "all" && associateFilter === "all" && timeFilter === "all"));
  }, [rows, associateFilter, search, statusFilter, timeFilter]);
  const analytics = useMemo(() => buildAnalytics(filteredRows), [filteredRows]);
  const factoryAnalytics = useMemo(() => buildFactoryAnalytics(filterFactorySites(allSiteDetails, { factoryPeriod, search, statusFilter, timeFilter })), [allSiteDetails, factoryPeriod, search, statusFilter, timeFilter]);
  const associateOptions = useMemo(
    () => (rows ?? []).map((row) => ({ id: row.consultant.id, name: row.consultant.name || "Unnamed" })).sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  );

  if (rows === null) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-lime/80 font-bold">Business Analytics</p>
          <h1 className="mt-2 text-4xl uppercase tracking-tight font-extrabold font-syne text-text-primary">Consultant Performance</h1>
          <p className="mt-2 max-w-3xl text-sm text-text-secondary">
            Analyze field associate execution from assignment to assessment, installation and commissioning with overview-aligned operational counts.
          </p>
        </div>
        <div className="rounded-[8px] border border-border bg-surface px-4 py-3 text-right">
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">Current View</div>
          <div className="mt-1 text-xl font-extrabold text-text-primary">{analytics.total} Companies</div>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-text-secondary">No Field Associates yet</div>
      ) : (
        <>
          <div className="sticky top-0 z-20 rounded-[10px] border border-border bg-bg/95 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.22)] backdrop-blur">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm font-extrabold text-text-primary">
                <Filter size={16} className="text-lime" />
                Focus Filters
              </div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">
                {filteredRows.length} consultant{filteredRows.length !== 1 ? "s" : ""} in selected view
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_1fr_1.4fr_auto]">
              <Select value={analysisView} onChange={(e) => setAnalysisView(e.target.value)} className="text-xs">
                <option value="stage">Stage Base Progress</option>
                <option value="factory">Factory Analysis</option>
              </Select>
              <Select value={factoryPeriod} onChange={(e) => setFactoryPeriod(e.target.value)} className="text-xs">
                <option value="before_aug_2026">Before August 2026</option>
                <option value="aug_2026_to_today">August 2026 to till date</option>
              </Select>
              <Select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)} className="text-xs">
                <option value="all">All time</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="month">This month</option>
              </Select>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-xs">
                <option value="all">All stages</option>
                <option value="assigned">Assigned</option>
                <option value="not_started">Not Started Yet</option>
                <option value="assessed">Assessed</option>
                <option value="installed">Installed</option>
                <option value="commissioned">Commissioned</option>
                <option value="dropped">Dropped / Rejected</option>
              </Select>
              <Select value={associateFilter} onChange={(e) => setAssociateFilter(e.target.value)} className="text-xs">
                <option value="all">All field associates</option>
                {associateOptions.map((associate) => (
                  <option key={associate.id} value={associate.id}>{associate.name}</option>
                ))}
              </Select>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" size={15} />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search consultant, company, city, status..."
                  className="pl-9"
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => { setAnalysisView("stage"); setFactoryPeriod("aug_2026_to_today"); setTimeFilter("all"); setStatusFilter("all"); setAssociateFilter("all"); setSearch(""); }}
                className="h-9 px-3 text-xs"
              >
                <RotateCcw size={14} />
                Reset
              </Button>
            </div>
          </div>

          {analysisView === "stage" ? (
            <>
              <AnalyticsDashboard analytics={analytics} onFilter={setStatusFilter} />
              <StagePerformanceTable filteredRows={filteredRows} openConsultant={openConsultant} setOpenConsultant={setOpenConsultant} />
            </>
          ) : (
            <FactoryAnalysisDashboard factoryAnalytics={factoryAnalytics} />
          )}
        </>
      )}
    </div>
  );
}

function StagePerformanceTable({
  filteredRows,
  openConsultant,
  setOpenConsultant,
}: {
  filteredRows: ConsultantRow[];
  openConsultant: string | null;
  setOpenConsultant: (value: string | null) => void;
}) {
  return (
    <Panel title="Field Associate Performance" description="Click a field associate row to expand company-level tracking.">
      {filteredRows.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-text-secondary">
          No performance records match the current filter.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-border">
          <div className="hidden grid-cols-[1.65fr_repeat(5,0.72fr)_1fr_auto] gap-4 bg-surface-raised px-5 py-3 font-mono text-[10px] uppercase tracking-widest text-text-secondary lg:grid">
            <span>Field Associate</span>
            <span className="text-right">Assigned</span>
            <span className="text-right">Not Started</span>
            <span className="text-right">Assessed</span>
            <span className="text-right">Installed</span>
            <span className="text-right">Commissioned</span>
            <span>Performance</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {filteredRows.map((row) => {
              const isOpen = openConsultant === row.consultant.id;
              const stats = buildConsultantStats(row);

              return (
                <div key={row.consultant.id}>
                  <button
                    className="grid w-full gap-4 p-5 text-left transition-colors hover:bg-surface-raised/40 lg:grid-cols-[1.65fr_repeat(5,0.72fr)_1fr_auto] lg:items-center"
                    onClick={() => setOpenConsultant(isOpen ? null : row.consultant.id)}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {isOpen ? <ChevronDown size={16} className="text-text-secondary flex-shrink-0" /> : <ChevronRight size={16} className="text-text-secondary flex-shrink-0" />}
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-violet/10 text-xs font-extrabold text-violet">
                        {initials(stats.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-lg font-bold text-text-primary">{stats.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
                          <Badge tone={row.consultant.is_active ? "success" : "warning"}>{row.consultant.is_active ? "Active" : "Pending"}</Badge>
                          <span>{stats.assigned} assigned</span>
                        </div>
                      </div>
                    </div>
                    <MetricCell label="Assigned" value={stats.assigned} />
                    <MetricCell label="Not Started" value={stats.notStarted} />
                    <MetricCell label="Assessed" value={stats.assessed} />
                    <MetricCell label="Installed" value={stats.installed} />
                    <MetricCell label="Commissioned" value={stats.commissioned} />
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">Performance</span>
                        <span className="font-mono text-sm font-extrabold text-text-primary">{stats.completion}%</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-border">
                        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-mint" style={{ width: `${stats.completion}%` }} />
                      </div>
                    </div>
                    <span className="hidden font-mono text-[10px] uppercase tracking-widest text-text-secondary lg:block">
                      {isOpen ? "Hide" : "View"}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-border divide-y divide-border bg-surface-raised/10">
                      {row.sites.length === 0 ? (
                        <div className="px-8 py-6 text-sm text-text-secondary">No sites assigned yet.</div>
                      ) : (
                        row.sites.map((sd) => <SiteRow key={sd.site.id} sd={sd} />)
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

function AnalyticsDashboard({
  analytics,
  onFilter,
}: {
  analytics: Analytics;
  onFilter: (filter: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <AnalyticsTile label="Assigned" value={analytics.assigned} helper="Total field associate work" tone="blue" />
        <AnalyticsTile label="Not Started" value={analytics.notStarted} helper={`${pct(analytics.notStarted, analytics.assigned)}% pending start`} tone="amber" />
        <AnalyticsTile label="Assessed" value={analytics.assessed} helper={`${pct(analytics.assessed, analytics.assigned)}% current stage`} tone="cyan" />
        <AnalyticsTile label="Installed" value={analytics.installed} helper={`${pct(analytics.installed, analytics.assigned)}% current stage`} tone="indigo" />
        <AnalyticsTile label="Commissioned" value={analytics.commissioned} helper={`${pct(analytics.commissioned, analytics.assigned)}% fully done`} tone="green" />
        <AnalyticsTile label="Performance" value={`${analytics.avgCompletion}%`} helper="3-stage weighted score" tone="lime" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel title="Current Stage Distribution" description="Each company is counted once in its latest field associate stage." className="p-4">
          <div className="space-y-3">
            {analytics.stageProgress.map((entry) => (
              <StageMeter
                key={entry.stage}
                entry={entry}
                total={analytics.assigned}
                onClick={() => onFilter(entry.filter)}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Current Delay Position" description="Where each company is currently stuck or completed." className="p-4">
          <div className="grid items-center gap-3 md:grid-cols-[150px_1fr] xl:grid-cols-[140px_1fr]">
            <div className="relative h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={analytics.statusBreakdown} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="86%" paddingAngle={3}>
                    {analytics.statusBreakdown.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#111318", border: "1px solid rgba(148,163,184,0.25)", borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-xl font-extrabold text-text-primary">{analytics.total}</span>
                <span className="font-mono text-[9px] uppercase tracking-widest text-text-secondary">Total</span>
              </div>
            </div>
            <div className="space-y-1.5 text-xs">
              {analytics.statusBreakdown.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => onFilter(entry.filter)}
                  className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 rounded-[6px] px-2 py-2 text-left transition-colors hover:bg-surface-raised"
                >
                  <span className="flex min-w-0 items-center gap-2 font-semibold text-text-secondary">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span className="font-mono font-extrabold text-text-primary">{entry.value}</span>
                  <span className="w-10 text-right font-mono text-text-secondary">{pct(entry.value, analytics.total)}%</span>
                </button>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Monthly Completion Trend" description="Installed and commissioned company movement over selected period." className="p-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="h-[190px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.monthlyTrend} margin={{ left: -14, right: 18, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9ca3af" }} />
                <Tooltip contentStyle={{ background: "#111318", border: "1px solid rgba(148,163,184,0.25)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="installed" name="Installed" stroke="#3b82f6" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="commissioned" name="Commissioned" stroke="#22c55e" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs lg:w-56 lg:grid-cols-1">
            <TrendLegend label="Installed" value={analytics.installed} color="bg-blue-500" />
            <TrendLegend label="Commissioned" value={analytics.commissioned} color="bg-green-500" />
            <TrendLegend label="Avg score" value={`${analytics.avgCompletion}%`} icon={<Activity size={13} />} />
          </div>
        </div>
      </Panel>
    </div>
  );
}

function FactoryAnalysisDashboard({ factoryAnalytics }: { factoryAnalytics: FactoryAnalytics }) {
  return (
    <div className="space-y-4">
      <Panel title="Factory Process Time Tracking" description="Company-wise days taken between assigned, assessed, installed and commissioned dates.">
        {factoryAnalytics.companyRows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-text-secondary">
            No factory timing records match the current filter.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[8px] border border-border">
            <table className="min-w-[1180px] w-full border-collapse text-sm">
              <thead className="bg-surface-raised">
                <tr className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">
                  <th className="px-4 py-3 text-left">Company</th>
                  <th className="px-4 py-3 text-left">Assigned Date</th>
                  <th className="px-4 py-3 text-left">Assessed Date</th>
                  <th className="px-4 py-3 text-left">Installed Date</th>
                  <th className="px-4 py-3 text-left">Commissioned Date</th>
                  <th className="px-4 py-3 text-right">Assign To Assess</th>
                  <th className="px-4 py-3 text-right">Assess To Install</th>
                  <th className="px-4 py-3 text-right">Install To Commission</th>
                  <th className="px-4 py-3 text-right">Total Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {factoryAnalytics.companyRows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-raised/30">
                    <td className="px-4 py-3">
                      <div className="font-bold text-text-primary">{row.company}</div>
                    </td>
                    <DateCell value={row.assignedAt} />
                    <DateCell value={row.assessedAt} />
                    <DateCell value={row.installedAt} />
                    <DateCell value={row.commissionedAt} />
                    <DaysCell value={row.assignToAssessDays} />
                    <DaysCell value={row.assessToInstallDays} />
                    <DaysCell value={row.installToCommissionDays} />
                    <DaysCell value={row.totalDays} strong />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function DateCell({ value }: { value: string | null }) {
  return (
    <td className="px-4 py-3 font-mono text-xs text-text-secondary">{formatShortDate(value)}</td>
  );
}

function DaysCell({ value, strong }: { value: number | null; strong?: boolean }) {
  return (
    <td className={`px-4 py-3 text-right font-mono text-sm ${strong ? "font-extrabold text-text-primary" : "font-bold text-text-secondary"}`}>
      {formatDays(value)}
    </td>
  );
}

function AnalyticsTile({ label, value, helper, tone }: { label: string; value: number | string; helper: string; tone: "blue" | "amber" | "cyan" | "indigo" | "green" | "lime" }) {
  const toneClass = {
    blue: "from-blue-500/18 to-blue-500/5 text-blue-400",
    amber: "from-amber-500/18 to-amber-500/5 text-amber-300",
    cyan: "from-cyan-400/18 to-cyan-400/5 text-cyan-300",
    indigo: "from-indigo-400/18 to-indigo-400/5 text-indigo-300",
    green: "from-green-500/18 to-green-500/5 text-green-400",
    lime: "from-lime/18 to-lime/5 text-lime",
  }[tone];

  return (
    <div className={`rounded-[8px] border border-border bg-gradient-to-br ${toneClass} p-4`}>
      <div className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">{label}</div>
      <div className="mt-2 font-mono text-3xl font-extrabold text-text-primary">{value}</div>
      <div className="mt-1 text-xs font-medium text-text-secondary">{helper}</div>
    </div>
  );
}

function StageMeter({
  entry,
  total,
  onClick,
}: {
  entry: { stage: string; count: number; filter: string };
  total: number;
  onClick: () => void;
}) {
  const percentage = pct(entry.count, total);
  return (
    <button type="button" onClick={onClick} className="w-full rounded-[8px] border border-border/70 bg-surface-raised/20 px-4 py-3 text-left transition-colors hover:border-blue-500/50 hover:bg-surface-raised/50">
      <div className="mb-2 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-extrabold text-text-primary">{entry.stage}</div>
          <div className="text-xs text-text-secondary">{entry.count} companies</div>
        </div>
        <div className="font-mono text-lg font-extrabold text-text-primary">{percentage}%</div>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-mint" style={{ width: `${percentage}%` }} />
      </div>
    </button>
  );
}

function TrendLegend({ label, value, color, icon }: { label: string; value: number | string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-[8px] border border-border bg-surface-raised/30 px-3 py-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
        {icon ?? <span className={`h-2.5 w-2.5 rounded-full ${color}`} />}
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-extrabold text-text-primary">{value}</div>
    </div>
  );
}

function SiteRow({ sd }: {
  sd: SiteDetail;
}) {
  const timingStatus = getAppointmentTimingStatus(sd.site.appt_date, sd.site.appt_time, sd.assessment?.appointment_saved_at);
  const displayStatus = performanceStatusLabel(sd);

  return (
    <div className="flex items-center justify-between gap-4 px-8 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-border" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text-primary">
              <span className="truncate">{sd.site.company_name || sd.site.name}</span>
              {timingStatus && <Badge tone={timingStatus === "Late" ? "danger" : "success"}>{timingStatus}</Badge>}
              <Badge tone={statusTone(displayStatus)}>{displayStatus}</Badge>
            </div>
            <div className="text-xs text-text-secondary">{sd.site.city ?? "-"}{sd.site.appt_date ? ` - Appt ${sd.site.appt_date}` : ""}</div>
          </div>
        </div>
        <div className="hidden min-w-[220px] items-center justify-end gap-3 text-xs text-text-secondary sm:flex">
          <span className="font-mono uppercase tracking-widest">{displayStatus}</span>
          <span className="font-mono text-sm font-extrabold text-text-primary">{performanceProgress(sd)}%</span>
        </div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: number }) {
  return (
    <span className="grid grid-cols-[110px_auto] items-center justify-between gap-3 rounded-[6px] bg-surface-raised/25 px-3 py-2 text-sm lg:block lg:bg-transparent lg:px-0 lg:py-0 lg:text-right">
      <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary lg:block">{label}</span>
      <span className="font-mono text-base font-extrabold text-text-primary lg:mt-1 lg:block">{value}</span>
    </span>
  );
}

function Panel({ title, description, className, children }: { title: string; description?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-[10px] border border-border bg-surface p-5 shadow-xs ${className ?? ""}`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-text-primary">{title}</h2>
          {description && <p className="mt-1 text-xs text-text-secondary">{description}</p>}
        </div>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-border bg-surface-raised/30 text-[11px] text-text-secondary">i</span>
      </div>
      {children}
    </section>
  );
}

function PhaseAccordion({ label, phaseKey, openPhase, setOpenPhase, children }: {
  label: string; phaseKey: string; openPhase: string | null; setOpenPhase: (k: string | null) => void; children: React.ReactNode;
}) {
  const isOpen = openPhase === phaseKey;
  return (
    <div className="border border-border rounded-[8px] overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-raised/30 transition-colors"
        onClick={() => setOpenPhase(isOpen ? null : phaseKey)}
      >
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronDown size={13} className="text-text-secondary" /> : <ChevronRight size={13} className="text-text-secondary" />}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">{isOpen ? "Hide Details" : "View Details"}</span>
      </button>
      {isOpen && <div className="border-t border-border px-4 py-4 bg-surface-raised/20">{children}</div>}
    </div>
  );
}

function AssessmentDetail({ data, contacts, machines, scheduledDate, scheduledTime }: {
  data: PhaseData;
  contacts: Contact[];
  machines: Machine[];
  scheduledDate: string | null;
  scheduledTime: string | null;
}) {
  if (!data && contacts.length === 0 && machines.length === 0) {
    return <p className="text-xs text-text-secondary">No data saved yet.</p>;
  }
  const d = data ?? {};
  const timingStatus = getAppointmentTimingStatus(scheduledDate, scheduledTime, d.appointment_saved_at);
  return (
    <div className="space-y-5 text-sm">
      <Section title="Factory Call"><Row label="Done" value={boolVal(d.factory_call_done)} /><Row label="Completed at" value={fmtDate(d.factory_call_at)} /></Section>
      <Section title="Third Party Call"><Row label="Done" value={boolVal(d.third_party_call_done)} /><Row label="Completed at" value={fmtDate(d.third_party_call_at)} /></Section>
      <Section title="Appointment">
        <Row label="Company" value={d.appt_company} />
        <Row label="Date" value={d.appt_date} />
        <Row label="Time" value={d.appt_time} />
        <Row label="Mode" value={d.appt_mode} />
        {timingStatus && <div className="py-1"><Badge tone={timingStatus === "Late" ? "danger" : "success"}>{timingStatus}</Badge></div>}
        <Row label="Notes" value={d.appt_notes} multiline />
      </Section>
      <Section title="Facility Visit"><Row label="Done" value={boolVal(d.facility_visit_done)} /><Row label="Visited at" value={fmtDate(d.facility_visit_at)} /><Row label="Visited by" value={d.facility_visited_by} /></Section>
      <Section title="Business Profile"><Row label="Business Name" value={d.biz_name} /><Row label="Industry" value={d.biz_industry} /><Row label="GST" value={d.biz_gst} /><Row label="City" value={d.biz_city} /><Row label="State" value={d.biz_state} /></Section>
      {contacts.length > 0 && <Section title="Contacts">{contacts.map((c) => <Row key={c.id} label={c.name || "Contact"} value={[c.designation, c.mobile, c.email].filter(Boolean).join(" - ")} />)}</Section>}
      {machines.length > 0 && <Section title="Machines">{machines.map((m) => <Row key={m.id} label={m.name || "Machine"} value={[m.brand, m.model, m.serial].filter(Boolean).join(" - ")} />)}</Section>}
      <Section title="Files"><Row label="MOM Uploaded" value={boolVal(d.mom_uploaded)} /><Row label="Media Uploaded" value={boolVal(d.media_uploaded)} /></Section>
    </div>
  );
}

function InstallationDetail({ data }: { data: PhaseData }) {
  if (!data) return <p className="text-xs text-text-secondary">No data saved yet.</p>;
  return (
    <div className="space-y-5 text-sm">
      <Section title="Delivery"><Row label="Confirmed" value={boolVal(data.delivery_confirmed)} /><Row label="Date" value={data.delivery_date} /><Row label="Units received" value={data.delivery_units?.toString()} /><Row label="Condition" value={data.delivery_condition} /><Row label="Notes" value={data.delivery_notes} multiline /></Section>
      <Section title="Coordination"><Row label="Done" value={boolVal(data.coordination_done)} /><Row label="At" value={fmtDate(data.coordination_at)} /><Row label="Notes" value={data.coordination_notes} multiline /></Section>
      <Section title="Photos"><Row label="Uploaded" value={boolVal(data.photos_uploaded)} /></Section>
    </div>
  );
}

function CommissioningDetail({ data }: { data: PhaseData }) {
  if (!data) return <p className="text-xs text-text-secondary">No data saved yet.</p>;
  return (
    <div className="space-y-5 text-sm">
      {[
        ["coordination_done", "Coordination"],
        ["visit_done", "Visit"],
        ["connection_done", "Connection"],
        ["configure_done", "Configure"],
        ["testing_done", "Testing"],
      ].map(([key, label]) => <Section key={key} title={label}><Row label="Done" value={boolVal(data[key])} /></Section>)}
      <Section title="Final"><Row label="Screenshots" value={boolVal(data.screenshots_uploaded)} /><Row label="Certificate Sent" value={boolVal(data.certificate_sent)} /><Row label="Final MOM" value={boolVal(data.final_mom_uploaded)} /></Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-text-secondary">{title}</div>
      <div className="space-y-1 border-l border-border pl-3">{children}</div>
    </div>
  );
}

function Row({ label, value, multiline }: { label: string; value: string | null | undefined; multiline?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className={`flex ${multiline ? "flex-col gap-0.5" : "items-baseline justify-between gap-4"}`}>
      <span className="text-xs text-text-secondary flex-shrink-0">{label}</span>
      <span className={`text-xs font-mono ${multiline ? "text-text-primary whitespace-pre-wrap" : "text-text-primary text-right"}`}>{value}</span>
    </div>
  );
}

type Analytics = ReturnType<typeof buildAnalytics>;
type FactoryAnalytics = ReturnType<typeof buildFactoryAnalytics>;

function filterFactorySites(
  sites: SiteDetail[],
  filters: { factoryPeriod: string; search: string; statusFilter: string; timeFilter: string },
) {
  const term = filters.search.trim().toLowerCase();
  return sites.filter((site) => {
    const statusGroup = performanceStatusGroup(site);
    const matchesStatus = filters.statusFilter === "all" ||
      statusGroup === filters.statusFilter ||
      (filters.statusFilter === "assigned" && !!siteAssignedAt(site)) ||
      (filters.statusFilter === "dropped" && site.status === "Dropped / Rejected");
    const matchesTime = siteMatchesTimeFilter(site, filters.timeFilter);
    const matchesPeriod = siteMatchesFactoryPeriod(site, filters.factoryPeriod);
    const matchesSearch = !term || [
      site.site.name,
      site.site.company_name || "",
      site.site.city || "",
      site.status,
    ].some((value) => value.toLowerCase().includes(term));
    return matchesStatus && matchesTime && matchesPeriod && matchesSearch;
  });
}

function buildConsultantStats(row: ConsultantRow) {
  const assigned = row.sites.length;
  const notStarted = row.sites.filter((s) => performanceStatusGroup(s) === "not_started").length;
  const assessed = row.sites.filter((s) => performanceStatusGroup(s) === "assessed").length;
  const installed = row.sites.filter((s) => performanceStatusGroup(s) === "installed").length;
  const commissioned = row.sites.filter((s) => performanceStatusGroup(s) === "commissioned").length;
  const completion = assigned ? Math.round(row.sites.reduce((sum, s) => sum + performanceProgress(s), 0) / assigned) : 0;
  return {
    id: row.consultant.id,
    name: row.consultant.name || "Unnamed",
    companies: assigned,
    assigned,
    notStarted,
    assessed,
    installed,
    commissioned,
    completion,
  };
}

function buildFactoryAnalytics(sites: SiteDetail[]) {
  return {
    companyRows: sites
      .map((site) => ({
        id: site.site.id,
        company: site.site.company_name || site.site.name,
        assignedAt: siteAssignedAt(site),
        assessedAt: hasAssessedMilestone(site) ? site.assessmentUpdatedAt : null,
        installedAt: hasInstalledMilestone(site) ? site.installationUpdatedAt : null,
        commissionedAt: hasCommissionedMilestone(site) ? site.commissioningUpdatedAt : null,
        assignToAssessDays: daysAssignedToAssessment(site),
        assessToInstallDays: daysAssessmentToInstallation(site),
        installToCommissionDays: daysInstallationToCommissioning(site),
        totalDays: hasCommissionedMilestone(site) ? daysAssignedToCommissioning(site) : daysSinceAssigned(site),
      }))
      .sort((a, b) => compareNullableDesc(a.totalDays, b.totalDays) || a.company.localeCompare(b.company)),
  };
}

function buildAnalytics(rows: ConsultantRow[]) {
  const sites = rows.flatMap((row) => row.sites.map((site) => ({ ...site, consultantId: row.consultant.id, consultantName: row.consultant.name || "Unnamed" })));
  const total = sites.length;
  const notStarted = sites.filter((s) => performanceStatusGroup(s) === "not_started").length;
  const assessed = sites.filter((s) => performanceStatusGroup(s) === "assessed").length;
  const installed = sites.filter((s) => performanceStatusGroup(s) === "installed").length;
  const commissioned = sites.filter((s) => performanceStatusGroup(s) === "commissioned").length;
  const avgCompletion = total ? Math.round(sites.reduce((sum, s) => sum + performanceProgress(s), 0) / total) : 0;

  const associates = rows.map(buildConsultantStats).sort((a, b) => b.completion - a.completion || b.companies - a.companies);

  return {
    total,
    assigned: total,
    notStarted,
    assessed,
    installed,
    commissioned,
    avgCompletion,
    pendingConversion: notStarted + assessed,
    bestAssociate: associates[0],
    associates,
    stageProgress: [
      { stage: "Not Started Yet", count: notStarted, filter: "not_started" },
      { stage: "Assessed", count: assessed, filter: "assessed" },
      { stage: "Installed", count: installed, filter: "installed" },
      { stage: "Commissioned", count: commissioned, filter: "commissioned" },
    ],
    monthlyTrend: buildMonthlyTrend(sites),
    statusBreakdown: [
      { name: "Not Started Yet", value: notStarted, color: "#f59e0b", filter: "not_started" },
      { name: "Assessed", value: assessed, color: "#38bdf8", filter: "assessed" },
      { name: "Installed", value: installed, color: "#3b82f6", filter: "installed" },
      { name: "Commissioned", value: commissioned, color: "#22c55e", filter: "commissioned" },
    ].filter((item) => item.value > 0 || total === 0),
  };
}

function buildMonthlyTrend(sites: Array<SiteDetail & { consultantId: string; consultantName: string }>) {
  const months: { key: string; month: string; installed: number; commissioned: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    months.push({ key, month: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), installed: 0, commissioned: 0 });
  }
  for (const site of sites) {
    const installedKey = site.installationUpdatedAt ? site.installationUpdatedAt.slice(0, 7) : "";
    const commissionedKey = site.commissioningUpdatedAt ? site.commissioningUpdatedAt.slice(0, 7) : "";
    const installedMonth = months.find((m) => m.key === installedKey);
    const commissionedMonth = months.find((m) => m.key === commissionedKey);
    if (installedMonth && hasInstalledMilestone(site)) installedMonth.installed += 1;
    if (commissionedMonth && hasCommissionedMilestone(site)) commissionedMonth.commissioned += 1;
  }
  let installedRunning = 0;
  let commissionedRunning = 0;
  return months.map((month) => {
    installedRunning += month.installed;
    commissionedRunning += month.commissioned;
    return { month: month.month, installed: installedRunning, commissioned: commissionedRunning };
  });
}

function siteMatchesTimeFilter(site: SiteDetail, filter: string) {
  if (filter === "all") return true;
  const activity = latestSiteActivity(site);
  if (!activity) return false;
  const now = new Date();
  const activityDate = new Date(activity);
  if (isNaN(activityDate.getTime())) return false;

  if (filter === "month") {
    return activityDate.getFullYear() === now.getFullYear() && activityDate.getMonth() === now.getMonth();
  }

  const days = filter === "7d" ? 7 : filter === "30d" ? 30 : filter === "90d" ? 90 : null;
  if (!days) return true;
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - days);
  return activityDate >= cutoff;
}

function siteMatchesFactoryPeriod(site: SiteDetail, period: string) {
  const assignedAt = siteAssignedAt(site);
  if (!assignedAt) return false;
  const assignedDate = new Date(assignedAt);
  if (isNaN(assignedDate.getTime())) return false;

  const augustStart = new Date("2026-08-01T00:00:00");
  if (period === "before_aug_2026") {
    return assignedDate < augustStart;
  }

  const now = new Date();
  return assignedDate >= augustStart && assignedDate <= now;
}

function latestSiteActivity(site: SiteDetail) {
  const activityDates = [
    site.assessmentUpdatedAt,
    site.installationUpdatedAt,
    site.commissioningUpdatedAt,
    site.site.assigned_at,
    site.site.created_at,
  ].filter(Boolean).sort();
  return activityDates.length ? activityDates[activityDates.length - 1] : null;
}

function siteAssignedAt(site: SiteDetail) {
  return site.site.assigned_at || site.site.created_at;
}

function daysAssignedToAssessment(site: SiteDetail) {
  if (!hasAssessedMilestone(site)) return null;
  return daysBetween(siteAssignedAt(site), site.assessmentUpdatedAt);
}

function daysAssessmentToInstallation(site: SiteDetail) {
  if (!hasInstalledMilestone(site)) return null;
  return daysBetween(site.assessmentUpdatedAt, site.installationUpdatedAt);
}

function daysInstallationToCommissioning(site: SiteDetail) {
  if (!hasCommissionedMilestone(site)) return null;
  return daysBetween(site.installationUpdatedAt, site.commissioningUpdatedAt);
}

function daysAssignedToCommissioning(site: SiteDetail) {
  if (!hasCommissionedMilestone(site)) return null;
  return daysBetween(siteAssignedAt(site), site.commissioningUpdatedAt);
}

function daysSinceAssigned(site: SiteDetail) {
  return daysBetween(siteAssignedAt(site), new Date().toISOString());
}

function daysBetween(startIso: string | null | undefined, endIso: string | null | undefined) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return null;
  return Math.round(((end.getTime() - start.getTime()) / 86400000) * 10) / 10;
}

function compareNullableDesc(a: number | null, b: number | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function formatDays(value: number | null) {
  if (value === null) return "-";
  if (value === 0) return "0d";
  return `${value}d`;
}

function formatShortDate(iso: string | null | undefined) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function performanceStatusGroup(site: SiteDetail) {
  if (hasCommissionedMilestone(site)) return "commissioned";
  if (hasInstalledMilestone(site)) return "installed";
  if (hasAssessedMilestone(site)) return "assessed";
  return "not_started";
}

function hasAssessedMilestone(site: SiteDetail) {
  return site.status === "Assessed" ||
    site.status === "Panel Dispatched" ||
    site.status === "Installed" ||
    site.status === "Commissioned" ||
    site.status === "Submitted" ||
    site.status === "Certification Pending" ||
    site.assessmentPct > 0;
}

function hasInstalledMilestone(site: SiteDetail) {
  return site.status === "Installed" ||
    site.status === "Commissioned" ||
    site.status === "Submitted" ||
    site.status === "Certification Pending" ||
    site.installationPct === 100 ||
    site.commissioningPct === 100;
}

function hasCommissionedMilestone(site: SiteDetail) {
  return site.status === "Commissioned" ||
    site.status === "Submitted" ||
    site.status === "Certification Pending" ||
    site.commissioningPct === 100;
}

function performanceStatusLabel(site: SiteDetail) {
  const group = performanceStatusGroup(site);
  if (group === "commissioned") return "Commissioned";
  if (group === "installed") return "Installed";
  if (group === "assessed") return "Assessed";
  return "Not Started Yet";
}

function performanceProgress(site: SiteDetail) {
  const done = Number(hasAssessedMilestone(site)) + Number(hasInstalledMilestone(site)) + Number(hasCommissionedMilestone(site));
  return Math.round((done / 3) * 100);
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "Commissioned") return "success";
  if (status === "Installed" || status === "Assessed") return "info";
  if (status === "Not Started Yet") return "warning";
  return "info";
}

function completionPct(data: PhaseData, keys: string[]) {
  if (!data) return 0;
  return Math.round((keys.filter((k) => !!data[k]).length / keys.length) * 100);
}

function pct(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

function boolVal(v: any): string | undefined {
  if (v === true || v === "true") return "Yes";
  if (v === false || v === "false") return "No";
  return undefined;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return undefined;
  try {
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "FA";
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
  "final_mom_uploaded",
];
