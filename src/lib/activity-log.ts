import { supabase } from "@/integrations/supabase/client";

export type ActivityAction =
  | "login"
  | "status_change"
  | "create"
  | "update"
  | "delete"
  | "logistics_update";

export type ActivityLogEntry = {
  actor_id: string | null;
  actor_name: string;
  action: ActivityAction;
  entity_type: string;
  entity_id?: string | null;
  entity_name?: string | null;
  site_id?: string | null;
  company_name?: string | null;
  factory_name?: string | null;
  from_value?: string | null;
  to_value?: string | null;
  details?: Record<string, unknown>;
};

export const actorName = (
  profile: { name?: string | null; mobile?: string | null } | null | undefined,
  email?: string | null,
  userId?: string | null,
) => profile?.name || profile?.mobile || email || userId || "Unknown User";

export async function recordActivityLog(entry: ActivityLogEntry): Promise<void> {
  const { error } = await supabase.from("activity_logs" as any).insert({
    actor_id: entry.actor_id,
    actor_name: entry.actor_name || "Unknown User",
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id ?? null,
    entity_name: entry.entity_name ?? null,
    site_id: entry.site_id ?? null,
    company_name: entry.company_name ?? null,
    factory_name: entry.factory_name ?? null,
    from_value: entry.from_value ?? null,
    to_value: entry.to_value ?? null,
    details: entry.details ?? {},
  } as never);

  if (error) {
    console.error("Could not write activity log:", error);
  }
}
