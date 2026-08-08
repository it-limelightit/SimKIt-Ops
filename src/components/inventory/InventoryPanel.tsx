import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";

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
  proxy_model: string | null;
  vibration_model: string | null;
  installation_date: string | null;
  iccid: string | null;
  remark: string | null;
};

export function InventoryPanel({ editable = false }: { editable?: boolean }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filterState, setFilterState] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, filterState]);

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

  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      const matchesQuery = `${m.material_name} ${m.device_id ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase());

      const status = getLogisticsStatus(m);
      let normalizedStatus = status;
      if (status === "In transit" || status === "Transit" || status === "Shipped") {
        normalizedStatus = "Transit";
      }
      const matchesState = filterState === "all" || normalizedStatus.toLowerCase() === filterState.toLowerCase();

      return matchesQuery && matchesState;
    });
  }, [materials, query, filterState]);

  // Analytics Metrics (KTAs)
  const metrics = useMemo(() => {
    const total = materials.length;
    let pending = 0;
    let packing = 0;
    let transit = 0;
    let delivered = 0;

    materials.forEach((m) => {
      const status = getLogisticsStatus(m);
      if (status === "Pending") pending++;
      else if (status === "Packing") packing++;
      else if (status === "Transit" || status === "In transit" || status === "Shipped") transit++;
      else if (status === "Delivered") delivered++;
      else pending++;
    });

    return { total, pending, packing, transit, delivered };
  }, [materials]);

  const ITEMS_PER_PAGE = 50;
  const totalItems = filteredMaterials.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedMaterials = filteredMaterials.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  return (
    <div className="space-y-7 animate-in fade-in duration-200">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-lime/80 font-bold">
            Live Logistics Pipelines
          </p>
          <h1 className="mt-2 text-4xl uppercase tracking-tight font-extrabold font-syne">Logistic</h1>
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
        />
        <MetricCard
          icon={AlertCircle}
          label="Pending Packing"
          value={metrics.pending}
          tone="danger"
        />
        <MetricCard
          icon={Package}
          label="In Packing"
          value={metrics.packing}
          tone="warning"
        />
        <MetricCard
          icon={Truck}
          label="Shipped / Transit"
          value={metrics.transit}
          tone="info"
        />
        <MetricCard
          icon={PackageCheck}
          label="Delivered"
          value={metrics.delivered}
          tone="success"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border pt-4">
        <div className="flex gap-2">
          <Select
            value={filterState}
            onChange={(e) => setFilterState(e.target.value)}
            className="text-xs"
          >
            <option value="all">All Statuses</option>
            <option value="Pending">Pending / Not Prepared</option>
            <option value="Packing">Packing</option>
            <option value="Transit">In Transit</option>
            <option value="Delivered">Delivered</option>
          </Select>
        </div>
        <div className="relative sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" size={15} />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search orders by client name..."
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((x) => (
            <div key={x} className="h-44 animate-pulse rounded-[10px] bg-surface" />
          ))}
        </div>
      ) : filteredMaterials.length ? (
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
}: {
  icon: any;
  label: string;
  value: number;
  tone: "info" | "warning" | "success" | "danger";
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
    <div className="flex items-center gap-3 rounded-[9px] border border-border bg-surface px-4 py-3">
      <div className={`rounded-[6px] p-2 ${bgClass}`}>
        <Icon size={18} />
      </div>
      <div>
        <div className="text-xl font-extrabold text-text-primary">{value}</div>
        <div className="font-mono text-[9px] uppercase tracking-widest text-text-secondary">
          {label}
        </div>
      </div>
    </div>
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

      toast.success("Order deleted successfully.");
      setExpanded(false);
      onReload();
    } catch (err: any) {
      toast.error("Failed to delete order: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

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

  // Form State - Step 1 (Default unchecked)
  const [ct1, setCt1] = useState(false);
  const [ct2, setCt2] = useState(false);
  const [ct3, setCt3] = useState(false);
  const [proxy1, setProxy1] = useState(false);
  const [proxy2, setProxy2] = useState(false);
  const [encoder, setEncoder] = useState(false);
  const [vibration, setVibration] = useState(false);
  const [vibrationModel, setVibrationModel] = useState(material.vibration_model || "");
  const [antenna, setAntenna] = useState(false);
  const [towerLight, setTowerLight] = useState(false);
  const [energyMeter, setEnergyMeter] = useState(false);
  const [plc, setPlc] = useState(false);

  const [version, setVersion] = useState(material.version || "");
  const [otaKey, setOtaKey] = useState(material.ota_key || "");
  const [otaAccount, setOtaAccount] = useState(material.ota_account || "");
  const [uplink, setUplink] = useState(material.uplink || "");
  const [iccid, setIccid] = useState(material.iccid || "");

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
    setCourierId(material.tracking_number || "");
    setState(initialNotes.logistics_status || "Pending");
    setCourierPartner(material.dispatch || "");
    setPackingDate(initialNotes.packing_date || "");
    setTransitDate(initialNotes.transit_date || "");
    setArrivedDate(initialNotes.arrived_date || "");
    setVibrationModel(material.vibration_model || "");
    setVersion(material.version || "");
    setOtaKey(material.ota_key || "");
    setOtaAccount(material.ota_account || "");
    setUplink(material.uplink || "");
    setIccid(material.iccid || "");

    setQuickCourierId(material.tracking_number || "");
    setQuickStatus(initialNotes.logistics_status || "Pending");
  }, [material, initialNotes]);

  // Handle Quick Save from outer card
  const handleSaveQuick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) return;
    setQuickSaving(true);

    let currentPackingDate = packingDate;
    let currentTransitDate = transitDate;
    let currentArrivedDate = arrivedDate;

    const nowStr = new Date().toLocaleDateString("en-IN");
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
        tracking_number: quickCourierId || null,
        state: quickStatus === "Transit" ? "In transit" : quickStatus,
        notes: JSON.stringify(newNotes),
      })
      .eq("id", material.id);

    setQuickSaving(false);
    if (error) {
      toast.error("Failed to save quick updates: " + error.message);
    } else {
      toast.success("Courier info updated!");
      onReload();
    }
  };

  // Save Step 1 (Packing checklist and configurations)
  const handleSaveStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editable) return;
    setSaving(true);

    const { error } = await supabase
      .from("inventory_materials")
      .update({
        ct1: ct1 ? "TRUE" : "FALSE",
        ct2: ct2 ? "TRUE" : "FALSE",
        ct3: ct3 ? "TRUE" : "FALSE",
        proxy1: proxy1 ? "TRUE" : "FALSE",
        proxy2: proxy2 ? "TRUE" : "FALSE",
        encoder: encoder ? "TRUE" : "FALSE",
        vibration: vibration ? "TRUE" : "FALSE",
        vibration_model: vibrationModel || null,
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
      toast.success("Hardware configuration saved.");
      setStep(2); // Go to Courier Step
      onReload();
    }
  };

  // Save Step 2 (Courier info and final status)
  const handleSaveStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editable) return;
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
        state: state === "Transit" ? "In transit" : "Available", // Pass CHECK constraint validation
        dispatch: courierPartner || null,
        tracking_number: courierId || null,
        notes: JSON.stringify(updatedNotes),
      })
      .eq("id", material.id);

    setSaving(false);
    if (error) {
      toast.error("Failed to save courier details: " + error.message);
    } else {
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
    setSaving(true);

    const updatedNotes: CourierNotes = {
      ...initialNotes,
      courier_id: courierId,
    };

    const { error } = await supabase
      .from("inventory_materials")
      .update({
        tracking_number: courierId || null,
        notes: JSON.stringify(updatedNotes),
      })
      .eq("id", material.id);

    setSaving(false);
    if (error) {
      toast.error("Failed to update Courier ID: " + error.message);
    } else {
      toast.success("Courier ID updated successfully.");
      onReload();
    }
  };

  // Dynamically filter which checkboxes to show based on BC selection
  const checklistItems = [];
  if (material.ct1 === "TRUE") checklistItems.push({ label: "CT 1 Clamp", checked: ct1, onChange: setCt1, id: `pack-ct1-${material.id}` });
  if (material.ct2 === "TRUE") checklistItems.push({ label: "CT 2 Clamp", checked: ct2, onChange: setCt2, id: `pack-ct2-${material.id}` });
  if (material.ct3 === "TRUE") checklistItems.push({ label: "CT 3 Clamp", checked: ct3, onChange: setCt3, id: `pack-ct3-${material.id}` });
  if (material.proxy1 === "TRUE" || material.proxy_model) {
    checklistItems.push({
      label: `Proxy 1 ${material.proxy_model ? `(${material.proxy_model})` : ""}`,
      checked: proxy1,
      onChange: setProxy1,
      id: `pack-p1-${material.id}`
    });
  }
  if (material.proxy2 === "TRUE") checklistItems.push({ label: "Proxy 2", checked: proxy2, onChange: setProxy2, id: `pack-p2-${material.id}` });
  if (material.encoder === "TRUE") checklistItems.push({ label: "Encoder", checked: encoder, onChange: setEncoder, id: `pack-enc-${material.id}` });
  if (material.vibration === "TRUE" || material.vibration_model) {
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
    if (material.proxy1 === "TRUE" || material.proxy_model) setProxy1(true);
    if (material.proxy2 === "TRUE") setProxy2(true);
    if (material.encoder === "TRUE") setEncoder(true);
    if (material.vibration === "TRUE" || material.vibration_model) setVibration(true);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-2xl bg-surface border border-border/80 rounded-[16px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">

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
                {editable && (
                  <button
                    onClick={handleDelete}
                    className="p-1.5 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-600 transition"
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
                          <Label>Vibration Model</Label>
                          <Select value={vibrationModel} onChange={(e) => setVibrationModel(e.target.value)}>
                            <option value="">Select vibration model...</option>
                            <option value="renke">Renke</option>
                            <option value="witmotion">WitMotion</option>
                          </Select>
                        </div>
                        <div>
                          <Label>ICCID (SIM Serial)</Label>
                          <Input value={iccid} onChange={(e) => setIccid(e.target.value)} placeholder="SIM Card ICCID" />
                        </div>
                        <div>
                          <Label>OTA Key</Label>
                          <Input value={otaKey} onChange={(e) => setOtaKey(e.target.value)} placeholder="Secure Key" />
                        </div>
                        <div>
                          <Label>OTA Account</Label>
                          <Input value={otaAccount} onChange={(e) => setOtaAccount(e.target.value)} placeholder="ota-admin@email.com" />
                        </div>
                      </div>

                      <div className="flex justify-end pt-4 border-t border-border/50">
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
                        <div>Vib Model: <strong>{material.vibration_model || "N/A"}</strong></div>
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
                          <Label>Courier Partner Name</Label>
                          <Input
                            value={courierPartner}
                            onChange={(e) => setCourierPartner(e.target.value)}
                            placeholder="e.g. Delhivery, Blue Dart"
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
