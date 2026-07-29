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
  Search,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

type ViewMode = "company" | "consultant";
type ManagementStatus =
  | "Pending"
  | "Completed"
  | "Awaiting Confirmation"
  | "Submitted"
  | "Rejected"
  | "In Progress";

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
  status: ManagementStatus;
  rawStatus: string;
  createdAt: string;
};

const STATUS_OPTIONS: ManagementStatus[] = [
  "Pending",
  "Completed",
  "Awaiting Confirmation",
  "Submitted",
  "Rejected",
  "In Progress",
];

function managementStatus(status: string, visitStatus: string): ManagementStatus {
  if (status === "Completion" || status === "Completed & Billed") return "Completed";
  if (status === "Reject") return "Rejected";
  if (status === "Billing" || status === "Awaiting NPC Confirmation") {
    return "Awaiting Confirmation";
  }
  if (status === "Verification" || status === "Shipped" || visitStatus === "Visit Complete") {
    return "Submitted";
  }
  if (!status || status === "Assigned") return "Pending";
  return "In Progress";
}

function statusStyle(status: ManagementStatus) {
  switch (status) {
    case "Completed":
      return "border-mint/25 bg-mint-dim text-mint";
    case "Awaiting Confirmation":
      return "border-warning/25 bg-warning/10 text-warning";
    case "Submitted":
      return "border-violet/25 bg-violet/10 text-violet";
    case "Rejected":
      return "border-coral/25 bg-coral-dim text-coral";
    case "In Progress":
      return "border-[#3B82F6]/25 bg-[#3B82F6]/10 text-[#60A5FA]";
    default:
      return "border-border bg-surface-raised text-text-secondary";
  }
}

export function ReportsPanel() {
  const [view, setView] = useState<ViewMode>("company");
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [loading, setLoading] = useState(true);
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
      const [siteResult, consultantResult] = await Promise.all([
        supabase
          .from("sites")
          .select(
            "id,name,company_name,city,assigned_worker_id,task_notes,consultant_stage,created_at",
          )
          .order("created_at", { ascending: false }),
        supabase.from("profiles").select("id,name,mobile").order("name"),
      ]);

      if (siteResult.error)
        toast.error("Could not load factory report: " + siteResult.error.message);
      if (consultantResult.error) {
        toast.error("Could not load business consultants: " + consultantResult.error.message);
      }
      setSites(siteResult.data ?? []);
      setConsultants(consultantResult.data ?? []);
      setLoading(false);
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
    () =>
      sites.map((site) => {
        const meta = parseSiteMetadata(site.task_notes);
        const consultantIds =
          meta.worker_ids?.length > 0
            ? meta.worker_ids
            : site.assigned_worker_id
              ? [site.assigned_worker_id]
              : [];
        const rawStatus = site.consultant_stage || meta.status || "";
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
          status: managementStatus(rawStatus, meta.visit_status),
          rawStatus,
          createdAt: site.created_at,
        };
      }),
    [sites, consultantMap],
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
      completed: filteredRows.filter((row) => row.status === "Completed").length,
      pending: filteredRows.filter((row) => row.status === "Pending").length,
      awaiting: filteredRows.filter((row) => row.status === "Awaiting Confirmation").length,
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
      ["Company", "Factory", "City", "Business Consultant", "Status", "System Status", "Created"],
      ...filteredRows.map((row) => [
        row.companyName,
        row.factoryName,
        row.city,
        row.consultantNames.join(" | ") || "Unassigned",
        row.status,
        row.rawStatus,
        row.createdAt,
      ]),
    ].map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));

    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `factory-management-report-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
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
        <Button onClick={exportCsv} variant="secondary">
          <Download size={16} strokeWidth={1.5} /> Export CSV
        </Button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard icon={Factory} label="Total Factories" value={summary.total} tone="lime" />
        <SummaryCard icon={Building2} label="Companies" value={summary.companies} tone="violet" />
        <SummaryCard icon={CheckCircle2} label="Completed" value={summary.completed} tone="mint" />
        <SummaryCard icon={Clock3} label="Pending" value={summary.pending} tone="stone" />
        <SummaryCard
          icon={Clock3}
          label="Awaiting Action"
          value={summary.awaiting}
          tone="warning"
        />
      </section>

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
        active ? "bg-lime text-black" : "text-text-secondary hover:text-text-primary"
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
        const completed = group.rows.filter((row) => row.status === "Completed").length;
        const awaiting = group.rows.filter((row) => row.status === "Awaiting Confirmation").length;
        return (
          <section
            key={group.name}
            className="overflow-hidden rounded-[10px] border border-border bg-surface"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-raised px-5 py-4">
              <div>
                <h2 className="font-bold text-text-primary">{group.name}</h2>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-text-secondary">
                  {group.rows.length} {group.rows.length === 1 ? "factory" : "factories"}
                </p>
              </div>
              <div className="flex gap-2 font-mono text-[9px] uppercase tracking-wider">
                <span className="rounded-full bg-mint-dim px-2.5 py-1 text-mint">
                  {completed} completed
                </span>
                <span className="rounded-full bg-warning/10 px-2.5 py-1 text-warning">
                  {awaiting} awaiting
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr className="text-left font-mono text-[9px] uppercase tracking-widest text-text-secondary">
                    {showCompany && <th className="px-5 py-3">Company</th>}
                    <th className="px-5 py-3">Factory</th>
                    <th className="px-5 py-3">City</th>
                    {!showCompany && <th className="px-5 py-3">Consultant</th>}
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      {showCompany && (
                        <td className="px-5 py-3 text-text-secondary">{row.companyName}</td>
                      )}
                      <td className="px-5 py-3 font-semibold text-text-primary">
                        {row.factoryName}
                      </td>
                      <td className="px-5 py-3 text-text-secondary">{row.city}</td>
                      {!showCompany && (
                        <td className="px-5 py-3 text-text-secondary">
                          {row.consultantNames.join(", ") || "Unassigned"}
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
