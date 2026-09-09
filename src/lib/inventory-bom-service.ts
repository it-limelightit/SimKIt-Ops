export type InventoryBomItem = {
  id: string;
  product_name: string;
  category: string;
  sensor_type: string | null;
  quantity_per_kit: number;
  unit: string;
  required_by_default: boolean;
  min_quantity: number;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryBomCalculation = InventoryBomItem & {
  planned_quantity: number;
  required_for_plan: number;
  actual_used_quantity: number;
  current_quantity: number;
  balance_quantity: number;
  shortage_quantity: number;
  order_quantity: number;
  status: "AVAILABLE" | "LOW STOCK" | "OUT OF STOCK" | "ORDER REQUIRED" | "OPTIONAL";
};

export type ComponentUsage = {
  category: string;
  sensorType?: string | null;
  quantity: number;
};

function sameComponent(
  leftCategory: string,
  leftSensorType: string | null | undefined,
  rightCategory: string,
  rightSensorType: string | null | undefined,
) {
  return (
    leftCategory.trim().toLowerCase() === rightCategory.trim().toLowerCase() &&
    (leftSensorType || "").trim().toLowerCase() === (rightSensorType || "").trim().toLowerCase()
  );
}

/**
 * Calculates the Excel-style planning columns without mutating stock rows.
 * Actual usage is supplied from order selections or inventory transaction logs.
 */
export function calculateInventoryBom(
  bomItems: InventoryBomItem[],
  params: {
    plannedKitQuantity: number;
    currentStock: Array<{ category: string; sensor_type: string | null; actual_quantity: number }>;
    usage: ComponentUsage[];
  },
): InventoryBomCalculation[] {
  const plannedKitQuantity = Math.max(0, Number(params.plannedKitQuantity) || 0);

  return bomItems.filter((item) => item.active).map((item) => {
    const currentQuantity = params.currentStock
      .filter((stockItem) => sameComponent(item.category, item.sensor_type, stockItem.category, stockItem.sensor_type))
      .reduce((sum, stockItem) => sum + (Number(stockItem.actual_quantity) || 0), 0);
    const actualUsedQuantity = params.usage
      .filter((usageItem) => sameComponent(item.category, item.sensor_type, usageItem.category, usageItem.sensorType))
      .reduce((sum, usageItem) => sum + Math.max(0, Number(usageItem.quantity) || 0), 0);
    const requiredForPlan = item.required_by_default ? item.quantity_per_kit * plannedKitQuantity : 0;
    const balanceQuantity = currentQuantity - actualUsedQuantity;
    const shortageQuantity = Math.max(requiredForPlan - balanceQuantity, 0);
    const orderQuantity = Math.max(requiredForPlan - balanceQuantity, 0);

    let status: InventoryBomCalculation["status"] = "AVAILABLE";
    if (!item.required_by_default) status = "OPTIONAL";
    else if (balanceQuantity <= 0) status = "OUT OF STOCK";
    else if (balanceQuantity <= item.min_quantity) status = "LOW STOCK";
    else if (orderQuantity > 0) status = "ORDER REQUIRED";

    return {
      ...item,
      planned_quantity: plannedKitQuantity,
      required_for_plan: requiredForPlan,
      actual_used_quantity: actualUsedQuantity,
      current_quantity: currentQuantity,
      balance_quantity: balanceQuantity,
      shortage_quantity: shortageQuantity,
      order_quantity: orderQuantity,
      status,
    };
  });
}
