import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Badge, Input, Label } from "@/components/ui-kit";
import { toast } from "sonner";
import { parseSiteMetadata, serializeSiteMetadata } from "@/lib/site-metadata";
import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { X } from "lucide-react";

export const updateConsultantProfileFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as {
    userId: string;
    name: string;
    email: string;
    originalEmail?: string;
    mobile: string;
    whatsapp?: string;
    password?: string;
  })
  .handler(async ({ data }) => {
    const { userId, name, email, originalEmail, mobile, whatsapp, password } = data;
    try {
      const hasAdminKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

      const updateData: any = {};
      if (email && email.toLowerCase() !== originalEmail?.toLowerCase()) {
        updateData.email = email;
      }
      if (password) {
        updateData.password = password;
      }

      if (Object.keys(updateData).length > 0) {
        if (!hasAdminKey) {
          return {
            success: false,
            error: "Changing email or password requires the Supabase Service Role Key to be configured in Vercel settings. Please configure SUPABASE_SERVICE_ROLE_KEY."
          };
        }
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
          userId,
          updateData
        );
        if (authError) {
          return { success: false, error: authError.message };
        }
      }

      // Update profiles table
      const dbClient = hasAdminKey ? supabaseAdmin : supabase;
      const { error: profileError } = await dbClient
        .from("profiles")
        .update({
          name,
          email,
          mobile,
          whatsapp: whatsapp || mobile,
        })
        .eq("id", userId);

      if (profileError) {
        return { success: false, error: profileError.message };
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  });

export function BusinessConsultantsPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [editingConsultant, setEditingConsultant] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editMobile, setEditMobile] = useState("");
  const [editWhatsapp, setEditWhatsapp] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (editingConsultant) {
      setEditName(editingConsultant.name || "");
      setEditEmail(editingConsultant.email || "");
      setEditMobile(editingConsultant.mobile || "");
      setEditWhatsapp(editingConsultant.whatsapp || "");
      setEditPassword("");
    }
  }, [editingConsultant]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingConsultant) return;
    setUpdating(true);
    try {
      const isEmailOrPasswordChanged = (editEmail.toLowerCase() !== editingConsultant.email?.toLowerCase()) || !!editPassword;

      if (isEmailOrPasswordChanged) {
        const res = await updateConsultantProfileFn({
          data: {
            userId: editingConsultant.id,
            name: editName,
            email: editEmail,
            originalEmail: editingConsultant.email,
            mobile: editMobile,
            whatsapp: editWhatsapp,
            password: editPassword || undefined,
          }
        });
        if (!res.success) {
          throw new Error(res.error || "Failed to update profile");
        }
      } else {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            name: editName,
            mobile: editMobile,
            whatsapp: editWhatsapp,
          })
          .eq("id", editingConsultant.id);

        if (profileError) throw profileError;
      }

      toast.success("Consultant profile updated successfully!");
      setEditingConsultant(null);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update profile");
    } finally {
      setUpdating(false);
    }
  };

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
    const [profilesRes, supervisorRolesRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id,name,email,mobile,whatsapp,is_active,last_login,created_at")
        .in("id", ids)
        .order("created_at", { ascending: false }),
      supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "supervisor")
        .in("user_id", ids),
    ]);

    const data = profilesRes.data ?? [];
    const supervisorIds = new Set((supervisorRolesRes.data ?? []).map((r: any) => r.user_id));

    // Retrieve local stages from localStorage
    let localStages: Record<string, string> = {};
    try {
      const stored = localStorage.getItem("consultant_stages");
      if (stored) localStages = JSON.parse(stored);
    } catch (e) {}

    const rowsWithStatus = data.map((r: any) => {
      const status = localStages[r.id] || "assigned";
      return { ...r, status, isManager: supervisorIds.has(r.id) };
    });
    setRows(rowsWithStatus);
  };
  useEffect(() => {
    void load();

    // Subscribe to realtime updates on profiles table
    const channel = supabase
      .channel("profiles-realtime-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => {
          void load();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const toggle = async (id: string, active: boolean) => {
    const { error } = await supabase.from("profiles").update({ is_active: active } as never).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(active ? "Activated" : "Deactivated");
      await load();
    }
  };

  const handleToggleManager = async (userId: string, isCurrentlyManager: boolean) => {
    try {
      // Use SECURITY DEFINER RPC to bypass RLS on user_roles (no INSERT/DELETE policy for authenticated)
      const { error } = await supabase.rpc("toggle_user_manager_role", {
        _target_user_id: userId,
        _make_manager: !isCurrentlyManager,
      });
      if (error) throw error;
      toast.success(isCurrentlyManager ? "Manager role revoked" : "Manager role granted");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update role");
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
    if (!window.confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
    try {
      // 1. Remove from all site worker_ids arrays (client-side, for multi-BC metadata)
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

      // 2. Call SECURITY DEFINER function — bypasses RLS to delete role + profile
      const { error } = await supabase.rpc("delete_worker", { worker_id: workerId });
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

      toast.success(`${name} deleted`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete field associate");
    }
  };

  const clearConsultantData = async (workerId: string) => {
    if (!window.confirm("Are you sure you want to clear all assigned tasks, appointments, and progress data for this field associate? This will reset their app screen to 'Task will be assigned'.")) return;
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

      toast.success("Field Associate side cleared successfully");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear field associate data");
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-widest text-stone">Manage</p>
        <h1 className="mt-2 text-4xl">Field Associates</h1>
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
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No field associates yet</td></tr>
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
                    <Button
                      variant="secondary"
                      className="py-1 px-2.5 text-xs font-semibold cursor-pointer"
                      onClick={() => setEditingConsultant(r)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      className={`py-1 px-2.5 text-xs font-semibold cursor-pointer ${
                        r.isManager 
                          ? "bg-lime/10 text-lime border border-lime/20 hover:bg-lime-dim" 
                          : ""
                      }`}
                      onClick={() => handleToggleManager(r.id, !!r.isManager)}
                    >
                      {r.isManager ? "Revoke Manager" : "Make Manager"}
                    </Button>
                    <Button variant="secondary" className="py-1 px-2.5 text-xs font-semibold cursor-pointer" onClick={() => toggle(r.id, !r.is_active)}>
                      {r.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      variant="danger"
                      className="bg-coral/10 text-coral border border-coral/20 hover:bg-coral-dim py-1 px-2.5 text-xs font-semibold cursor-pointer"
                      onClick={() => clearConsultantData(r.id)}
                    >
                      Clear Field Associate Side
                    </Button>
                    <Button
                      variant="danger"
                      className="py-1 px-2.5 text-xs font-semibold cursor-pointer"
                      onClick={() => deleteConsultant(r.id, r.name ?? r.email ?? "Field Associate")}
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

      {editingConsultant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-surface border border-border rounded-xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-5 border-b border-border bg-surface-raised/40">
              <div>
                <h3 className="text-lg font-bold text-text-primary">Edit Field Associate Profile</h3>
                <p className="text-xs text-text-secondary">Update details or change password for {editingConsultant.name || "Field Associate"}</p>
              </div>
              <button
                onClick={() => setEditingConsultant(null)}
                className="p-1.5 rounded-full hover:bg-surface-raised text-text-secondary hover:text-text-primary transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleUpdate} className="p-5 space-y-4">
              <div>
                <Label>Full Name</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. John Doe"
                  required
                />
              </div>

              <div>
                <Label>Email Address</Label>
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="e.g. john@example.com"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Mobile Number</Label>
                  <Input
                    value={editMobile}
                    onChange={(e) => setEditMobile(e.target.value)}
                    placeholder="e.g. 9876543210"
                    required
                  />
                </div>
                <div>
                  <Label>WhatsApp Number</Label>
                  <Input
                    value={editWhatsapp}
                    onChange={(e) => setEditWhatsapp(e.target.value)}
                    placeholder="e.g. 9876543210"
                  />
                </div>
              </div>

              <div className="border-t border-border pt-3">
                <Label className="text-text-primary font-bold">Change Password</Label>
                <p className="text-[10px] text-text-secondary mb-2">Enter a new password to change it, or leave blank to keep current password.</p>
                <Input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="New password (min 6 chars)"
                  minLength={6}
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-border mt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditingConsultant(null)}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={updating} className="cursor-pointer">
                  {updating ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
