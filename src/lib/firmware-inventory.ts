import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

export type FirmwareProduct = {
  stock_id: string;
  category: string;
  model: string;
  unit: string;
  available: number;
};
export type FirmwareReturn = {
  id: string;
  quantity: number;
  return_date: string;
  actor_name: string;
  stock_before: number;
  stock_after: number;
};
export type FirmwareLoan = {
  id: string;
  owner_name: string;
  taken_date: string;
  category: string;
  model: string;
  unit: string;
  quantity: number;
  returned_quantity: number;
  reason: string;
  stock_before: number;
  stock_after: number;
  returns: FirmwareReturn[];
};
export type FirmwareInventoryData = { products: FirmwareProduct[]; loans: FirmwareLoan[] };

export async function firmwareInventoryRpc<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (supabase as unknown as SupabaseClient).rpc(name, args);
  if (error)
    throw new Error(
      ["PGRST202", "42883"].includes(error.code)
        ? "Firmware inventory is not enabled yet. Apply the firmware inventory database migration."
        : error.message,
    );
  return data as T;
}
