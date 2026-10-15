import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, ChevronLeft, ChevronRight, PackageCheck, Search, Truck, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Card, EmptyState, Input, Select } from "@/components/ui-kit";
import { LogisticsTableView, normalizeLogisticsStatus, type Material } from "./InventoryPanel";

type CompanyOrder = {
  id: string;
  company_name: string;
  device_count: number;
  created_at: string;
};

type StatusFilter = "all" | "Pending" | "Packing" | "Transit" | "Delivered";
const PAGE_SIZE = 20;

function deviceStatus(device: Material): Exclude<StatusFilter, "all"> {
  try {
    const notes = JSON.parse(device.notes || "{}");
    return normalizeLogisticsStatus(notes.logistics_status || device.state || "Pending");
  } catch {
    return normalizeLogisticsStatus(device.state || "Pending");
  }
}

export function UpscaleDeviceInfoPanel() {
  const [orders, setOrders] = useState<CompanyOrder[]>([]);
  const [devices, setDevices] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [deviceQuery, setDeviceQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [orderResult, deviceResult] = await Promise.all([
      supabase.from("upscale_company_orders").select("id,company_name,device_count,created_at").order("created_at", { ascending: false }),
      supabase.from("inventory_materials").select("*").eq("order_source", "upscale").eq("submitted", true),
    ]);
    if (orderResult.error || deviceResult.error) {
      setError(orderResult.error?.message || deviceResult.error?.message || "Could not load Upscale device information.");
    } else {
      setError("");
      setOrders((orderResult.data ?? []) as CompanyOrder[]);
      setDevices((deviceResult.data ?? []) as Material[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase.channel("upscale-device-info-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "upscale_company_orders" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_materials" }, () => void load(true))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  useEffect(() => {
    if (!selectedOrderId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedOrderId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedOrderId]);

  useEffect(() => { setPage(1); }, [selectedOrderId, deviceQuery, statusFilter]);

  const visibleOrders = useMemo(() => orders.filter((order) =>
    order.company_name.toLowerCase().includes(companyQuery.trim().toLowerCase()),
  ), [orders, companyQuery]);
  const selectedOrder = orders.find((order) => order.id === selectedOrderId);
  useEffect(() => {
    if (selectedOrderId && !loading && !selectedOrder) setSelectedOrderId(null);
  }, [selectedOrderId, selectedOrder, loading]);
  const companyDevices = useMemo(() => devices
    .filter((device) => device.upscale_order_id === selectedOrderId)
    .sort((a, b) => (a.upscale_device_sequence ?? 0) - (b.upscale_device_sequence ?? 0)),
  [devices, selectedOrderId]);
  const filteredDevices = useMemo(() => companyDevices.filter((device) => {
    const matchesStatus = statusFilter === "all" || deviceStatus(device) === statusFilter;
    const searchable = `${device.client_machine_name ?? ""} ${device.device_id ?? ""} ${device.tracking_number ?? ""} ${device.upscale_device_sequence ?? ""}`.toLowerCase();
    return matchesStatus && searchable.includes(deviceQuery.trim().toLowerCase());
  }), [companyDevices, deviceQuery, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredDevices.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageDevices = filteredDevices.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const deliveredCount = companyDevices.filter((device) => deviceStatus(device) === "Delivered").length;
  const transitCount = companyDevices.filter((device) => deviceStatus(device) === "Transit").length;

  if (loading) return <Card className="p-6 text-sm text-text-secondary">Loading Upscale device information...</Card>;
  if (error) return <Card className="p-6 text-sm text-coral">{error}</Card>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-text-primary">Company device tracking</h3>
          <p className="mt-1 text-xs text-text-secondary">Open a company to review every machine and its logistics details.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
          <Input value={companyQuery} onChange={(event) => setCompanyQuery(event.target.value)} placeholder="Search company" aria-label="Search Upscale companies" className="pl-9" />
        </div>
      </div>
      {visibleOrders.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleOrders.map((order) => {
            const orderDevices = devices.filter((device) => device.upscale_order_id === order.id);
            const delivered = orderDevices.filter((device) => deviceStatus(device) === "Delivered").length;
            const inTransit = orderDevices.filter((device) => deviceStatus(device) === "Transit").length;
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => { setSelectedOrderId(order.id); setDeviceQuery(""); setStatusFilter("all"); setPage(1); }}
                className="rounded-xl border border-border bg-surface p-4 text-left transition hover:border-lime/60 hover:bg-surface-raised/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words font-syne text-base font-bold text-text-primary">{order.company_name}</span>
                  <ChevronRight size={17} className="shrink-0 text-lime" />
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold text-lime">{orderDevices.length}</span>
                  <span className="text-xs text-text-secondary">of {order.device_count} machines</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                  <span className="inline-flex items-center gap-1"><Truck size={13} /> {inTransit} in transit</span>
                  <span className="inline-flex items-center gap-1"><PackageCheck size={13} /> {delivered} delivered</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Boxes} text={companyQuery ? "No companies match this search." : "No Upscale company orders found."} />
      )}

      {selectedOrder && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-bg p-3 sm:p-5" role="dialog" aria-modal="true" aria-label={`${selectedOrder.company_name} device tracking`}>
          <div className="mx-auto max-w-screen-2xl space-y-4">
            <header className="sticky top-0 z-30 flex items-start justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-lime">Upscale / Device information</p>
                <h2 className="mt-1 break-words font-syne text-xl font-bold text-text-primary sm:text-2xl">{selectedOrder.company_name}</h2>
                <p className="mt-1 text-xs text-text-secondary">{companyDevices.length} machines · {transitCount} in transit · {deliveredCount} delivered</p>
              </div>
              <button type="button" onClick={() => setSelectedOrderId(null)} aria-label="Close Upscale device tracking" className="rounded-lg border border-border p-2 text-text-secondary transition hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"><X size={18} /></button>
            </header>
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
                <Input value={deviceQuery} onChange={(event) => setDeviceQuery(event.target.value)} placeholder="Search machine, DM name, tracking number" aria-label="Search company machines" className="pl-9" />
              </div>
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} aria-label="Filter machines by status" className="sm:w-44">
                <option value="all">All statuses</option>
                <option value="Pending">Pending</option>
                <option value="Packing">Packing</option>
                <option value="Transit">In transit</option>
                <option value="Delivered">Delivered</option>
              </Select>
              <span className="text-xs text-text-secondary sm:pl-2">{filteredDevices.length} shown</span>
            </div>
            <LogisticsTableView materials={pageDevices} showMachineColumn title="Upscale Device Tracking" />
            {pageCount > 1 && (
              <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-3">
                <Button variant="secondary" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={15} /> Previous</Button>
                <span className="font-mono text-xs text-text-secondary">Page {currentPage} of {pageCount}</span>
                <Button variant="secondary" size="sm" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next <ChevronRight size={15} /></Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
