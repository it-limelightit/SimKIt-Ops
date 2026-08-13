import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Input, Label, Textarea, Badge, Select, EmptyState } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth-store";
import { toast } from "sonner";
import { ClipboardList } from "lucide-react";

type Site = {
  id: string;
  name: string;
  city: string | null;
  assigned_worker_id: string | null;
  appt_date: string | null;
  appt_time: string | null;
  task_notes: string | null;
  task_assigned_at: string | null;
};
type BusinessConsultant = { id: string; name: string | null };

const PHASES = ["assessment", "installation", "commissioning"];

export function parseTaskNotes(notes: string | null) {
  if (!notes) return { phase: null, cleanNotes: "" };
  const phaseMatch = notes.match(/\[PHASE:([^\]]+)\]/);
  const phase = phaseMatch ? phaseMatch[1] : null;
  let cleanNotes = notes;
  if (phaseMatch) cleanNotes = cleanNotes.replace(phaseMatch[0], "");

  // Strip METADATA block with brace matching (since JSON might contain brackets ']')
  const metaPrefix = "[METADATA:";
  const metaIdx = cleanNotes.indexOf(metaPrefix);
  if (metaIdx !== -1) {
    const start = metaIdx + metaPrefix.length;
    let depth = 0;
    let endIdx = -1;
    for (let i = start; i < cleanNotes.length; i++) {
      if (cleanNotes[i] === "{") depth++;
      else if (cleanNotes[i] === "}") {
        depth--;
        if (depth === 0) {
          endIdx = i + 1 + (cleanNotes[i + 1] === "]" ? 1 : 0);
          break;
        }
      }
    }
    if (endIdx !== -1) {
      cleanNotes = cleanNotes.slice(0, metaIdx) + cleanNotes.slice(endIdx);
    }
  }

  // Strip legacy tags
  cleanNotes = cleanNotes
    .replace(/\[SECTION:[^\]]*\]/g, "")
    .replace(/\[HIDDEN:[^\]]*\]/g, "")
    .replace(/\[STAGE:[^\]]*\]/g, "");

  // Remove any remaining raw JSON object string
  if (cleanNotes.includes('"assessor_company"')) {
    cleanNotes = cleanNotes.replace(/\{[^\}]*\}/g, "");
  }

  return { phase, cleanNotes: cleanNotes.trim() };
}

