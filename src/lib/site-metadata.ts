import { supabase } from "@/integrations/supabase/client";

export type SiteMeta = {
  c1_name: string;
  c1_mobile: string;
  c1_email: string;
  c2_name: string;
  c2_mobile: string;
  c2_email: string;
  status: string;
  create_drive_folder: boolean;
  drive_folder_name: string;
  drive_folder_link: string;
  visit_status: string;
  worker_ids: string[];
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
};

export function parseSiteMetadata(taskNotes: string | null): SiteMeta {
  if (!taskNotes) return { ...DEFAULT_META };
  const match = taskNotes.match(/\[METADATA:([^\]]+)\]/);
  if (!match) return { ...DEFAULT_META };
  try {
    return { ...DEFAULT_META, ...JSON.parse(match[1]) };
  } catch {
    return { ...DEFAULT_META };
  }
}

export function serializeSiteMetadata(taskNotes: string | null, metaObj: Partial<SiteMeta>): string {
  const baseNotes = taskNotes ? taskNotes.replace(/\[METADATA:[^\]]*\]/g, "") : "";
  return `[METADATA:${JSON.stringify(metaObj)}]${baseNotes}`;
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
