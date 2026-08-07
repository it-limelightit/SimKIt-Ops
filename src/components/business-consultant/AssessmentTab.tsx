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
import { Plus, Trash2, Users, Wrench, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

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
    "Factory Call": true,
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

      {/* 1. Factory Call */}
      {shouldShow("Factory Call") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">01</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Factory Call")}>
            <SectionTitle num={1}>Factory Call</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Factory Call"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>
          
          {expandedSections["Factory Call"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-secondary">Factory call phase details and confirmation</span>
                <Badge tone={data.factory_call_done ? "success" : "warning"}>
                  {data.factory_call_done ? "Done" : "Pending"}
                </Badge>
              </div>
              {data.factory_call_done && (
                <div className="mt-5">
                  <Label>Completed at</Label>
                  <Input
                    type="datetime-local"
                    defaultValue={toLocalInput(data.factory_call_at)}
                    onBlur={(e) => patch({ factory_call_at: fromLocalInput(e.target.value) })}
                  />
                </div>
              )}
              {renderCustomFields("Factory Call")}
              <CompleteJobRow
                checked={!!data.factory_call_done}
                onToggle={() => {
                  const v = !data.factory_call_done;
                  patch({ factory_call_done: v, factory_call_at: v ? data.factory_call_at ?? nowIso() : null });
                }}
              />
            </div>
          )}
        </Card>
      )}

      {/* 2. Assessor Call */}
      {shouldShow("Third Party Call") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">02</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Third Party Call")}>
            <SectionTitle num={2}>Assessor Call</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Third Party Call"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Third Party Call"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              {renderCustomFields("Third Party Call")}
              <CompleteJobRow
                checked={!!data.third_party_call_done}
                onToggle={() => {
                  const v = !data.third_party_call_done;
                  patch({ third_party_call_done: v, third_party_call_at: v ? nowIso() : null });
                }}
              />
            </div>
          )}
        </Card>
      )}

      {/* 3. Appointment */}
      {shouldShow("Appointment") && (
        <Card key={siteDetails ? "loaded" : "loading"} className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">03</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Appointment")}>
            <SectionTitle num={3}>Book Appointment</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Appointment"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Appointment"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              {renderCustomFields("Appointment", !!data.appointment_saved)}
              <CompleteJobRow
                checked={!!data.appointment_saved}
                onToggle={() => patch({ appointment_saved: !data.appointment_saved })}
              />
            </div>
          )}
        </Card>
      )}

      {/* 4. Facility Visit */}
      {shouldShow("Facility Visit") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">04</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Facility Visit")}>
            <SectionTitle num={4}>Facility Visit</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Facility Visit"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Facility Visit"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              {data.facility_visit_done && (
                <div className="mb-5 grid grid-cols-2 gap-4">
                  <div>
                    <Label>Visited at</Label>
                    <Input
                      type="datetime-local"
                      defaultValue={toLocalInput(data.facility_visit_at)}
                      onBlur={(e) => patch({ facility_visit_at: fromLocalInput(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label>Visited by</Label>
                    <Input value={data.facility_visited_by ?? profile?.name ?? ""} readOnly />
                  </div>
                </div>
              )}
              {renderCustomFields("Facility Visit")}
              <CompleteJobRow
                checked={!!data.facility_visit_done}
                onToggle={() =>
                  patch({
                    facility_visit_done: !data.facility_visit_done,
                    facility_visit_at: !data.facility_visit_done ? data.facility_visit_at ?? nowIso() : null,
                    facility_visited_by: !data.facility_visit_done ? profile?.name ?? "" : null,
                  })
                }
              />
            </div>
          )}
        </Card>
      )}

      {/* 5. Explanation */}
      {shouldShow("Explanation") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">05</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Explanation")}>
            <SectionTitle num={5}>Explanation</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Explanation"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Explanation"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <Label>Explanation Notes <span className="text-[#A63D2F] ml-0.5">*</span></Label>
              <Textarea
                rows={6}
                defaultValue={data.explanation_notes ?? ""}
                onBlur={(e) => patch({ explanation_notes: e.target.value })}
                disabled={!!data.explanation_saved}
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="font-mono text-[10px] text-text-secondary">
                  {(data.explanation_notes ?? "").length} characters
                </span>
                {data.explanation_saved ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => save({ ...data, explanation_saved: false })}
                  >
                    Edit Explanation
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => {
                      if (!data.explanation_notes?.trim()) {
                        toast.error("Please fill in Explanation Notes.");
                        return;
                      }
                      save({ ...data, explanation_saved: true });
                    }}
                  >
                    Save Explanation
                  </Button>
                )}
              </div>
              {renderCustomFields("Explanation", !!data.explanation_saved)}
              <CompleteJobRow
                checked={!!data.explanation_saved}
                onToggle={() => {
                  if (!data.explanation_saved && !data.explanation_notes?.trim()) {
                    toast.error("Please fill in Explanation Notes first.");
                    return;
                  }
                  patch({ explanation_saved: !data.explanation_saved });
                }}
              />
            </div>
          )}
        </Card>
      )}

      {/* 6. Contacts */}
      {shouldShow("Contacts") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">06</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Contacts")}>
            <SectionTitle num={6}>Contact Numbers</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Contacts"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>
          {expandedSections["Contacts"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <ContactsCardContent siteId={siteId} onChange={(n) => patch({ contacts_done: n > 0 })} />
              <CompleteJobRow
                checked={!!data.contacts_done}
                onToggle={() => patch({ contacts_done: !data.contacts_done })}
              />
            </div>
          )}
        </Card>
      )}

      {/* 7. Floor Visit */}
      {shouldShow("Floor Visit") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">07</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Floor Visit")}>
            <SectionTitle num={7}>Floor Visit with Machine Photos</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Floor Visit"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Floor Visit"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <div className="mt-6">
                <MediaUploader siteId={siteId} phase="assessment" section="floor-visit" />
              </div>
              {renderCustomFields("Floor Visit")}
              <CompleteJobRow
                checked={!!data.floor_visit_done}
                onToggle={() => patch({ floor_visit_done: !data.floor_visit_done })}
                validate={() => validateSectionLinks("Floor Visit", ["floor-visit"])}
              />
            </div>
          )}
        </Card>
      )}

      {/* 8. Business Profile */}
      {shouldShow("Business Profile") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">08</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Business Profile")}>
            <SectionTitle num={8}>Business Profile</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Business Profile"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Business Profile"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <Label>Business Name</Label>
                  <Input
                    defaultValue={data.biz_name ?? ""}
                    onBlur={(e) => patch({ biz_name: e.target.value })}
                    disabled={!!data.business_profile_saved}
                  />
                </div>
                <div>
                  <Label>Industry Type</Label>
                  <Select
                    defaultValue={data.biz_industry ?? ""}
                    onBlur={(e) => patch({ biz_industry: e.target.value })}
                    onChange={(e) => patch({ biz_industry: e.target.value })}
                    disabled={!!data.business_profile_saved}
                  >
                    <option value="">Select…</option>
                    {["Manufacturing", "Textile", "Chemical", "Food Processing", "Other"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>GST Number</Label>
                  <Input
                    defaultValue={data.biz_gst ?? ""}
                    onBlur={(e) => patch({ biz_gst: e.target.value })}
                    disabled={!!data.business_profile_saved}
                  />
                </div>
                <div>
                  <Label>Primary Contact Name</Label>
                  <Input
                    defaultValue={data.biz_contact_name ?? ""}
                    onBlur={(e) => patch({ biz_contact_name: e.target.value })}
                    disabled={!!data.business_profile_saved}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Address</Label>
                  <Textarea
                    rows={2}
                    defaultValue={data.biz_address ?? ""}
                    onBlur={(e) => patch({ biz_address: e.target.value })}
                    disabled={!!data.business_profile_saved}
                  />
                </div>
                <div>
                  <Label>City</Label>
                  <Input
                    defaultValue={data.biz_city ?? ""}
                    onBlur={(e) => patch({ biz_city: e.target.value })}
                    disabled={!!data.business_profile_saved}
                  />
                </div>
                <div>
                  <Label>State</Label>
                  <Input
                    defaultValue={data.biz_state ?? ""}
                    onBlur={(e) => patch({ biz_state: e.target.value })}
                    disabled={!!data.business_profile_saved}
                  />
                </div>
                <div>
                  <Label>PIN</Label>
                  <Input
                    defaultValue={data.biz_pin ?? ""}
                    onBlur={(e) => patch({ biz_pin: e.target.value })}
                    disabled={!!data.business_profile_saved}
                  />
                </div>
                <div>
                  <Label>Primary Contact Number</Label>
                  <Input
                    defaultValue={data.biz_contact_mobile ?? ""}
                    onBlur={(e) => patch({ biz_contact_mobile: e.target.value })}
                    disabled={!!data.business_profile_saved}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                {data.business_profile_saved ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => save({ ...data, business_profile_saved: false })}
                  >
                    Edit Business Profile
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => save({ ...data, business_profile_saved: true })}
                  >
                    Save Business Profile
                  </Button>
                )}
              </div>
              <CompleteJobRow
                checked={!!data.business_profile_saved}
                onToggle={() => patch({ business_profile_saved: !data.business_profile_saved })}
              />
              {renderCustomFields("Business Profile", !!data.business_profile_saved)}
            </div>
          )}
        </Card>
      )}

      {/* 9. Machines */}
      {shouldShow("Machines") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">09</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Machines")}>
            <SectionTitle num={9}>Machine Details</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Machines"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>
          {expandedSections["Machines"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <MachinesCardContent siteId={siteId} onChange={(n) => patch({ machines_done: n > 0 })} />
              {renderCustomFields("Machines")}
              <CompleteJobRow
                checked={!!data.machines_done}
                onToggle={() => patch({ machines_done: !data.machines_done })}
              />
            </div>
          )}
        </Card>
      )}

      {/* 10. MOM */}
      {shouldShow("MOM") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">10</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("MOM")}>
            <SectionTitle num={10}>MOM (Minutes of Meeting)</SectionTitle>
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

      {/* 11. Photos & Videos */}
      {shouldShow("Media") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">11</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Media")}>
            <SectionTitle num={11}>Photos &amp; Videos</SectionTitle>
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

      {/* 12. Factory Operations Form */}
      {shouldShow("Factory Operations") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">12</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Factory Operations")}>
            <SectionTitle num={12}>Factory Operations Form</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Factory Operations"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Factory Operations"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <FactoryOperationsCardContent data={data} patch={patch} />
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
            if (shouldShow("Third Party Call") && !data.third_party_call_done) {
              toast.error("Please complete the Assessor Call section.");
              return;
            }

            if (shouldShow("Explanation") && !data.explanation_notes?.trim()) {
              toast.error("Please fill in Explanation Notes.");
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

function FactoryOperationsCardContent({ data, patch }: FactoryOperationsCardContentProps) {
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

      {/* H. Business Profile Header */}
      <div className="pt-6 border-t border-border text-center">
        <h4 className="font-syne text-[15px] font-extrabold uppercase tracking-widest text-text-secondary">
          Business Profile
        </h4>
      </div>
    </div>
  );
}