export function TasksPanel({ hideHeader = false }: { hideHeader?: boolean }) {
  const { userId } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [businessConsultants, setBusinessConsultants] = useState<BusinessConsultant[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ worker: "", date: "", time: "", notes: "", phase: "assessment" });

  const load = async () => {
    const [s, w] = await Promise.all([
      supabase
        .from("sites")
        .select("id,name,city,assigned_worker_id,appt_date,appt_time,task_notes,task_assigned_at")
        .order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id").eq("role", "worker"),
    ]);
    const ids = ((w.data ?? []) as any[]).map((r) => r.user_id);
    const profs = ids.length
      ? await supabase.from("profiles").select("id,name").in("id", ids).eq("is_active", true)
      : { data: [] as any[] };
    setSites((s.data ?? []) as Site[]);
    setBusinessConsultants((profs.data ?? []) as BusinessConsultant[]);
  };
  useEffect(() => { void load(); }, []);

  const startEdit = (s: Site) => {
    setEditing(s.id);
    const parsed = parseTaskNotes(s.task_notes);
    setForm({
      worker: s.assigned_worker_id ?? "",
      date: s.appt_date ?? "",
      time: s.appt_time ?? "",
      notes: parsed.cleanNotes,
      phase: parsed.phase || "assessment",
    });
  };

  const save = async (siteId: string) => {
    if (!form.worker || !form.date || !form.time) {
      toast.error("Field Associate, date and time are required");
      return;
    }
    const notesWithPrefix = `[PHASE:${form.phase}]${form.notes}`;
    const { error } = await supabase
      .from("sites")
      .update({
        assigned_worker_id: form.worker,
        assigned_at: new Date().toISOString(),
        appt_date: form.date,
        appt_time: form.time,
        task_notes: notesWithPrefix,
        task_assigned_at: new Date().toISOString(),
        task_assigned_by: userId,
      } as never)
      .eq("id", siteId);
    if (error) toast.error(error.message);
    else {
      toast.success("Task assigned");
      setEditing(null);
      await load();
    }
  };

  const clear = async (siteId: string) => {
    const { error } = await supabase
      .from("sites")
      .update({
        appt_date: null,
        appt_time: null,
        task_notes: null,
        task_assigned_at: null,
      } as never)
      .eq("id", siteId);
    if (error) toast.error(error.message);
    else {
      toast.success("Task cleared");
      await load();
    }
  };

  const nameOf = (id: string | null) => businessConsultants.find((w) => w.id === id)?.name ?? "—";

  return (
    <div className="space-y-8">
      {!hideHeader && (
        <header>
          <p className="font-mono text-[11px] uppercase tracking-widest text-stone">Schedule</p>
          <h1 className="mt-2 text-4xl">Tasks</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Assign a Field Associate, appointment date and time to each site. The Field Associate only sees the site after a task is set.
          </p>
        </header>
      )}

      {sites.length === 0 ? (
        <EmptyState icon={ClipboardList} text="No sites yet. Create one in Sites." />
      ) : (
        <div className="space-y-3">
          {sites.map((s) => {
            const isEditing = editing === s.id;
            const hasTask = !!s.appt_date;
            const parsed = parseTaskNotes(s.task_notes);
            return (
              <div key={s.id} className="border border-border bg-surface p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg">{s.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{s.city ?? "—"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={hasTask ? "success" : "warning"}>{hasTask ? "Task set" : "No task"}</Badge>
                    {!isEditing && (
                      <Button variant="secondary" onClick={() => startEdit(s)}>
                        {hasTask ? "Edit" : "Assign task"}
                      </Button>
                    )}
                  </div>
                </div>

                {!isEditing && hasTask && (
                  <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                    <Field label="Field Associate" value={nameOf(s.assigned_worker_id)} />
                    <Field label="Date" value={s.appt_date ?? "—"} />
                    <Field label="Time" value={s.appt_time?.slice(0, 5) ?? "—"} />
                    <Field
                      label="Assigned"
                      value={s.task_assigned_at ? new Date(s.task_assigned_at).toLocaleString() : "—"}
                    />
                    {parsed.phase && (
                      <Field
                        label="Assigned Phase"
                        value={parsed.phase === "assessment" ? "Assessment Visit" : parsed.phase === "installation" ? "Installation" : "Commissioning"}
                      />
                    )}
                    {parsed.cleanNotes && (
                      <div className="col-span-full">
                        <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          Notes
                        </div>
                        <p className="text-sm">{parsed.cleanNotes}</p>
                      </div>
                    )}
                  </div>
                )}

                {isEditing && (
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <Label>Field Associate</Label>
                      <Select value={form.worker} onChange={(e) => setForm({ ...form, worker: e.target.value })}>
                        <option value="">Choose Field Associate</option>
                        {businessConsultants.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name ?? w.id.slice(0, 8)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label>Date</Label>
                      <Input
                        type="date"
                        value={form.date}
                        onChange={(e) => setForm({ ...form, date: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Time</Label>
                      <Input
                        type="time"
                        value={form.time}
                        onChange={(e) => setForm({ ...form, time: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Active Phase</Label>
                      <Select 
                        value={form.phase} 
                        onChange={(e) => {
                          const p = e.target.value;
                          setForm({ ...form, phase: p });
                        }}
                      >
                        {PHASES.map((p) => (
                          <option key={p} value={p}>
                            {p === "assessment" ? "Assessment Visit" : p === "installation" ? "Installation" : "Commissioning"}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="md:col-span-3">
                      <Label>Notes (optional)</Label>
                      <Textarea
                        rows={2}
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        placeholder="Instructions for the Field Associate"
                      />
                    </div>
                    <div className="md:col-span-3 flex justify-end gap-2">
                      {hasTask && (
                        <Button variant="ghost" onClick={() => clear(s.id)}>
                          Clear task
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button onClick={() => save(s.id)}>Save task</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}
