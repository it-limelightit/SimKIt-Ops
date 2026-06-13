import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Badge } from "@/components/ui-kit";
import { toast } from "sonner";
import { parseSiteMetadata, serializeSiteMetadata } from "@/lib/site-metadata";

export function BusinessConsultantsPanel() {
  const [rows, setRows] = useState<any[]>([]);

  const load = async () => {
    // Only show users whose role is 'worker'
    const { data: workerRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "worker");
    const ids = (workerRoles ?? []).map((r: any) => r.user_id);
    if (ids.length === 0) {
      setRows([]);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("id,name,email,mobile,whatsapp,is_active,last_login,created_at,status")
      .in("id", ids)
      .neq("status", "deleted")
      .order("created_at", { ascending: false });

    // Retrieve local stages from localStorage
    let localStages: Record<string, string> = {};
    try {
      const stored = localStorage.getItem("consultant_stages");
      if (stored) localStages = JSON.parse(stored);
    } catch (e) {}

    const rowsWithStatus = (data ?? []).map((r: any) => {
      const status = localStages[r.id] || "assigned";
      return { ...r, status };
    });
    setRows(rowsWithStatus);
  };
  useEffect(() => {
    void load();
  }, []);

  const toggle = async (id: string, active: boolean) => {
    const { error } = await supabase.from("profiles").update({ is_active: active } as never).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(active ? "Activated" : "Deactivated");
      await load();
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      const stored = localStorage.getItem("consultant_stages");
      const localStages = stored ? JSON.parse(stored) : {};
      localStages[id] = status;
      localStorage.setItem("consultant_stages", JSON.stringify(localStages));
      toast.success("Stage updated locally");
      await load();
    } catch (e) {
      toast.error("Failed to update status");
    }
  };

  const getStatusStyle = (status: string | null) => {
    const s = status || "assigned";
    switch (s) {
      case "assigned":
        return "bg-[#800000] text-white border-none";
      case "assessment & Visit":
        return "bg-[#C4E1F6] text-[#1D4ED8] border-none font-bold";
      case "concept":
        return "bg-[#FDF2CE] text-[#B45309] border-none font-bold";
      case "installation":
        return "bg-[#FCE7D4] text-[#C2410C] border-none font-bold";
      case "verification":
        return "bg-[#1D4ED8] text-white border-none font-bold";
      case "Running":
        return "bg-[#107C41] text-white border-none font-bold";
      case "Reject":
        return "bg-[#E1E1E1] text-[#374151] border-none font-bold";
      default:
        return "bg-[#800000] text-white border-none";
    }
  };

  const deleteConsultant = async (workerId: string, name: string) => {
    if (!window.confirm(`Remove "${name}"? They will be removed from this list and all site assignments.`)) return;
    try {
      // 1. Remove from all site worker_ids arrays
      const { data: sites } = await supabase
        .from("sites")
        .select("id,assigned_worker_id,task_notes")
        .or(`assigned_worker_id.eq.${workerId},task_notes.ilike.%"${workerId}"%`);

      for (const site of sites ?? []) {
        const meta = parseSiteMetadata(site.task_notes);
        const workerIds = (meta.worker_ids ?? []).filter((id: string) => id !== workerId);
        const newPrimary = site.assigned_worker_id === workerId ? (workerIds[0] ?? null) : site.assigned_worker_id;
        const newNotes = serializeSiteMetadata(site.task_notes, { ...meta, worker_ids: workerIds });
        await supabase.from("sites").update({
          assigned_worker_id: newPrimary,
          task_notes: newNotes,
        } as never).eq("id", site.id);
      }

      // 2. Mark profile as deleted + deactivate (UPDATE — works without DELETE RLS)
      const { error } = await supabase
        .from("profiles")
        .update({ status: "deleted", is_active: false } as never)
        .eq("id", workerId);
      if (error) throw error;

      // 3. Clean up local stage storage
      try {
        const stored = localStorage.getItem("consultant_stages");
        if (stored) {
          const stages = JSON.parse(stored);
          delete stages[workerId];
          localStorage.setItem("consultant_stages", JSON.stringify(stages));
        }
      } catch {}

      toast.success(`${name} removed`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove consultant");
    }
  };

  const clearConsultantData = async (workerId: string) => {
    if (!window.confirm("Are you sure you want to clear all assigned tasks, appointments, and progress data for this consultant? This will reset their app screen to 'Task will be assigned'.")) return;
    try {
      const { data: workerSites, error: sitesError } = await supabase
        .from("sites")
        .select("id")
        .eq("assigned_worker_id", workerId);

      if (sitesError) throw sitesError;

      const siteIds = (workerSites ?? []).map((s: any) => s.id);

      if (siteIds.length > 0) {
        await Promise.all([
          supabase.from("assessment").delete().in("site_id", siteIds),
          supabase.from("commissioning").delete().in("site_id", siteIds),
          supabase.from("contacts").delete().in("site_id", siteIds),
          supabase.from("installation").delete().in("site_id", siteIds),
          supabase.from("machines").delete().in("site_id", siteIds),
          supabase.from("media").delete().in("site_id", siteIds),
        ]);
      }

      const { error: updateError } = await supabase
        .from("sites")
        .update({
          assigned_worker_id: null,
          assigned_at: null,
          appt_date: null,
          appt_time: null,
          task_notes: null,
          task_assigned_at: null,
          task_assigned_by: null,
        } as never)
        .eq("assigned_worker_id", workerId);

      if (updateError) throw updateError;

      toast.success("Consultant side cleared successfully");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear consultant data");
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-widest text-stone">Manage</p>
        <h1 className="mt-2 text-4xl">Business Consultants</h1>
      </header>

      <div className="overflow-x-auto border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted">
            <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Mobile</th>
              <th className="px-4 py-3">WhatsApp</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Process Stage</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No business consultants yet</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-raised/30 transition-colors">
                <td className="px-4 py-4 align-middle font-medium text-text-primary">{r.name ?? "—"}</td>
                <td className="px-4 py-4 align-middle font-mono text-xs text-text-primary">{r.mobile ?? "—"}</td>
                <td className="px-4 py-4 align-middle font-mono text-xs text-text-primary">{r.whatsapp ?? "—"}</td>
                <td className="px-4 py-4 align-middle text-text-secondary">{r.email ?? "—"}</td>
                <td className="px-4 py-4 align-middle">
                  <Badge tone={r.is_active ? "success" : "warning"}>
                    {r.is_active ? "Active" : "Pending"}
                  </Badge>
                </td>
                <td className="px-4 py-4 align-middle">
                  <span className={`inline-block rounded-[6px] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-center ${getStatusStyle(r.status)}`}>
                    {r.status ?? "assigned"}
                  </span>
                </td>
                <td className="px-4 py-4 align-middle text-right">
                  <div className="flex items-center justify-end gap-2.5 whitespace-nowrap">
                    <Button variant="secondary" className="py-1 px-2.5 text-xs font-semibold" onClick={() => toggle(r.id, !r.is_active)}>
                      {r.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      variant="danger"
                      className="bg-coral/10 text-coral border border-coral/20 hover:bg-coral-dim py-1 px-2.5 text-xs font-semibold"
                      onClick={() => clearConsultantData(r.id)}
                    >
                      Clear Consultant Side
                    </Button>
                    <Button
                      variant="danger"
                      className="py-1 px-2.5 text-xs font-semibold"
                      onClick={() => deleteConsultant(r.id, r.name ?? r.email ?? "Consultant")}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
