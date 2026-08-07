import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Textarea,
} from "@/components/ui-kit";
import {
  Boxes,
  Clock3,
  MapPin,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Truck,
  ChevronDown,
  ChevronUp,
  Cpu,
  Wifi,
  Globe,
  SlidersHorizontal,
  CheckCircle2,
  Calendar,
  Layers,
  Info,
  Package,
} from "lucide-react";
import { toast } from "sonner";

type Parcel = {
  id: string;
  parcel_name: string;
  tracking_number: string;
  carrier: string | null;
  status: string;
  location: string | null;
  estimated_arrival: string | null;
  notes: string | null;
  updated_at: string;
};
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
  vibration_model: string | null;
  proxy_model: string | null;
  installation_date: string | null;
  iccid: string | null;
  remark: string | null;
};
type Tab = "parcels" | "materials";

const emptyParcel = {
  parcel_name: "",
  tracking_number: "",
  carrier: "",
  status: "Preparing",
  location: "",
  estimated_date: "",
  estimated_time: "",
  notes: "",
};
const emptyMaterial = {
  material_name: "",
  quantity: "",
  unit: "pcs",
  state: "Available",
  location: "",
  estimated_date: "",
  estimated_time: "",
  tracking_number: "",
  notes: "",
  device_id: "",
  submitted: false,
  industry: "",
  version: "",
  ota_key: "",
  ota_account: "",
  mac_id: "",
  uplink: "",
  ct1: "",
  ct2: "",
  ct3: "",
  proxy1: "",
  proxy2: "",
  encoder: "",
  vibration: "",
  antenna: "",
  tower_light: "",
  dispatch: "",
  energy_meter: "",
  plc: "",
  flash_size: "",
  vibration_model: "",
  proxy_model: "",
  installation_date: "",
  iccid: "",
  remark: "",
};

