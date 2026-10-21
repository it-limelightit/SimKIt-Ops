import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Boxes, CheckCircle2, ChevronLeft, ChevronRight, Package, PackageCheck, Search, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button, Card, Checkbox, EmptyState, Input, Select } from "@/components/ui-kit";
import { MetricCard, OrderCard, normalizeLogisticsStatus, type Material } from "./InventoryPanel";
import { LogisticsResultsPortal } from "./LogisticsResultsPortal";
import { inventoryCtSensorCount } from "@/lib/inventory-components";

type UpscaleCompanyOrder = {
  id: string;
  tracker_id: string;
  company_name: string;
  device_count: number;
  created_at: string;
};

const componentNames: Record<string, string> = {
  dm: "DM (Data Meter)",
  without_cavli: "Without Cavli",
  ct1: "CT1 — Single-phase / 1 sensor",
  ct2: "CT2 — 2 sensors",
  ct3: "CT3 — Three-phase / 3 sensors",
  proxy1: "Proxy 1 (Inductive)",
  proxy2: "Proxy 2 (Inductive)",
  encoder: "Encoder",
  vibration: "Vibration Sensor",
  antenna: "Antenna Kit",
  tower_light: "Tower Light",
  energy_meter: "Energy Meter",
  plc: "PLC",
};

function deviceStatus(device: Material) {
  try {
    const parsed = JSON.parse(device.notes || "{}");
    return parsed.logistics_status || device.state || "Pending";
  } catch {
    return device.state || "Pending";
  }
}

type UpscaleStatus = "all" | "Pending" | "Packing" | "Transit" | "Delivered";

function normalizedDeviceStatus(device: Material): Exclude<UpscaleStatus, "all"> {
  return normalizeLogisticsStatus(deviceStatus(device));
}

function confirmationProgress(device: Material) {
  const requested = device.upscale_requested_components ?? {};
  const confirmed = device.upscale_confirmed_components ?? {};
  const keys = Object.keys(requested).filter((key) => requested[key]);
  return { total: keys.length, done: keys.filter((key) => confirmed[key]).length };
}

const DEVICES_PER_PAGE = 12;

