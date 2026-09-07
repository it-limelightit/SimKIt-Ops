import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  Label,
  Select,
} from "@/components/ui-kit";
import {
  Boxes,
  Clock3,
  MapPin,
  PackageCheck,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  Cpu,
  Wifi,
  Calendar,
  Layers,
  Info,
  Truck,
  AlertCircle,
  Package,
  Trash2,
  X,
  FileText,
  Table2,
} from "lucide-react";
import { toast } from "sonner";
import { parseSiteMetadata } from "@/lib/site-metadata";
import { useAuth } from "@/lib/auth-store";
import { actorName, recordActivityLog } from "@/lib/activity-log";
import { deductStockForOrder, isTruthy } from "@/lib/inventory-service";


type Material = {
  id: string;
  material_name: string;
  quantity: number;
  unit: string;
  state: string;
  location: string | null;
  estimated_arrival: string | null;
  tracking_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  device_id: string | null;
  submitted: boolean | null;
  industry: string | null;
  version: string | null;
  ota_key: string | null;
  ota_account: string | null;
  mac_id: string | null;
  uplink: string | null;
  ct1: string | null;
  ct2: string | null;
  ct3: string | null;
  proxy1: string | null;
  proxy2: string | null;
  encoder: string | null;
  vibration: string | null;
  antenna: string | null;
  tower_light: string | null;
  dispatch: string | null;
  energy_meter: string | null;
  plc: string | null;
  flash_size: string | null;
  proxy_model: string | null;
  vibration_model: string | null;
  installation_date: string | null;
  iccid: string | null;
  remark: string | null;
};

type InventoryPanelProps = {
  editable?: boolean;
  defaultFilterState?: string;
};

type ViewMode = "cards" | "table";
type TableDateFilter = "all" | "thisMonth" | "lastMonth" | string;

const CUSTOM_OPTION_VALUE = "__custom__";
const DEFAULT_OTA_KEYS = [
  "0bda416c-b70b-48a4-9b5f-f9be1ad54669",
  "5e97f426-d490-420d-9462-e94c878d8e98",
];
const DEFAULT_OTA_ACCOUNTS = [
  "kuldeepshrimali.limelight@gmail.com",
];
const DEFAULT_COURIER_PARTNERS = ["Tirupati"];

function readCustomDropdownOptions(storageKey: string) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : [];
  } catch {
    return [];
  }
}

function writeCustomDropdownOption(storageKey: string, value: string) {
  if (typeof window === "undefined") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  const next = uniqueDropdownOptions([...readCustomDropdownOptions(storageKey), trimmed]);
  window.localStorage.setItem(storageKey, JSON.stringify(next));
}

function uniqueDropdownOptions(options: string[]) {
  const seen = new Set<string>();
  return options.reduce<string[]>((next, option) => {
    const trimmed = option.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return next;
    seen.add(key);
    next.push(trimmed);
    return next;
  }, []);
}

