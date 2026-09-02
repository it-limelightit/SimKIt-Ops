import { supabase } from "@/integrations/supabase/client";
import { recordActivityLog } from "@/lib/activity-log";

export type SiteMeta = {
  c1_name: string;
  c1_mobile: string;
  c1_email: string;
  c2_name: string;
  c2_mobile: string;
  c2_email: string;
  status: string;
  status_source?: "manager" | "associate" | "system";
  create_drive_folder: boolean;
  drive_folder_name: string;
  drive_folder_link: string;
  visit_status: string;
  worker_ids: string[];
  assessor_company: string;
  assessor_phone: string;
  assessor_city: string;
  assessor_number: string;
  assessor_email: string;
  assessor_address: string;
  credential_created?: boolean;
  manager_password?: string;
  client_email?: string;
  client_token?: string;
  activity_logs?: SiteActivityLog[];
};

export type SiteActivityLog = {
  id: string;
  type: "status_change";
  at: string;
  user_id: string | null;
  user_name: string;
  from_status: string;
  to_status: string;
};

const DEFAULT_META: SiteMeta = {
  c1_name: "",
  c1_mobile: "",
  c1_email: "",
  c2_name: "",
  c2_mobile: "",
  c2_email: "",
  status: "Running",
  create_drive_folder: false,
  drive_folder_name: "",
  drive_folder_link: "",
  visit_status: "",
  worker_ids: [],
  assessor_company: "",
  assessor_phone: "",
  assessor_city: "",
  assessor_number: "",
  assessor_email: "",
  assessor_address: "",
};

// Extract the JSON object after [METADATA: by counting braces — safe for nested arrays/objects
function extractMetaJson(taskNotes: string): string | null {
  const prefix = "[METADATA:";
  const idx = taskNotes.indexOf(prefix);
  if (idx === -1) return null;
  const start = idx + prefix.length;
  let depth = 0;
  for (let i = start; i < taskNotes.length; i++) {
    if (taskNotes[i] === "{") depth++;
    else if (taskNotes[i] === "}") {
      depth--;
      if (depth === 0) return taskNotes.slice(start, i + 1);
    }
  }
  return null;
}

// Remove the [METADATA:{...}] block from a string
function stripMetaBlock(taskNotes: string): string {
  const prefix = "[METADATA:";
  const idx = taskNotes.indexOf(prefix);
  if (idx === -1) return taskNotes;
  const start = idx + prefix.length;
  let depth = 0;
  for (let i = start; i < taskNotes.length; i++) {
    if (taskNotes[i] === "{") depth++;
    else if (taskNotes[i] === "}") {
      depth--;
      if (depth === 0) {
        // +1 to consume the closing ] after }
        const end = i + 1 + (taskNotes[i + 1] === "]" ? 1 : 0);
        return taskNotes.slice(0, idx) + taskNotes.slice(end);
      }
    }
  }
  return taskNotes;
}

export function parseSiteMetadata(taskNotes: string | null): SiteMeta {
  if (!taskNotes) return { ...DEFAULT_META };
  const json = extractMetaJson(taskNotes);
  if (!json) return { ...DEFAULT_META };
  try {
    return { ...DEFAULT_META, ...JSON.parse(json) };
  } catch {
    return { ...DEFAULT_META };
  }
}

export function serializeSiteMetadata(taskNotes: string | null, metaObj: Partial<SiteMeta>): string {
  const base = taskNotes ? stripMetaBlock(taskNotes) : "";
  return `[METADATA:${JSON.stringify(metaObj)}]${base}`;
}

export function appendStatusActivityLog(
  meta: SiteMeta,
  entry: Omit<SiteActivityLog, "id" | "type" | "at"> & { at?: string },
): SiteMeta {
  const currentLogs = Array.isArray(meta.activity_logs) ? meta.activity_logs : [];
  return {
    ...meta,
    activity_logs: [
      {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: "status_change",
        at: entry.at || new Date().toISOString(),
        user_id: entry.user_id,
        user_name: entry.user_name,
        from_status: entry.from_status,
        to_status: entry.to_status,
      },
      ...currentLogs,
    ].slice(0, 100),
  };
}

export async function recordStatusActivityLog(
  siteId: string,
  entry: Omit<SiteActivityLog, "id" | "type" | "at"> & { at?: string },
): Promise<void> {
  if (!entry.to_status || entry.from_status === entry.to_status) return;

  const { data: site, error } = await supabase
    .from("sites")
    .select("id,name,company_name,task_notes")
    .eq("id", siteId)
    .maybeSingle();

  if (error) throw error;

  const meta = parseSiteMetadata(site?.task_notes ?? null);
  const nextMeta = appendStatusActivityLog(meta, entry);
  const newNotes = serializeSiteMetadata(site?.task_notes ?? null, nextMeta);
  const { error: updateError } = await supabase
    .from("sites")
    .update({ task_notes: newNotes } as never)
    .eq("id", siteId);

  if (updateError) throw updateError;

  await recordActivityLog({
    actor_id: entry.user_id,
    actor_name: entry.user_name,
    action: "status_change",
    entity_type: "site",
    entity_id: siteId,
    entity_name: site?.company_name || site?.name || "Site",
    site_id: siteId,
    company_name: site?.company_name || site?.name || null,
    factory_name: site?.name || null,
    from_value: entry.from_status,
    to_value: entry.to_status,
  });
}

const VISIT_RANK: Record<string, number> = {
  "Assessment Done": 1,
  "Installation Done": 2,
  "Visit Complete": 3,
};

export async function advanceSiteVisitStatus(siteId: string, visitStatus: string): Promise<void> {
  const { data: site } = await supabase
    .from("sites")
    .select("task_notes")
    .eq("id", siteId)
    .maybeSingle();

  const meta = parseSiteMetadata(site?.task_notes ?? null);
  const currentRank = VISIT_RANK[meta.visit_status] ?? 0;
  const newRank = VISIT_RANK[visitStatus] ?? 0;
  if (newRank <= currentRank) return;

  const newNotes = serializeSiteMetadata(site?.task_notes ?? null, { ...meta, visit_status: visitStatus });
  await supabase.from("sites").update({ task_notes: newNotes } as never).eq("id", siteId);
}
