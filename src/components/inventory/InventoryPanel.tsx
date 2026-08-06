import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Badge,
  Button,
  Card,
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
        .select(
          "id,material_name,quantity,unit,state,location,estimated_arrival,tracking_number,notes,updated_at",
        )
        .order("updated_at", { ascending: false }),
    ]);
    if (parcelResult.error || materialResult.error)
      toast.error(
        parcelResult.error?.message || materialResult.error?.message || "Could not load inventory",
      );
    else {
      setParcels((parcelResult.data ?? []) as Parcel[]);
      setMaterials((materialResult.data ?? []) as Material[]);
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
  const filteredMaterials = useMemo(
    () =>
      materials.filter((m) =>
        `${m.material_name} ${m.tracking_number ?? ""} ${m.location ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [materials, query],
  );

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
    });
    setShowForm(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
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
      };
      result = editingId
        ? await supabase.from("inventory_materials").update(values).eq("id", editingId)
        : await supabase.from("inventory_materials").insert(values);
    }
    setSaving(false);
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

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          icon={Truck}
          label="Active parcels"
          value={parcels.filter((p) => !["Delivered", "Cancelled"].includes(p.status)).length}
        />
        <Metric icon={Boxes} label="Material lines" value={materials.length} />
        <Metric
          icon={PackageCheck}
          label="Available items"
          value={materials.filter((m) => m.state === "Available").length}
        />
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
        <div className="grid gap-4 md:grid-cols-2">
          {filteredMaterials.map((m) => (
            <MaterialCard
              key={m.id}
              material={m}
              editable={editable}
              onEdit={() => editMaterial(m)}
              onDelete={() => void remove("inventory_materials", m.id, m.material_name)}
            />
          ))}
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
    <>
      <Field
        label="Material"
        required
        value={value.material_name}
        onChange={(v) => setValue({ ...value, material_name: v })}
        placeholder="Datameter enclosure"
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
        <Label>State</Label>
        <Select value={value.state} onChange={(e) => setValue({ ...value, state: e.target.value })}>
          {["Available", "Low stock", "Out of stock", "In transit", "Reserved"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
      </div>
      <Field
        label="Location"
        value={value.location}
        onChange={(v) => setValue({ ...value, location: v })}
        placeholder="Ahmedabad warehouse"
      />
      <EtaFields
        date={value.estimated_date}
        time={value.estimated_time}
        onDateChange={(estimated_date) => setValue({ ...value, estimated_date })}
        onTimeChange={(estimated_time) => setValue({ ...value, estimated_time })}
      />
      <Field
        label="Tracking number"
        value={value.tracking_number}
        onChange={(v) => setValue({ ...value, tracking_number: v })}
        placeholder="If material is shipping"
      />
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
      className={`flex items-center gap-2 rounded-[6px] px-4 py-2 text-xs transition ${active ? "bg-lime text-black" : "text-text-secondary hover:text-text-primary"}`}
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
