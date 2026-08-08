import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  SectionTitle,
  Segmented,
  Select,
  Textarea,
  EmptyState,
  CompleteJobRow,
} from "@/components/ui-kit";
import { MediaUploader } from "@/components/MediaUploader";
import { usePhaseData } from "@/lib/use-phase-data";
import { useAuth } from "@/lib/auth-store";
import { advanceSiteVisitStatus } from "@/lib/site-metadata";
import { Plus, Trash2, Users, Wrench, AlertTriangle, ChevronDown, ChevronUp, Building2, Check } from "lucide-react";

type Props = { siteId: string; workerId: string; hiddenSections?: string[]; onSubmit?: () => void };

type AData = Record<string, any>;

export function getAppointmentTimingStatus(scheduledDateStr: string | null, scheduledTimeStr: string | null, completedAtIso: string | null) {
  if (!scheduledDateStr || !completedAtIso) return null;
  try {
    const timePart = scheduledTimeStr ? (scheduledTimeStr.length === 5 ? scheduledTimeStr + ":00" : scheduledTimeStr) : "00:00:00";
    const scheduledDate = new Date(`${scheduledDateStr}T${timePart}`);
    const completedDate = new Date(completedAtIso);
    
    if (isNaN(scheduledDate.getTime()) || isNaN(completedDate.getTime())) return null;
    
    const diffMs = completedDate.getTime() - scheduledDate.getTime();
    const diffMins = diffMs / (60 * 1000);
    
    if (diffMins < -15) {
      return "Early";
    } else if (diffMins >= -15 && diffMins <= 30) {
      return "On Time";
    } else {
      return "Late";
    }
  } catch (e) {
    return null;
  }
}

