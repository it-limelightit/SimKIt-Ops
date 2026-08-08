import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, SectionTitle, Label, Input, Select, Button, Checkbox } from "@/components/ui-kit";
import { toast } from "sonner";
import { Cpu, Layers, CheckCircle2, RefreshCw, Activity } from "lucide-react";

interface OrderTabProps {
  site: {
    id: string;
    name: string;
    company_name: string | null;
    city: string | null;
    address: string | null;
  };
  workerId: string;
}

export function OrderTab({ site, workerId }: OrderTabProps) {
  const [deviceName, setDeviceName] = useState("");
  const [ct1, setCt1] = useState(false);
  const [ct2, setCt2] = useState(false);
  const [ct3, setCt3] = useState(false);
  const [proxyModel, setProxyModel] = useState("");
  const [proxy1, setProxy1] = useState(false);
  const [proxy2, setProxy2] = useState(false);
  const [encoder, setEncoder] = useState(false);
  const [vibration, setVibration] = useState(false);
  const [vibrationModel, setVibrationModel] = useState("");
  const [antenna, setAntenna] = useState(false);
  const [towerLight, setTowerLight] = useState(false);
  const [energyMeter, setEnergyMeter] = useState(false);
  const [plc, setPlc] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submittedOrder, setSubmittedOrder] = useState<any | null>(null);
  const [existingOrder, setExistingOrder] = useState<any | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(true);

  const companyName = site.company_name || site.name;
  const address = site.address?.trim() || site.city?.trim() || "Address not specified";

  useEffect(() => {
    const fetchExistingOrder = async () => {
      setLoadingOrder(true);
      try {
        const { data, error } = await supabase
          .from("inventory_materials")
          .select("*")
          .eq("submitted", true)
          .eq("material_name", companyName)
          .maybeSingle();

        if (!error && data) {
          setExistingOrder(data);
        }
      } catch (err) {
        console.error("Error checking existing order:", err);
      } finally {
        setLoadingOrder(false);
      }
    };
    fetchExistingOrder();
  }, [companyName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName.trim()) {
      toast.error("Please enter a device name.");
      return;
    }

    setSubmitting(true);
    try {
      // 1. Prevent duplicate submission by querying DB first
      const { data: check, error: checkError } = await supabase
        .from("inventory_materials")
        .select("*")
        .eq("submitted", true)
        .eq("material_name", companyName)
        .maybeSingle();

      if (check) {
        toast.error("Already ordered: An order has already been placed for this company.");
        setExistingOrder(check);
        setSubmitting(false);
        return;
      }

      const { data: inserted, error } = await supabase
        .from("inventory_materials")
        .insert({
          material_name: companyName,
          location: address,
          device_id: deviceName.trim(),
          submitted: true,
          state: "Available", // Must be one of ('Available', 'Low stock', 'Out of stock', 'In transit', 'Reserved') to pass DB CHECK constraint
          ct1: ct1 ? "TRUE" : "FALSE",
          ct2: ct2 ? "TRUE" : "FALSE",
          ct3: ct3 ? "TRUE" : "FALSE",
          proxy_model: proxyModel || null,
          proxy1: proxy1 ? "TRUE" : "FALSE",
          proxy2: proxy2 ? "TRUE" : "FALSE",
          encoder: encoder ? "TRUE" : "FALSE",
          vibration: vibration ? "TRUE" : "FALSE",
          vibration_model: vibrationModel || null,
          antenna: antenna ? "TRUE" : "FALSE",
          tower_light: towerLight ? "TRUE" : "FALSE",
          energy_meter: energyMeter ? "TRUE" : "FALSE",
          plc: plc ? "TRUE" : "FALSE",
          created_by: workerId,
          quantity: 1,
          unit: "pcs",
          notes: JSON.stringify({
            courier_partner: "",
            packing_date: "",
            transit_date: "",
            arrived_date: "",
            courier_id: "",
            logistics_status: "Pending" // Storing actual logistics status in JSON notes to bypass RLS constraint check
          })
        })
        .select()
        .single();

      if (error) throw error;

      toast.success("Device order submitted successfully!");
      setSubmittedOrder(inserted);
      // Reset form
      setDeviceName("");
      setCt1(false);
      setCt2(false);
      setCt3(false);
      setProxyModel("");
      setProxy1(false);
      setProxy2(false);
      setEncoder(false);
      setVibration(false);
      setVibrationModel("");
      setAntenna(false);
      setTowerLight(false);
      setEnergyMeter(false);
      setPlc(false);
    } catch (err: any) {
      toast.error("Failed to submit device order: " + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingOrder) {
    return (
      <Card className="max-w-2xl mx-auto p-8 text-center space-y-4 border border-border">
        <div className="flex justify-center">
          <RefreshCw className="animate-spin text-lime" size={32} />
        </div>
        <p className="text-text-secondary text-sm font-mono">Checking order status...</p>
      </Card>
    );
  }

  const orderToShow = submittedOrder || existingOrder;

  if (orderToShow) {
    return (
      <Card className="max-w-2xl mx-auto border border-lime p-8 text-center space-y-6 animate-fade-in">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-lime/10 text-lime">
            <CheckCircle2 size={36} />
          </div>
        </div>
        <h2 className="text-2xl font-bold font-syne uppercase tracking-tight text-text-primary">
          {existingOrder ? "Order Already Placed" : "Order Submitted Successfully"}
        </h2>
        <p className="text-sm text-text-secondary max-w-md mx-auto">
          The order for <strong className="text-text-primary">{companyName}</strong> has been transmitted to Logistics. The manager will prepare the packing list shortly.
        </p>
        <div className="p-4 bg-surface rounded-[8px] border border-border text-left space-y-2 max-w-md mx-auto font-mono text-xs">
          <div><span className="text-text-dim">Device:</span> {orderToShow.device_id}</div>
          <div><span className="text-text-dim">Company:</span> {orderToShow.material_name}</div>
          <div>
            <span className="text-text-dim">Status:</span>{" "}
            <span className="text-yellow font-bold">
              {(() => {
                try {
                  const notesObj = JSON.parse(orderToShow.notes);
                  return notesObj.logistics_status;
                } catch (e) {
                  return "Pending";
                }
              })()}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="max-w-4xl mx-auto border border-border">
      <SectionTitle num={4}>Device & Sensor Order Form</SectionTitle>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* A. Fixed Details */}
        <div className="grid gap-4 sm:grid-cols-2 bg-surface-raised/20 p-4 border border-border rounded-[8px]">
          <div>
            <Label className="text-text-secondary">Company Name</Label>
            <div className="py-2 px-3 bg-surface border border-border rounded-[6px] text-sm text-text-primary font-bold">
              {companyName}
            </div>
          </div>
          <div>
            <Label className="text-text-secondary">Delivery Address</Label>
            <div className="py-2 px-3 bg-surface border border-border rounded-[6px] text-sm text-text-primary min-h-[38px] leading-relaxed">
              {address}
            </div>
          </div>
        </div>

        {/* B. Device Details */}
        <div className="space-y-3">
          <Label className="text-lime">Device Details</Label>
          <div>
            <Label>Device Name / Model</Label>
            <Input
              required
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g. SIM-Kit Gateway V3"
              className="w-full"
            />
          </div>
        </div>

        {/* C. Sensors Configuration */}
        <div className="space-y-4 pt-2">
          <div className="font-mono text-[11px] font-bold text-lime uppercase tracking-widest border-b border-border pb-1">
            Sensors Section
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {/* CT Clamps */}
            <div className="p-4 border border-border bg-surface-raised/10 rounded-[8px] space-y-3 flex flex-col justify-between">
              <div>
                <Label className="text-text-primary font-bold flex items-center gap-1.5"><Cpu size={14} /> CT Clamps</Label>
                <p className="text-[10px] text-text-secondary mb-3">Check required CT channels.</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Checkbox
                  checked={ct1}
                  onCheckedChange={setCt1}
                  label="CT 1"
                  id="order-ct1"
                />
                <Checkbox
                  checked={ct2}
                  onCheckedChange={setCt2}
                  label="CT 2"
                  id="order-ct2"
                />
                <Checkbox
                  checked={ct3}
                  onCheckedChange={setCt3}
                  label="CT 3"
                  id="order-ct3"
                />
              </div>
            </div>

            {/* Proximity Sensors */}
            <div className="p-4 border border-border bg-surface-raised/10 rounded-[8px] space-y-3">
              <Label className="text-text-primary font-bold flex items-center gap-1.5"><Layers size={14} /> Proximity Sensors</Label>
              <div className="space-y-2">
                <div>
                  <Label className="text-[9px] mb-1">Proxy Model</Label>
                  <Select
                    value={proxyModel}
                    onChange={(e) => setProxyModel(e.target.value)}
                    className="w-full text-xs"
                  >
                    <option value="">Select proxy model...</option>
                    <option value="inductive">Inductive</option>
                    <option value="capacitive">Capacitive</option>
                    <option value="photoelectric">Photoelectric</option>
                    <option value="magnetic">Magnetic</option>
                  </Select>
                </div>
                <div className="flex gap-4 pt-1">
                  <Checkbox
                    checked={proxy1}
                    onCheckedChange={setProxy1}
                    label="Proxy 1"
                    id="order-proxy1"
                  />
                  <Checkbox
                    checked={proxy2}
                    onCheckedChange={setProxy2}
                    label="Proxy 2"
                    id="order-proxy2"
                  />
                </div>
              </div>
            </div>

            {/* Vibration Sensor Panel */}
            <div className="p-4 border border-border bg-surface-raised/10 rounded-[8px] space-y-3">
              <Label className="text-text-primary font-bold flex items-center gap-1.5"><Activity size={14} /> Vibration Sensors</Label>
              <div className="space-y-2">
                <div>
                  <Label className="text-[9px] mb-1">Vibration Model</Label>
                  <Select
                    value={vibrationModel}
                    onChange={(e) => setVibrationModel(e.target.value)}
                    className="w-full text-xs"
                  >
                    <option value="">Select vibration model...</option>
                    <option value="renke">Renke</option>
                    <option value="witmotion">WitMotion</option>
                  </Select>
                </div>
                <div className="pt-1">
                  <Checkbox
                    checked={vibration}
                    onCheckedChange={setVibration}
                    label="Vibration Sensor"
                    id="order-vibration"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Other Sensors Grid */}
          <div className="p-4 border border-border bg-surface-raised/10 rounded-[8px]">
            <Label className="text-text-primary font-bold mb-3 block">Additional Components</Label>
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-5">
              <Checkbox
                checked={encoder}
                onCheckedChange={setEncoder}
                label="Encoder"
                id="order-encoder"
              />
              <Checkbox
                checked={antenna}
                onCheckedChange={setAntenna}
                label="Antenna"
                id="order-antenna"
              />
              <Checkbox
                checked={towerLight}
                onCheckedChange={setTowerLight}
                label="Tower Light"
                id="order-towerlight"
              />
              <Checkbox
                checked={energyMeter}
                onCheckedChange={setEnergyMeter}
                label="Energy Meter"
                id="order-energymeter"
              />
              <Checkbox
                checked={plc}
                onCheckedChange={setPlc}
                label="PLC Interface"
                id="order-plc"
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="pt-4 border-t border-border flex justify-end">
          <Button type="submit" disabled={submitting} className="px-8">
            {submitting && <RefreshCw className="animate-spin mr-1.5" size={14} />}
            Submit Device Order
          </Button>
        </div>
      </form>
    </Card>
  );
}