export function InventoryPanel({ editable = false }: { editable?: boolean }) {
  const formRevealRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("parcels");
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [parcelForm, setParcelForm] = useState(emptyParcel);
  const [materialForm, setMaterialForm] = useState(emptyMaterial);

  // Advanced Filters
  const [filterInstallation, setFilterInstallation] = useState<"all" | "installed" | "pending">("all");
  const [filterOta, setFilterOta] = useState<"all" | "configured" | "pending">("all");
  const [filterDispatch, setFilterDispatch] = useState<"all" | "dispatched" | "pending">("all");
  const [filterIndustry, setFilterIndustry] = useState<string>("all");
  const [filterState, setFilterState] = useState<string>("all");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [parcelResult, materialResult] = await Promise.all([
      supabase
        .from("inventory_parcels")
        .select(
          "id,parcel_name,tracking_number,carrier,status,location,estimated_arrival,notes,updated_at",
        )
        .order("updated_at", { ascending: false }),
      supabase
        .from("inventory_materials")
        .select("*")
        .order("updated_at", { ascending: false }),
    ]);
    if (parcelResult.error || materialResult.error)
      toast.error(
        parcelResult.error?.message || materialResult.error?.message || "Could not load inventory",
      );
    else {
      const dbParcels = (parcelResult.data ?? []) as Parcel[];
      const dbMaterials = (materialResult.data ?? []) as Material[];

      const mockParcels: Parcel[] = [
        {
          id: "mock-parcel-1",
          parcel_name: "High-Gain SIM Gateway Kit",
          tracking_number: "TRK-777888",
          carrier: "Delhivery",
          status: "In transit",
          location: "Delhi Hub",
          estimated_arrival: new Date(Date.now() + 86400000).toISOString(),
          notes: "Package departed hub; ETA tomorrow",
          updated_at: new Date().toISOString()
        }
      ];

      const mockMaterials: Material[] = [
        {
          id: "mock-mat-1",
          device_id: "DM-027",
          quantity: 0,
          unit: "pcs",
          material_name: "Pure Temptation (not working)",
          version: "1.0.180327",
          ota_key: "5e97f426-d490-420d-9462-e94c878d8e98",
          ota_account: "kuldeepshrimali.limelight@gmail.com",
          ct1: "TRUE",
          ct2: "TRUE",
          ct3: "TRUE",
          proxy1: "TRUE",
          proxy2: "FALSE",
          encoder: "FALSE",
          vibration: "TRUE",
          antenna: "FALSE",
          tower_light: "TRUE",
          submitted: true,
          energy_meter: "FALSE",
          plc: "FALSE",
          flash_size: "Flash-16mb",
          vibration_model: "renke",
          proxy_model: "inductive",
          state: "Available",
          location: "Goa Warehouse",
          estimated_arrival: null,
          tracking_number: null,
          notes: "Defective unit awaiting inspection",
          updated_at: new Date().toISOString(),
          mac_id: null,
          uplink: null,
          dispatch: null,
          installation_date: null,
          iccid: null,
          remark: null
        },
        {
          id: "mock-mat-2",
          device_id: "DM-101",
          quantity: 1,
          unit: "pcs",
          material_name: "Aatomize",
          version: "3.0.1",
          ota_key: "0bda416c-b70b-48a4-9b5f-f9be1ad54669",
          ota_account: "kuldeepshrimali.limelight@gmail.com",
          uplink: "LTE",
          ct1: "TRUE",
          ct2: "TRUE",
          ct3: "TRUE",
          proxy1: "FALSE",
          proxy2: "FALSE",
          encoder: "FALSE",
          vibration: "TRUE",
          antenna: "TRUE",
          tower_light: "TRUE",
          submitted: true,
          energy_meter: "FALSE",
          plc: "FALSE",
          flash_size: "Flash-16mb",
          vibration_model: "witmotion",
          installation_date: "2026-06-26",
          iccid: "89918570407083025936",
          remark: "Three phase monitoring is done for state detection Channel A is used for CT based counting",
          state: "Available",
          location: "Mumbai Plant",
          estimated_arrival: null,
          tracking_number: null,
          notes: "Successfully deployed and tested on-site",
          updated_at: new Date().toISOString(),
          mac_id: null,
          dispatch: null,
          proxy_model: null
        },
        {
          id: "mock-mat-3",
          device_id: "DM-099",
          quantity: 1,
          unit: "pcs",
          material_name: "Active Gateway & SIM Kit",
          version: "v3.2",
          state: "In transit",
          tracking_number: "TRK-777888",
          location: "Delhi Hub",
          industry: "Steel",
          submitted: true,
          flash_size: "Flash-16mb",
          vibration_model: "witmotion",
          ota_key: "5e97f426-d490-420d-9462-e94c878d8999",
          ota_account: "support@detameter.in",
          notes: "Dispatched via Delhivery Express",
          updated_at: new Date().toISOString(),
          estimated_arrival: null,
          mac_id: null,
          uplink: null,
          ct1: null,
          ct2: null,
          ct3: null,
          proxy1: null,
          proxy2: null,
          encoder: null,
          vibration: null,
          antenna: null,
          tower_light: null,
          dispatch: null,
          energy_meter: null,
          plc: null,
          proxy_model: null,
          installation_date: null,
          iccid: "89918570407083021111",
          remark: "Demo unit for Steel plant monitoring"
        }
      ];

      const mergedMaterials = [...mockMaterials];
      dbMaterials.forEach((m) => {
        if (!mergedMaterials.some((mm) => mm.device_id === m.device_id)) {
          mergedMaterials.push(m);
        }
      });

      const mergedParcels = [...mockParcels];
      dbParcels.forEach((p) => {
        if (!mergedParcels.some((mp) => mp.tracking_number === p.tracking_number)) {
          mergedParcels.push(p);
        }
      });

      setParcels(mergedParcels);
      setMaterials(mergedMaterials);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("inventory-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_parcels" },
        () => void load(true),
      )
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

  useEffect(() => {
    if (!showForm) return;
    const frame = window.requestAnimationFrame(() => {
      formRevealRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const firstField = formRevealRef.current?.querySelector<HTMLInputElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      );
      firstField?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showForm, editingId]);

  const filteredParcels = useMemo(
    () =>
      parcels.filter((p) =>
        `${p.parcel_name} ${p.tracking_number} ${p.location ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [parcels, query],
  );

  const industries = useMemo(() => {
    const set = new Set<string>();
    materials.forEach((m) => {
      if (m.industry) set.add(m.industry);
    });
    return Array.from(set);
  }, [materials]);

  const states = useMemo(() => {
    const set = new Set<string>();
    materials.forEach((m) => {
      if (m.state) set.add(m.state);
    });
    return Array.from(set);
  }, [materials]);

  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      // 1. Search Query
      const matchesQuery = `${m.material_name} ${m.tracking_number ?? ""} ${m.location ?? ""} ${m.device_id ?? ""} ${m.mac_id ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase());

      // 2. Installation Status
      const matchesInstallation = 
        filterInstallation === "all" ||
        (filterInstallation === "installed" && m.installation_date) ||
        (filterInstallation === "pending" && !m.installation_date);

      // 3. OTA Config
      const matchesOta = 
        filterOta === "all" ||
        (filterOta === "configured" && (m.ota_key || m.ota_account)) ||
        (filterOta === "pending" && !m.ota_key && !m.ota_account);

      // 4. Dispatch Status
      const matchesDispatch =
        filterDispatch === "all" ||
        (filterDispatch === "dispatched" && (m.dispatch || m.tracking_number)) ||
        (filterDispatch === "pending" && !m.dispatch && !m.tracking_number);

      // 5. Industry
      const matchesIndustry =
        filterIndustry === "all" || m.industry === filterIndustry;

      // 6. State
      const matchesState =
        filterState === "all" || m.state === filterState;

      return matchesQuery && matchesInstallation && matchesOta && matchesDispatch && matchesIndustry && matchesState;
    });
  }, [materials, query, filterInstallation, filterOta, filterDispatch, filterIndustry, filterState]);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setParcelForm(emptyParcel);
    setMaterialForm(emptyMaterial);
  };
  const openNew = () => {
    resetForm();
    setShowForm(true);
  };
  const editParcel = (p: Parcel) => {
    const eta = toLocalParts(p.estimated_arrival);
    setTab("parcels");
    setEditingId(p.id);
    setParcelForm({
      parcel_name: p.parcel_name,
      tracking_number: p.tracking_number,
      carrier: p.carrier ?? "",
      status: p.status,
      location: p.location ?? "",
      estimated_date: eta.date,
      estimated_time: eta.time,
      notes: p.notes ?? "",
    });
    setShowForm(true);
  };
  const editMaterial = (m: Material) => {
    const eta = toLocalParts(m.estimated_arrival);
    setTab("materials");
    setEditingId(m.id);
    setMaterialForm({
      material_name: m.material_name,
      quantity: String(m.quantity),
      unit: m.unit,
      state: m.state,
      location: m.location ?? "",
      estimated_date: eta.date,
      estimated_time: eta.time,
      tracking_number: m.tracking_number ?? "",
      notes: m.notes ?? "",
      device_id: m.device_id ?? "",
      submitted: m.submitted ?? false,
      industry: m.industry ?? "",
      version: m.version ?? "",
      ota_key: m.ota_key ?? "",
      ota_account: m.ota_account ?? "",
      mac_id: m.mac_id ?? "",
      uplink: m.uplink ?? "",
      ct1: m.ct1 ?? "",
      ct2: m.ct2 ?? "",
      ct3: m.ct3 ?? "",
      proxy1: m.proxy1 ?? "",
      proxy2: m.proxy2 ?? "",
      encoder: m.encoder ?? "",
      vibration: m.vibration ?? "",
      antenna: m.antenna ?? "",
      tower_light: m.tower_light ?? "",
      dispatch: m.dispatch ?? "",
      energy_meter: m.energy_meter ?? "",
      plc: m.plc ?? "",
      flash_size: m.flash_size ?? "",
      vibration_model: m.vibration_model ?? "",
      proxy_model: m.proxy_model ?? "",
      installation_date: m.installation_date ?? "",
      iccid: m.iccid ?? "",
      remark: m.remark ?? "",
    });
    setShowForm(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setSaving(true);
    let result;
    if (tab === "parcels") {
      const values = {
        parcel_name: parcelForm.parcel_name,
        tracking_number: parcelForm.tracking_number,
        status: parcelForm.status,
        carrier: nullable(parcelForm.carrier),
        location: nullable(parcelForm.location),
        estimated_arrival: nullableDate(parcelForm.estimated_date, parcelForm.estimated_time),
        notes: nullable(parcelForm.notes),
      };
      result = editingId
        ? await supabase.from("inventory_parcels").update(values).eq("id", editingId)
        : await supabase.from("inventory_parcels").insert(values);
    } else {
      const values = {
        material_name: materialForm.material_name,
        quantity: Number(materialForm.quantity),
        unit: materialForm.unit,
        state: materialForm.state,
        location: nullable(materialForm.location),
        estimated_arrival: nullableDate(materialForm.estimated_date, materialForm.estimated_time),
        tracking_number: nullable(materialForm.tracking_number),
        notes: nullable(materialForm.notes),
        device_id: nullable(materialForm.device_id),
        submitted: materialForm.submitted,
        industry: nullable(materialForm.industry),
        version: nullable(materialForm.version),
        ota_key: nullable(materialForm.ota_key),
        ota_account: nullable(materialForm.ota_account),
        mac_id: nullable(materialForm.mac_id),
        uplink: nullable(materialForm.uplink),
        ct1: nullable(materialForm.ct1),
        ct2: nullable(materialForm.ct2),
        ct3: nullable(materialForm.ct3),
        proxy1: nullable(materialForm.proxy1),
        proxy2: nullable(materialForm.proxy2),
        encoder: nullable(materialForm.encoder),
        vibration: nullable(materialForm.vibration),
        antenna: nullable(materialForm.antenna),
        tower_light: nullable(materialForm.tower_light),
        dispatch: nullable(materialForm.dispatch),
        energy_meter: nullable(materialForm.energy_meter),
        plc: nullable(materialForm.plc),
        flash_size: nullable(materialForm.flash_size),
        vibration_model: nullable(materialForm.vibration_model),
        proxy_model: nullable(materialForm.proxy_model),
        installation_date: nullable(materialForm.installation_date),
        iccid: nullable(materialForm.iccid),
        remark: nullable(materialForm.remark),
      };
      result = editingId
        ? await supabase.from("inventory_materials").update(values).eq("id", editingId)
        : await supabase.from("inventory_materials").insert(values);
    }
    setSaving(false);
    setLoading(false);
    if (result.error) return toast.error(result.error.message);
    toast.success(
      `${tab === "parcels" ? "Parcel" : "Material"} ${editingId ? "updated" : "added"}`,
    );
    resetForm();
    await load(true);
  };

  const remove = async (
    table: "inventory_parcels" | "inventory_materials",
    id: string,
    label: string,
  ) => {
    if (!window.confirm(`Delete “${label}”? This cannot be undone.`)) return false;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return false;
    } else {
      toast.success("Inventory entry deleted");
      await load(true);
      return true;
    }
  };

  const deleteEditingEntry = async () => {
    if (!editingId) return;
    const isParcel = tab === "parcels";
    const deleted = await remove(
      isParcel ? "inventory_parcels" : "inventory_materials",
      editingId,
      isParcel ? parcelForm.parcel_name : materialForm.material_name,
    );
    if (deleted) resetForm();
  };

  return (
    <div className="space-y-7 animate-in fade-in duration-200">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-lime/80 font-bold">
            Live logistics
          </p>
          <h1 className="mt-2 text-4xl uppercase tracking-tight font-extrabold">Inventory</h1>
          <p className="mt-2 text-sm text-text-secondary">
            {editable
              ? "Manage parcel movement and material availability for every associate."
              : "Live parcel and material updates from your manager."}
          </p>
        </div>
        {editable && (
          <Button onClick={openNew}>
            <Plus size={16} /> Add {tab === "parcels" ? "parcel" : "material"}
          </Button>
        )}
      </header>

      {/* Dynamic Tab-Specific Metric Cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        {tab === "parcels" ? (
          <>
            <Metric
              icon={Truck}
              label="Active parcels"
              value={parcels.filter((p) => !["Delivered", "Cancelled"].includes(p.status)).length}
            />
            <Metric
              icon={Clock3}
              label="In Transit"
              value={parcels.filter((p) => p.status === "In transit").length}
            />
            <Metric
              icon={PackageCheck}
              label="Delivered"
              value={parcels.filter((p) => p.status === "Delivered").length}
            />
            <Metric
              icon={Boxes}
              label="Total Parcels"
              value={parcels.length}
            />
          </>
        ) : (
          <>
            <Metric
              icon={Boxes}
              label="Total Devices"
              value={materials.length}
            />
            <Metric
              icon={PackageCheck}
              label="Installed"
              value={materials.filter((m) => m.installation_date).length}
            />
            <Metric
              icon={Truck}
              label="Pending Dispatch"
              value={materials.filter((m) => !m.dispatch && !m.tracking_number).length}
            />
            <Metric
              icon={Clock3}
              label="OTA Configured"
              value={materials.filter((m) => m.ota_key || m.ota_account).length}
            />
          </>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-[8px] border border-border bg-surface p-1">
          <TabButton
            active={tab === "parcels"}
            onClick={() => {
              setTab("parcels");
              resetForm();
            }}
            icon={Truck}
          >
            Parcels <span>{parcels.length}</span>
          </TabButton>
          <TabButton
            active={tab === "materials"}
            onClick={() => {
              setTab("materials");
              resetForm();
            }}
            icon={Boxes}
          >
            Materials <span>{materials.length}</span>
          </TabButton>
        </div>
        <div className="relative sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" size={15} />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search inventory…"
            className="pl-9"
          />
        </div>
      </div>

      {/* Advanced Analysis Filters Panel */}
      {tab === "materials" && (
        <div className="rounded-[10px] border border-border bg-surface/40 p-4 space-y-4">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-text-secondary border-b border-border/40 pb-2">
            <SlidersHorizontal size={14} className="text-lime" />
            <span>Analysis Filters</span>
          </div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
            <div>
              <Label>Installation</Label>
              <Select
                value={filterInstallation}
                onChange={(e) => setFilterInstallation(e.target.value as any)}
                className="w-full text-xs"
              >
                <option value="all">All Devices</option>
                <option value="installed">Installed</option>
                <option value="pending">Pending Installation</option>
              </Select>
            </div>
            
            <div>
              <Label>OTA Config</Label>
              <Select
                value={filterOta}
                onChange={(e) => setFilterOta(e.target.value as any)}
                className="w-full text-xs"
              >
                <option value="all">All</option>
                <option value="configured">Configured</option>
                <option value="pending">Pending</option>
              </Select>
            </div>

            <div>
              <Label>Dispatch Status</Label>
              <Select
                value={filterDispatch}
                onChange={(e) => setFilterDispatch(e.target.value as any)}
                className="w-full text-xs"
              >
                <option value="all">All</option>
                <option value="dispatched">Dispatched / Shipped</option>
                <option value="pending">Awaiting Dispatch</option>
              </Select>
            </div>

            <div>
              <Label>Industry</Label>
              <Select
                value={filterIndustry}
                onChange={(e) => setFilterIndustry(e.target.value)}
                className="w-full text-xs"
              >
                <option value="all">All Industries</option>
                {industries.map((ind) => (
                  <option key={ind} value={ind}>{ind}</option>
                ))}
              </Select>
            </div>

            <div>
              <Label>Hardware State</Label>
              <Select
                value={filterState}
                onChange={(e) => setFilterState(e.target.value)}
                className="w-full text-xs"
              >
                <option value="all">All States</option>
                {states.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      )}

      {editable && showForm && (
        <div ref={formRevealRef} className="scroll-mt-6">
          <Card className="border-l-[3px] border-lime">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-lime">
                  Manager entry
                </p>
                <h2 className="mt-1 text-xl">
                  {editingId ? "Edit" : "Add"} {tab === "parcels" ? "parcel" : "material"}
                </h2>
              </div>
              <Button variant="ghost" onClick={resetForm} type="button">
                Cancel
              </Button>
            </div>
            <form onSubmit={save} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tab === "parcels" ? (
                <ParcelFields value={parcelForm} setValue={setParcelForm} />
              ) : (
                <MaterialFields value={materialForm} setValue={setMaterialForm} />
              )}
              <div className="sm:col-span-2 lg:col-span-3">
                <Label>Notes</Label>
                <Textarea
                  rows={2}
                  value={tab === "parcels" ? parcelForm.notes : materialForm.notes}
                  onChange={(e) =>
                    tab === "parcels"
                      ? setParcelForm({ ...parcelForm, notes: e.target.value })
                      : setMaterialForm({ ...materialForm, notes: e.target.value })
                  }
                  placeholder="Optional handling or delivery note"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                {editingId ? (
                  <Button
                    variant="danger"
                    type="button"
                    disabled={saving}
                    onClick={() => void deleteEditingEntry()}
                  >
                    <Trash2 size={15} /> Delete entry
                  </Button>
                ) : (
                  <span />
                )}
                <Button disabled={saving} type="submit">
                  {saving ? <RefreshCw className="animate-spin" size={15} /> : null}
                  {editingId ? "Save changes" : "Publish to associates"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((x) => (
            <div key={x} className="h-52 animate-pulse rounded-[10px] bg-surface" />
          ))}
        </div>
      ) : tab === "parcels" ? (
        filteredParcels.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredParcels.map((p) => (
              <ParcelCard
                key={p.id}
                parcel={p}
                editable={editable}
                onEdit={() => editParcel(p)}
                onDelete={() => void remove("inventory_parcels", p.id, p.parcel_name)}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon={Truck} text="No parcels found." />
        )
      ) : filteredMaterials.length ? (
        /* REDESIGNED RESPONSIVE DATA TABLE FOR MATERIALS/DEVICES */
        <div className="overflow-x-auto rounded-[8px] border border-border bg-surface">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised/40 font-mono text-[10px] uppercase tracking-widest text-text-secondary">
                <th className="px-4 py-3">Device / ID</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Qty</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Installation</th>
                <th className="px-4 py-3">Logistics</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredMaterials.map((m) => (
                <MaterialRow
                  key={m.id}
                  material={m}
                  editable={editable}
                  onEdit={() => editMaterial(m)}
                  onDelete={() => void remove("inventory_materials", m.id, m.material_name)}
                  parcels={parcels}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={Boxes} text="No materials found." />
      )}
    </div>
  );
}

function ParcelFields({
  value,
  setValue,
}: {
  value: typeof emptyParcel;
  setValue: (v: typeof emptyParcel) => void;
}) {
  return (
    <>
      <Field
        label="Parcel name"
        required
        value={value.parcel_name}
        onChange={(v) => setValue({ ...value, parcel_name: v })}
        placeholder="SIM kit batch A"
      />
      <Field
        label="Tracking number"
        required
        value={value.tracking_number}
        onChange={(v) => setValue({ ...value, tracking_number: v })}
        placeholder="AWB / tracking ID"
      />
      <Field
        label="Carrier"
        value={value.carrier}
        onChange={(v) => setValue({ ...value, carrier: v })}
        placeholder="DHL, Delhivery…"
      />
      <div>
        <Label>Status</Label>
        <Select
          value={value.status}
          onChange={(e) => setValue({ ...value, status: e.target.value })}
        >
          {["Preparing", "In transit", "Delivered", "Delayed", "Cancelled"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
      </div>
      <Field
        label="Current location"
        value={value.location}
        onChange={(v) => setValue({ ...value, location: v })}
        placeholder="Mumbai hub"
      />
      <EtaFields
        date={value.estimated_date}
        time={value.estimated_time}
        onDateChange={(estimated_date) => setValue({ ...value, estimated_date })}
        onTimeChange={(estimated_time) => setValue({ ...value, estimated_time })}
      />
    </>
  );
}
function MaterialFields({
  value,
  setValue,
}: {
  value: typeof emptyMaterial;
  setValue: (v: typeof emptyMaterial) => void;
}) {
  return (
    <div className="sm:col-span-2 lg:col-span-3 space-y-6">
      
      {/* Group 1: Device Core Details */}
      <div className="space-y-4">
        <h4 className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-lime uppercase tracking-widest border-b border-border pb-1.5">
          <Cpu size={12} /> Device Information
        </h4>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Material Name / Device Name"
            required
            value={value.material_name}
            onChange={(v) => setValue({ ...value, material_name: v })}
            placeholder="Datameter enclosure"
          />
          <Field
            label="Device ID"
            value={value.device_id}
            onChange={(v) => setValue({ ...value, device_id: v })}
            placeholder="DEV-1002"
          />
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Field
              label="Quantity"
              required
              type="number"
              min="0"
              step="0.01"
              value={value.quantity}
              onChange={(v) => setValue({ ...value, quantity: v })}
              placeholder="0"
            />
            <Field
              label="Unit"
              required
              value={value.unit}
              onChange={(v) => setValue({ ...value, unit: v })}
              placeholder="pcs"
            />
          </div>
          <div>
            <Label>Hardware State</Label>
            <Select value={value.state} onChange={(e) => setValue({ ...value, state: e.target.value })}>
              {["Available", "Low stock", "Out of stock", "In transit", "Reserved"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </div>
          <Field
            label="Industry"
            value={value.industry}
            onChange={(v) => setValue({ ...value, industry: v })}
            placeholder="Textile, Metal, etc."
          />
          <Field
            label="Version"
            value={value.version}
            onChange={(v) => setValue({ ...value, version: v })}
            placeholder="v2.1.0"
          />
          <Field
            label="ICCID (SIM Card)"
            value={value.iccid}
            onChange={(v) => setValue({ ...value, iccid: v })}
            placeholder="899110..."
          />
          <Field
            label="Flash Size"
            value={value.flash_size}
            onChange={(v) => setValue({ ...value, flash_size: v })}
            placeholder="8MB, 16MB"
          />
          <div className="flex items-center pt-5">
            <Checkbox
              checked={value.submitted}
              onCheckedChange={(checked) => setValue({ ...value, submitted: checked })}
              label="Mark Submitted"
              id="field-submitted"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field
              label="Remark"
              value={value.remark}
              onChange={(v) => setValue({ ...value, remark: v })}
              placeholder="Internal hardware observations..."
            />
          </div>
        </div>
      </div>

      {/* Group 2: Communication Spec */}
      <div className="space-y-4 pt-2">
        <h4 className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-violet uppercase tracking-widest border-b border-border pb-1.5">
          <Wifi size={12} /> Communication Specifications
        </h4>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="MAC ID"
            value={value.mac_id}
            onChange={(v) => setValue({ ...value, mac_id: v })}
            placeholder="00:1A:2B:3C..."
          />
          <Field
            label="UPLINK Type"
            value={value.uplink}
            onChange={(v) => setValue({ ...value, uplink: v })}
            placeholder="4G / Wi-Fi / Ethernet"
          />
          <Field
            label="Antenna Type"
            value={value.antenna}
            onChange={(v) => setValue({ ...value, antenna: v })}
            placeholder="Internal / External 3dBi"
          />
        </div>
      </div>

      {/* Group 3: Hardware Config */}
      <div className="space-y-4 pt-2">
        <h4 className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-coral uppercase tracking-widest border-b border-border pb-1.5">
          <Layers size={12} /> Hardware Configuration
        </h4>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="PLC Type"
            value={value.plc}
            onChange={(v) => setValue({ ...value, plc: v })}
            placeholder="Modbus RTU / Siemens"
          />
          <Field
            label="Vibration Model"
            value={value.vibration_model}
            onChange={(v) => setValue({ ...value, vibration_model: v })}
            placeholder="ADXL345 / LIS3DH"
          />
          <Field
            label="Proxy Model"
            value={value.proxy_model}
            onChange={(v) => setValue({ ...value, proxy_model: v })}
            placeholder="NPN NO / PNP"
          />
        </div>
      </div>

      {/* Group 4: Power & Sensors */}
      <div className="space-y-4 pt-2">
        <h4 className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-mint uppercase tracking-widest border-b border-border pb-1.5">
          <Info size={12} /> Power & Sensors Configuration
        </h4>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Field
            label="CT1 Spec"
            value={value.ct1}
            onChange={(v) => setValue({ ...value, ct1: v })}
            placeholder="30A / 1V"
          />
          <Field
            label="CT2 Spec"
            value={value.ct2}
            onChange={(v) => setValue({ ...value, ct2: v })}
            placeholder="30A / 1V"
          />
          <Field
            label="CT3 Spec"
            value={value.ct3}
            onChange={(v) => setValue({ ...value, ct3: v })}
            placeholder="30A / 1V"
          />
          <Field
            label="PROXY1 Spec"
            value={value.proxy1}
            onChange={(v) => setValue({ ...value, proxy1: v })}
            placeholder="M12 Inductive"
          />
          <Field
            label="PROXY2 Spec"
            value={value.proxy2}
            onChange={(v) => setValue({ ...value, proxy2: v })}
            placeholder="M18 Photoelectric"
          />
          <Field
            label="ENCODER Spec"
            value={value.encoder}
            onChange={(v) => setValue({ ...value, encoder: v })}
            placeholder="600 PPR"
          />
          <Field
            label="VIBRATION Spec"
            value={value.vibration}
            onChange={(v) => setValue({ ...value, vibration: v })}
            placeholder="3-Axis Accel"
          />
          <Field
            label="Tower Light Spec"
            value={value.tower_light}
            onChange={(v) => setValue({ ...value, tower_light: v })}
            placeholder="3-Color Red/Yel/Grn"
          />
          <Field
            label="Energy Meter"
            value={value.energy_meter}
            onChange={(v) => setValue({ ...value, energy_meter: v })}
            placeholder="Modbus kWh Meter"
          />
        </div>
      </div>

      {/* Group 5: OTA Config */}
      <div className="space-y-4 pt-2">
        <h4 className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-violet uppercase tracking-widest border-b border-border pb-1.5">
          OTA Settings
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="OTA Key"
            value={value.ota_key}
            onChange={(v) => setValue({ ...value, ota_key: v })}
            placeholder="ota-secure-key-12345"
          />
          <Field
            label="OTA Account"
            value={value.ota_account}
            onChange={(v) => setValue({ ...value, ota_account: v })}
            placeholder="admin@ota.account"
          />
        </div>
      </div>

      {/* Group 6: Dates & Logistics */}
      <div className="space-y-4 pt-2">
        <h4 className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-lime uppercase tracking-widest border-b border-border pb-1.5">
          Dates & Logistics
        </h4>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Location"
            value={value.location}
            onChange={(v) => setValue({ ...value, location: v })}
            placeholder="Ahmedabad warehouse"
          />
          <Field
            label="Installation Date"
            type="date"
            value={value.installation_date || ""}
            onChange={(v) => setValue({ ...value, installation_date: v })}
          />
          <Field
            label="Dispatch Details"
            value={value.dispatch}
            onChange={(v) => setValue({ ...value, dispatch: v })}
            placeholder="Dispatched via Blue Dart"
          />
          <Field
            label="Tracking Number"
            value={value.tracking_number}
            onChange={(v) => setValue({ ...value, tracking_number: v })}
            placeholder="AWB Tracking Link / ID"
          />
          <div className="sm:col-span-2">
            <EtaFields
              date={value.estimated_date}
              time={value.estimated_time}
              onDateChange={(estimated_date) => setValue({ ...value, estimated_date })}
              onTimeChange={(estimated_time) => setValue({ ...value, estimated_time })}
            />
          </div>
        </div>
      </div>

    </div>
  );
}

function MaterialRow({
  material: m,
  editable,
  onEdit,
  onDelete,
  parcels,
}: {
  material: Material;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
  parcels: Parcel[];
}) {
  const [expanded, setExpanded] = useState(false);

  // Live tracking lookup
  const matchedParcel = useMemo(() => {
    if (!m.tracking_number) return null;
    return parcels.find((p) => p.tracking_number.trim() === m.tracking_number?.trim());
  }, [m.tracking_number, parcels]);

  return (
    <>
      <tr 
        onClick={() => setExpanded(!expanded)}
        className="cursor-pointer hover:bg-surface-raised/40 transition-colors border-b border-border/50"
      >
        <td className="px-4 py-3.5">
          <div className="flex items-center gap-2">
            <div className="font-mono text-sm font-bold text-lime">
              {m.device_id || "No ID"}
            </div>
            {m.submitted && (
              <Badge tone="success">SUBMITTED</Badge>
            )}
          </div>
          <div className="text-xs text-text-secondary mt-0.5">{m.material_name}</div>
        </td>
        <td className="px-4 py-3.5">
          <StatusBadge value={m.state} />
        </td>
        <td className="px-4 py-3.5 font-mono text-xs">
          {m.quantity} <span className="text-text-secondary">{m.unit}</span>
        </td>
        <td className="px-4 py-3.5 text-xs text-text-secondary">
          <div className="flex items-center gap-1.5">
            <MapPin size={12} className="text-lime shrink-0" />
            <span>{m.location || "Not set"}</span>
          </div>
        </td>
        <td className="px-4 py-3.5 text-xs text-text-secondary">
          <div className="flex items-center gap-1.5">
            <Calendar size={12} className="text-lime shrink-0" />
            <span>{m.installation_date ? new Date(m.installation_date).toLocaleDateString() : "Pending"}</span>
          </div>
        </td>
        <td className="px-4 py-3.5 text-xs">
          {m.tracking_number ? (
            <div className="flex flex-col">
              <span className="font-mono text-[10px] text-text-primary">{m.tracking_number}</span>
              {matchedParcel ? (
                <span className="text-[10px] text-violet font-semibold">{matchedParcel.status}</span>
              ) : (
                <span className="text-[10px] text-text-dim">Shipping</span>
              )}
            </div>
          ) : (
            <span className="text-text-dim text-[11px]">No Tracking</span>
          )}
        </td>
        <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" className="p-1.5" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </Button>
            {editable && <Actions onEdit={onEdit} onDelete={onDelete} />}
          </div>
        </td>
      </tr>

      {/* Expanded row details */}
      {expanded && (
        <tr className="bg-surface-raised/20 border-b border-border/50">
          <td colSpan={7} className="px-6 py-5">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              
              {/* Device Info */}
              <div className="space-y-3 rounded-lg border border-border bg-surface/50 p-4">
                <h4 className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-lime uppercase tracking-widest border-b border-border pb-1.5">
                  <Cpu size={12} /> Device Information
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-text-secondary">Device ID:</span> <span className="font-mono font-bold">{m.device_id || "N/A"}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Submitted:</span> <span>{m.submitted ? "Yes" : "No"}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Industry:</span> <span className="font-semibold">{m.industry || "N/A"}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Version:</span> <span>{m.version || "N/A"}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">ICCID:</span> <span className="font-mono">{m.iccid || "N/A"}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Flash Size:</span> <span>{m.flash_size || "N/A"}</span></div>
                  <div className="flex flex-col gap-0.5 mt-1 border-t border-border/40 pt-1.5">
                    <span className="text-text-secondary text-[10px] uppercase font-mono">Remarks:</span>
                    <p className="text-[11px] text-text-primary leading-relaxed">{m.remark || "None"}</p>
                  </div>
                </div>
              </div>

              {/* Communication & OTA */}
              <div className="space-y-3 rounded-lg border border-border bg-surface/50 p-4">
                <h4 className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-violet uppercase tracking-widest border-b border-border pb-1.5">
                  <Wifi size={12} /> Communication & OTA
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-text-secondary">MAC ID:</span> <span className="font-mono text-text-primary">{m.mac_id || "N/A"}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">UPLINK:</span> <span>{m.uplink || "N/A"}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Antenna:</span> <span>{m.antenna || "N/A"}</span></div>
                  <div className="flex flex-col gap-1.5 mt-2 border-t border-border/40 pt-2">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-violet/80">OTA Config</span>
                    <div className="flex justify-between"><span className="text-text-secondary">OTA Key:</span> <span className="font-mono">{m.ota_key || "N/A"}</span></div>
                    <div className="flex justify-between"><span className="text-text-secondary">OTA Account:</span> <span>{m.ota_account || "N/A"}</span></div>
                  </div>
                </div>
              </div>

              {/* Hardware & Power Config */}
              <div className="space-y-3 rounded-lg border border-border bg-surface/50 p-4">
                <h4 className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-coral uppercase tracking-widest border-b border-border pb-1.5">
                  <Layers size={12} /> Hardware & Power
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-text-secondary">PLC:</span> <span>{m.plc || "N/A"}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Vibration Model:</span> <span>{m.vibration_model || "N/A"}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Proxy Model:</span> <span>{m.proxy_model || "N/A"}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Energy Meter:</span> <span>{m.energy_meter || "N/A"}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Tower Light:</span> <span>{m.tower_light || "N/A"}</span></div>
                </div>
              </div>

              {/* Power & Sensors Continued */}
              <div className="space-y-3 rounded-lg border border-border bg-surface/50 p-4">
                <h4 className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-mint uppercase tracking-widest border-b border-border pb-1.5">
                  <Info size={12} /> Sensors Configuration
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex flex-col"><span className="text-[10px] text-text-secondary">CT1:</span><span className="font-semibold">{m.ct1 || "N/A"}</span></div>
                  <div className="flex flex-col"><span className="text-[10px] text-text-secondary">CT2:</span><span className="font-semibold">{m.ct2 || "N/A"}</span></div>
                  <div className="flex flex-col"><span className="text-[10px] text-text-secondary">CT3:</span><span className="font-semibold">{m.ct3 || "N/A"}</span></div>
                  <div className="flex flex-col"><span className="text-[10px] text-text-secondary">PROXY1:</span><span className="font-semibold">{m.proxy1 || "N/A"}</span></div>
                  <div className="flex flex-col"><span className="text-[10px] text-text-secondary">PROXY2:</span><span className="font-semibold">{m.proxy2 || "N/A"}</span></div>
                  <div className="flex flex-col"><span className="text-[10px] text-text-secondary">ENCODER:</span><span className="font-semibold">{m.encoder || "N/A"}</span></div>
                  <div className="flex flex-col"><span className="text-[10px] text-text-secondary">VIBRATION:</span><span className="font-semibold">{m.vibration || "N/A"}</span></div>
                </div>
              </div>

              {/* Dispatch & Parcel Tracking Integration */}
              <div className="sm:col-span-2 lg:col-span-4 rounded-lg border border-border bg-surface/50 p-4 space-y-3">
                <h4 className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-violet uppercase tracking-widest border-b border-border pb-1.5">
                  <Truck size={12} /> Dispatch & Live Parcel Tracking
                </h4>
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-text-secondary">Dispatch:</span> <span className="font-semibold">{m.dispatch || "N/A"}</span></div>
                    <div className="flex justify-between"><span className="text-text-secondary">Tracking Number:</span> <span className="font-mono">{m.tracking_number || "N/A"}</span></div>
                    <div className="flex justify-between"><span className="text-text-secondary">Current Location:</span> <span>{m.location || "N/A"}</span></div>
                    <div className="flex justify-between"><span className="text-text-secondary">Estimated Arrival:</span> <span>{m.estimated_arrival ? formatDate(m.estimated_arrival) : "N/A"}</span></div>
                  </div>
                  
                  {/* Live Stepper Tracker */}
                  <div className="rounded-lg bg-surface-raised/40 p-4 border border-border/60 flex flex-col justify-center">
                    {matchedParcel ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs border-b border-border/40 pb-1.5">
                          <span className="font-semibold text-text-secondary">Parcel Link:</span>
                          <span className="font-bold text-lime">{matchedParcel.parcel_name}</span>
                        </div>
                        
                        {/* Stepper Timeline */}
                        <div className="flex items-center justify-between relative mt-2 px-2">
                          <div className="absolute left-4 right-4 top-1/2 h-0.5 bg-border -translate-y-1/2 z-0" />
                          
                          {/* Preparing */}
                          <div className="flex flex-col items-center z-10">
                            <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              ["Preparing", "In transit", "Delivered"].includes(matchedParcel.status)
                                ? "bg-lime text-bg"
                                : "bg-surface border border-border text-text-dim"
                            }`}>✓</div>
                            <span className="text-[9px] font-mono uppercase mt-1 text-text-secondary">Prepared</span>
                          </div>

                          {/* In transit */}
                          <div className="flex flex-col items-center z-10">
                            <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              ["In transit", "Delivered"].includes(matchedParcel.status)
                                ? "bg-violet text-white"
                                : matchedParcel.status === "Delayed"
                                  ? "bg-coral text-white animate-pulse"
                                  : "bg-surface border border-border text-text-dim"
                            }`}>
                              {matchedParcel.status === "Delayed" ? "!" : "🚚"}
                            </div>
                            <span className="text-[9px] font-mono uppercase mt-1 text-text-secondary">In Transit</span>
                          </div>

                          {/* Delivered */}
                          <div className="flex flex-col items-center z-10">
                            <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              matchedParcel.status === "Delivered"
                                ? "bg-mint text-bg"
                                : "bg-surface border border-border text-text-dim"
                            }`}>✓</div>
                            <span className="text-[9px] font-mono uppercase mt-1 text-text-secondary">Delivered</span>
                          </div>
                        </div>

                        {/* Additional info */}
                        <div className="text-[11px] text-text-secondary mt-2 text-center">
                          {matchedParcel.carrier && <span>Carrier: <strong className="text-text-primary">{matchedParcel.carrier}</strong></span>}
                          {matchedParcel.location && <span> · Current: <strong className="text-text-primary">{matchedParcel.location}</strong></span>}
                          {matchedParcel.notes && <p className="mt-1 italic text-text-dim">"{matchedParcel.notes}"</p>}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center text-text-dim space-y-1.5 py-2">
                        <Info size={24} strokeWidth={1.5} />
                        <p className="text-xs">No active parcel link found.</p>
                        <p className="text-[10px] max-w-xs">Create a parcel with tracking number <strong className="font-mono text-text-secondary">{m.tracking_number || "none"}</strong> to track live delivery status.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
function Field({
  label,
  onChange,
  ...props
}: { label: string; onChange: (v: string) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange"
>) {
  return (
    <div>
      <Label>{label}</Label>
      <Input onChange={(e) => onChange(e.target.value)} {...props} />
    </div>
  );
}
function EtaFields({
  date,
  time,
  onDateChange,
  onTimeChange,
}: {
  date: string;
  time: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Arrival date" type="date" value={date} onChange={onDateChange} />
      <Field label="Arrival time" type="time" value={time} onChange={onTimeChange} />
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Truck;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[9px] border border-border bg-surface px-4 py-3">
      <div className="rounded-[6px] bg-lime/10 p-2 text-lime">
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
function TabButton({
  active,
  icon: Icon,
  children,
  onClick,
}: {
  active: boolean;
  icon: typeof Truck;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-[6px] px-4 py-2 text-xs font-semibold transition ${active ? "bg-lime text-primary-foreground" : "text-text-secondary hover:text-text-primary"}`}
    >
      <Icon size={15} />
      {children}
    </button>
  );
}
function ParcelCard({
  parcel: p,
  editable,
  onEdit,
  onDelete,
}: {
  parcel: Parcel;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-y-0 left-0 w-1 bg-violet" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-text-primary">{p.parcel_name}</div>
          <div className="mt-1 font-mono text-xs text-lime">{p.tracking_number}</div>
        </div>
        <StatusBadge value={p.status} />
      </div>
      <Details location={p.location} eta={p.estimated_arrival} tracking={null} />
      <div className="mt-4 flex items-end justify-between border-t border-border pt-3">
        <div className="text-[10px] text-text-dim">
          {p.carrier || "Carrier not set"}
          {p.notes ? ` · ${p.notes}` : ""}
        </div>
        {editable && <Actions onEdit={onEdit} onDelete={onDelete} />}
      </div>
    </Card>
  );
}
function MaterialCard({
  material: m,
  editable,
  onEdit,
  onDelete,
}: {
  material: Material;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-y-0 left-0 w-1 bg-lime" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-text-primary">{m.material_name}</div>
          <div className="mt-1 text-2xl font-extrabold text-lime">
            {m.quantity} <span className="text-xs text-text-secondary">{m.unit}</span>
          </div>
        </div>
        <StatusBadge value={m.state} />
      </div>
      <Details location={m.location} eta={m.estimated_arrival} tracking={m.tracking_number} />
      <div className="mt-4 flex items-end justify-between border-t border-border pt-3">
        <div className="text-[10px] text-text-dim">
          {m.notes || `Updated ${formatDate(m.updated_at)}`}
        </div>
        {editable && <Actions onEdit={onEdit} onDelete={onDelete} />}
      </div>
    </Card>
  );
}
function Details({
  location,
  eta,
  tracking,
}: {
  location: string | null;
  eta: string | null;
  tracking: string | null;
}) {
  return (
    <div className="mt-5 grid gap-3 text-xs sm:grid-cols-2">
      <div className="flex gap-2 text-text-secondary">
        <MapPin size={15} className="shrink-0 text-lime" />
        <span>{location || "Location not set"}</span>
      </div>
      <div className="flex gap-2 text-text-secondary">
        <Clock3 size={15} className="shrink-0 text-lime" />
        <span>{eta ? formatDate(eta) : "ETA not set"}</span>
      </div>
      {tracking && (
        <div className="sm:col-span-2 font-mono text-[11px] text-text-secondary">
          Tracking: <span className="text-text-primary">{tracking}</span>
        </div>
      )}
    </div>
  );
}
function Actions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex gap-1">
      <Button variant="ghost" className="p-2" onClick={onEdit} title="Edit">
        <Pencil size={14} />
      </Button>
      <Button variant="ghost" className="p-2 text-coral" onClick={onDelete} title="Delete">
        <Trash2 size={14} />
      </Button>
    </div>
  );
}
function StatusBadge({ value }: { value: string }) {
  const tone = ["Delivered", "Available"].includes(value)
    ? "success"
    : ["Delayed", "Out of stock", "Cancelled"].includes(value)
      ? "danger"
      : ["Preparing", "Low stock", "Reserved"].includes(value)
        ? "warning"
        : "info";
  return <Badge tone={tone}>{value}</Badge>;
}
function nullable(v: string) {
  return v.trim() || null;
}
function nullableDate(date: string, time: string) {
  return date ? new Date(`${date}T${time || "00:00"}`).toISOString() : null;
}
function toLocalParts(v: string | null) {
  if (!v) return { date: "", time: "" };
  const d = new Date(v);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  const local = d.toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}
function formatDate(v: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(v),
  );
}
