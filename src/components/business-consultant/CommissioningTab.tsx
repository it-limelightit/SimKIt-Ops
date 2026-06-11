import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  SectionTitle,
  Select,
  Textarea,
  CompleteJobRow,
} from "@/components/ui-kit";
import { toast } from "sonner";
import { MediaUploader } from "@/components/MediaUploader";
import { usePhaseData } from "@/lib/use-phase-data";
import { advanceSiteVisitStatus } from "@/lib/site-metadata";

type Props = { siteId: string; workerId: string; hiddenSections?: string[]; onSubmit?: () => void };

export function CommissioningTab({ siteId, workerId, hiddenSections, onSubmit }: Props) {
  const { data, patch, save, loaded, lastSaved, saving } = usePhaseData<Record<string, any>>(
    "commissioning",
    siteId,
    workerId,
    {},
  );
  const validateSectionLinks = async (sectionName: string, defaultSectionKeys: string[]) => {
    for (const key of defaultSectionKeys) {
      const { data: mediaRows } = await supabase
        .from("media")
        .select("file_path")
        .eq("site_id", siteId)
        .eq("phase", "commissioning")
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
        .eq("phase", "commissioning")
        .eq("section", `custom-${f.id}`);
      const hasLink = mediaRows?.some(r => r.file_path && r.file_path.trim().startsWith("http"));
      if (!hasLink) {
        toast.error(`Please paste a valid link for custom field "${f.label}" first.`);
        return false;
      }
    }
    return true;
  };

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    "Coordination": true,
  });

  const toggleSection = (name: string) => {
    setExpandedSections(prev => {
      const isExpanding = !prev[name];
      return isExpanding ? { [name]: true } : {};
    });
  };

  const [customFields, setCustomFields] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data: fields } = await supabase
        .from("custom_fields")
        .select("*")
        .eq("phase", "commissioning");
      const filtered = (fields ?? []).filter((f: any) => {
        const wId = f.options?.worker_id;
        return !wId || wId === "all" || wId === workerId;
      });
      setCustomFields(filtered);
    })();
  }, [workerId]);

  if (!loaded) return null;
  const nowIso = () => new Date().toISOString();
  const onDone = (key: string) => (v: boolean) =>
    patch({ [key]: v, [`${key}_at`]: v ? data[`${key}_at`] ?? nowIso() : null });

  const shouldShow = (secName: string) => !hiddenSections?.includes(secName);

  const steps: { num: number; key: string; title: string; photo?: boolean; notesKey?: string; notesLabel?: string }[] = [
    { num: 1, key: "coordination_done", title: "Coordination" },
    { num: 2, key: "visit_done", title: "Visit", photo: true },
    { num: 3, key: "connection_done", title: "Connection", photo: true },
    {
      num: 4,
      key: "configure_done",
      title: "Configure Hardware & Software",
      photo: true,
      notesKey: "configure_notes",
      notesLabel: "Configuration details (firmware version, parameters)",
    },
    {
      num: 5,
      key: "testing_done",
      title: "Testing",
      photo: true,
      notesKey: "testing_notes",
      notesLabel: "Test results",
    },
  ];

  const sectionMapping: Record<string, string> = {
    coordination_done: "Coordination",
    visit_done: "Visit",
    connection_done: "Connection",
    configure_done: "Configure",
    testing_done: "Testing",
  };

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
                  phase="commissioning"
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
          <span className="text-text-dim">Auto-save on</span>
        )}
      </div>
      
      {steps.map((s) => {
        const secName = sectionMapping[s.key] || s.title;
        if (!shouldShow(secName)) return null;
        return (
          <Card key={s.key} className="border-l-[3px] border-lime relative">
            <div className="section-number-ghost">{String(s.num).padStart(2, "0")}</div>
            <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection(secName)}>
              <SectionTitle num={s.num}>{s.title}</SectionTitle>
              <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
                {expandedSections[secName] ? "COLLAPSE ▲" : "EXPAND ▼"}
              </span>
            </div>

            {expandedSections[secName] && (
              <div className="mt-6 space-y-6 animate-in fade-in duration-200">
                {s.notesKey && (
                  <div className="mt-5">
                    <Label>{s.notesLabel}</Label>
                    <Textarea
                      rows={3}
                      defaultValue={data[s.notesKey] ?? ""}
                      onBlur={(e) => patch({ [s.notesKey!]: e.target.value })}
                    />
                  </div>
                )}
                {s.photo && (
                  <div className="mt-5">
                    <MediaUploader siteId={siteId} phase="commissioning" section={s.key.replace("_done", "")} />
                  </div>
                )}
                {renderCustomFields(secName)}
                <CompleteJobRow
                  checked={!!data[s.key]}
                  onToggle={() => onDone(s.key)(!data[s.key])}
                  validate={() => validateSectionLinks(secName, s.photo ? [s.key.replace("_done", "")] : [])}
                />
              </div>
            )}
          </Card>
        );
      })}

      {shouldShow("Screenshots") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">06</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Screenshots")}>
            <SectionTitle num={6}>Screenshots &amp; Photos</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Screenshots"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Screenshots"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <MediaUploader siteId={siteId} phase="commissioning" section="screenshots" />
              {renderCustomFields("Screenshots")}
              <CompleteJobRow
                checked={!!data.screenshots_uploaded}
                onToggle={() => patch({ screenshots_uploaded: !data.screenshots_uploaded })}
                validate={() => validateSectionLinks("Screenshots", ["screenshots"])}
              />
            </div>
          )}
        </Card>
      )}

      {shouldShow("Certificate") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">07</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Certificate")}>
            <SectionTitle num={7}>Completion Certificate</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Certificate"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Certificate"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <div className="space-y-6">
                <div>
                  <Label>Date</Label>
                  <Input
                    type="date"
                    defaultValue={data.certificate_sent_at ? data.certificate_sent_at.slice(0, 10) : ""}
                    onBlur={(e) =>
                      patch({ certificate_sent_at: e.target.value ? new Date(e.target.value).toISOString() : null })
                    }
                  />
                </div>
                <div>
                  <Label>Certificate Photo / PDF</Label>
                  <div className="mt-2">
                    <MediaUploader
                      siteId={siteId}
                      phase="commissioning"
                      section="certificate"
                    />
                  </div>
                </div>
                {data.certificate_sent_at && (
                  <Badge tone="success">Recorded · {new Date(data.certificate_sent_at).toLocaleDateString()}</Badge>
                )}
              </div>
              {renderCustomFields("Certificate")}
              <CompleteJobRow
                checked={!!data.certificate_sent}
                onToggle={() =>
                  patch({
                    certificate_sent: !data.certificate_sent,
                    certificate_sent_at: !data.certificate_sent ? data.certificate_sent_at ?? nowIso() : null,
                  })
                }
                validate={() => validateSectionLinks("Certificate", ["certificate"])}
              />
            </div>
          )}
        </Card>
      )}

      {shouldShow("Final MOM") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">08</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Final MOM")}>
            <SectionTitle num={8}>Final MOM</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Final MOM"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Final MOM"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <MediaUploader
                siteId={siteId}
                phase="commissioning"
                section="final-mom"
                disabled={!!data.final_mom_uploaded}
              />
              <div className="mt-4">
                <Label>Notes</Label>
                <Textarea
                  rows={3}
                  defaultValue={data.final_mom_notes ?? ""}
                  onBlur={(e) => patch({ final_mom_notes: e.target.value })}
                  disabled={!!data.final_mom_uploaded}
                />
              </div>
              <div className="mt-6 flex justify-end">
                {data.final_mom_uploaded ? (
                  <Button
                    variant="secondary"
                    onClick={() => save({ ...data, final_mom_uploaded: false })}
                  >
                    Edit Final MOM
                  </Button>
                ) : (
                  <Button onClick={async () => {
                    await save({ ...data, final_mom_uploaded: true });
                    advanceSiteVisitStatus(siteId, "Visit Complete");
                  }}>Submit Final MOM</Button>
                )}
              </div>
              {renderCustomFields("Final MOM", !!data.final_mom_uploaded)}
              <CompleteJobRow
                checked={!!data.final_mom_uploaded}
                onToggle={async () => {
                  const next = !data.final_mom_uploaded;
                  patch({ final_mom_uploaded: next });
                  if (next) advanceSiteVisitStatus(siteId, "Visit Complete");
                }}
              />
            </div>
          )}
        </Card>
      )}

      <div className="mt-8 flex justify-end">
        <Button onClick={onSubmit} className="w-full sm:w-auto text-base py-3 px-8">
          Submit Commissioning Phase
        </Button>
      </div>
    </>
  );
}