export function AssessmentTab({ siteId, workerId, hiddenSections, onSubmit }: Props) {
  const { data, patch, save, loaded, lastSaved, saving } = usePhaseData<AData>("assessment", siteId, workerId, {});
  const validateSectionLinks = async (sectionName: string, defaultSectionKeys: string[]) => {
    for (const key of defaultSectionKeys) {
      const { data: mediaRows } = await supabase
        .from("media")
        .select("file_path")
        .eq("site_id", siteId)
        .eq("phase", "assessment")
        .eq("section", key);
      const hasLink = mediaRows?.some(r => r.file_path && r.file_path.trim().startsWith("http"));
      if (!hasLink) {
        toast.error(`Please paste a valid Google Drive/document link for this section first.`);
        return false;
      }
    }
    const secFields = customFields.filter(f => f.section === sectionName && f.field_type === "File Upload");
    for (const f of secFields) {
      const { data: mediaRows } = await supabase
        .from("media")
        .select("file_path")
        .eq("site_id", siteId)
        .eq("phase", "assessment")
        .eq("section", `custom-${f.id}`);
      const hasLink = mediaRows?.some(r => r.file_path && r.file_path.trim().startsWith("http"));
      if (!hasLink) {
        toast.error(`Please paste a valid link for custom field "${f.label}" first.`);
        return false;
      }
    }
    return true;
  };
  const { profile } = useAuth();
  const [siteDetails, setSiteDetails] = useState<{ appt_date: string | null; appt_time: string | null; task_notes: string | null } | null>(null);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    "MOM": true,
  });

  const toggleSection = (name: string) => {
    setExpandedSections(prev => {
      const isExpanding = !prev[name];
      return isExpanding ? { [name]: true } : {};
    });
  };

  useEffect(() => {
    (async () => {
      const { data: site } = await supabase
        .from("sites")
        .select("appt_date,appt_time,task_notes")
        .eq("id", siteId)
        .maybeSingle();
      if (site) {
        setSiteDetails(site);
        if (loaded) {
          const updates: any = {};
          if (data.appt_date === undefined || data.appt_date === null) {
            updates.appt_date = site.appt_date;
          }
          if (data.appt_time === undefined || data.appt_time === null) {
            updates.appt_time = site.appt_time;
          }
          if (Object.keys(updates).length > 0) {
            patch(updates);
          }
        }
      }
    })();
  }, [siteId, loaded]);

  const [customFields, setCustomFields] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data: fields } = await supabase
        .from("custom_fields")
        .select("*")
        .eq("phase", "assessment");
      const filtered = (fields ?? []).filter((f: any) => {
        const wId = f.options?.worker_id;
        return !wId || wId === "all" || wId === workerId;
      });
      setCustomFields(filtered);
    })();
  }, [workerId]);

  const shouldShow = (secName: string) => !hiddenSections?.includes(secName);

  const renderCustomFields = (sectionName: string, disabled: boolean = false) => {
    const fields = customFields.filter((f) => f.section === sectionName);
    if (fields.length === 0) return null;

    return (
      <div className="mt-5 space-y-4 border-t border-border pt-4">
        {fields.map((f) => {
          const valueKey = `custom_${f.id}`;
          const currentValue = data[valueKey] ?? "";

          return (
            <div key={f.id} className="space-y-1">
              <Label>{f.label}</Label>
              {f.field_type === "Text" && (
                <Input
                  defaultValue={currentValue}
                  onBlur={(e) => patch({ [valueKey]: e.target.value })}
                  disabled={disabled}
                />
              )}
              {f.field_type === "Number" && (
                <Input
                  type="number"
                  defaultValue={currentValue}
                  onBlur={(e) => patch({ [valueKey]: e.target.value ? Number(e.target.value) : "" })}
                  disabled={disabled}
                />
              )}
              {f.field_type === "Textarea" && (
                <Textarea
                  rows={3}
                  defaultValue={currentValue}
                  onBlur={(e) => patch({ [valueKey]: e.target.value })}
                  disabled={disabled}
                />
              )}
              {f.field_type === "Dropdown" && (
                <Select
                  value={currentValue}
                  onChange={(e) => patch({ [valueKey]: e.target.value })}
                  disabled={disabled}
                >
                  <option value="">Select…</option>
                  {(f.options?.values ?? []).map((val: string) => (
                    <option key={val} value={val}>
                      {val}
                    </option>
                  ))}
                </Select>
              )}
              {f.field_type === "Checkbox" && (
                <Checkbox
                  checked={!!currentValue}
                  onCheckedChange={(val) => patch({ [valueKey]: val })}
                  label={f.label}
                  disabled={disabled}
                />
              )}
              {f.field_type === "File Upload" && (
                <MediaUploader
                  siteId={siteId}
                  phase="assessment"
                  section={`custom-${f.id}`}
                  disabled={disabled}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const nowIso = () => new Date().toISOString();

  return (
    <>
      <div className="flex items-center justify-end gap-2 text-xs text-text-secondary pb-2">
        {saving ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            Saving…
          </span>
        ) : lastSaved ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
            Auto-saved {lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : (
          <span className="text-muted-foreground/50">Auto-save on</span>
        )}
      </div>

      {/* 1. MOM */}
      {shouldShow("MOM") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">01</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("MOM")}>
            <SectionTitle num={1}>MOM (Minutes of Meeting)</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["MOM"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["MOM"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <MediaUploader
                siteId={siteId}
                phase="assessment"
                section="mom"
              />
              <div className="mt-4">
                <Label>Quick Notes</Label>
                <Textarea
                  rows={3}
                  defaultValue={data.mom_notes ?? ""}
                  onBlur={(e) => patch({ mom_notes: e.target.value, mom_uploaded: true })}
                />
              </div>
              {renderCustomFields("MOM")}
              <CompleteJobRow
                checked={!!data.mom_uploaded}
                onToggle={() => patch({ mom_uploaded: !data.mom_uploaded })}
                validate={() => validateSectionLinks("MOM", ["mom"])}
              />
            </div>
          )}
        </Card>
      )}

      {/* 2. Photos & Videos */}
      {shouldShow("Media") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">02</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Media")}>
            <SectionTitle num={2}>Photos &amp; Videos</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Media"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Media"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <MediaUploader siteId={siteId} phase="assessment" section="media" />
              {renderCustomFields("Media")}
              <CompleteJobRow
                checked={!!data.media_uploaded}
                onToggle={async () => {
                  const next = !data.media_uploaded;
                  patch({ media_uploaded: next });
                  if (next) advanceSiteVisitStatus(siteId, "Assessment Done");
                }}
                validate={() => validateSectionLinks("Media", ["media"])}
              />
            </div>
          )}
        </Card>
      )}

      {/* 3. Factory Operations Form */}
      {shouldShow("Factory Operations") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">03</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Factory Operations")}>
            <SectionTitle num={3}>Factory Operations Form</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Factory Operations"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Factory Operations"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <FactoryOperationsCardContent data={data} patch={patch} siteId={siteId} />
              <CompleteJobRow
                checked={!!data.factory_operations_done}
                onToggle={() => patch({ factory_operations_done: !data.factory_operations_done })}
                validate={() => {
                  const shifts = data.factory_op_shifts ?? [];
                  const hasOverlap = checkShiftOverlap(shifts);
                  if (hasOverlap) {
                    toast.error("Please resolve the shift overlap before completing this section.");
                    return false;
                  }
                  return true;
                }}
              />
            </div>
          )}
        </Card>
      )}

      <div className="mt-8 flex justify-end">
        <Button
          onClick={async () => {
            if (shouldShow("MOM") && !data.mom_uploaded) {
              toast.error("Please complete the MOM (Minutes of Meeting) section.");
              return;
            }

            if (shouldShow("Media") && !data.media_uploaded) {
              toast.error("Please complete the Photos & Videos section.");
              return;
            }

            if (shouldShow("Factory Operations") && !data.factory_operations_done) {
              toast.error("Please complete the Factory Operations Form.");
              return;
            }

            await save({ ...data, assessment_phase_submitted: true });
            if (onSubmit) onSubmit();
          }}
          className="w-full sm:w-auto text-base py-3 px-8"
        >
          Submit Assessment Phase
        </Button>
      </div>
    </>
  );
}

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string) {
  return v ? new Date(v).toISOString() : null;
}

