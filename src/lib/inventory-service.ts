import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const FEATURE_IMPLEMENTATION_TIMESTAMP = "2026-09-07T00:00:00.000Z";

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
  "Proxy 1",
  "Proxy 2",
  "Vibration Sensor",
  "Encoder",
  "Antenna",
  "Tower Light",
  "Energy Meter",
  "PLC Interface",
];

// Proxy Models from App UI
export const PROXY_MODELS = [
  "Inductive",
  "Capacitive",
  "Photoelectric",
  "Magnetic",
];

// Vibration Models from App UI
export const VIBRATION_MODELS = [
  "Renke",
  "WitMotion",
  "Vibe Q",
];

/**
 * Helper to normalize truthy values for sensor flags ("TRUE", "1", true)
 */
export function isTruthy(val: any): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const s = val.trim().toUpperCase();
    return s === "TRUE" || s === "1" || s === "YES";
  }
  if (typeof val === "number") return val > 0;
  return false;
}

/**
 * Deduct stock for items used in an order dispatch/transit.
 * Applies ONLY to orders created/transitioned after FEATURE_IMPLEMENTATION_TIMESTAMP.
 */
export async function deductStockForOrder(params: {
  orderId: string;
  orderCreatedAt?: string | null;
  counts: {
    datameter_box?: number;
    ct1?: number;
    ct2?: number;
    ct3?: number;
    proxy1?: number;
    proxy2?: number;
    vibration?: number;
    encoder?: number;
    antenna?: number;
    tower_light?: number;
    energy_meter?: number;
    plc?: number;
  };
}) {
  const { orderId, orderCreatedAt, counts } = params;

  // Enforce rule: Only apply to orders created on/after rollout date
  if (orderCreatedAt) {
    const orderDate = new Date(orderCreatedAt).getTime();
    const rolloutDate = new Date(FEATURE_IMPLEMENTATION_TIMESTAMP).getTime();
    if (orderDate < rolloutDate) {
      console.log(`[Inventory] Skipping deduction for historical order ${orderId} created on ${orderCreatedAt}`);
      return;
    }
  }

  // Check if this order was already deducted in audit logs
  const { data: existingLogs } = await supabase
    .from("inventory_logs" as any)
    .select("id")
    .eq("order_id", orderId)
    .limit(1);

  if (existingLogs && existingLogs.length > 0) {
    console.log(`[Inventory] Order ${orderId} was already deducted previously. Skipping duplicate deduction.`);
    return;
  }

  // Fetch current inventory stock
  const { data: stockItems, error } = await supabase
    .from("inventory_stock" as any)
    .select("*");


  if (error || !stockItems) {
    console.error("[Inventory] Failed to fetch stock for deduction:", error);
    return;
  }

  const items = stockItems as unknown as InventoryStockItem[];

  // Map dispatch fields to exact inventory categories
  const itemsToDeduct: { targetCategory: string; qty: number }[] = [];
  if (counts.datameter_box) itemsToDeduct.push({ targetCategory: "Datameter Box", qty: counts.datameter_box });
  if (counts.ct1) itemsToDeduct.push({ targetCategory: "CT 1", qty: counts.ct1 });
  if (counts.ct2) itemsToDeduct.push({ targetCategory: "CT 2", qty: counts.ct2 });
  if (counts.ct3) itemsToDeduct.push({ targetCategory: "CT 3", qty: counts.ct3 });
  if (counts.proxy1) itemsToDeduct.push({ targetCategory: "Proxy 1", qty: counts.proxy1 });
  if (counts.proxy2) itemsToDeduct.push({ targetCategory: "Proxy 2", qty: counts.proxy2 });
  if (counts.vibration) itemsToDeduct.push({ targetCategory: "Vibration Sensor", qty: counts.vibration });
  if (counts.encoder) itemsToDeduct.push({ targetCategory: "Encoder", qty: counts.encoder });
  if (counts.tower_light) itemsToDeduct.push({ targetCategory: "Tower Light", qty: counts.tower_light });
  if (counts.antenna) itemsToDeduct.push({ targetCategory: "Antenna", qty: counts.antenna });
  if (counts.energy_meter) itemsToDeduct.push({ targetCategory: "Energy Meter", qty: counts.energy_meter });
  if (counts.plc) itemsToDeduct.push({ targetCategory: "PLC Interface", qty: counts.plc });

  for (const deductReq of itemsToDeduct) {
    // Robust category matching: Exact or Includes
    const matchedStock = items.find((s) => {
      const dbCat = s.category.toLowerCase().trim();
      const targetCat = deductReq.targetCategory.toLowerCase().trim();
      return dbCat === targetCat || dbCat.includes(targetCat) || targetCat.includes(dbCat);
    });

    if (matchedStock) {
      const newQty = Math.max(0, matchedStock.actual_quantity - deductReq.qty);
      const { error: updateErr } = await supabase
        .from("inventory_stock" as any)
        .update({
          actual_quantity: newQty,
          updated_at: new Date().toISOString(),
        })
        .eq("id", matchedStock.id);

      if (updateErr) {
        console.error(`[Inventory] Error updating stock for ${matchedStock.category}:`, updateErr);
      } else {
        // Log transaction audit
        await supabase.from("inventory_logs" as any).insert({
          stock_id: matchedStock.id,
          order_id: orderId,
          quantity_changed: -deductReq.qty,
          change_type: "DISPATCH_DEDUCTION",
        });

        // Trigger low stock toast if limit reached
        if (newQty <= matchedStock.min_quantity) {
          toast.warning(
            `⚠️ Low Stock Alert: "${matchedStock.category}" has dropped to ${newQty} items (Min limit: ${matchedStock.min_quantity})!`,
            { duration: 6000 }
          );
        }
      }
    }
  }
}
