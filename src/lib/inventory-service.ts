export type InventoryStockItem = {
  id: string;
  category: string;
  sensor_type: string | null;
  actual_quantity: number;
  min_quantity: number;
  unit_price: number;
  total_price?: number;
  entry_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Item Category Options matching exact Sensors / Components section in app forms
export const PREDEFINED_CATEGORIES = [
  "Datameter Box",
  "CT 1",
  "CT 2",
  "CT 3",
  "YHDC CT SENSOR",
  "ENERGY METER CT SENSOR",
  "Proxy 1",
  "Proxy 2",
  "Vibration Sensor",
  "Encoder",
  "ROTARY ENCODER",
  "PROXIMITY SENSOR",
  "Antenna",
  "Tower Light",
  "Energy Meter",
  "PLC Interface",
  "Box",
  "CABLE GLAND",
  "FORM SHEET",
  "ENCLOSURE STICKER",
  "SIM CARD",
  "3D PRINT ENCLOSURE",
  "MOTHER BOARD PCB",
  "LCD PCB",
  "CAVLI PCB",
  "DIN RAIL MOUNTING CLIP",
  "MAGNETIC MOUNT ANTENNA",
  "RF CABLE (ANTENNA)",
  "Tape Role",
  "TAPE ROLE (FRAGILE)",
  "UV PRINTING",
  "ZIPE TIE",
  "2 CORE WIRE",
  "4 CORE WIRE",
  "POWER CORD CABLE",
  "PANEL BOX/DOOR/LOCK",
];

// Proxy Models from App UI
export const PROXY_MODELS = ["Inductive", "Capacitive", "Photoelectric", "Magnetic"];

// Vibration Models from App UI
export const VIBRATION_MODELS = ["Renke", "WitMotion", "Vibe Q"];

/**
 * Helper to normalize truthy values for sensor flags ("TRUE", "1", true)
 */
export function isTruthy(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const s = val.trim().toUpperCase();
    return s === "TRUE" || s === "1" || s === "YES";
  }
  if (typeof val === "number") return val > 0;
  return false;
}
