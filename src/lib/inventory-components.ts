export function inventoryOrderIncludesDm(notes: string | null) {
  try {
    const selected = JSON.parse(notes || "{}")?.dm_selected;
    // Existing orders predate the checkbox and still include their Data Meter.
    return selected == null || ["true", "1", "yes"].includes(String(selected).trim().toLowerCase());
  } catch {
    return true;
  }
}

export function inventoryComponentKey(name: string) {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string> = {
    enclousuresticker: "enclosuresticker",
    "3dprintenclosure": "3dprintedenclosure",
    "3dprintenclousure": "3dprintedenclosure",
    "3dprinterenclosure": "3dprintedenclosure",
    "3dprinterenclousure": "3dprintedenclosure",
    "3dprinterencloser": "3dprintedenclosure",
    magneticmountanteena: "magneticmountantenna",
    antenna: "magneticmountantenna",
    rfcableanteena: "rfcableantenna",
    proximitrysensor: "proximitysensor",
    proxymetersensor: "proximitysensor",
    proxysensor: "proximitysensor",
    proxy1: "proximitysensor",
    proxy2: "proximitysensor",
    "3core": "3corewire",
    encoder: "rotaryencoder",
    packingbox: "box",
    ziptie: "zip ties",
    zipties: "zip ties",
    zipetie: "zip ties",
    taperole: "tape roll",
    taperoll: "tape roll",
    taperolefragile: "tape roll",
    taperollfragile: "tape roll",
    vibrationsensorvibeq: "vibrationsensor",
    vibrationsensoevibeq: "vibrationsensor",
    vibrationsensoe: "vibrationsensor",
  };
  return aliases[key] ?? key;
}

export function inventoryModelKey(category: string, model?: string | null) {
  if (model?.trim()) return model.toLowerCase().replace(/[^a-z0-9]/g, "");
  return inventoryComponentKey(category) === "vibrationsensor" &&
    category
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .includes("vibeq")
    ? "vibeq"
    : "";
}

export function inventoryCtSensorCount(order: { ct1?: unknown; ct2?: unknown; ct3?: unknown }): number {
  const selected = (value: unknown) => value === true || ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
  return selected(order.ct3) ? 3 : selected(order.ct2) ? 2 : selected(order.ct1) ? 1 : 0;
}

export function inventoryDispatchHint(category: string) {
  const key = inventoryComponentKey(category);
  if (["zip ties", "tape roll", "formsheet"].includes(key))
    return "Managed manually. Device dispatch does not deduct this item.";
  if (key === "2corewire")
    return "Normal YHDC CT orders deduct a fixed 12 meters. Energy-meter CTs do not use this wire rule.";
  if (key === "3corewire")
    return "Orders with Proxy 1 or Proxy 2 deduct 3 meters once per order, even when both are selected.";
  if (key === "4corewire") return "Vibration sensor orders deduct a fixed 5 meters.";
  if (key === "cablegland") return "Each new device order deducts 3 cable glands when it enters In Packing.";
  if (["box", "powercordcable", "panelboxdoorlock", "uvprinting"].includes(key))
    return "Each new device order deducts 1 unit when it enters In Packing.";
  if (key === "towerlight")
    return "Deduct 1 unit only when tower light is selected in the device order.";
  if (["magneticmountantenna", "rfcableantenna"].includes(key))
    return "Deduct the configured Qty/Kit only when Antenna Kit is selected in the device order.";
  if (key === "energymeterctsensor")
    return "Energy meter orders include 3 of these CT sensors. These are separate from YHDC CTs.";
  if (key === "yhdcctsensor")
    return "Single-phase uses 1 YHDC sensor; three-phase uses 3. No selection uses none.";
  if (key === "proximitysensor")
    return "Only Inductive proxy sensors are used. Deduct one sensor for each selected proxy input.";
  return null;
}
