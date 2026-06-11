import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Card, Input, Label, Select, Badge } from "@/components/ui-kit";
import { toast } from "sonner";
import { Plus, X, Edit, Phone, Calendar, Clock, Folder, ExternalLink } from "lucide-react";
import { parseSiteMetadata, serializeSiteMetadata } from "@/lib/site-metadata";

export { parseSiteMetadata, serializeSiteMetadata };

export function SitesPanel() {
  const [sites, setSites] = useState<any[]>([]);
  const [businessConsultants, setBusinessConsultants] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingSite, setEditingSite] = useState<any | null>(null);

  const [form, setForm] = useState({
    name: "",
    city: "",
    address: "",
    worker: "",
    c1_name: "",
    c1_mobile: "",
    c1_email: "",
    c2_name: "",
    c2_mobile: "",
    c2_email: "",
    status: "Running",
    appt_date: "",
    appt_time: "",
    create_drive_folder: false,
    drive_folder_link: ""
  });

  const load = async () => {
    const [s, w] = await Promise.all([
      supabase
        .from("sites")
        .select("id,name,city,address,assigned_worker_id,assigned_at,task_notes,appt_date,appt_time")
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,name,mobile,is_active").order("created_at"),
    ]);
    if (s.error) toast.error("Error loading sites: " + s.error.message);
    if (w.error) toast.error("Error loading profiles: " + w.error.message);
    setSites(s.data ?? []);
    setBusinessConsultants((w.data ?? []).filter((x: any) => x.is_active));
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    if (!form.name) return toast.error("Name required");
    const meta = {
      c1_name: form.c1_name,
      c1_mobile: form.c1_mobile,
      c1_email: form.c1_email,
      c2_name: form.c2_name,
      c2_mobile: form.c2_mobile,
      c2_email: form.c2_email,
      status: form.status,
      create_drive_folder: form.create_drive_folder,
      drive_folder_name: form.name, // Keep for backward compatibility
      drive_folder_link: form.create_drive_folder ? form.drive_folder_link : ""
    };
    const taskNotes = serializeSiteMetadata("", meta);

    const { error } = await supabase.from("sites").insert({
      name: form.name,
      city: form.city || null,
      address: form.address || null,
      assigned_worker_id: form.worker || null,
      task_notes: taskNotes,
      appt_date: form.appt_date || null,
      appt_time: form.appt_time || null
    } as never);

    if (error) toast.error(error.message);
    else {
      toast.success("Site created");
      setCreating(false);
      resetForm();
      await load();
    }
  };

  const startEdit = (s: any) => {
    const meta = parseSiteMetadata(s.task_notes);
    setEditingSite(s);
    setForm({
      name: s.name,
      city: s.city ?? "",
      address: s.address ?? "",
      worker: s.assigned_worker_id ?? "",
      c1_name: meta.c1_name,
      c1_mobile: meta.c1_mobile,
      c1_email: meta.c1_email,
      c2_name: meta.c2_name,
      c2_mobile: meta.c2_mobile,
      c2_email: meta.c2_email,
      status: meta.status,
      appt_date: s.appt_date ?? "",
      appt_time: s.appt_time ?? "",
      create_drive_folder: !!meta.create_drive_folder,
      drive_folder_link: meta.drive_folder_link ?? ""
    });
  };

  const updateSite = async () => {
    if (!editingSite) return;
    const meta = {
      c1_name: form.c1_name,
      c1_mobile: form.c1_mobile,
      c1_email: form.c1_email,
      c2_name: form.c2_name,
      c2_mobile: form.c2_mobile,
      c2_email: form.c2_email,
      status: form.status,
      create_drive_folder: form.create_drive_folder,
      drive_folder_name: form.name,
      drive_folder_link: form.create_drive_folder ? form.drive_folder_link : ""
    };
    const taskNotes = serializeSiteMetadata(editingSite.task_notes, meta);

    const { error } = await supabase
      .from("sites")
      .update({
        name: form.name,
        city: form.city || null,
        address: form.address || null,
        assigned_worker_id: form.worker || null,
        task_notes: taskNotes,
        appt_date: form.appt_date || null,
        appt_time: form.appt_time || null
      } as never)
      .eq("id", editingSite.id);

    if (error) toast.error(error.message);
    else {
      toast.success("Site updated");
      setEditingSite(null);
      resetForm();
      await load();
    }
  };

  const resetForm = () => {
    setForm({
      name: "",
      city: "",
      address: "",
      worker: "",
      c1_name: "",
      c1_mobile: "",
      c1_email: "",
      c2_name: "",
      c2_mobile: "",
      c2_email: "",
      status: "Running",
      appt_date: "",
      appt_time: "",
      create_drive_folder: false,
      drive_folder_link: ""
    });
  };

  const assign = async (siteId: string, workerId: string) => {
    await supabase
      .from("sites")
      .update({ assigned_worker_id: workerId || null, assigned_at: new Date().toISOString() } as never)
      .eq("id", siteId);
    toast.success("Updated");
    await load();
  };

  const updateSiteStatus = async (siteId: string, newStatus: string, currentTaskNotes: string | null) => {
    const meta = parseSiteMetadata(currentTaskNotes);
    const newNotes = serializeSiteMetadata(currentTaskNotes, { ...meta, status: newStatus || "" });
    const { error } = await supabase.from("sites").update({ task_notes: newNotes } as never).eq("id", siteId);
    if (error) toast.error(error.message);
    else await load();
  };

  const deleteSite = async (siteId: string) => {
    if (!window.confirm("Are you sure you want to delete this site? All associated forms, appointments, and progress data will be permanently removed.")) return;
    try {
      await Promise.all([
        supabase.from("assessment").delete().eq("site_id", siteId),
        supabase.from("commissioning").delete().eq("site_id", siteId),
        supabase.from("contacts").delete().eq("site_id", siteId),
        supabase.from("installation").delete().eq("site_id", siteId),
        supabase.from("machines").delete().eq("site_id", siteId),
        supabase.from("media").delete().eq("site_id", siteId),
      ]);

      const { error } = await supabase.from("sites").delete().eq("id", siteId);
      if (error) throw error;

      toast.success("Site deleted successfully");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete site");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-lime/80 font-bold">Manage</p>
          <h1 className="mt-2 text-4xl uppercase tracking-tight font-extrabold">Sites</h1>
        </div>
        <Button onClick={() => { resetForm(); setCreating(true); setEditingSite(null); }}>
          <Plus size={16} strokeWidth={1.5} /> New Site
        </Button>
      </div>

      {(creating || editingSite) && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl uppercase font-bold tracking-tight text-lime">{editingSite ? "Edit Site Details" : "New Site Details"}</h2>
            <button onClick={() => { setCreating(false); setEditingSite(null); }}>
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Site Name</Label>
              <Input 
                value={form.name} 
                onChange={(e) => setForm({ ...form, name: e.target.value })} 
              />
            </div>
            <div><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            
            <div className="md:col-span-2"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>

            <div>
              <Label>Appointment Date</Label>
              <div className="relative flex items-center">
                <Input type="date" className="pr-10" value={form.appt_date} onChange={(e) => setForm({ ...form, appt_date: e.target.value })} />
                <Calendar className="absolute right-3 text-text-primary pointer-events-none z-0" size={16} strokeWidth={1.5} />
              </div>
            </div>
            <div>
              <Label>Appointment Time</Label>
              <div className="relative flex items-center">
                <Input type="time" className="pr-10" value={form.appt_time} onChange={(e) => setForm({ ...form, appt_time: e.target.value })} />
                <Clock className="absolute right-3 text-text-primary pointer-events-none z-0" size={16} strokeWidth={1.5} />
              </div>
            </div>

            <div className="border-t border-border pt-4 md:col-span-2">
              <h4 className="text-sm font-bold uppercase tracking-wider text-lime mb-3">Primary Contact</h4>
              <div className="grid gap-4 md:grid-cols-3">
                <div><Label>Contact Name</Label><Input value={form.c1_name} onChange={(e) => setForm({ ...form, c1_name: e.target.value })} /></div>
                <div><Label>Contact Mobile</Label><Input value={form.c1_mobile} onChange={(e) => setForm({ ...form, c1_mobile: e.target.value })} /></div>
                <div><Label>Contact Email</Label><Input value={form.c1_email} onChange={(e) => setForm({ ...form, c1_email: e.target.value })} /></div>
              </div>
            </div>

            <div className="border-t border-border pt-4 md:col-span-2">
              <h4 className="text-sm font-bold uppercase tracking-wider text-lime mb-3">Secondary Contact</h4>
              <div className="grid gap-4 md:grid-cols-3">
                <div><Label>Contact Name</Label><Input value={form.c2_name} onChange={(e) => setForm({ ...form, c2_name: e.target.value })} /></div>
                <div><Label>Contact Mobile</Label><Input value={form.c2_mobile} onChange={(e) => setForm({ ...form, c2_mobile: e.target.value })} /></div>
                <div><Label>Contact Email</Label><Input value={form.c2_email} onChange={(e) => setForm({ ...form, c2_email: e.target.value })} /></div>
              </div>
            </div>

            <div className="border-t border-border pt-4 md:col-span-2 grid gap-4 md:grid-cols-2">
              <div>
                <Label>Factory Status</Label>
                <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="Running">Running</option>
                  <option value="Stopped">Stopped</option>
                  <option value="Maintenance">Maintenance</option>
                </Select>
              </div>
              <div>
                <Label>Assign Business Consultant</Label>
                <Select value={form.worker} onChange={(e) => setForm({ ...form, worker: e.target.value })}>
                  <option value="">— Unassigned —</option>
                  {businessConsultants.map((w) => (
                    <option key={w.id} value={w.id}>{w.name ?? w.mobile}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="border-t border-border pt-4 md:col-span-2 grid gap-4 md:grid-cols-2">
              <div className="flex items-center gap-2 mt-6">
                <input 
                  type="checkbox" 
                  id="create_drive_folder"
                  checked={form.create_drive_folder} 
                  onChange={(e) => setForm({ ...form, create_drive_folder: e.target.checked })}
                  className="rounded border-border bg-surface text-lime focus:ring-lime h-4 w-4"
                />
                <Label htmlFor="create_drive_folder" className="cursor-pointer">Google Drive Link</Label>
              </div>
              {form.create_drive_folder && (
                <div>
                  <Label>Google Drive Folder Link</Label>
                  <Input 
                    placeholder="https://drive.google.com/drive/folders/..." 
                    value={form.drive_folder_link} 
                    onChange={(e) => setForm({ ...form, drive_folder_link: e.target.value })} 
                  />
                </div>
              )}
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => { setCreating(false); setEditingSite(null); }}>Cancel</Button>
            <Button onClick={editingSite ? updateSite : create}>{editingSite ? "Save Details" : "Create Site"}</Button>
          </div>
        </Card>
      )}

      <div className="overflow-x-auto border border-border bg-surface rounded-[10px]">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-raised">
            <tr className="text-left font-mono text-[9px] uppercase tracking-widest text-text-secondary">
              <th className="px-4 py-3">Site / Factory</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Primary Contact</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">BC Assignment</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sites.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-text-dim italic">No sites created yet.</td></tr>
            ) : sites.map((s) => {
              const meta = parseSiteMetadata(s.task_notes);
              return (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-surface-raised/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-text-primary">{s.name}</div>
                    <div className="text-xs text-text-secondary mt-0.5 truncate max-w-[200px]">{s.address || "—"}</div>
                    {meta.drive_folder_link && (
                      <button
                        onClick={() => {
                          window.open(meta.drive_folder_link, "_blank");
                        }}
                        className="text-xs text-lime hover:underline flex items-center gap-1 mt-1 font-mono text-left"
                      >
                        <Folder size={12} className="inline mr-1" /> Open Drive Folder <ExternalLink size={10} className="inline ml-1" />
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-primary font-medium">{s.city || "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    {meta.c1_name ? (
                      <div>
                        <div className="font-semibold text-text-primary">{meta.c1_name}</div>
                        <a href={`tel:${meta.c1_mobile}`} className="text-lime hover:underline flex items-center gap-1 mt-0.5 font-mono text-[10px]">
                          <Phone size={10} /> {meta.c1_mobile}
                        </a>
                      </div>
                    ) : (
                      <span className="text-text-dim">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <select
                        value={meta.status || ""}
                        onChange={(e) => updateSiteStatus(s.id, e.target.value, s.task_notes)}
                        className={`appearance-none rounded-[4px] px-2 py-1 font-mono text-[10px] uppercase tracking-wider font-bold border outline-none cursor-pointer transition-all ${
                          meta.status === "Running" ? "bg-mint-dim text-mint border-mint/20"
                          : meta.status === "Reject" ? "bg-coral-dim text-coral border-coral/20"
                          : !meta.status ? "bg-surface text-text-dim border-border"
                          : "bg-warning/8 text-warning border-warning/20"
                        }`}
                      >
                        <option value="">— None —</option>
                        <option value="Assigned">Assigned</option>
                        <option value="Assessment &amp; Visit">Assessment &amp; Visit</option>
                        <option value="Concept">Concept</option>
                        <option value="Installation">Installation</option>
                        <option value="Verification">Verification</option>
                        <option value="Running">Running</option>
                        <option value="Reject">Reject</option>
                      </select>
                      {meta.visit_status && (
                        <span className={`font-mono text-[9px] uppercase tracking-wider ${
                          meta.visit_status === "Visit Complete" ? "text-mint"
                          : meta.visit_status === "Installation Done" ? "text-violet"
                          : "text-warning"
                        }`}>{meta.visit_status}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Select value={s.assigned_worker_id ?? ""} onChange={(e) => assign(s.id, e.target.value)}>
                      <option value="">— Unassigned —</option>
                      {businessConsultants.map((w) => (
                        <option key={w.id} value={w.id}>{w.name ?? w.mobile}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="secondary" className="p-1 px-2.5 text-xs" onClick={() => startEdit(s)}>
                        <Edit size={12} /> Edit
                      </Button>
                      <Button 
                        variant="danger" 
                        className="py-1 px-2.5 text-xs" 
                        onClick={() => deleteSite(s.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
