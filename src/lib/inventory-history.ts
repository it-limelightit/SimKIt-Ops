import { supabase } from "@/integrations/supabase/client";

export type HistoryItem = {
  id: string; category: string; model: string; unit: string; quantity: number;
  stock_before: number; stock_after: number; current_stock: number | null; item_key: string;
};
export type HistoryOrder = {
  issue_id: string; reference: string; company_name: string; order_id: string;
  issued_at: string; actor_name: string; device_id: string | null; order_source: string;
  order_created_at: string | null; status_at_issue: string; order_exists: boolean; logistics_status: string;
};
export type HistoryIssue = HistoryOrder & { items: HistoryItem[]; total_item_types: number };
export type HistoryRow = HistoryOrder & HistoryItem;
export type InventoryHistoryData = {
  activated_at: string; refreshed_at: string; total_records: number;
  issue_count: number; company_count: number; item_type_count: number;
  companies: string[]; products: { key: string; category: string; model: string; unit: string }[];
  issues: HistoryIssue[]; item_rows: HistoryRow[];
};
export function stockQuantity(value: number | null, unit: string) {
  return value === null ? "Unavailable" : `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(Number(value))} ${unit}`;
}
export function historyDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Unavailable";
}
export async function loadInventoryHistory(args: Record<string, unknown>): Promise<InventoryHistoryData> {
  const { data, error } = await (supabase.rpc as any)("inventory_history", args);
  if (error) throw new Error(["PGRST202", "42883"].includes(error.code) ? "Inventory history is not enabled yet. Ask your administrator to apply the inventory history migration." : error.message);
  return data;
}
