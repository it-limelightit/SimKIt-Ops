import { supabase } from "@/integrations/supabase/client";

export type InstallationEquipmentItem = {
  key: string;
  group_key: string;
  label: string;
  number: number;
  count: number;
  model: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
  received: boolean;
  used: boolean;
  /** Taken from the associate's own extra stock instead of central stock. */
  from_extra?: boolean;
};
export type InstallationEquipmentOrder = {
  id: string;
  company_name: string;
  device_id: string | null;
  revision: number;
  associate_id: string | null;
  associate_name: string | null;
  confirmed_at: string | null;
  items: InstallationEquipmentItem[];
};
export type InstallationEquipmentChecklist = {
  legacy: boolean;
  required: boolean;
  waiting_dispatch: boolean;
  orders: InstallationEquipmentOrder[];
};
export type AssociateExtraCompany = {
  company: string;
  quantity: number;
  total_value: number | null;
  last_confirmed_at: string | null;
};
export type AssociateExtraItem = {
  associate_id: string;
  associate_name: string;
  group_key: string;
  label: string;
  model: string;
  unit: string;
  quantity: number;
  unit_price: number | null;
  total_value: number | null;
  companies: string;
  company_list?: string[] | null;
  company_breakdown?: AssociateExtraCompany[] | null;
  last_confirmed_at?: string | null;
  received_quantity?: number;
  used_quantity?: number;
  usage_history?: AssociateExtraUsage[] | null;
};
export type AssociateExtraUsage = {
  order_id: string;
  company: string;
  device_id: string | null;
  quantity: number;
  /** Units confirmed as Used at that company. */
  installed?: number;
  /** Units confirmed as not used there; they stay in extra stock. */
  returned?: number;
  outcome?: "pending" | "installed" | "returned" | "partial";
  used_at: string | null;
  selected_by: string;
};
export type ExtraStockOption = {
  group_key: string;
  label: string;
  model: string;
  required: number;
  available: number;
  selected: number;
  status: "planned" | "applied";
};
export type ExtraStockOptions = {
  order_id: string;
  associate_id: string | null;
  associate_name: string;
  locked: boolean;
  eligible: boolean;
  reason: string | null;
  items: ExtraStockOption[];
};

export async function associateInventoryRpc<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const result = await (supabase.rpc as any)(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export function equipmentCounts(items: InstallationEquipmentItem[]) {
  return {
    received: items.filter((item) => item.received).length,
    used: items.filter((item) => item.used).length,
    extra: items.filter((item) => item.received && !item.used).length,
    fromExtra: items.filter((item) => item.from_extra).length,
    missing: items.filter((item) => !item.received).length,
  };
}
