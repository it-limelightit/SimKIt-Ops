import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function stripMeta(notes: string): string {
  const prefix = "[METADATA:";
  const idx = notes.indexOf(prefix);
  if (idx === -1) return notes;
  const start = idx + prefix.length;
  let depth = 0;
  for (let i = start; i < notes.length; i++) {
    if (notes[i] === "{") depth++;
    else if (notes[i] === "}") {
      depth--;
      if (depth === 0) {
        const end = i + 1 + (notes[i + 1] === "]" ? 1 : 0);
        return notes.slice(0, idx) + notes.slice(end);
      }
    }
  }
  return notes;
}

function parseMeta(notes: string): Record<string, any> {
  const prefix = "[METADATA:";
  const idx = notes.indexOf(prefix);
  if (idx === -1) return {};
  const start = idx + prefix.length;
  let depth = 0;
  for (let i = start; i < notes.length; i++) {
    if (notes[i] === "{") depth++;
    else if (notes[i] === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(notes.slice(start, i + 1)); } catch { return {}; }
      }
    }
  }
  return {};
}

export const deleteConsultantFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { workerId: string })
  .handler(async ({ data }) => {
    const { workerId } = data;

    // Fetch all sites where this worker is assigned
    const { data: sites } = await supabaseAdmin
      .from("sites")
      .select("id,assigned_worker_id,task_notes")
      .or(`assigned_worker_id.eq.${workerId},task_notes.ilike.%"${workerId}"%`);

    for (const site of sites ?? []) {
      const notes = (site.task_notes as string) ?? "";
      const meta = notes ? parseMeta(notes) : {};
      const workerIds: string[] = ((meta.worker_ids ?? []) as string[]).filter((id) => id !== workerId);
      const newPrimary = site.assigned_worker_id === workerId ? (workerIds[0] ?? null) : site.assigned_worker_id;
      meta.worker_ids = workerIds;
      const base = notes ? stripMeta(notes) : "";
      await supabaseAdmin.from("sites").update({
        assigned_worker_id: newPrimary,
        task_notes: `[METADATA:${JSON.stringify(meta)}]${base}`,
      } as never).eq("id", site.id);
    }

    await supabaseAdmin.from("user_roles").delete().eq("user_id", workerId);
    await supabaseAdmin.from("profiles").delete().eq("id", workerId);
    await supabaseAdmin.auth.admin.deleteUser(workerId);

    return { ok: true };
  });