export function UpscaleLogisticsPanel({
  activeOrderSource,
  onMetricSelect,
  resultsHost,
}: {
  activeOrderSource?: "simkit" | "upscale" | null;
  onMetricSelect?: () => void;
  resultsHost?: HTMLElement | null;
} = {}) {
  const [orders, setOrders] = useState<UpscaleCompanyOrder[]>([]);
  const [devices, setDevices] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceQuery, setDeviceQuery] = useState("");
  const [deviceStatusFilter, setDeviceStatusFilter] = useState<UpscaleStatus>("all");
  const [devicePage, setDevicePage] = useState(1);
  const [query, setQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<UpscaleStatus | null>(null);
  const revealOrders = selectedStatus !== null &&
    (activeOrderSource === undefined || activeOrderSource === "upscale");
  const selectMetric = (status: UpscaleStatus) => {
    setSelectedStatus(status);
    onMetricSelect?.();
  };
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const missingSchema = useRef(false);
  const deviceDetailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDevicePage(1);
  }, [companyId, deviceQuery, deviceStatusFilter]);

  useEffect(() => {
    if (!companyId || !revealOrders) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [companyId, revealOrders]);

  const load = useCallback(async (quiet = false) => {
    if (missingSchema.current) return;
    if (!quiet) setLoading(true);
    const companies = await supabase
      .from("upscale_company_orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (companies.error) {
      const schemaUnavailable =
        companies.error.code === "PGRST205" || companies.error.code === "42P01";
      if (schemaUnavailable) missingSchema.current = true;
      const message = schemaUnavailable
        ? "Upscale orders need the database migration before this section can be used."
        : `Could not load Upscale orders: ${companies.error.message}`;
      setLoadError(message);
      setLoading(false);
      return;
    }
    const materials = await supabase
      .from("inventory_materials")
      .select("*")
      .eq("order_source", "upscale")
      .eq("submitted", true)
      .order("upscale_device_sequence", { ascending: true });
    if (materials.error) {
      setLoadError(`Could not load Upscale devices: ${materials.error.message}`);
      setLoading(false);
      return;
    }
    setLoadError("");
    setOrders((companies.data ?? []) as UpscaleCompanyOrder[]);
    setDevices((materials.data ?? []) as Material[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("upscale-logistics-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_materials" },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "upscale_company_orders" },
        () => void load(true),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const metrics = useMemo(() => ({
    total: devices.length,
    pending: devices.filter((device) => normalizedDeviceStatus(device) === "Pending").length,
    packing: devices.filter((device) => normalizedDeviceStatus(device) === "Packing").length,
    transit: devices.filter((device) => normalizedDeviceStatus(device) === "Transit").length,
    delivered: devices.filter((device) => normalizedDeviceStatus(device) === "Delivered").length,
  }), [devices]);
  const visibleOrders = useMemo(() => orders.filter((order) => {
    if (!order.company_name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return selectedStatus === "all" || devices.some((device) =>
      device.upscale_order_id === order.id && normalizedDeviceStatus(device) === selectedStatus,
    );
  }), [orders, devices, query, selectedStatus]);
  const selectedCompany = orders.find((order) => order.id === companyId);
  const companyDevices = useMemo(() => devices
    .filter((device) => device.upscale_order_id === companyId)
    .sort((a, b) => (a.upscale_device_sequence ?? 0) - (b.upscale_device_sequence ?? 0)), [devices, companyId]);
  const visibleCompanyDevices = useMemo(() => companyDevices.filter((device) => {
    const matchesStatus = deviceStatusFilter === "all" || normalizedDeviceStatus(device) === deviceStatusFilter;
    const searchable = `${device.client_machine_name ?? ""} ${device.upscale_device_sequence ?? ""} ${device.device_id ?? ""} ${device.tracking_number ?? ""}`.toLowerCase();
    return matchesStatus && searchable.includes(deviceQuery.trim().toLowerCase());
  }), [companyDevices, deviceQuery, deviceStatusFilter]);
  const devicePageCount = Math.max(1, Math.ceil(visibleCompanyDevices.length / DEVICES_PER_PAGE));
  const safeDevicePage = Math.min(devicePage, devicePageCount);
  const pagedCompanyDevices = visibleCompanyDevices.slice(
    (safeDevicePage - 1) * DEVICES_PER_PAGE,
    safeDevicePage * DEVICES_PER_PAGE,
  );
  const selectedDevice = pagedCompanyDevices.find((device) => device.id === deviceId)
    ?? pagedCompanyDevices[0];
  const selectedDeviceIndex = selectedDevice
    ? visibleCompanyDevices.findIndex((device) => device.id === selectedDevice.id)
    : -1;
  const deliveredCount = companyDevices.filter((device) => normalizedDeviceStatus(device) === "Delivered").length;
  const confirmedDeviceCount = companyDevices.filter((device) => {
    const progress = confirmationProgress(device);
    return progress.total > 0 && progress.done === progress.total;
  }).length;
  const requested = selectedDevice?.upscale_requested_components ?? {};
  const confirmed = selectedDevice?.upscale_confirmed_components ?? {};
  const selectedComponentKeys = Object.keys(requested).filter((key) => requested[key]);
  const confirmedCount = selectedComponentKeys.filter((key) => confirmed[key]).length;

  const selectDeviceAt = (index: number) => {
    const device = visibleCompanyDevices[index];
    if (!device) return;
    setDevicePage(Math.floor(index / DEVICES_PER_PAGE) + 1);
    setDeviceId(device.id);
    requestAnimationFrame(() => deviceDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const saveConfirmation = async (next: Record<string, boolean>) => {
    if (!selectedDevice) return;
    setSaving(true);
    const { error } = await supabase
      .from("inventory_materials")
      .update({ upscale_confirmed_components: next })
      .eq("id", selectedDevice.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    setDevices((current) =>
      current.map((device) =>
        device.id === selectedDevice.id
          ? { ...device, upscale_confirmed_components: next }
          : device,
      ),
    );
    toast.success("Component confirmation saved.");
  };

  if (loading)
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-sm text-text-secondary">
        Loading Upscale orders...
      </div>
    );
  if (loadError) return <Card className="p-6 text-sm text-text-secondary">{loadError}</Card>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Upscale device order status">
        <MetricCard icon={Boxes} label="Total devices" value={metrics.total} tone="info" active={revealOrders && selectedStatus === "all"} onClick={() => selectMetric("all")} />
        <MetricCard icon={AlertCircle} label="Pending packing" value={metrics.pending} tone="danger" active={revealOrders && selectedStatus === "Pending"} onClick={() => selectMetric("Pending")} />
        <MetricCard icon={Package} label="In packing" value={metrics.packing} tone="warning" active={revealOrders && selectedStatus === "Packing"} onClick={() => selectMetric("Packing")} />
        <MetricCard icon={Truck} label="Shipped / Transit" value={metrics.transit} tone="info" active={revealOrders && selectedStatus === "Transit"} onClick={() => selectMetric("Transit")} />
        <MetricCard icon={PackageCheck} label="Delivered" value={metrics.delivered} tone="success" active={revealOrders && selectedStatus === "Delivered"} onClick={() => selectMetric("Delivered")} />
      </div>
      {revealOrders && <LogisticsResultsPortal host={resultsHost}>
      <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs font-semibold text-text-secondary">{visibleOrders.length} {visibleOrders.length === 1 ? "company" : "companies"}</p>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" size={15} />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company" className="pl-9" aria-label="Search Upscale companies" />
        </div>
      </div>
      {visibleOrders.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleOrders.map((order) => {
            const orderDevices = devices.filter((device) => device.upscale_order_id === order.id);
            const delivered = orderDevices.filter(
              (device) => normalizedDeviceStatus(device) === "Delivered",
            ).length;
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => {
                  setCompanyId(order.id);
                  setDeviceId(null);
                  setDeviceQuery("");
                  setDeviceStatusFilter("all");
                  setDevicePage(1);
                }}
                className="rounded-xl border border-border bg-surface p-5 text-left transition hover:border-lime/60 hover:bg-surface-raised/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-syne text-lg font-bold text-text-primary">
                    {order.company_name}
                  </h3>
                  <ChevronRight className="shrink-0 text-lime" size={18} />
                </div>
                <p className="mt-4 font-mono text-3xl font-bold text-lime">{order.device_count}</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Devices ordered
                </p>
                <p className="mt-3 text-xs text-text-secondary">
                  {delivered} delivered · {orderDevices.length} device orders available
                </p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-raised" aria-hidden="true">
                  <div className="h-full rounded-full bg-lime" style={{ width: `${orderDevices.length ? (delivered / orderDevices.length) * 100 : 0}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Boxes} text="No Upscale company orders found." />
      )}
      </div>
      </LogisticsResultsPortal>}

      {revealOrders && selectedCompany && (
        <div
          className="fixed inset-0 z-40 overflow-y-auto bg-bg p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedCompany.company_name} Upscale devices`}
        >
          <div className="mx-auto max-w-7xl space-y-4">
            <header className="sticky top-0 z-20 rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-lime">Upscale / Company order</p>
                  <h2 className="mt-1 truncate font-syne text-xl font-bold text-text-primary sm:text-2xl">
                    {selectedCompany.company_name}
                  </h2>
                  <p className="mt-1 text-xs text-text-secondary">
                    {companyDevices.length} machine orders · {confirmedDeviceCount} contents checked · {deliveredCount} delivered
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCompanyId(null)}
                  className="rounded-lg border border-border p-2 text-text-secondary transition hover:border-lime/50 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                  aria-label="Close company order"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised" role="progressbar" aria-label="Devices delivered" aria-valuenow={deliveredCount} aria-valuemin={0} aria-valuemax={companyDevices.length}>
                  <div className="h-full rounded-full bg-lime transition-all" style={{ width: `${companyDevices.length ? (deliveredCount / companyDevices.length) * 100 : 0}%` }} />
                </div>
                <span className="shrink-0 font-mono text-xs font-bold text-text-secondary">{deliveredCount}/{companyDevices.length} delivered</span>
              </div>
            </header>
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(270px,330px)_minmax(0,1fr)]">
              <aside className="flex flex-col rounded-xl border border-border bg-surface lg:sticky lg:top-32 lg:max-h-[calc(100vh-9rem)]" aria-label="Machine orders">
                <div className="space-y-3 border-b border-border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-syne text-sm font-bold text-text-primary">Machines</h3>
                    <span className="font-mono text-xs text-text-secondary">{visibleCompanyDevices.length} of {companyDevices.length}</span>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" size={15} />
                    <Input value={deviceQuery} onChange={(event) => setDeviceQuery(event.target.value)} placeholder="Name, number, DM or AWB" aria-label="Search machine orders" className="pl-9" />
                  </div>
                  <Select value={deviceStatusFilter} onChange={(event) => setDeviceStatusFilter(event.target.value as UpscaleStatus)} aria-label="Filter machine orders by status" className="w-full text-xs">
                    <option value="all">All statuses</option>
                    <option value="Pending">Pending</option>
                    <option value="Packing">Packing</option>
                    <option value="Transit">In transit</option>
                    <option value="Delivered">Delivered</option>
                  </Select>
                </div>
                <div className="max-h-72 space-y-1.5 overflow-y-auto p-2 lg:max-h-none lg:min-h-0 lg:flex-1" role="group" aria-label="Filtered machine orders">
                  {pagedCompanyDevices.map((device) => {
                    const progress = confirmationProgress(device);
                    const active = selectedDevice?.id === device.id;
                    return (
                      <button
                        key={device.id}
                        type="button"
                        onClick={() => {
                          setDeviceId(device.id);
                          requestAnimationFrame(() => deviceDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
                        }}
                        aria-pressed={active}
                        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet ${active ? "border-lime bg-lime/10" : "border-transparent hover:border-border hover:bg-surface-raised"}`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-raised font-mono text-xs font-bold text-text-secondary">{device.upscale_device_sequence ?? "—"}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-text-primary">{device.client_machine_name || "Unnamed machine"}</span>
                          <span className="mt-0.5 block text-[11px] text-text-secondary">{normalizedDeviceStatus(device)} · {progress.total ? `${progress.done}/${progress.total} checked` : "No parts requested"}</span>
                        </span>
                        <ChevronRight size={15} className="shrink-0 text-text-dim" />
                      </button>
                    );
                  })}
                  {!visibleCompanyDevices.length && (
                    <div className="space-y-2 px-2 py-6 text-center">
                      <p className="text-xs text-text-secondary">No machines match these filters.</p>
                      <Button variant="ghost" size="sm" onClick={() => { setDeviceQuery(""); setDeviceStatusFilter("all"); }}>Clear filters</Button>
                    </div>
                  )}
                </div>
                {visibleCompanyDevices.length > DEVICES_PER_PAGE && (
                  <div className="flex items-center justify-between gap-2 border-t border-border p-3">
                    <Button variant="ghost" size="sm" disabled={safeDevicePage === 1} onClick={() => { setDevicePage(safeDevicePage - 1); setDeviceId(null); }} aria-label="Previous machine page"><ChevronLeft size={15} /></Button>
                    <span className="font-mono text-xs text-text-secondary">Page {safeDevicePage} of {devicePageCount}</span>
                    <Button variant="ghost" size="sm" disabled={safeDevicePage === devicePageCount} onClick={() => { setDevicePage(safeDevicePage + 1); setDeviceId(null); }} aria-label="Next machine page"><ChevronRight size={15} /></Button>
                  </div>
                )}
              </aside>
              {selectedDevice ? (
                <div ref={deviceDetailRef} className="min-w-0 scroll-mt-32 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-mono text-xs font-semibold text-text-secondary">Machine {selectedDeviceIndex + 1} of {visibleCompanyDevices.length}</p>
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" disabled={selectedDeviceIndex <= 0} onClick={() => selectDeviceAt(selectedDeviceIndex - 1)}><ChevronLeft size={14} /> Previous</Button>
                      <Button variant="secondary" size="sm" disabled={selectedDeviceIndex >= visibleCompanyDevices.length - 1} onClick={() => selectDeviceAt(selectedDeviceIndex + 1)}>Next <ChevronRight size={14} /></Button>
                    </div>
                  </div>
                  <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-syne text-xl font-bold text-text-primary">
                          {selectedDevice.client_machine_name}
                        </h3>
                        <p className="text-xs text-text-secondary">
                          Client machine name · Internal DM name:{" "}
                          {selectedDevice.device_id || "Not assigned"}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${normalizedDeviceStatus(selectedDevice) === "Delivered" ? "bg-mint/15 text-mint" : normalizedDeviceStatus(selectedDevice) === "Packing" ? "bg-warning/15 text-warning" : normalizedDeviceStatus(selectedDevice) === "Transit" ? "bg-violet/15 text-violet" : "bg-coral/15 text-coral"}`}>
                        {normalizedDeviceStatus(selectedDevice)}
                      </span>
                    </div>
                    <div>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-bold text-text-primary">Confirm contents of this device order</p>
                        {selectedComponentKeys.length > 0 && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={saving || confirmedCount === selectedComponentKeys.length}
                            onClick={() => void saveConfirmation({
                              ...confirmed,
                              ...Object.fromEntries(selectedComponentKeys.map((key) => [key, true])),
                            })}
                          >
                            {saving ? "Saving..." : confirmedCount === selectedComponentKeys.length ? "All confirmed" : "Quick fill all"}
                          </Button>
                        )}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {selectedComponentKeys.map((key) => (
                          <Checkbox
                            key={key}
                            id={`upscale-confirm-${selectedDevice.id}-${key}`}
                            label={componentNames[key] || key}
                            checked={!!confirmed[key]}
                            disabled={saving}
                            onCheckedChange={(checked) =>
                              void saveConfirmation({ ...confirmed, [key]: checked })
                            }
                          />
                        ))}
                      </div>
                      {selectedComponentKeys.length === 0 && (
                        <p className="text-sm text-text-secondary">No components selected.</p>
                      )}
                      <p className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
                        <CheckCircle2 size={14} /> {confirmedCount} of{" "}
                        {selectedComponentKeys.length} contents confirmed
                      </p>
                    </div>
                    <div className="border-t border-border pt-4">
                      <h4 className="mb-3 text-sm font-bold text-text-primary">Configuration & courier</h4>
                      <dl className="grid gap-x-5 gap-y-3 rounded-lg bg-surface-raised/50 p-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                        <div><dt className="text-xs text-text-secondary">Device model</dt><dd className="mt-0.5 break-words font-semibold text-text-primary">{selectedDevice.material_name || "Not set"}</dd></div>
                        <div><dt className="text-xs text-text-secondary">Hardware version</dt><dd className="mt-0.5 break-words font-semibold text-text-primary">{selectedDevice.version || "Not set"}</dd></div>
                        <div><dt className="text-xs text-text-secondary">Uplink</dt><dd className="mt-0.5 break-words font-semibold text-text-primary">{selectedDevice.uplink || "Not set"}</dd></div>
                        <div><dt className="text-xs text-text-secondary">CT sensors</dt><dd className="mt-0.5 font-semibold text-text-primary">{inventoryCtSensorCount(selectedDevice)}</dd></div>
                        <div><dt className="text-xs text-text-secondary">Vibration sensor</dt><dd className="mt-0.5 break-words font-semibold text-text-primary">{selectedDevice.vibration === "TRUE" ? selectedDevice.vibration_model || "Selected" : "Not selected"}</dd></div>
                        <div><dt className="text-xs text-text-secondary">Proxy model</dt><dd className="mt-0.5 break-words font-semibold text-text-primary">{selectedDevice.proxy_model || "Not set"}</dd></div>
                        <div><dt className="text-xs text-text-secondary">Courier partner</dt><dd className="mt-0.5 break-words font-semibold text-text-primary">{selectedDevice.dispatch || "Not set"}</dd></div>
                        <div><dt className="text-xs text-text-secondary">Tracking number</dt><dd className="mt-0.5 break-all font-semibold text-text-primary">{selectedDevice.tracking_number || "Not set"}</dd></div>
                      </dl>
                    </div>
                    <div>
                      <OrderCard
                        key={selectedDevice.id}
                        material={selectedDevice}
                        editable
                        allowDelete={false}
                        triggerMode="actions"
                        onReload={() => void load(true)}
                      />
                    </div>
                  </section>
                </div>
              ) : (
                <Card className="p-8 text-center text-sm text-text-secondary">
                  No machine matches this search or status.
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