export function InventoryPanel({ editable = false, defaultFilterState = "all" }: InventoryPanelProps) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filterState, setFilterState] = useState<string>(defaultFilterState);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [tableDateFilter, setTableDateFilter] = useState<TableDateFilter>("all");
  const [tableLocationFilter, setTableLocationFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, filterState, tableDateFilter, tableLocationFilter, viewMode]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data, error } = await supabase
      .from("inventory_materials")
      .select("*")
      .eq("submitted", true)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Could not load logistics data: " + error.message);
      setMaterials([]);
    } else {
      setMaterials((data ?? []) as Material[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("logistics-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_materials" },
        () => void load(true),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const getLogisticsStatus = (m: Material): string => {
    try {
      if (m.notes && m.notes.startsWith("{")) {
        const parsed = JSON.parse(m.notes);
        if (parsed.logistics_status) {
          return parsed.logistics_status;
        }
      }
    } catch (e) { }
    return m.state === "In transit" ? "Transit" : (m.state || "Pending");
  };

  const scopedMaterials = useMemo(() => {
    return materials.filter((m) => {
      const notes = parseCourierNotes(m);
      const matchesQuery = `${m.material_name} ${m.device_id ?? ""} ${m.location ?? ""} ${m.tracking_number ?? ""} ${notes.courier_partner} ${notes.courier_id}`
        .toLowerCase()
        .includes(query.toLowerCase());

      const matchesDate = matchesTableDateFilter(getAnalysisDate(m), tableDateFilter);
      const matchesLocation =
        tableLocationFilter === "all" || getLogisticsCity(m.location) === tableLocationFilter;

      return matchesQuery && matchesDate && matchesLocation;
    });
  }, [materials, query, tableDateFilter, tableLocationFilter]);

  const filteredMaterials = useMemo(() => {
    return scopedMaterials.filter((m) => {
      const status = getLogisticsStatus(m);
      const normalizedStatus = normalizeLogisticsStatus(status);
      return filterState === "all" || normalizedStatus.toLowerCase() === filterState.toLowerCase();
    });
  }, [scopedMaterials, filterState]);

  const monthOptions = useMemo(() => {
    const monthKeys = new Set<string>();
    materials.forEach((m) => {
      const key = getMonthKey(getAnalysisDate(m));
      if (key) monthKeys.add(key);
    });
    return Array.from(monthKeys).sort((a, b) => b.localeCompare(a));
  }, [materials]);

  const locationOptions = useMemo(() => {
    const locations = new Set<string>();
    materials.forEach((m) => {
      const normalized = getLogisticsCity(m.location);
      if (normalized !== "Unassigned") locations.add(normalized);
    });
    return Array.from(locations).sort((a, b) => a.localeCompare(b));
  }, [materials]);

  const tableMaterials = useMemo(() => {
    return [...filteredMaterials].sort((a, b) => compareDatesDesc(getAnalysisDate(a), getAnalysisDate(b)));
  }, [filteredMaterials]);

  // Analytics Metrics (KTAs)
  const metrics = useMemo(() => {
    const total = scopedMaterials.length;
    let pending = 0;
    let packing = 0;
    let transit = 0;
    let delivered = 0;

    scopedMaterials.forEach((m) => {
      const status = normalizeLogisticsStatus(getLogisticsStatus(m));
      if (status === "Pending") pending++;
      else if (status === "Packing") packing++;
      else if (status === "Transit") transit++;
      else if (status === "Delivered") delivered++;
      else pending++;
    });

    return { total, pending, packing, transit, delivered };
  }, [scopedMaterials]);

  const ITEMS_PER_PAGE = 50;
  const totalItems = filteredMaterials.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedMaterials = filteredMaterials.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  return (
    <div className="space-y-7 animate-in fade-in duration-200">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-lime/80 font-bold">
            Live Logistics Pipelines
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setViewMode("cards");
                setFilterState("all");
              }}
              aria-pressed={viewMode === "cards"}
              className="text-left text-4xl uppercase tracking-tight font-extrabold font-syne text-text-primary transition hover:text-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
            >
              Logistic
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              aria-pressed={viewMode === "table"}
              className={`inline-flex h-12 w-[260px] shrink-0 items-center justify-center gap-3 whitespace-nowrap rounded-[6px] px-3 text-4xl font-extrabold transition ${
                viewMode === "table"
                  ? "bg-lime text-background"
                  : "border border-border bg-surface text-text-secondary hover:bg-surface-raised hover:text-text-primary"
              }`}
            >
              <Table2 size={22} />
              Device Info
            </button>
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            Track client device orders, pack hardware packages, configure OTA settings, and log courier shipments.
          </p>
        </div>
      </header>

      {/* Logistics Business Analytics KTAs */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
        <MetricCard
          icon={Boxes}
          label="Total Orders"
          value={metrics.total}
          tone="info"
          active={filterState === "all"}
          onClick={() => setFilterState("all")}
        />
        <MetricCard
          icon={AlertCircle}
          label="Pending Packing"
          value={metrics.pending}
          tone="danger"
          active={filterState === "Pending"}
          onClick={() => setFilterState("Pending")}
        />
        <MetricCard
          icon={Package}
          label="In Packing"
          value={metrics.packing}
          tone="warning"
          active={filterState === "Packing"}
          onClick={() => setFilterState("Packing")}
        />
        <MetricCard
          icon={Truck}
          label="Shipped / Transit"
          value={metrics.transit}
          tone="info"
          active={filterState === "Transit"}
          onClick={() => setFilterState("Transit")}
        />
        <MetricCard
          icon={PackageCheck}
          label="Delivered"
          value={metrics.delivered}
          tone="success"
          active={filterState === "Delivered"}
          onClick={() => setFilterState("Delivered")}
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
              className="text-xs sm:w-56"
            >
              <option value="all">All Statuses</option>
              <option value="Pending">Pending / Not Prepared</option>
              <option value="Packing">Packing</option>
              <option value="Transit">In Transit</option>
              <option value="Delivered">Delivered</option>
            </Select>
            <Select
              value={tableDateFilter}
              onChange={(e) => setTableDateFilter(e.target.value)}
              className="text-xs sm:w-44"
            >
              <option value="all">All Months</option>
              <option value="thisMonth">This Month</option>
              <option value="lastMonth">Last Month</option>
              {monthOptions.map((monthKey) => (
                <option key={monthKey} value={monthKey}>
                  {formatMonthLabel(monthKey)}
                </option>
              ))}
            </Select>
            <div className="relative sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" size={15} />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search orders by client name..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2 lg:items-end">
            <Select
              value={tableLocationFilter}
              onChange={(e) => setTableLocationFilter(e.target.value)}
              className="w-full text-xs sm:w-52"
            >
              <option value="all">All Cities</option>
              {locationOptions.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((x) => (
            <div key={x} className="h-44 animate-pulse rounded-[10px] bg-surface" />
          ))}
        </div>
      ) : filteredMaterials.length ? (
        viewMode === "table" ? (
          <LogisticsTableView
            materials={tableMaterials}
          />
        ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {paginatedMaterials.map((m) => (
              <OrderCard key={m.id} material={m} editable={editable} onReload={() => void load(true)} />
            ))}
          </div>

          {/* Pagination Bar */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border border-border bg-surface rounded-[10px] px-4 py-3 sm:px-6">
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
                          className={`inline-flex items-center justify-center text-xs font-mono font-bold h-8 w-8 rounded-[6px] transition-all cursor-pointer ${isActive
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
        )
      ) : (
        <EmptyState icon={Boxes} text="No logistics orders found." />
      )}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
  active = false,
  onClick,
}: {
  icon: any;
  label: string;
  value: number;
  tone: "info" | "warning" | "success" | "danger";
  active?: boolean;
  onClick?: () => void;
}) {
  const bgClass =
    tone === "success"
      ? "bg-mint/15 text-mint"
      : tone === "warning"
        ? "bg-warning/15 text-warning"
        : tone === "danger"
          ? "bg-coral/15 text-coral"
          : "bg-violet/15 text-violet";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-[9px] border bg-surface px-4 py-3 text-left transition-all hover:border-lime/60 hover:bg-surface-hover ${
        active ? "border-lime ring-2 ring-lime/15" : "border-border"
      }`}
    >
      <div className={`rounded-[6px] p-2 ${bgClass}`}>
        <Icon size={18} />
      </div>
      <div>
        <div className="text-xl font-extrabold text-text-primary">{value}</div>
        <div className="font-mono text-[9px] uppercase tracking-widest text-text-secondary">
          {label}
        </div>
      </div>
    </button>
  );
}

function parseCourierNotes(material: Material): CourierNotes {
  try {
    if (material.notes && material.notes.startsWith("{")) {
      const parsed = JSON.parse(material.notes) as Partial<CourierNotes>;
      return {
        courier_partner: parsed.courier_partner || "",
        packing_date: parsed.packing_date || "",
        transit_date: parsed.transit_date || "",
        arrived_date: parsed.arrived_date || "",
        courier_id: parsed.courier_id || "",
        logistics_status:
          parsed.logistics_status || (material.state === "In transit" ? "Transit" : material.state || "Pending"),
      };
    }
  } catch {
    // Keep table analytics resilient when notes contain legacy free text.
  }

  return {
    courier_partner: "",
    packing_date: "",
    transit_date: "",
    arrived_date: "",
    courier_id: "",
    logistics_status: material.state === "In transit" ? "Transit" : material.state || "Pending",
  };
}

function getMonthKey(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getRelativeMonthKey(offset: number) {
  const date = new Date();
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function compareDatesDesc(a: string | null | undefined, b: string | null | undefined) {
  const first = parseDate(a)?.getTime() ?? 0;
  const second = parseDate(b)?.getTime() ?? 0;
  return second - first;
}

function addDaysToDate(value: string | null | undefined, days: number) {
  const date = parseDate(value);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function formatDisplayDate(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(date);
}

function getLogisticsCity(location: string | null | undefined) {
  const parts = (location || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "Unassigned";

  const ignoredParts = new Set([
    "india",
    "gujarat",
    "rajasthan",
    "maharashtra",
    "madhya pradesh",
    "delhi",
    "karnataka",
    "telangana",
    "tamil nadu",
    "uttar pradesh",
  ]);
  const city = [...parts].reverse().find((part) => {
    const cleaned = part.replace(/[0-9-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    return cleaned && !ignoredParts.has(cleaned);
  });
  return city?.replace(/\s*[-/]?\s*\d{5,6}\s*$/, "").trim() || "Unassigned";
}

function boolLabel(value: string | null | undefined) {
  if (value === "TRUE" || value === "true" || value === "1") return "Yes";
  if (value === "FALSE" || value === "false" || value === "0") return "No";
  return value || "-";
}

function normalizeLogisticsStatus(status: string) {
  if (status === "In transit" || status === "Transit" || status === "Shipped") return "Transit";
  if (status === "Packing") return "Packing";
  if (status === "Delivered") return "Delivered";
  return "Pending";
}

function isSensorChecked(value: string | null | undefined) {
  return value === "TRUE" || value === "true" || value === "1" || value === "yes" || value === "Yes";
}

function getAnalysisDate(material: Material) {
  const notes = parseCourierNotes(material);
  const status = normalizeLogisticsStatus(notes.logistics_status || material.state || "Pending");

  if (status === "Delivered") {
    return addDaysToDate(material.created_at, 2) || notes.arrived_date || notes.transit_date || material.updated_at || material.created_at;
  }

  return notes.transit_date || notes.packing_date || material.updated_at || material.installation_date || material.created_at;
}

function matchesTableDateFilter(value: string | null | undefined, filter: TableDateFilter) {
  if (filter === "all") return true;
  const monthKey = getMonthKey(value);
  if (!monthKey) return false;
  if (filter === "thisMonth") return monthKey === getRelativeMonthKey(0);
  if (filter === "lastMonth") return monthKey === getRelativeMonthKey(-1);
  return monthKey === filter;
}

function LogisticsTableView({
  materials,
}: {
  materials: Material[];
}) {
  return (
    <div>
      <Card className="rounded-[10px] border border-border bg-surface p-0">
        <div className="flex flex-col gap-2 border-b border-border px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-base font-extrabold text-text-primary">Logistics Analysis Table</h2>
            <p className="mt-1 text-xs text-text-secondary">
              Live device data grouped for date, delivery, location, courier, and hardware analysis.
            </p>
          </div>
        </div>

        {materials.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[4040px] w-full table-fixed border-separate border-spacing-0 text-left text-xs">
              <colgroup>
                <col className="w-32" />
                <col className="w-72" />
                <col className="w-40" />
                <col className="w-40" />
                <col className="w-32" />
                <col className="w-40" />
                <col className="w-48" />
                <col className="w-36" />
                <col className="w-36" />
                <col className="w-36" />
                <col className="w-40" />
                <col className="w-32" />
                <col className="w-32" />
                {Array.from({ length: 11 }, (_, index) => <col key={`boolean-column-${index}`} className="w-28" />)}
                <col className="w-36" />
                <col className="w-48" />
                <col className="w-40" />
                <col className="w-56" />
                <col className="w-72" />
              </colgroup>
              <thead className="sticky top-0 z-20 bg-surface-raised text-[10px] uppercase tracking-widest text-text-secondary">
                <tr>
                  {[
                    "Date",
                    "Company",
                    "Location",
                    "Device ID",
                    "Status",
                    "Courier",
                    "Tracking",
                    "Packing",
                    "Transit",
                    "Delivered",
                    "Industry",
                    "Version",
                    "Uplink",
                    "CT1",
                    "CT2",
                    "CT3",
                    "Proxy1",
                    "Proxy2",
                    "Encoder",
                    "Vibration",
                    "Antenna",
                    "Tower",
                    "Energy",
                    "PLC",
                    "Flash",
                    "Vibration Model",
                    "Proxy Model",
                    "ICCID",
                    "Remark",
                  ].map((heading, index) => (
                    <th
                      key={heading}
                      className={`whitespace-nowrap border-b border-border px-3 py-3 font-bold ${
                        index === 0 ? "sticky left-0 z-30 w-32 min-w-32 border-r border-border bg-surface-raised" : ""
                      } ${index === 1 ? "sticky left-32 z-30 w-72 min-w-72 border-r border-border bg-surface-raised" : ""}`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {materials.map((material) => {
                  const notes = parseCourierNotes(material);
                  const status = getStatusForRow(material);
                  return (
                    <tr
                      key={material.id}
                      className="group border-b border-border odd:bg-surface even:bg-surface-raised/25 hover:bg-lime/5"
                    >
                      <TableCellValue sticky="left">{formatDisplayDate(getAnalysisDate(material))}</TableCellValue>
                      <TableCellValue sticky="company" strong>
                        {material.material_name}
                      </TableCellValue>
                      <TableCellValue>{material.location || "Address not available"}</TableCellValue>
                      <TableCellValue mono>{material.device_id || "-"}</TableCellValue>
                      <td className="overflow-hidden border-b border-border/70 px-3 py-3 align-top text-text-secondary">
                        <span className={`rounded-[5px] px-2 py-1 text-[10px] font-bold uppercase ${statusClass(status)}`}>
                          {status}
                        </span>
                      </td>
                      <TableCellValue>{notes.courier_partner || "-"}</TableCellValue>
                      <TableCellValue mono>{material.tracking_number || notes.courier_id || "-"}</TableCellValue>
                      <TableCellValue>{formatDisplayDate(notes.packing_date)}</TableCellValue>
                      <TableCellValue>{formatDisplayDate(notes.transit_date)}</TableCellValue>
                      <TableCellValue>{formatDisplayDate(notes.arrived_date)}</TableCellValue>
                      <TableCellValue>{material.industry || "-"}</TableCellValue>
                      <TableCellValue>{material.version || "-"}</TableCellValue>
                      <TableCellValue>{material.uplink || "-"}</TableCellValue>
                      <SensorCell value={material.ct1} />
                      <SensorCell value={material.ct2} />
                      <SensorCell value={material.ct3} />
                      <SensorCell value={material.proxy1} />
                      <SensorCell value={material.proxy2} />
                      <SensorCell value={material.encoder} />
                      <SensorCell value={material.vibration} />
                      <SensorCell value={material.antenna} />
                      <SensorCell value={material.tower_light} />
                      <SensorCell value={material.energy_meter} />
                      <SensorCell value={material.plc} />
                      <TableCellValue>{material.flash_size || "-"}</TableCellValue>
                      <TableCellValue>{material.vibration_model || "-"}</TableCellValue>
                      <TableCellValue>{material.proxy_model || "-"}</TableCellValue>
                      <TableCellValue mono>{material.iccid || "-"}</TableCellValue>
                      <TableCellValue>{material.remark || "-"}</TableCellValue>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-6">
            <EmptyState icon={Table2} text="No logistics rows match these table filters." />
          </div>
        )}
      </Card>
    </div>
  );
}

function getStatusForRow(material: Material) {
  return parseCourierNotes(material).logistics_status || material.state || "Pending";
}

function statusClass(status: string) {
  if (status === "Delivered") return "bg-mint/15 text-mint";
  if (status === "Packing") return "bg-warning/15 text-warning";
  if (status === "Transit" || status === "In transit" || status === "Shipped") return "bg-violet/15 text-violet";
  return "bg-coral/15 text-coral";
}

function TableCellValue({
  children,
  strong = false,
  mono = false,
  sticky,
}: {
  children: ReactNode;
  strong?: boolean;
  mono?: boolean;
  sticky?: "left" | "company";
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <td
      className={`overflow-hidden border-b border-border/70 px-3 py-3 align-top text-text-secondary ${
        strong ? "font-semibold text-text-primary" : ""
      } ${mono ? "font-mono text-[11px]" : ""} ${
        sticky === "left"
          ? "sticky left-0 z-20 w-32 min-w-32 max-w-32 border-r border-border/80 bg-surface whitespace-nowrap"
          : sticky === "company"
            ? "sticky left-32 z-20 w-72 min-w-72 max-w-72 border-r border-border/80 bg-surface"
            : ""
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        title="Click to expand this cell"
        aria-label="Click to expand this cell"
        onClick={() => setExpanded((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setExpanded((current) => !current);
          }
        }}
        className={`cursor-pointer rounded-[3px] outline-none transition-colors hover:bg-lime/10 focus-visible:ring-1 focus-visible:ring-lime ${
          expanded ? "whitespace-normal break-words leading-5" : "truncate whitespace-nowrap"
        }`}
      >
        {children}
      </div>
    </td>
  );
}

function SensorCell({ value }: { value: string | null | undefined }) {
  const checked = isSensorChecked(value);
  return (
    <td className="border-b border-border/70 px-3 py-3 align-top text-center">
      <span
        title={checked ? "Enabled" : "Not enabled"}
        aria-label={checked ? "Enabled" : "Not enabled"}
        className={`inline-flex h-5 w-5 items-center justify-center rounded-[4px] border ${
          checked ? "border-lime bg-lime text-background" : "border-border bg-surface-raised text-text-dim"
        }`}
      >
        {checked ? "✓" : ""}
      </span>
    </td>
  );
}

interface CourierNotes {
  courier_partner: string;
  packing_date: string;
  transit_date: string;
  arrived_date: string;
  courier_id: string;
  logistics_status?: string;
}

function DropdownWithCustomOption({
  label,
  value,
  onChange,
  defaultOptions,
  storageKey,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  defaultOptions: string[];
  storageKey: string;
  placeholder: string;
}) {
  const [customOptions, setCustomOptions] = useState<string[]>(() => readCustomDropdownOptions(storageKey));
  const options = useMemo(
    () => uniqueDropdownOptions([...defaultOptions, ...customOptions, ...(value ? [value] : [])]),
    [customOptions, defaultOptions, value],
  );
  const isKnownValue = !value || options.includes(value);
  const [showCustomInput, setShowCustomInput] = useState(!isKnownValue);
  const [customValue, setCustomValue] = useState(isKnownValue ? "" : value);

  useEffect(() => {
    const nextCustomOptions = readCustomDropdownOptions(storageKey);
    setCustomOptions(nextCustomOptions);
    const nextOptions = uniqueDropdownOptions([...defaultOptions, ...nextCustomOptions]);
    const nextIsKnownValue = !value || nextOptions.includes(value);
    setShowCustomInput(!nextIsKnownValue);
    setCustomValue(nextIsKnownValue ? "" : value);
  }, [defaultOptions, storageKey, value]);

  const addCustomValue = () => {
    const trimmed = customValue.trim();
    if (!trimmed) return;
    writeCustomDropdownOption(storageKey, trimmed);
    setCustomOptions(readCustomDropdownOptions(storageKey));
    onChange(trimmed);
    setShowCustomInput(false);
  };

  return (
    <div>
      <Label>{label}</Label>
      <Select
        value={showCustomInput ? CUSTOM_OPTION_VALUE : value}
        onChange={(e) => {
          const nextValue = e.target.value;
          if (nextValue === CUSTOM_OPTION_VALUE) {
            setShowCustomInput(true);
            setCustomValue(value);
            return;
          }
          setShowCustomInput(false);
          onChange(nextValue);
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value={CUSTOM_OPTION_VALUE}>Add custom...</option>
      </Select>
      {showCustomInput && (
        <div className="mt-2 flex gap-2">
          <Input
            value={customValue}
            onChange={(e) => {
              setCustomValue(e.target.value);
              onChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomValue();
              }
            }}
            placeholder={`Enter ${label.toLowerCase()}`}
          />
          <Button type="button" variant="secondary" onClick={addCustomValue} className="shrink-0 px-3">
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

function OrderCard({
  material,
  editable,
  onReload,
}: {
  material: Material;
  editable: boolean;
  onReload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const { userId, email, profile } = useAuth();
  const currentActorName = actorName(profile, email, userId);

  // Date parsing for Notes JSON
  const initialNotes: CourierNotes = useMemo(() => {
    try {
      if (material.notes && material.notes.startsWith("{")) {
        const parsed = JSON.parse(material.notes);
        if (!parsed.logistics_status) {
          parsed.logistics_status = material.state === "In transit" ? "Transit" : (material.state || "Pending");
        }
        return parsed;
      }
    } catch (e) {
      // ignore
    }
    return {
      courier_partner: "",
      packing_date: "",
      transit_date: "",
      arrived_date: "",
      courier_id: "",
      logistics_status: material.state === "In transit" ? "Transit" : (material.state || "Pending")
    };
  }, [material.notes, material.state]);

  const handleDelete = async () => {
    const confirmDelete = window.confirm(
      `Are you sure you want to delete the order for ${material.material_name}? This action cannot be undone.`
    );
    if (!confirmDelete) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("inventory_materials")
        .delete()
        .eq("id", material.id);

      if (error) throw error;

      await recordActivityLog({
        actor_id: userId,
        actor_name: currentActorName,
        action: "delete",
        entity_type: "logistics_order",
        entity_id: material.id,
        entity_name: material.material_name,
        company_name: material.material_name,
        from_value: initialNotes.logistics_status || material.state || "Existing",
        to_value: "Deleted",
      });
      toast.success("Order deleted successfully.");
      setExpanded(false);
      onReload();
    } catch (err: any) {
      toast.error("Failed to delete order: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  const downloadPDF = async () => {
    try {
      const [{ jsPDF }] = await Promise.all([
        import("jspdf"),
      ]);

      const { data: latestMaterial } = await supabase
        .from("inventory_materials")
        .select("*")
        .eq("id", material.id)
        .maybeSingle();

      const pdfMaterial = (latestMaterial as Material | null) || material;

      const normalizeMobileForPdf = (mobile?: string | null) => {
        const value = (mobile || "").trim();
        if (!value) return "";
        return value.startsWith("+") ? value : `+91 ${value}`;
      };

      const firstFilledMobile = (...values: Array<string | null | undefined>) => {
        for (const value of values) {
          const normalized = normalizeMobileForPdf(value);
          if (normalized) return normalized;
        }
        return "N/A";
      };

      // Query database for recipient's address and mobile number dynamically
      let dynamicAddress = "";
      let recipientMobile = "N/A";
      try {
        const { data: byCompany } = await supabase
          .from("sites")
          .select("id, address, city, task_notes")
          .eq("company_name", pdfMaterial.material_name)
          .limit(1)
          .maybeSingle();

        let siteRecord = byCompany;

        if (!siteRecord) {
          const { data: byName } = await supabase
            .from("sites")
            .select("id, address, city, task_notes")
            .eq("name", pdfMaterial.material_name)
            .limit(1)
            .maybeSingle();
          siteRecord = byName;
        }

        if (siteRecord) {
          const { data: assessData } = await supabase
            .from("assessment")
            .select("data")
            .eq("site_id", siteRecord.id)
            .limit(1)
            .maybeSingle();
          const aData = assessData?.data || {};

          if (siteRecord.address && siteRecord.address.trim()) {
            dynamicAddress = siteRecord.address.trim();
          } else {
            if (aData.factory_op_address && typeof aData.factory_op_address === "string" && aData.factory_op_address.trim()) {
              dynamicAddress = aData.factory_op_address.trim();
            } else if (aData.registered_address && typeof aData.registered_address === "string" && aData.registered_address.trim()) {
              dynamicAddress = aData.registered_address.trim();
            }
          }

          const { data: contactData } = await supabase
            .from("contacts")
            .select("mobile")
            .eq("site_id", siteRecord.id)
            .limit(1)
            .maybeSingle();
          const siteMeta = parseSiteMetadata(siteRecord.task_notes ?? null);
          const ownerMobile = Array.isArray(aData.factory_op_owners) ? aData.factory_op_owners[0]?.contact : "";
          const technicianMobile = Array.isArray(aData.factory_op_technicians) ? aData.factory_op_technicians[0]?.contact : "";
          recipientMobile = firstFilledMobile(
            contactData?.mobile,
            siteMeta.c1_mobile,
            siteMeta.c2_mobile,
            ownerMobile,
            technicianMobile
          );
        } else {
          recipientMobile = "N/A";
        }
      } catch (err) {
        console.error("Error fetching recipient contact & address:", err);
        recipientMobile = "N/A";
      }

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

      const locationText = dynamicAddress || pdfMaterial.location || "Address not specified";
      const wrapWidth = 106;

      // Wrap address text at base font size first to calculate line count
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(11);
      let splitLocation = doc.splitTextToSize(locationText, wrapWidth);
      const addressLinesCount = splitLocation.length;

      // Keep the address label compact enough to share a landscape page with the device checklist.
      let fontSizeTitle = 22;
      let fontSizeHeader = 16;
      let fontSizeContent = 12;
      let lineSpacing = 7;
      let sectionSpacing = 8;

      if (addressLinesCount <= 2) {
        fontSizeTitle = 24;
        fontSizeHeader = 18;
        fontSizeContent = 13;
        lineSpacing = 9;
        sectionSpacing = 11;
      } else if (addressLinesCount > 5) {
        fontSizeTitle = 20;
        fontSizeHeader = 15;
        fontSizeContent = 11;
        lineSpacing = 6;
        sectionSpacing = 7;
      }

      // Re-evaluate wrap width at actual target font size
      doc.setFontSize(fontSizeContent);
      splitLocation = doc.splitTextToSize(locationText, wrapWidth);

      // Compute relative offsets from startY of each label box
      // Order: TO (recipient) on top, FROM (LimelightIT) on bottom
      const titleOffset = 10;
      const headerDividerOffset = 16;

      // TO section (upper)
      const toHeaderOffset = headerDividerOffset + sectionSpacing;
      const toCompanyOffset = toHeaderOffset + lineSpacing;

      let currentOffset = toCompanyOffset + lineSpacing;
      const toAddressOffsets: number[] = [];
      splitLocation.forEach(() => {
        toAddressOffsets.push(currentOffset);
        currentOffset += lineSpacing;
      });

      const toMobileOffset = currentOffset;
      const toBottomOffset = toMobileOffset + sectionSpacing;

      // FROM section (lower)
      const fromToDividerOffset = toBottomOffset;
      const fromHeaderOffset = fromToDividerOffset + sectionSpacing;
      const fromCompanyOffset = fromHeaderOffset + lineSpacing;
      const fromAddr1Offset = fromCompanyOffset + lineSpacing;
      const fromAddr2Offset = fromAddr1Offset + lineSpacing;
      const fromMobileOffset = fromAddr2Offset + lineSpacing;

      // Both landscape cards use the same fixed dimensions and alignment.
      const startX = 12;
      const width = 132;
      const cardHeight = 150;
      const totalBoxHeight = cardHeight;

      // Helper function to render a single label
      const renderLabel = (startY: number) => {
        // Outer rounded rectangle box enclosing the entire label (border)
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.8);
        doc.roundedRect(startX, startY, width, totalBoxHeight, 5, 5, "D");

        // Draw horizontal dividing lines
        doc.setLineWidth(0.5);
        doc.line(startX, startY + headerDividerOffset, startX + width, startY + headerDividerOffset); // Header divider
        doc.line(startX, startY + fromToDividerOffset, startX + width, startY + fromToDividerOffset); // TO-FROM divider

        // Render Title Section
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(fontSizeTitle);
        doc.setTextColor(0, 0, 0);
        doc.text("COURIER ADDRESS LABEL", startX + width / 2, startY + titleOffset, { align: "center" });

        // Render TO Section (upper half — recipient first)
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(fontSizeHeader);
        doc.text("TO", startX + 7, startY + toHeaderOffset);

        // Recipient Company Name (bold & uppercase)
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(fontSizeContent);
        const recipientName = (pdfMaterial.material_name || "N/A").toUpperCase();
        doc.text(recipientName, startX + 7, startY + toCompanyOffset);

        // Recipient Address (split to wrap nicely)
        doc.setFont("Helvetica", "normal");
        splitLocation.forEach((line: string, index: number) => {
          doc.text(line, startX + 7, startY + toAddressOffsets[index]);
        });

        // Recipient Mobile
        doc.text(`Mobile: ${recipientMobile}`, startX + 7, startY + toMobileOffset);

        // Render FROM Section (lower half — sender)
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(fontSizeHeader);
        doc.text("FROM", startX + 7, startY + fromHeaderOffset);

        doc.setFont("Helvetica", "bold");
        doc.setFontSize(fontSizeContent);
        doc.text("LimelightIT", startX + 7, startY + fromCompanyOffset);

        doc.setFont("Helvetica", "normal");
        doc.text("A/448, Money Plant High Street,", startX + 7, startY + fromAddr1Offset);
        doc.text("Gota, Ahmedabad, Gujarat - 382470", startX + 7, startY + fromAddr2Offset);
        doc.text("Mobile: +91 93130 48188", startX + 7, startY + fromMobileOffset);
      };

      const pageHeight = 210;
      const labelStartY = Math.max(12, (pageHeight - totalBoxHeight) / 2);
      renderLabel(labelStartY);

      // Use the right side for the selected device order and its sensor checklist.
      const panelX = 153;
      const panelY = labelStartY;
      const panelWidth = width;
      const panelHeight = cardHeight;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      doc.roundedRect(panelX, panelY, panelWidth, panelHeight, 4, 4, "D");
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(15);
      doc.text("DEVICE ORDER", panelX + 6, panelY + 11);
      doc.setFontSize(10);
      doc.text("SELECTED ITEM", panelX + 6, panelY + 18);
      doc.setLineWidth(0.3);
      doc.line(panelX + 6, panelY + 22, panelX + panelWidth - 6, panelY + 22);

      const deviceInfo = [
        ["Device", pdfMaterial.device_id || "N/A"],
        ["Version", pdfMaterial.version || "N/A"],
        ["Uplink", pdfMaterial.uplink || "N/A"],
        ["ICCID", pdfMaterial.iccid || "N/A"],
      ];
      let infoY = panelY + 31;
      deviceInfo.forEach(([label, value]) => {
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(8.5);
        doc.text(`${label}:`, panelX + 6, infoY);
        doc.setFont("Helvetica", "normal");
        doc.setFontSize(8.5);
        const valueLines = doc.splitTextToSize(value, panelWidth - 28);
        doc.text(valueLines, panelX + 25, infoY);
        infoY += Math.max(7, valueLines.length * 4.5);
      });

      const sensorItems = ([
        ["CT 1 Clamp", isSensorChecked(pdfMaterial.ct1)],
        ["CT 2 Clamp", isSensorChecked(pdfMaterial.ct2)],
        ["CT 3 Clamp", isSensorChecked(pdfMaterial.ct3)],
        ["Proxy 1", isSensorChecked(pdfMaterial.proxy1)],
        ["Proxy 2", isSensorChecked(pdfMaterial.proxy2)],
        ["Encoder", isSensorChecked(pdfMaterial.encoder)],
        ["Vibration", isSensorChecked(pdfMaterial.vibration)],
        ["Antenna", isSensorChecked(pdfMaterial.antenna)],
        ["Tower Light", isSensorChecked(pdfMaterial.tower_light)],
        ["Energy Meter", isSensorChecked(pdfMaterial.energy_meter)],
        ["PLC", isSensorChecked(pdfMaterial.plc)],
      ] as Array<[string, boolean]>).filter(([, checked]) => checked);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(10);
      doc.text("ORDERED SENSORS", panelX + 6, infoY + 4);
      const checklistStartY = infoY + 12;
      const columnWidth = 43;
      const rowHeight = 10;
      sensorItems.forEach(([label, checked], index) => {
        const column = index < 6 ? 0 : 1;
        const row = index < 6 ? index : index - 6;
        const itemX = panelX + 6 + column * columnWidth;
        const itemY = checklistStartY + row * rowHeight;
        doc.setDrawColor(0, 0, 0);
        doc.rect(itemX, itemY - 4.5, 4.5, 4.5);
        if (checked) {
          doc.setLineWidth(0.6);
          doc.line(itemX + 0.8, itemY - 2.2, itemX + 2, itemY - 1);
          doc.line(itemX + 2, itemY - 1, itemX + 4, itemY - 4);
        }
        doc.setFont("Helvetica", "normal");
        doc.setFontSize(8);
        doc.text(label, itemX + 7, itemY - 1);
      });
      if (!sensorItems.length) {
        doc.setFont("Helvetica", "normal");
        doc.setFontSize(8);
        doc.text("No sensors ordered", panelX + 6, checklistStartY);
      }

      // Save Label PDF
      const safeName = (pdfMaterial.material_name || "company").toLowerCase().replace(/[^a-z0-9]/g, "_");
      const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
      const fileName = `courier_label_${safeName}_${timestamp}.pdf`;
      doc.save(fileName);
      toast.success("Logistics PDF downloaded!");
    } catch (error: any) {
      toast.error("Failed to generate PDF label: " + error.message);
    }
  };

  // Form State - Step 1
  const [ct1, setCt1] = useState(isTruthy(material.ct1));
  const [ct2, setCt2] = useState(isTruthy(material.ct2));
  const [ct3, setCt3] = useState(isTruthy(material.ct3));
  const [proxy1, setProxy1] = useState(isTruthy(material.proxy1));
  const [proxy2, setProxy2] = useState(isTruthy(material.proxy2));
  const [encoder, setEncoder] = useState(isTruthy(material.encoder));
  const [vibration, setVibration] = useState(isTruthy(material.vibration));
  const [antenna, setAntenna] = useState(isTruthy(material.antenna));
  const [towerLight, setTowerLight] = useState(isTruthy(material.tower_light));
  const [energyMeter, setEnergyMeter] = useState(isTruthy(material.energy_meter));
  const [plc, setPlc] = useState(isTruthy(material.plc));

  const [version, setVersion] = useState(material.version || "");
  const [otaKey, setOtaKey] = useState(material.ota_key || "");
  const [otaAccount, setOtaAccount] = useState(material.ota_account || "");
  const [uplink, setUplink] = useState(material.uplink || "");
  const [iccid, setIccid] = useState(material.iccid || "");
  const [deviceName, setDeviceName] = useState(material.device_id || "");

  // Form State - Step 2
  const [state, setState] = useState(initialNotes.logistics_status || "Pending");
  const [courierId, setCourierId] = useState(material.tracking_number || "");
  const [courierPartner, setCourierPartner] = useState(material.dispatch || "");

  const [packingDate, setPackingDate] = useState(initialNotes.packing_date || "");
  const [transitDate, setTransitDate] = useState(initialNotes.transit_date || "");
  const [arrivedDate, setArrivedDate] = useState(initialNotes.arrived_date || "");

  // Quick Edit State (On outer card)
  const [quickCourierId, setQuickCourierId] = useState(material.tracking_number || "");
  const [quickStatus, setQuickStatus] = useState(initialNotes.logistics_status || "Pending");
  const [quickSaving, setQuickSaving] = useState(false);

  // Sync state with latest material values
  useEffect(() => {
    setCt1(isTruthy(material.ct1));
    setCt2(isTruthy(material.ct2));
    setCt3(isTruthy(material.ct3));
    setProxy1(isTruthy(material.proxy1));
    setProxy2(isTruthy(material.proxy2));
    setEncoder(isTruthy(material.encoder));
    setVibration(isTruthy(material.vibration));
    setAntenna(isTruthy(material.antenna));
    setTowerLight(isTruthy(material.tower_light));
    setEnergyMeter(isTruthy(material.energy_meter));
    setPlc(isTruthy(material.plc));

    setCourierId(material.tracking_number || "");
    setState(initialNotes.logistics_status || "Pending");
    setCourierPartner(material.dispatch || "");
    setPackingDate(initialNotes.packing_date || "");
    setTransitDate(initialNotes.transit_date || "");
    setArrivedDate(initialNotes.arrived_date || "");
    setVersion(material.version || "");
    setOtaKey(material.ota_key || "");
    setOtaAccount(material.ota_account || "");
    setUplink(material.uplink || "");
    setIccid(material.iccid || "");
    setDeviceName(material.device_id || "");

    setQuickCourierId(material.tracking_number || "");
    setQuickStatus(initialNotes.logistics_status || "Pending");
  }, [material, initialNotes]);


  // Handle Quick Save from outer card
  const handleSaveQuick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) return;
    if (!deviceName.trim()) {
      toast.error("Please enter device name.");
      return;
    }
    setQuickSaving(true);

    let currentPackingDate = packingDate;
    let currentTransitDate = transitDate;
    let currentArrivedDate = arrivedDate;

    const nowStr = new Date().toISOString().split("T")[0];
    if (quickStatus === "Packing" && !currentPackingDate) {
      currentPackingDate = nowStr;
    } else if (quickStatus === "Transit" && !currentTransitDate) {
      currentTransitDate = nowStr;
      if (!currentPackingDate) currentPackingDate = nowStr;
    } else if (quickStatus === "Delivered" && !currentArrivedDate) {
      currentArrivedDate = nowStr;
      if (!currentPackingDate) currentPackingDate = nowStr;
      if (!currentTransitDate) currentTransitDate = nowStr;
    }

    const newNotes: CourierNotes = {
      ...initialNotes,
      logistics_status: quickStatus,
      courier_id: quickCourierId,
      packing_date: currentPackingDate,
      transit_date: currentTransitDate,
      arrived_date: currentArrivedDate,
    };

    const { error } = await supabase
      .from("inventory_materials")
      .update({
        device_id: deviceName.trim(),
        tracking_number: quickCourierId || null,
        state: quickStatus === "Transit" ? "In transit" : quickStatus,
        notes: JSON.stringify(newNotes),
      })
      .eq("id", material.id);

    if (!error && (quickStatus === "Packing" || quickStatus === "Transit" || quickStatus === "Delivered")) {
      void deductStockForOrder({
        orderId: material.id,
        orderCreatedAt: material.created_at,
        counts: {
          datameter_box: material.quantity || 1,
          ct1: isTruthy(material.ct1) ? 1 : 0,
          ct2: isTruthy(material.ct2) ? 1 : 0,
          ct3: isTruthy(material.ct3) ? 1 : 0,
          proxy1: isTruthy(material.proxy1) ? 1 : 0,
          proxy2: isTruthy(material.proxy2) ? 1 : 0,
          vibration: isTruthy(material.vibration) ? 1 : 0,
          encoder: isTruthy(material.encoder) ? 1 : 0,
          tower_light: isTruthy(material.tower_light) ? 1 : 0,
          antenna: isTruthy(material.antenna) ? 1 : 0,
          energy_meter: isTruthy(material.energy_meter) ? 1 : 0,
          plc: isTruthy(material.plc) ? 1 : 0,
        },
      });
    }


    setQuickSaving(false);

    if (error) {
      toast.error("Failed to save quick updates: " + error.message);
    } else {
      await recordActivityLog({
        actor_id: userId,
        actor_name: currentActorName,
        action: "logistics_update",
        entity_type: "logistics_order",
        entity_id: material.id,
        entity_name: material.material_name,
        company_name: material.material_name,
        from_value: initialNotes.logistics_status || material.state || "Pending",
        to_value: quickStatus,
        details: { field: "quick_courier", tracking_number: quickCourierId || null },
      });
      toast.success("Courier info updated!");
      onReload();
    }
  };

  // Save Step 1 (Packing checklist and configurations)
  const handleSaveStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editable) return;
    if (!deviceName.trim()) {
      toast.error("Please enter device name.");
      return;
    }
    setSaving(true);

    const { error } = await supabase
      .from("inventory_materials")
      .update({
        device_id: deviceName.trim(),
        ct1: ct1 ? "TRUE" : "FALSE",
        ct2: ct2 ? "TRUE" : "FALSE",
        ct3: ct3 ? "TRUE" : "FALSE",
        proxy1: proxy1 ? "TRUE" : "FALSE",
        proxy2: proxy2 ? "TRUE" : "FALSE",
        encoder: encoder ? "TRUE" : "FALSE",
        vibration: vibration ? "TRUE" : "FALSE",
        antenna: antenna ? "TRUE" : "FALSE",
        tower_light: towerLight ? "TRUE" : "FALSE",
        energy_meter: energyMeter ? "TRUE" : "FALSE",
        plc: plc ? "TRUE" : "FALSE",
        version: version || null,
        ota_key: otaKey || null,
        ota_account: otaAccount || null,
        uplink: uplink || null,
        iccid: iccid || null,
      })
      .eq("id", material.id);

    setSaving(false);
    if (error) {
      toast.error("Failed to save hardware configuration: " + error.message);
    } else {
      await recordActivityLog({
        actor_id: userId,
        actor_name: currentActorName,
        action: "update",
        entity_type: "logistics_order",
        entity_id: material.id,
        entity_name: material.material_name,
        company_name: material.material_name,
        from_value: "Hardware Configuration",
        to_value: "Updated",
      });
      toast.success("Hardware configuration saved.");
      setStep(2); // Go to Courier Step
      onReload();
    }
  };

  // Save Step 2 (Courier info and final status)
  const handleSaveStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editable) return;
    if (!deviceName.trim()) {
      toast.error("Please enter device name.");
      return;
    }
    setSaving(true);

    // Save corresponding date based on the selected status
    let currentPackingDate = packingDate;
    let currentTransitDate = transitDate;
    let currentArrivedDate = arrivedDate;

    const todayStr = new Date().toISOString().split("T")[0];
    if (state === "Packing" && !packingDate) {
      currentPackingDate = todayStr;
      setPackingDate(todayStr);
    } else if (state === "Transit" && !transitDate) {
      currentTransitDate = todayStr;
      setTransitDate(todayStr);
    } else if (state === "Delivered" && !arrivedDate) {
      currentArrivedDate = todayStr;
      setArrivedDate(todayStr);
    }

    const updatedNotes: CourierNotes = {
      courier_partner: courierPartner,
      packing_date: currentPackingDate,
      transit_date: currentTransitDate,
      arrived_date: currentArrivedDate,
      courier_id: courierId,
      logistics_status: state,
    };

    const { error } = await supabase
      .from("inventory_materials")
      .update({
        device_id: deviceName.trim(),
        state: state === "Transit" ? "In transit" : "Available", // Pass CHECK constraint validation
        dispatch: courierPartner || null,
        tracking_number: courierId || null,
        notes: JSON.stringify(updatedNotes),
      })
      .eq("id", material.id);

    if (!error && (state === "Packing" || state === "Transit" || state === "Delivered")) {
      void deductStockForOrder({
        orderId: material.id,
        orderCreatedAt: material.created_at,
        counts: {
          datameter_box: material.quantity || 1,
          ct1: ct1 ? 1 : 0,
          ct2: ct2 ? 1 : 0,
          ct3: ct3 ? 1 : 0,
          proxy1: proxy1 ? 1 : 0,
          proxy2: proxy2 ? 1 : 0,
          vibration: vibration ? 1 : 0,
          encoder: encoder ? 1 : 0,
          tower_light: towerLight ? 1 : 0,
          antenna: antenna ? 1 : 0,
          energy_meter: energyMeter ? 1 : 0,
          plc: plc ? 1 : 0,
        },
      });
    }


    setSaving(false);

    if (error) {
      toast.error("Failed to save courier details: " + error.message);
    } else {
      await recordActivityLog({
        actor_id: userId,
        actor_name: currentActorName,
        action: "logistics_update",
        entity_type: "logistics_order",
        entity_id: material.id,
        entity_name: material.material_name,
        company_name: material.material_name,
        from_value: initialNotes.logistics_status || material.state || "Pending",
        to_value: state,
        details: { field: "courier_details", tracking_number: courierId || null },
      });
      toast.success("Courier details and status updated.");
      setExpanded(false);
      onReload();
    }
  };

  // Direct Save Tracking ID on Card Footer
  const handleSaveTrackingDirectly = async (e: React.FormEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!editable) return;
    if (!deviceName.trim()) {
      toast.error("Please enter device name.");
      return;
    }
    setSaving(true);

    const updatedNotes: CourierNotes = {
      ...initialNotes,
      courier_id: courierId,
    };

    const { error } = await supabase
      .from("inventory_materials")
      .update({
        device_id: deviceName.trim(),
        tracking_number: courierId || null,
        notes: JSON.stringify(updatedNotes),
      })
      .eq("id", material.id);

    setSaving(false);
    if (error) {
      toast.error("Failed to update Courier ID: " + error.message);
    } else {
      await recordActivityLog({
        actor_id: userId,
        actor_name: currentActorName,
        action: "update",
        entity_type: "logistics_order",
        entity_id: material.id,
        entity_name: material.material_name,
        company_name: material.material_name,
        from_value: material.tracking_number || "No Courier ID",
        to_value: courierId || "No Courier ID",
        details: { field: "courier_id" },
      });
      toast.success("Courier ID updated successfully.");
      onReload();
    }
  };

  // Dynamically filter which checkboxes to show based on BC selection
  const checklistItems = [];
  if (material.ct1 === "TRUE") checklistItems.push({ label: "CT 1 Clamp", checked: ct1, onChange: setCt1, id: `pack-ct1-${material.id}` });
  if (material.ct2 === "TRUE") checklistItems.push({ label: "CT 2 Clamp", checked: ct2, onChange: setCt2, id: `pack-ct2-${material.id}` });
  if (material.ct3 === "TRUE") checklistItems.push({ label: "CT 3 Clamp", checked: ct3, onChange: setCt3, id: `pack-ct3-${material.id}` });
  if (material.proxy1 === "TRUE") {
    checklistItems.push({
      label: `Proxy 1 ${material.proxy_model ? `(${material.proxy_model})` : ""}`,
      checked: proxy1,
      onChange: setProxy1,
      id: `pack-p1-${material.id}`
    });
  }
  if (material.proxy2 === "TRUE") checklistItems.push({ label: "Proxy 2", checked: proxy2, onChange: setProxy2, id: `pack-p2-${material.id}` });
  if (material.encoder === "TRUE") checklistItems.push({ label: "Encoder", checked: encoder, onChange: setEncoder, id: `pack-enc-${material.id}` });
  if (material.vibration === "TRUE") {
    checklistItems.push({
      label: `Vibration ${material.vibration_model ? `(${material.vibration_model})` : ""}`,
      checked: vibration,
      onChange: setVibration,
      id: `pack-vib-${material.id}`
    });
  }
  if (material.antenna === "TRUE") checklistItems.push({ label: "Antenna", checked: antenna, onChange: setAntenna, id: `pack-ant-${material.id}` });
  if (material.tower_light === "TRUE") checklistItems.push({ label: "Tower Light", checked: towerLight, onChange: setTowerLight, id: `pack-twr-${material.id}` });
  if (material.energy_meter === "TRUE") checklistItems.push({ label: "Energy Meter", checked: energyMeter, onChange: setEnergyMeter, id: `pack-en-${material.id}` });
  if (material.plc === "TRUE") checklistItems.push({ label: "PLC", checked: plc, onChange: setPlc, id: `pack-plc-${material.id}` });
 
  // Quick fill all checkboxes
  const handleQuickFill = () => {
    if (material.ct1 === "TRUE") setCt1(true);
    if (material.ct2 === "TRUE") setCt2(true);
    if (material.ct3 === "TRUE") setCt3(true);
    if (material.proxy1 === "TRUE") setProxy1(true);
    if (material.proxy2 === "TRUE") setProxy2(true);
    if (material.encoder === "TRUE") setEncoder(true);
    if (material.vibration === "TRUE") setVibration(true);
    if (material.antenna === "TRUE") setAntenna(true);
    if (material.tower_light === "TRUE") setTowerLight(true);
    if (material.energy_meter === "TRUE") setEnergyMeter(true);
    if (material.plc === "TRUE") setPlc(true);
    toast.success("All requested components checked!");
  };

  // Border Color Calculations
  const activeStatus = initialNotes.logistics_status || "Pending";
  const isDeliveredAndTracked = activeStatus === "Delivered" && material.tracking_number;
  const isYellowStatus = ["Packing", "Transit", "Shipped"].includes(activeStatus);
  const borderStyle = isDeliveredAndTracked
    ? "border-l-[5px] border-mint hover:border-mint hover:shadow-[0_4px_25px_rgba(61,255,192,0.15)] bg-surface"
    : isYellowStatus
      ? "border-l-[5px] border-warning hover:border-warning hover:shadow-[0_4px_25px_rgba(255,184,48,0.15)] bg-surface"
      : "border-l-[5px] border-violet/60 hover:border-violet hover:shadow-[0_4px_20px_rgba(124,58,237,0.15)] bg-surface";

  return (
    <>
      {/* 1. Interactive Card */}
      <Card
        onClick={() => setExpanded(true)}
        className={`relative overflow-hidden transition-all duration-300 transform hover:-translate-y-[2px] cursor-pointer flex flex-col justify-between h-full border border-border/60 hover:border-border rounded-xl p-5 ${borderStyle}`}
      >
        <div className="space-y-4">
          {/* Card Header & Status Badge */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h4 className="font-extrabold text-text-primary text-base font-syne uppercase tracking-tight leading-snug transition-colors group-hover:text-violet">
                {material.material_name}
              </h4>
              <p className="flex items-center gap-1.5 text-xs text-text-secondary">
                <span className="font-mono text-violet font-bold bg-violet/10 px-2 py-0.5 rounded text-[10px]">
                  {material.device_id || "No ID"}
                </span>
                <span>•</span>
                <span className="flex items-center gap-0.5 truncate max-w-[150px]">
                  <MapPin size={11} className="text-violet shrink-0" />
                  {material.location || "No Address"}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="secondary"
                className="py-1 px-2 text-[10px] font-bold flex items-center gap-1 bg-surface-raised border border-border h-7 shrink-0 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  void downloadPDF();
                }}
                title="Download Challan PDF"
              >
                <FileText size={11} /> PDF
              </Button>
              <Badge
                tone={
                  isDeliveredAndTracked
                    ? "success"
                    : isYellowStatus
                      ? "warning"
                      : "info"
                }
                className="text-[10px] font-mono font-bold tracking-wider uppercase px-2.5 py-0.5 rounded-full"
              >
                {activeStatus}
              </Badge>
              {editable && (
                <button
                  onClick={handleDelete}
                  className="p-1.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-500 transition cursor-pointer"
                  title="Delete Order"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Quick info list */}
          <div className="grid grid-cols-2 gap-2 text-[10.5px] text-text-secondary/90 font-mono bg-surface-raised p-2.5 rounded-lg border border-border/60">
            <div>CTs: <span className="text-text-primary font-bold">{[material.ct1, material.ct2, material.ct3].filter(x => x === "TRUE").length} Active</span></div>
            <div>Vib: <span className="text-text-primary font-bold">{material.vibration === "TRUE" ? (material.vibration_model || "Yes") : "No"}</span></div>
            <div>Proxy: <span className="text-text-primary font-bold">{material.proxy_model || "None"}</span></div>
            <div>Uplink: <span className="text-text-primary font-bold">{material.uplink || "Unconfigured"}</span></div>
            <div className="col-span-2 border-t border-border/40 pt-1.5 mt-0.5 flex justify-between gap-2">
              <span className="truncate">AWB: <span className="text-text-primary font-bold">{material.tracking_number || "None"}</span></span>
              <span className="truncate">Carrier: <span className="text-text-primary font-bold">{material.dispatch || "None"}</span></span>
            </div>
          </div>
          {/* Quick Courier & Status Editor */}
          {editable && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mt-3 p-3 bg-surface-raised border border-border rounded-lg space-y-2"
            >
              <div className="text-[9px] uppercase font-mono tracking-wider text-text-secondary font-bold">
                Quick Logistics Update
              </div>
              <div>
                <input
                  type="text"
                  required
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="Device Name / Model *"
                  className="w-full text-xs bg-surface border border-border hover:border-border-bright rounded px-2 py-1 outline-none text-text-primary placeholder:text-text-dim font-mono focus:border-lime"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <input
                    type="text"
                    value={quickCourierId}
                    onChange={(e) => setQuickCourierId(e.target.value)}
                    placeholder="Courier AWB #"
                    className="w-full text-xs bg-surface border border-border hover:border-border-bright rounded px-2 py-1 outline-none text-text-primary placeholder:text-text-dim font-mono focus:border-lime"
                  />
                </div>
                <div>
                  <select
                    value={quickStatus}
                    onChange={(e) => setQuickStatus(e.target.value)}
                    className="w-full text-xs bg-surface border border-border hover:border-border-bright rounded px-2 py-1 outline-none text-text-primary cursor-pointer focus:border-lime font-mono"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Packing">Packing</option>
                    <option value="Transit">Transit</option>
                    <option value="Delivered">Delivered</option>
                  </select>
                </div>
              </div>
              <Button
                onClick={handleSaveQuick}
                disabled={quickSaving}
                className="w-full py-1 text-[10px] uppercase font-bold tracking-widest bg-violet text-white font-sans rounded h-7 hover:brightness-110"
              >
                {quickSaving ? "Saving..." : "Save Quick Update"}
              </Button>
            </div>
          )}
        </div>

        {/* Card Footer (AWB ID / Direct Edit Info) */}
        <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11px] text-text-dim">
          <span>Submitted: {new Date(material.created_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}</span>
          <span className="text-violet font-bold group-hover:underline flex items-center gap-0.5">
            Configure &rarr;
          </span>
        </div>
      </Card>

      {/* 2. Central Screen Modal Popup Box */}
      {expanded && (
        <div 
          onClick={() => setExpanded(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl bg-surface border border-border/80 rounded-[16px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
          >

            {/* Modal Header */}
            <div className="flex justify-between items-start p-6 border-b border-border/50 bg-surface-raised/30">
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-mono tracking-widest text-violet font-bold">
                  Order Details & Configuration
                </div>
                <h3 className="text-2xl font-extrabold font-syne text-text-primary uppercase tracking-tight">
                  {material.material_name}
                </h3>
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <span className="font-mono bg-violet/10 text-violet px-2 py-0.5 rounded font-bold">{material.device_id || "No ID"}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1"><MapPin size={12} className="text-violet" /> {material.location || "No Address"}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  className="py-1.5 px-3 text-xs font-semibold flex items-center gap-1.5 bg-surface-raised border border-border h-9 cursor-pointer shrink-0"
                  onClick={() => void downloadPDF()}
                >
                  <FileText size={14} /> Download Challan PDF
                </Button>
                {editable && (
                  <button
                    onClick={handleDelete}
                    className="p-1.5 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-600 transition cursor-pointer"
                    title="Delete Order"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
                <button
                  onClick={() => setExpanded(false)}
                  className="p-1.5 rounded-full bg-surface-raised/60 hover:bg-surface-raised text-text-secondary hover:text-text-primary transition"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Content Scrollable Area */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">

              {/* Step tabs */}
              <div className="flex border-b border-border/40 pb-2 text-xs font-mono">
                <button
                  onClick={() => setStep(1)}
                  className={`flex-1 text-center py-2.5 font-bold border-b-2 transition ${step === 1 ? "border-violet text-violet" : "border-transparent text-text-secondary hover:text-text-primary"
                    }`}
                >
                  1. Hardware Packing Checklist
                </button>
                <button
                  onClick={() => setStep(2)}
                  className={`flex-1 text-center py-2.5 font-bold border-b-2 transition ${step === 2 ? "border-violet text-violet" : "border-transparent text-text-secondary hover:text-text-primary"
                    }`}
                >
                  2. Courier & Shipping Details
                </button>
              </div>

              {step === 1 ? (
                <form onSubmit={handleSaveStep1} className="space-y-4">
                  {editable ? (
                    <>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-text-primary font-bold text-xs uppercase tracking-wider">Requested Components Checklist</Label>
                            <p className="text-[10px] text-text-secondary mt-0.5">Tick components as you pack them to match consultant request.</p>
                          </div>
                          {checklistItems.length > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={handleQuickFill}
                              className="text-[10px] h-7 px-2.5 border border-border bg-surface hover:bg-surface-raised font-bold text-violet shrink-0"
                            >
                              Quick Fill All
                            </Button>
                          )}
                        </div>

                        {checklistItems.length > 0 ? (
                          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 bg-surface-raised/30 p-3 rounded-lg border border-border/40">
                            {checklistItems.map((item) => (
                              <div key={item.id} className="flex items-center justify-between p-3 bg-surface border border-border/60 rounded-xl hover:border-violet/40 transition">
                                <div className="space-y-0.5">
                                  <span className="text-xs font-extrabold text-text-primary block">{item.label}</span>
                                  <span className="inline-flex items-center gap-1 text-[9.5px] font-mono text-success font-bold uppercase bg-mint/10 px-1.5 py-0.5 rounded">
                                    Requested: YES
                                  </span>
                                </div>
                                <Checkbox
                                  checked={item.checked}
                                  onCheckedChange={item.onChange}
                                  id={item.id}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-3.5 bg-surface-raised/30 border border-border/50 rounded-lg text-xs text-text-secondary italic">
                            No additional sensors requested by the consultant.
                          </div>
                        )}
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2 border-t border-border/50 pt-4">
                        <div>
                          <Label>Device Name / Model <span className="text-red-500">*</span></Label>
                          <Input
                            required
                            value={deviceName}
                            onChange={(e) => setDeviceName(e.target.value)}
                            placeholder="e.g. SIM-Kit Gateway V3"
                          />
                        </div>
                        <div>
                          <Label>Hardware Version</Label>
                          <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. v3.2.1" />
                        </div>
                        <div>
                          <Label>Uplink Type</Label>
                          <Select value={uplink} onChange={(e) => setUplink(e.target.value)}>
                            <option value="">Select Uplink...</option>
                            <option value="LTE">LTE</option>
                            <option value="Wi-Fi">Wi-Fi</option>
                            <option value="Ethernet">Ethernet</option>
                          </Select>
                        </div>
                        <div>
                          <Label>ICCID (SIM Serial)</Label>
                          <Input value={iccid} onChange={(e) => setIccid(e.target.value)} placeholder="SIM Card ICCID" />
                        </div>
                        <div>
                          <DropdownWithCustomOption
                            label="OTA Key"
                            value={otaKey}
                            onChange={setOtaKey}
                            defaultOptions={DEFAULT_OTA_KEYS}
                            storageKey="simkit_custom_ota_keys"
                            placeholder="Select OTA key..."
                          />
                        </div>
                        <div>
                          <DropdownWithCustomOption
                            label="OTA Account"
                            value={otaAccount}
                            onChange={setOtaAccount}
                            defaultOptions={DEFAULT_OTA_ACCOUNTS}
                            storageKey="simkit_custom_ota_accounts"
                            placeholder="Select OTA account..."
                          />
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-4 border-t border-border/50">
                        <Button 
                          type="button" 
                          variant="ghost" 
                          onClick={() => setExpanded(false)}
                          className="px-4 py-2 border border-border bg-surface text-text-secondary hover:text-text-primary h-9 shrink-0 cursor-pointer"
                        >
                          Cancel & Close
                        </Button>
                        <Button type="submit" disabled={saving} className="px-6 py-2.5">
                          {saving && <RefreshCw size={12} className="animate-spin mr-1.5" />}
                          Save & Continue
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-text-secondary space-y-3">
                      <div>Only managers can update packing details. Current Hardware Config:</div>

                      {checklistItems.length > 0 && (
                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 bg-surface-raised/30 p-3 rounded-lg border border-border/40">
                          {checklistItems.map((item) => (
                            <div key={item.id} className="flex items-center justify-between p-3 bg-surface border border-border/60 rounded-xl">
                              <div className="space-y-0.5">
                                <span className="text-xs font-extrabold text-text-primary block">{item.label}</span>
                                <span className="inline-flex items-center gap-1 text-[9.5px] font-mono text-success font-bold uppercase bg-mint/10 px-1.5 py-0.5 rounded">
                                  Requested: YES
                                </span>
                              </div>
                              <Checkbox
                                checked={item.checked}
                                onCheckedChange={() => { }}
                                id={item.id}
                                disabled={true}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="p-4 bg-surface-raised/40 border border-border/60 rounded-xl font-mono text-[11px] not-italic space-y-1.5">
                        <div>Version: <strong>{material.version || "N/A"}</strong></div>
                        <div>Uplink: <strong>{material.uplink || "N/A"}</strong></div>
                        <div>ICCID: <strong>{material.iccid || "N/A"}</strong></div>
                        <div>OTA Key: <strong>{material.ota_key || "N/A"}</strong></div>
                        <div>OTA Account: <strong>{material.ota_account || "N/A"}</strong></div>
                      </div>
                    </div>
                  )}
                </form>
              ) : (
                <form onSubmit={handleSaveStep2} className="space-y-4">
                  {editable ? (
                    <>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <DropdownWithCustomOption
                            label="Courier Partner Name"
                            value={courierPartner}
                            onChange={setCourierPartner}
                            defaultOptions={DEFAULT_COURIER_PARTNERS}
                            storageKey="simkit_custom_courier_partners"
                            placeholder="Select courier partner"
                          />
                        </div>
                        <div>
                          <Label>Courier Status</Label>
                          <Select value={state} onChange={(e) => setState(e.target.value)}>
                            <option value="Pending">Not Prepared (Pending)</option>
                            <option value="Packing">Packing</option>
                            <option value="Transit">In Transit</option>
                            <option value="Delivered">Delivered (Received)</option>
                          </Select>
                        </div>
                        <div className="sm:col-span-2">
                          <Label>Courier ID (AWB Tracking Number)</Label>
                          <Input
                            value={courierId}
                            onChange={(e) => setCourierId(e.target.value)}
                            placeholder="e.g. AWB102839281"
                          />
                        </div>
                      </div>

                      {state !== "Pending" && (
                        <div className="border-t border-border/50 pt-4 space-y-2">
                          <Label className="text-text-primary font-bold text-xs uppercase tracking-wider">Courier Dispatch Timeline Dates</Label>
                          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 text-xs bg-surface-raised/30 p-3 rounded-lg border border-border/40">
                            {["Packing", "Transit", "Delivered"].includes(state) && (
                              <div>
                                <Label className="text-[10px] text-text-secondary">Packing Date {state === "Packing" && <span className="text-yellow">*</span>}</Label>
                                <Input type="date" value={packingDate} onChange={(e) => setPackingDate(e.target.value)} />
                              </div>
                            )}
                            {["Transit", "Delivered"].includes(state) && (
                              <div>
                                <Label className="text-[10px] text-text-secondary">Transit Date {state === "Transit" && <span className="text-yellow">*</span>}</Label>
                                <Input type="date" value={transitDate} onChange={(e) => setTransitDate(e.target.value)} />
                              </div>
                            )}
                            {state === "Delivered" && (
                              <div>
                                <Label className="text-[10px] text-text-secondary">Arrived Date <span className="text-yellow">*</span></Label>
                                <Input type="date" value={arrivedDate} onChange={(e) => setArrivedDate(e.target.value)} />
                              </div>
                            )}
                          </div>
                          <p className="text-[10px] text-text-dim italic">
                            * Dates are automatically set to today if empty upon submitting corresponding status.
                          </p>
                        </div>
                      )}

                      <div className="flex justify-between pt-4 border-t border-border/50">
                        <Button type="button" variant="ghost" onClick={() => setStep(1)} className="px-4">
                          Back
                        </Button>
                        <Button type="submit" disabled={saving} className="px-6 py-2.5">
                          {saving && <RefreshCw size={12} className="animate-spin mr-1.5" />}
                          Submit & Save Order
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-text-secondary space-y-3">
                      <div className="p-4 bg-surface-raised/40 border border-border/60 rounded-xl font-mono space-y-2">
                        <div>Courier Partner: <strong>{material.dispatch || "N/A"}</strong></div>
                        <div>Tracking ID: <strong>{material.tracking_number || "N/A"}</strong></div>
                        <div className="border-t border-border/40 my-2 pt-2 text-[10.5px] space-y-1 text-text-secondary/80">
                          <div>Packing Date: {initialNotes.packing_date || "N/A"}</div>
                          <div>Transit Date: {initialNotes.transit_date || "N/A"}</div>
                          <div>Arrival Date: {initialNotes.arrived_date || "N/A"}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </form>
              )}
            </div>

            {/* Modal Quick-Save Footer */}
            {editable && (
              <div className="p-4 border-t border-border/50 bg-surface-raised/40 flex items-center justify-between text-xs">
                <form onSubmit={handleSaveTrackingDirectly} className="flex items-center gap-3 w-full">
                  <span className="text-text-secondary font-mono shrink-0 font-bold">Quick Courier AWB:</span>
                  <Input
                    value={courierId}
                    onChange={(e) => setCourierId(e.target.value)}
                    placeholder="Enter Tracking ID"
                    className="py-1.5 h-9 text-xs bg-background border-border/80"
                  />
                  <Button type="submit" disabled={saving} variant="ghost" className="h-9 py-1 px-4 border border-border/80 text-xs hover:bg-surface-raised shrink-0">
                    Save AWB
                  </Button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
