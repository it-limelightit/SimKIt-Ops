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
    missing: items.filter((item) => !item.received).length,
  };
}