// === Contacts ===
function ContactsCardContent({ siteId, onChange }: { siteId: string; onChange: (count: number) => void }) {
  const [rows, setRows] = useState<any[]>([]);

  const load = async () => {
    const { data } = await supabase.from("contacts").select("*").eq("site_id", siteId).order("created_at");
    setRows(data ?? []);
    onChange((data ?? []).length);
  };
  useEffect(() => {
    void load();
  }, [siteId]);

  const add = async () => {
    await supabase.from("contacts").insert({ site_id: siteId, name: "", mobile: "" });
    await load();
  };
  const update = async (id: string, patch: Record<string, any>) => {
    await supabase.from("contacts").update(patch as never).eq("id", id);
  };
  const remove = async (id: string) => {
    await supabase.from("contacts").delete().eq("id", id);
    await load();
  };

  return (
    <div className="space-y-6">
      {rows.length === 0 ? (
        <EmptyState icon={Users} text="No contacts added" />
      ) : (
        <div className="space-y-6">
          {rows.map((r, i) => (
            <div key={r.id} className="grid gap-4 border-b border-border pb-6 last:border-0 last:pb-0 md:grid-cols-2">
              <div className="md:col-span-2 flex items-center justify-between">
                <span className="font-mono text-xs text-stone">Contact {String(i + 1).padStart(2, "0")}</span>
                <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-[#A63D2F]">
                  <Trash2 size={16} strokeWidth={1.5} />
                </button>
              </div>
              <div>
                <Label>Name</Label>
                <Input defaultValue={r.name ?? ""} onBlur={(e) => update(r.id, { name: e.target.value })} />
              </div>
              <div>
                <Label>Designation</Label>
                <Input defaultValue={r.designation ?? ""} onBlur={(e) => update(r.id, { designation: e.target.value })} />
              </div>
              <div>
                <Label>Mobile</Label>
                <Input defaultValue={r.mobile ?? ""} onBlur={(e) => update(r.id, { mobile: e.target.value })} />
              </div>
              <div>
                <Label>Email</Label>
                <Input defaultValue={r.email ?? ""} onBlur={(e) => update(r.id, { email: e.target.value })} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-6">
        <Button variant="secondary" type="button" onClick={add}>
          <Plus size={16} strokeWidth={1.5} /> Add Another Contact
        </Button>
      </div>
    </div>
  );
}

// === Machines ===
function MachinesCardContent({ siteId, onChange }: { siteId: string; onChange: (count: number) => void }) {
  const [rows, setRows] = useState<any[]>([]);

  const load = async () => {
    const { data } = await supabase.from("machines").select("*").eq("site_id", siteId).order("created_at");
    setRows(data ?? []);
    onChange((data ?? []).length);
  };
  useEffect(() => {
    void load();
  }, [siteId]);
  const add = async () => {
    await supabase.from("machines").insert({ site_id: siteId, name: "" });
    await load();
  };
  const update = async (id: string, patch: Record<string, any>) => {
    await supabase.from("machines").update(patch as never).eq("id", id);
  };
  const remove = async (id: string) => {
    await supabase.from("machines").delete().eq("id", id);
    await load();
  };

  return (
    <div className="space-y-6">
      {rows.length === 0 ? (
        <EmptyState icon={Wrench} text="No machines added" />
      ) : (
        <div className="space-y-6">
          {rows.map((m, i) => (
            <div key={m.id} className="border border-border p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono text-xs text-stone">Machine {String(i + 1).padStart(2, "0")}</span>
                <button onClick={() => remove(m.id)} className="text-muted-foreground hover:text-[#A63D2F]">
                  <Trash2 size={16} strokeWidth={1.5} />
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Machine Name</Label>
                  <Input defaultValue={m.name ?? ""} onBlur={(e) => update(m.id, { name: e.target.value })} />
                </div>
                <div>
                  <Label>Make / Brand</Label>
                  <Input defaultValue={m.brand ?? ""} onBlur={(e) => update(m.id, { brand: e.target.value })} />
                </div>
                <div>
                  <Label>Model Number</Label>
                  <Input defaultValue={m.model ?? ""} onBlur={(e) => update(m.id, { model: e.target.value })} />
                </div>
                <div>
                  <Label>Serial Number</Label>
                  <Input defaultValue={m.serial ?? ""} onBlur={(e) => update(m.id, { serial: e.target.value })} />
                </div>
                <div>
                  <Label>Year of Manufacture</Label>
                  <Input
                    type="number"
                    defaultValue={m.year ?? ""}
                    onBlur={(e) => update(m.id, { year: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
                <div>
                  <Label>Current Condition</Label>
                  <Select
                    defaultValue={m.condition ?? ""}
                    onChange={(e) => update(m.id, { condition: e.target.value })}
                  >
                    <option value="">Select…</option>
                    <option>Good</option>
                    <option>Average</option>
                    <option>Poor</option>
                  </Select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-6">
        <Button variant="secondary" type="button" onClick={add}>
          <Plus size={16} strokeWidth={1.5} /> Add Machine
        </Button>
      </div>
    </div>
  );
}

// === Factory Operations Form Component ===

interface FactoryOperationsCardContentProps {
  data: Record<string, any>;
  patch: (delta: Partial<Record<string, any>>) => void;
  siteId: string;
}

const COMMON_DOWNTIME_REASONS = [
  "Machine Breakdown",
  "Power Failure",
  "Material Shortage",
  "Die / Mould Change",
  "Planned Preventive Maintenance",
  "Setup & Changeover",
  "Tool Breakage / Tool Change",
  "Quality Rejection / Rework",
  "Operator Absence",
  "Electrical Fault",
  "Hydraulic / Pneumatic Failure",
  "Lubrication Issue",
  "Cooling System Failure",
  "PLC / Sensor Fault",
  "Raw Material Quality Issue",
  "Safety Issue / Accident",
  "Shift Changeover",
  "Material Jam / Choking",
  "Vendor / External Delay",
  "Machine Warm-up"
];

function checkShiftOverlap(shifts: any[]): boolean {
  const parsedShifts = (shifts ?? [])
    .filter(s => s && s.startTime && s.endTime)
    .map(s => {
      const [sh, sm] = s.startTime.split(":").map(Number);
      const [eh, em] = s.endTime.split(":").map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      
      if (end <= start) {
        // Crosses midnight
        return [
          { start, end: 1440 },
          { start: 0, end }
        ];
      } else {
        return [{ start, end }];
      }
    });

  for (let i = 0; i < parsedShifts.length; i++) {
    for (let j = i + 1; j < parsedShifts.length; j++) {
      const intervalsI = parsedShifts[i];
      const intervalsJ = parsedShifts[j];
      
      for (const intI of intervalsI) {
        for (const intJ of intervalsJ) {
          const maxStart = Math.max(intI.start, intJ.start);
          const minEnd = Math.min(intI.end, intJ.end);
          if (maxStart < minEnd) {
            return true; // Overlap detected!
          }
        }
      }
    }
  }
  return false;
}

function FactoryOperationsCardContent({ data, patch, siteId }: FactoryOperationsCardContentProps) {
  useEffect(() => {
    if (!siteId) return;
    (async () => {
      const { data: site } = await supabase
        .from("sites")
        .select("name,company_name,address")
        .eq("id", siteId)
        .maybeSingle();
      if (site) {
        const updates: Record<string, any> = {};
        if (!data.factory_op_name) {
          updates.factory_op_name = site.company_name || site.name;
        }
        if (!data.factory_op_address && site.address) {
          updates.factory_op_address = site.address;
        }
        if (Object.keys(updates).length > 0) {
          patch(updates);
        }
      }
    })();
  }, [siteId, data.factory_op_name, data.factory_op_address]);
  // Initialize dynamic lists
  const machines = data.factory_op_machines ?? [""];
  const owners = data.factory_op_owners ?? [{ name: "", email: "", contact: "" }];
  const operators = data.factory_op_operators ?? [{ name: "", email: "", contact: "" }];
  const technicians = data.factory_op_technicians ?? [{ name: "", email: "", contact: "" }];
  const shifts = data.factory_op_shifts ?? [{ name: "", type: "General", startTime: "", endTime: "" }];
  
  // Downtime Reasons
  const downtimeReasons = data.factory_op_downtime_reasons ?? ["Setup & Changeover", "Operator Absence", "Lubrication Issue"];
  const customReasons = data.factory_op_downtime_custom_reasons ?? [];
  const allReasons = [...COMMON_DOWNTIME_REASONS, ...customReasons];

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [customReasonInput, setCustomReasonInput] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  // Overlap status
  const hasOverlap = checkShiftOverlap(shifts);

  const handleMachineChange = (index: number, val: string) => {
    const updated = [...machines];
    updated[index] = val;
    patch({ factory_op_machines: updated });
  };

  const addMachine = () => {
    patch({ factory_op_machines: [...machines, ""] });
  };

  const removeMachine = (index: number) => {
    const updated = machines.filter((_: any, i: number) => i !== index);
    patch({ factory_op_machines: updated.length > 0 ? updated : [""] });
  };

  const handleOwnerChange = (index: number, key: string, val: string) => {
    const updated = [...owners];
    updated[index] = { ...updated[index], [key]: val };
    patch({ factory_op_owners: updated });
  };

  const addOwner = () => {
    patch({ factory_op_owners: [...owners, { name: "", email: "", contact: "" }] });
  };

  const removeOwner = (index: number) => {
    const updated = owners.filter((_: any, i: number) => i !== index);
    patch({ factory_op_owners: updated.length > 0 ? updated : [{ name: "", email: "", contact: "" }] });
  };

  const handleOperatorChange = (index: number, key: string, val: string) => {
    const updated = [...operators];
    updated[index] = { ...updated[index], [key]: val };
    patch({ factory_op_operators: updated });
  };

  const addOperator = () => {
    patch({ factory_op_operators: [...operators, { name: "", email: "", contact: "" }] });
  };

  const removeOperator = (index: number) => {
    const updated = operators.filter((_: any, i: number) => i !== index);
    patch({ factory_op_operators: updated.length > 0 ? updated : [{ name: "", email: "", contact: "" }] });
  };

  const handleTechnicianChange = (index: number, key: string, val: string) => {
    const updated = [...technicians];
    updated[index] = { ...updated[index], [key]: val };
    patch({ factory_op_technicians: updated });
  };

  const addTechnician = () => {
    patch({ factory_op_technicians: [...technicians, { name: "", email: "", contact: "" }] });
  };

  const removeTechnician = (index: number) => {
    const updated = technicians.filter((_: any, i: number) => i !== index);
    patch({ factory_op_technicians: updated.length > 0 ? updated : [{ name: "", email: "", contact: "" }] });
  };

  const handleShiftChange = (index: number, key: string, val: string) => {
    const updated = [...shifts];
    updated[index] = { ...updated[index], [key]: val };
    patch({ factory_op_shifts: updated });
  };

  const addShift = () => {
    patch({ factory_op_shifts: [...shifts, { name: "", type: "General", startTime: "", endTime: "" }] });
  };

  const removeShift = (index: number) => {
    const updated = shifts.filter((_: any, i: number) => i !== index);
    patch({ factory_op_shifts: updated.length > 0 ? updated : [{ name: "", type: "General", startTime: "", endTime: "" }] });
  };

  const toggleReason = (reason: string) => {
    let updated;
    if (downtimeReasons.includes(reason)) {
      updated = downtimeReasons.filter((r: string) => r !== reason);
    } else {
      updated = [...downtimeReasons, reason];
    }
    patch({ factory_op_downtime_reasons: updated });
  };

  const addCustomReason = () => {
    if (!customReasonInput.trim()) return;
    const val = customReasonInput.trim();
    if (!customReasons.includes(val)) {
      const nextCustom = [...customReasons, val];
      const nextReasons = [...downtimeReasons, val];
      patch({
        factory_op_downtime_custom_reasons: nextCustom,
        factory_op_downtime_reasons: nextReasons
      });
    }
    setCustomReasonInput("");
    setShowCustomInput(false);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* A. Factory Details */}
      <div className="space-y-4">
        <div className="font-mono text-[11px] font-bold text-lime uppercase tracking-widest border-b border-border pb-1">
          Factory Details
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Factory Name</Label>
            <Input
              value={data.factory_op_name ?? ""}
              onChange={(e) => patch({ factory_op_name: e.target.value })}
              placeholder="Enter Factory Name"
            />
          </div>
          <div>
            <Label>Full Address</Label>
            <Textarea
              rows={2}
              value={data.factory_op_address ?? ""}
              onChange={(e) => patch({ factory_op_address: e.target.value })}
              placeholder="Enter Full Address"
            />
          </div>
        </div>
        <div className="space-y-2 mt-2">
          <Label>Machine Names</Label>
          {machines.map((m: string, i: number) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                value={m}
                onChange={(e) => handleMachineChange(i, e.target.value)}
                placeholder={`Machine Name ${i + 1}`}
                className="flex-1"
              />
              {machines.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMachine(i)}
                  className="text-text-secondary hover:text-coral transition-colors p-1"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
          <div className="mt-1">
            <Button
              type="button"
              variant="secondary"
              className="py-1 px-3 text-xs"
              onClick={addMachine}
            >
              <Plus size={12} /> Add Machine Name
            </Button>
          </div>
        </div>
      </div>

      {/* B. Owner Information */}
      <div className="space-y-4">
        <div className="font-mono text-[11px] font-bold text-lime uppercase tracking-widest border-b border-border pb-1">
          Owner Information
        </div>
        {owners.map((owner: any, i: number) => (
          <div key={i} className="p-4 border border-border rounded-[8px] bg-surface-raised/10 space-y-3 relative">
            <div className="flex justify-between items-center">
              <span className="font-mono text-[10px] text-text-secondary">Owner {i + 1}</span>
              {owners.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeOwner(i)}
                  className="text-text-secondary hover:text-coral transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label>Owner Name</Label>
                <Input
                  value={owner.name ?? ""}
                  onChange={(e) => handleOwnerChange(i, "name", e.target.value)}
                  placeholder="Name"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={owner.email ?? ""}
                  onChange={(e) => handleOwnerChange(i, "email", e.target.value)}
                  placeholder="Email"
                />
              </div>
              <div>
                <Label>Contact No</Label>
                <Input
                  type="tel"
                  value={owner.contact ?? ""}
                  onChange={(e) => handleOwnerChange(i, "contact", e.target.value)}
                  placeholder="Contact Number"
                />
              </div>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="py-1.5 px-4 text-xs"
          onClick={addOwner}
        >
          <Plus size={14} /> Add Owner
        </Button>
      </div>

      {/* C. Operator Detail */}
      <div className="space-y-4">
        <div className="font-mono text-[11px] font-bold text-lime uppercase tracking-widest border-b border-border pb-1">
          Operator Details
        </div>
        {operators.map((op: any, i: number) => (
          <div key={i} className="p-4 border border-border rounded-[8px] bg-surface-raised/10 space-y-3 relative">
            <div className="flex justify-between items-center">
              <span className="font-mono text-[10px] text-text-secondary">Operator {i + 1}</span>
              {operators.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeOperator(i)}
                  className="text-text-secondary hover:text-coral transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label>Operator Name</Label>
                <Input
                  value={op.name ?? ""}
                  onChange={(e) => handleOperatorChange(i, "name", e.target.value)}
                  placeholder="Name"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={op.email ?? ""}
                  onChange={(e) => handleOperatorChange(i, "email", e.target.value)}
                  placeholder="Email"
                />
              </div>
              <div>
                <Label>Contact No</Label>
                <Input
                  type="tel"
                  value={op.contact ?? ""}
                  onChange={(e) => handleOperatorChange(i, "contact", e.target.value)}
                  placeholder="Contact Number"
                />
              </div>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="py-1.5 px-4 text-xs"
          onClick={addOperator}
        >
          <Plus size={14} /> Add Operator
        </Button>
      </div>

      {/* D. Technician Contact */}
      <div className="space-y-4">
        <div className="font-mono text-[11px] font-bold text-lime uppercase tracking-widest border-b border-border pb-1">
          Technician Contacts
        </div>
        {technicians.map((tech: any, i: number) => (
          <div key={i} className="p-4 border border-border rounded-[8px] bg-surface-raised/10 space-y-3 relative">
            <div className="flex justify-between items-center">
              <span className="font-mono text-[10px] text-text-secondary">Technician {i + 1}</span>
              {technicians.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeTechnician(i)}
                  className="text-text-secondary hover:text-coral transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label>Technician Name</Label>
                <Input
                  value={tech.name ?? ""}
                  onChange={(e) => handleTechnicianChange(i, "name", e.target.value)}
                  placeholder="Name"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={tech.email ?? ""}
                  onChange={(e) => handleTechnicianChange(i, "email", e.target.value)}
                  placeholder="Email"
                />
              </div>
              <div>
                <Label>Contact No</Label>
                <Input
                  type="tel"
                  value={tech.contact ?? ""}
                  onChange={(e) => handleTechnicianChange(i, "contact", e.target.value)}
                  placeholder="Contact Number"
                />
              </div>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="py-1.5 px-4 text-xs"
          onClick={addTechnician}
        >
          <Plus size={14} /> Add Technician
        </Button>
      </div>

      {/* E. Shift Panel */}
      <div className="space-y-4">
        <div className="font-mono text-[11px] font-bold text-lime uppercase tracking-widest border-b border-border pb-1">
          Shift Panel
        </div>
        {hasOverlap && (
          <div className="flex items-center gap-2 p-3 bg-coral-dim border border-coral/30 rounded-[6px] text-coral text-xs">
            <AlertTriangle size={15} className="shrink-0" />
            <span>Shift timings overlap or collide. Please check your start and end times.</span>
          </div>
        )}
        {shifts.map((shift: any, i: number) => (
          <div key={i} className="p-4 border border-border rounded-[8px] bg-surface-raised/10 space-y-3 relative">
            <div className="flex justify-between items-center">
              <span className="font-mono text-[10px] text-text-secondary">Shift {i + 1}</span>
              {shifts.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeShift(i)}
                  className="text-text-secondary hover:text-coral transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <Label>Shift Name</Label>
                <Input
                  value={shift.name ?? ""}
                  onChange={(e) => handleShiftChange(i, "name", e.target.value)}
                  placeholder="e.g. Day Shift"
                />
              </div>
              <div>
                <Label>Shift Type</Label>
                <Select
                  value={shift.type ?? "General"}
                  onChange={(e) => handleShiftChange(i, "type", e.target.value)}
                >
                  <option value="Morning">Morning</option>
                  <option value="Night">Night</option>
                  <option value="Afternoon">Afternoon</option>
                  <option value="General">General</option>
                  <option value="Rotation">Rotation</option>
                </Select>
              </div>
              <div>
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={shift.startTime ?? ""}
                  onChange={(e) => handleShiftChange(i, "startTime", e.target.value)}
                />
              </div>
              <div>
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={shift.endTime ?? ""}
                  onChange={(e) => handleShiftChange(i, "endTime", e.target.value)}
                />
              </div>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="py-1.5 px-4 text-xs"
          onClick={addShift}
        >
          <Plus size={14} /> Add Shift
        </Button>
      </div>

      {/* F. Downtime Reason Selection */}
      <div className="space-y-4">
        <div className="font-mono text-[11px] font-bold text-lime uppercase tracking-widest border-b border-border pb-1">
          Downtime Reason Selection
        </div>
        <div className="space-y-3">
          <Label>Common Reasons (Select all that apply)</Label>
          <div className="flex flex-wrap gap-2 py-1">
            {allReasons.map((reason: string) => {
              const isChecked = downtimeReasons.includes(reason);
              return (
                <button
                  key={reason}
                  type="button"
                  onClick={() => toggleReason(reason)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border text-xs font-mono font-medium transition-all duration-150 ${
                    isChecked
                      ? "border-lime bg-lime-dim/40 text-lime"
                      : "border-border hover:border-border-bright text-text-secondary bg-surface-raised/20"
                  }`}
                >
                  {isChecked && <span className="h-1.5 w-1.5 rounded-full bg-lime" />}
                  <span>{reason}</span>
                </button>
              );
            })}
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <div className="flex-1">
              {showCustomInput ? (
                <div className="flex gap-2 max-w-md">
                  <Input
                    value={customReasonInput}
                    onChange={(e) => setCustomReasonInput(e.target.value)}
                    placeholder="Enter custom downtime reason"
                    className="text-xs"
                  />
                  <Button
                    type="button"
                    className="py-1 px-3 text-xs"
                    onClick={addCustomReason}
                  >
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="py-1 px-2 text-xs"
                    onClick={() => {
                      setShowCustomInput(false);
                      setCustomReasonInput("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  className="py-1 px-3 text-xs"
                  onClick={() => setShowCustomInput(true)}
                >
                  <Plus size={12} /> Custom Add Downtime Reason
                </Button>
              )}
            </div>
            
            <div className="w-full sm:w-64">
              <Label>Ideal Threshold Time (Minutes)</Label>
              <Input
                type="number"
                value={data.factory_op_downtime_threshold ?? ""}
                onChange={(e) => patch({ factory_op_downtime_threshold: e.target.value ? Number(e.target.value) : "" })}
                placeholder="e.g. 15"
              />
            </div>
          </div>
        </div>
      </div>

      {/* G. Electricity Board Radio Group */}
      <div className="space-y-3">
        <div className="font-mono text-[11px] font-bold text-lime uppercase tracking-widest border-b border-border pb-1">
          Electricity Board
        </div>
        <div className="flex flex-wrap gap-4 py-1">
          {["PGVCL", "UGVCL", "MGVCL", "Torrent", "DGVCL"].map((board) => {
            const isChecked = (data.factory_op_electricity_board ?? "") === board;
            return (
              <label
                key={board}
                className={`flex items-center gap-2 cursor-pointer select-none py-1.5 px-4 rounded-[6px] border text-xs font-mono font-bold transition-all duration-150 ${
                  isChecked
                    ? "border-lime bg-lime-dim/50 text-lime"
                    : "border-border hover:border-border-bright text-text-secondary"
                }`}
              >
                <input
                  type="radio"
                  name="electricity_board"
                  value={board}
                  checked={isChecked}
                  onChange={() => patch({ factory_op_electricity_board: board })}
                  className="sr-only"
                />
                <span className={`inline-block h-3.5 w-3.5 rounded-full border-2 transition-all flex items-center justify-center ${
                  isChecked ? "border-lime bg-lime" : "border-text-dim"
                }`}>
                  {isChecked && <span className="h-1.5 w-1.5 rounded-full bg-bg" />}
                </span>
                <span>{board}</span>
              </label>
            );
          })}
        </div>
      </div>


      {/* H. Business Profile Details */}
      <div className="space-y-6 bg-surface-raised/40 backdrop-blur-md border border-border/80 rounded-2xl p-6 shadow-sm relative overflow-hidden transition-all duration-300 hover:border-lime/40">
        <div className="flex items-center gap-3 border-b border-border/80 pb-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-lime-dim/50 border border-lime/20 text-lime">
            <Building2 size={16} />
          </div>
          <div className="flex-1">
            <h4 className="font-syne text-[14px] font-extrabold uppercase tracking-wider text-text-primary">
              Business Profile Details
            </h4>
            <p className="text-[10px] text-text-secondary font-mono tracking-normal mt-0.5">
              Configure machine type specification and parameters
            </p>
          </div>
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-lime/40 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-lime"></span>
          </span>
        </div>

        <div className="bg-surface/50 border border-border/60 rounded-xl p-4">
          <Label className="text-[9px] text-text-secondary tracking-widest uppercase font-bold mb-1.5 block">Select Company / Machine Type</Label>
          <div className="relative">
            <Select
              value={data.company_type ?? ""}
              onChange={(e) => patch({ company_type: e.target.value })}
              className="w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:border-lime focus:ring-1 focus:ring-lime/20 transition-all font-sans"
            >
              <option value="">Select Type...</option>
              <option value="Runtime Machine">Runtime Machine (Time-based Tracking)</option>
              <option value="Length-based Machine">Length-based Machine (Continuous Extruder)</option>
            </Select>
          </div>
        </div>

        {data.company_type === "Runtime Machine" && (
          <div className="space-y-6 pt-4 border-t border-border/60 animate-in fade-in duration-200">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="bg-surface/30 border border-border/40 rounded-xl p-4 space-y-2 hover:border-lime/30 transition-all">
                <Label className="text-[9px] text-lime font-bold font-mono tracking-wider block">Expected daily run (hours)</Label>
                <Input
                  type="number"
                  value={data.expected_daily_run_hours ?? ""}
                  onChange={(e) => patch({ expected_daily_run_hours: e.target.value ? Number(e.target.value) : "" })}
                  placeholder="e.g. 9"
                  className="bg-transparent border-0 border-b border-border/80 focus:border-lime focus:ring-0 rounded-none text-base font-semibold py-1 px-0 w-full"
                />
              </div>
              <div className="bg-surface/30 border border-border/40 rounded-xl p-4 space-y-2 hover:border-lime/30 transition-all">
                <Label className="text-[9px] text-lime font-bold font-mono tracking-wider block">Expected runtime / day (min)</Label>
                <Input
                  type="number"
                  value={data.expected_runtime_day_min ?? ""}
                  onChange={(e) => patch({ expected_runtime_day_min: e.target.value ? Number(e.target.value) : "" })}
                  placeholder="540"
                  className="bg-transparent border-0 border-b border-border/80 focus:border-lime focus:ring-0 rounded-none text-base font-semibold py-1 px-0 w-full"
                />
                <p className="text-[9px] text-text-secondary mt-1">Typical productive runtime per day</p>
              </div>
              <div className="bg-surface/30 border border-border/40 rounded-xl p-4 space-y-2 hover:border-lime/30 transition-all">
                <Label className="text-[9px] text-lime font-bold font-mono tracking-wider block">Minimum stop duration (min)</Label>
                <Input
                  type="number"
                  value={data.expected_daily_run_hours && data.expected_runtime_day_min ? data.minimum_stop_duration_min ?? "" : data.minimum_stop_duration_min ?? ""}
                  onChange={(e) => patch({ minimum_stop_duration_min: e.target.value ? Number(e.target.value) : "" })}
                  placeholder="5"
                  className="bg-transparent border-0 border-b border-border/80 focus:border-lime focus:ring-0 rounded-none text-base font-semibold py-1 px-0 w-full"
                />
                <p className="text-[9px] text-text-secondary mt-1">Stops shorter than this are ignored</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                onClick={() => patch({ production_count_meaningful: !data.production_count_meaningful })}
                className={`flex items-center gap-3 p-4 rounded-xl border transition-all cursor-pointer select-none ${
                  data.production_count_meaningful
                    ? "border-lime bg-lime-dim/10 text-text-primary shadow-[0_0_12px_rgba(200,255,74,0.05)]"
                    : "border-border/60 bg-surface/20 text-text-secondary hover:border-border-bright"
                }`}
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                  data.production_count_meaningful
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-text-dim"
                }`}>
                  {data.production_count_meaningful && <Check size={11} strokeWidth={3} />}
                </div>
                <div className="flex-1">
                  <span className="text-xs font-semibold block font-sans">Production count is meaningful</span>
                  <span className="text-[9px] text-text-dim block mt-0.5">Toggle if OEE production count applies.</span>
                </div>
              </div>

              <div
                onClick={() => patch({ vibration_monitoring_relevant: !data.vibration_monitoring_relevant })}
                className={`flex items-center gap-3 p-4 rounded-xl border transition-all cursor-pointer select-none ${
                  data.vibration_monitoring_relevant
                    ? "border-lime bg-lime-dim/10 text-text-primary shadow-[0_0_12px_rgba(200,255,74,0.05)]"
                    : "border-border/60 bg-surface/20 text-text-secondary hover:border-border-bright"
                }`}
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                  data.vibration_monitoring_relevant
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-text-dim"
                }`}>
                  {data.vibration_monitoring_relevant && <Check size={11} strokeWidth={3} />}
                </div>
                <div className="flex-1">
                  <span className="text-xs font-semibold block font-sans">Vibration monitoring relevant</span>
                  <span className="text-[9px] text-text-dim block mt-0.5">Toggle for hardware vibration sensors.</span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-[10px] uppercase tracking-widest text-text-secondary">Machine Classification</Label>
              <div className="bg-surface/40 p-1.5 border border-border/85 rounded-xl flex flex-wrap gap-1 w-full md:w-auto">
                {["Production", "Utility", "Auxiliary", "Support"].map((type) => {
                  const isActive = (data.machine_usage_type ?? "Production") === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => patch({ machine_usage_type: type })}
                      className={`flex-1 md:flex-none px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 cursor-pointer ${
                        isActive
                          ? "bg-lime text-primary-foreground font-bold shadow-sm"
                          : "text-text-secondary hover:text-text-primary hover:bg-surface-raised/40"
                      }`}
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-text-secondary italic">
                Current Selection: {data.machine_usage_type ?? "Production"} — {
                  {
                    Production: "Makes units (OEE applies)",
                    Utility: "Compressor, pump, etc.",
                    Auxiliary: "Conveyor, mixer, support equip.",
                    Support: "AC, lighting, non-operating",
                  }[data.machine_usage_type ?? "Production"]
                }
              </p>
            </div>
          </div>
        )}

        {data.company_type === "Length-based Machine" && (
          <div className="space-y-6 pt-4 border-t border-border/60 animate-in fade-in duration-200">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="bg-surface/30 border border-border/40 rounded-xl p-4 space-y-2 hover:border-lime/30 transition-all">
                <Label className="text-[9px] text-lime font-bold font-mono tracking-wider block">Expected meters / shift * (m)</Label>
                <Input
                  type="number"
                  value={data.expected_meters_shift ?? ""}
                  onChange={(e) => patch({ expected_meters_shift: e.target.value ? Number(e.target.value) : "" })}
                  placeholder="Target meters per shift"
                  className="bg-transparent border-0 border-b border-border/80 focus:border-lime focus:ring-0 rounded-none text-base font-semibold py-1 px-0 w-full"
                />
                <p className="text-[9px] text-text-secondary mt-1">Target meters this machine should produce per shift.</p>
              </div>
              <div className="bg-surface/30 border border-border/40 rounded-xl p-4 space-y-2 hover:border-lime/30 transition-all">
                <Label className="text-[9px] text-lime font-bold font-mono tracking-wider block">Target line speed * (mpm)</Label>
                <Input
                  type="number"
                  value={data.target_line_speed ?? ""}
                  onChange={(e) => patch({ target_line_speed: e.target.value ? Number(e.target.value) : "" })}
                  placeholder="Ideal speed in mpm"
                  className="bg-transparent border-0 border-b border-border/80 focus:border-lime focus:ring-0 rounded-none text-base font-semibold py-1 px-0 w-full"
                />
                <p className="text-[9px] text-text-secondary mt-1">Ideal speed in meters per minute.</p>
              </div>
              <div className="bg-surface/30 border border-border/40 rounded-xl p-4 space-y-2 hover:border-lime/30 transition-all">
                <Label className="text-[9px] text-lime font-bold font-mono tracking-wider block">Minimum acceptable speed (mpm)</Label>
                <Input
                  type="number"
                  value={data.minimum_acceptable_speed ?? ""}
                  onChange={(e) => patch({ minimum_acceptable_speed: e.target.value ? Number(e.target.value) : "" })}
                  placeholder="Below this MPM is treated as idle/slow"
                  className="bg-transparent border-0 border-b border-border/80 focus:border-lime focus:ring-0 rounded-none text-base font-semibold py-1 px-0 w-full"
                />
                <p className="text-[9px] text-text-secondary mt-1">Below this speed the machine is considered idle.</p>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-[10px] uppercase tracking-widest text-text-secondary">Machine Classification</Label>
              <div className="bg-surface/40 p-1.5 border border-border/85 rounded-xl flex flex-wrap gap-1 w-full md:w-auto">
                {["Production", "Utility", "Auxiliary", "Support"].map((type) => {
                  const isActive = (data.machine_usage_type ?? "Production") === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => patch({ machine_usage_type: type })}
                      className={`flex-1 md:flex-none px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 cursor-pointer ${
                        isActive
                          ? "bg-lime text-primary-foreground font-bold shadow-sm"
                          : "text-text-secondary hover:text-text-primary hover:bg-surface-raised/40"
                      }`}
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-text-secondary italic">
                Current Selection: {data.machine_usage_type ?? "Production"} — {
                  {
                    Production: "Makes units (OEE applies)",
                    Utility: "Compressor, pump, etc.",
                    Auxiliary: "Conveyor, mixer, support equip.",
                    Support: "AC, lighting, non-operating",
                  }[data.machine_usage_type ?? "Production"]
                }
              </p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

