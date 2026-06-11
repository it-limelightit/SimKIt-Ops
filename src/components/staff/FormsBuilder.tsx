import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Input, Label, Select, Checkbox } from "@/components/ui-kit";
import { toast } from "sonner";
import { Trash2, Plus, EyeOff, Layout } from "lucide-react";
import { TasksPanel } from "./TasksPanel";

const PHASES = ["assessment", "installation", "commissioning"];
const FIELD_TYPES = ["Text", "Number", "Textarea", "Dropdown", "Checkbox", "File Upload"];
const SECTIONS: Record<string, string[]> = {
  assessment: ["Factory Call", "Third Party Call", "Appointment", "Facility Visit", "Explanation", "Contacts", "Floor Visit", "Business Profile", "Machines", "MOM", "Media"],
  installation: ["Delivery", "Coordination", "Photos"],
  commissioning: ["Coordination", "Visit", "Connection", "Configure", "Testing", "Screenshots", "Certificate", "Final MOM"],
};

export function FormsBuilder() {
  const [tab, setTab] = useState<"tasks" | "fields" | "visibility">("tasks");
  const [phase, setPhase] = useState("assessment");
  const [list, setList] = useState<any[]>([]);
  const [draft, setDraft] = useState({ label: "", field_type: "Text", options: "", section: SECTIONS.assessment[0] });
  const [consultants, setConsultants] = useState<any[]>([]);
  const [targetConsultant, setTargetConsultant] = useState("all");
  
  // Visibility tab states
  const [visibilityPhase, setVisibilityPhase] = useState("assessment");
  const [visibleSections, setVisibleSections] = useState<string[]>([]);
  const [visRecordId, setVisRecordId] = useState<string | null>(null);

  const load = async () => {
    const { data: fields } = await supabase
      .from("custom_fields")
      .select("*")
      .order("created_at", { ascending: false });
    setList((fields ?? []).filter((f: any) => f.phase !== "visibility_settings"));

    const { data: workerRoles } = await supabase.from("user_roles").select("user_id").eq("role", "worker");
    const ids = (workerRoles ?? []).map((r: any) => r.user_id);
    if (ids.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id,name,email").in("id", ids).order("name");
      setConsultants(profiles ?? []);
    } else {
      setConsultants([]);
    }
  };

  const loadVisibilitySettings = async (phaseName: string) => {
    const { data: vis } = await supabase
      .from("custom_fields")
      .select("*")
      .eq("phase", "visibility_settings")
      .eq("section", phaseName)
      .maybeSingle();

    if (vis) {
      setVisRecordId(vis.id);
      const hidden = vis.options?.hidden_sections ?? [];
      const allSecs = SECTIONS[phaseName];
      const visible = allSecs.filter(s => !hidden.includes(s));
      setVisibleSections(visible);
    } else {
      setVisRecordId(null);
      setVisibleSections(SECTIONS[phaseName]); // By default, all are visible
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (tab === "visibility") {
      void loadVisibilitySettings(visibilityPhase);
    }
  }, [tab, visibilityPhase]);

  const changePhase = (newPhase: string) => {
    setPhase(newPhase);
    setDraft((prev) => ({ ...prev, section: SECTIONS[newPhase][0] }));
  };

  const add = async () => {
    if (!draft.label) return toast.error("Label required");
    const optionsObj: any = { worker_id: targetConsultant };
    if (draft.field_type === "Dropdown") {
      optionsObj.values = draft.options.split(",").map((s) => s.trim()).filter(Boolean);
    }
    const { error } = await supabase.from("custom_fields").insert({
      phase,
      section: draft.section,
      field_type: draft.field_type,
      label: draft.label,
      options: optionsObj,
    } as never);
    if (error) toast.error(error.message);
    else {
      toast.success("Field added");
      setDraft({ label: "", field_type: "Text", options: "", section: SECTIONS[phase][0] });
      await load();
    }
  };

  const remove = async (id: string) => {
    await supabase.from("custom_fields").delete().eq("id", id);
    await load();
  };

  const handleToggleVisibility = (secName: string, isChecked: boolean) => {
    if (isChecked) {
      setVisibleSections(prev => [...prev, secName]);
    } else {
      setVisibleSections(prev => prev.filter(s => s !== secName));
    }
  };

  const saveVisibility = async () => {
    const allSecs = SECTIONS[visibilityPhase];
    const hidden = allSecs.filter(s => !visibleSections.includes(s));
    const payload = {
      phase: "visibility_settings",
      section: visibilityPhase,
      field_type: "Checkbox",
      label: "Visibility Settings",
      options: { hidden_sections: hidden }
    };

    if (visRecordId) {
      const { error } = await supabase
        .from("custom_fields")
        .update(payload as never)
        .eq("id", visRecordId);
      if (error) toast.error(error.message);
      else toast.success("Visibility settings updated");
    } else {
      const { error } = await supabase
        .from("custom_fields")
        .insert(payload as never);
      if (error) toast.error(error.message);
      else {
        toast.success("Visibility settings saved");
        void loadVisibilitySettings(visibilityPhase);
      }
    }
  };

  const filtered = list.filter((f) => f.phase === phase);

  return (
    <div className="space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-lime/80 font-bold">Customize</p>
          <h1 className="mt-2 text-4xl uppercase tracking-tight font-extrabold">Forms & Tasks</h1>
        </div>
        <div className="flex bg-surface border border-border p-1 rounded-[8px]">
          <button
            onClick={() => setTab("tasks")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-[6px] transition-all duration-150 cursor-pointer ${tab === "tasks" ? "bg-lime text-bg" : "text-text-secondary hover:text-text-primary"}`}
          >
            Tasks
          </button>
          <button
            onClick={() => setTab("fields")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-[6px] transition-all duration-150 cursor-pointer ${tab === "fields" ? "bg-lime text-bg" : "text-text-secondary hover:text-text-primary"}`}
          >
            Fields
          </button>
          <button
            onClick={() => setTab("visibility")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-[6px] transition-all duration-150 cursor-pointer ${tab === "visibility" ? "bg-lime text-bg" : "text-text-secondary hover:text-text-primary"}`}
          >
            Visibility
          </button>
        </div>
      </header>

      {tab === "tasks" && <TasksPanel hideHeader />}

      {tab === "fields" && (
        <div className="card-surface">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Phase</Label>
              <Select value={phase} onChange={(e) => changePhase(e.target.value)}>
                {PHASES.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
              </Select>
            </div>
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <h3 className="mb-4 text-lg font-bold uppercase tracking-wider text-lime">Add Custom Field</h3>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <Label>Section</Label>
                <Select value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })}>
                  {SECTIONS[phase].map((sec) => <option key={sec} value={sec}>{sec}</option>)}
                </Select>
              </div>
              <div>
                <Label>Label</Label>
                <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Field Label" />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={draft.field_type} onChange={(e) => setDraft({ ...draft, field_type: e.target.value })}>
                  {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <div>
                <Label>BC Assignment</Label>
                <Select value={targetConsultant} onChange={(e) => setTargetConsultant(e.target.value)}>
                  <option value="all">All Consultants</option>
                  {consultants.map((c) => (
                    <option key={c.id} value={c.id}>{c.name || c.email || "Unnamed"}</option>
                  ))}
                </Select>
              </div>
              {draft.field_type === "Dropdown" && (
                <div className="md:col-span-4">
                  <Label>Options (comma separated)</Label>
                  <Input value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} placeholder="Option 1, Option 2, Option 3" />
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={add}><Plus size={16} strokeWidth={1.5} /> Add Field</Button>
            </div>
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <h3 className="mb-4 text-lg font-bold uppercase tracking-wider">Existing Fields ({filtered.length})</h3>
            {filtered.length === 0 ? (
              <p className="text-sm text-text-dim italic">No custom fields for this phase yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((f) => (
                  <li key={f.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">{f.label}</div>
                      <div className="flex gap-2 items-center mt-1">
                        <span className="font-mono text-[9px] uppercase tracking-widest text-lime bg-lime-dim border border-lime/20 px-1.5 py-0.5 rounded-[4px]">{f.field_type} ({f.section})</span>
                        <span className="font-mono text-[9px] uppercase tracking-widest text-text-secondary bg-surface-raised px-1.5 py-0.5 rounded-[4px]">
                          For: {(() => {
                            const wId = f.options?.worker_id;
                            if (!wId || wId === "all") return "All Consultants";
                            const found = consultants.find((c) => c.id === wId);
                            return found ? (found.name || found.email || "Unnamed") : "Unknown";
                          })()}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => remove(f.id)} className="text-text-secondary hover:text-coral transition-colors p-1 cursor-pointer">
                      <Trash2 size={16} strokeWidth={1.5} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "visibility" && (
        <div className="card-surface">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Select Phase to Configure</Label>
              <Select value={visibilityPhase} onChange={(e) => setVisibilityPhase(e.target.value)}>
                {PHASES.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
              </Select>
            </div>
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <div className="flex items-center gap-2 mb-4">
              <Layout size={18} className="text-lime" />
              <h3 className="text-lg font-bold uppercase tracking-wider">Section Visibility Settings</h3>
            </div>
            <p className="text-sm text-text-secondary mb-6">
              Select which sections are visible to Business Consultants. Checked sections will be visible, unchecked sections will be hidden.
            </p>

            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 bg-surface-raised p-6 border border-border rounded-[10px]">
              {SECTIONS[visibilityPhase].map((sec) => {
                const isVisible = visibleSections.includes(sec);
                return (
                  <div key={sec} className="flex items-center gap-3 p-3 bg-surface border border-border rounded-[6px] hover:border-lime/30 transition-colors">
                    <Checkbox
                      checked={isVisible}
                      onCheckedChange={(checked) => handleToggleVisibility(sec, checked)}
                      label={<span className="font-semibold">{sec}</span>}
                    />
                  </div>
                );
              })}
            </div>

            <div className="mt-8 flex justify-end">
              <Button onClick={saveVisibility}><EyeOff size={16} /> Save Visibility Settings</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
