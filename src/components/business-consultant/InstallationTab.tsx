import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
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

type Props = { siteId: string; workerId: string; hiddenSections?: string[]; onSubmit?: () => void | Promise<void> };

export function InstallationTab({ siteId, workerId, hiddenSections, onSubmit }: Props) {
  const { data, patch, save, loaded, lastSaved, saving } = usePhaseData<Record<string, any>>(
    "installation",
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
        .eq("phase", "installation")
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
        .eq("phase", "installation")
        .eq("section", `custom-${f.id}`);
      const hasLink = mediaRows?.some(r => r.file_path && r.file_path.trim().startsWith("http"));
      if (!hasLink) {
        toast.error(`Please paste a valid link for custom field "${f.label}" first.`);
        return false;
      }
    }
    return true;
  };

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

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
        .eq("phase", "installation");
      const filtered = (fields ?? []).filter((f: any) => {
        const wId = f.options?.worker_id;
        return !wId || wId === "all" || wId === workerId;
      });
      setCustomFields(filtered);
    })();
  }, [workerId]);

  if (!loaded) return null;
  const nowIso = () => new Date().toISOString();

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
                  phase="installation"
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

      {shouldShow("Coordination") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">01</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Coordination")}>
            <SectionTitle num={1}>Installation Coordination</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Coordination"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Coordination"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              {data.coordination_done && (
                <div className="mb-5">
                  <Label>What was coordinated?</Label>
                  <Textarea
                    rows={3}
                    defaultValue={data.coordination_notes ?? ""}
                    onBlur={(e) => patch({ coordination_notes: e.target.value })}
                  />
                </div>
              )}
              {renderCustomFields("Coordination")}
              <CompleteJobRow
                checked={!!data.coordination_done}
                onToggle={() =>
                  patch({
                    coordination_done: !data.coordination_done,
                    coordination_at: !data.coordination_done ? data.coordination_at ?? nowIso() : null,
                  })
                }
                validate={() => validateSectionLinks("Coordination", [])}
              />
            </div>
          )}
        </Card>
      )}

      {shouldShow("Photos") && (
        <Card className="border-l-[3px] border-lime relative">
          <div className="section-number-ghost">02</div>
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection("Photos")}>
            <SectionTitle num={2}>Installation Photos</SectionTitle>
            <span className="font-mono text-[10px] text-lime bg-lime-dim/50 px-2 py-0.5 border border-lime/20 rounded-[4px] font-bold">
              {expandedSections["Photos"] ? "COLLAPSE ▲" : "EXPAND ▼"}
            </span>
          </div>

          {expandedSections["Photos"] && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-200">
              <div className="flex items-start gap-3 p-4 bg-muted/30 border border-border rounded-lg">
                <input
                  type="checkbox"
                  id="confirm-installation-photos-drive"
                  className="h-5 w-5 rounded border-gray-300 text-lime focus:ring-lime mt-0.5 cursor-pointer"
                  checked={!!data.photos_uploaded}
                  onChange={(e) => patch({ photos_uploaded: e.target.checked })}
                />
                <label htmlFor="confirm-installation-photos-drive" className="text-sm text-text-primary select-none cursor-pointer">
                  Are you sure you have uploaded the installation photos to Google Drive?
                </label>
              </div>
              {renderCustomFields("Photos")}
              <CompleteJobRow
                checked={!!data.photos_uploaded}
                onToggle={async () => {
                  const next = !data.photos_uploaded;
                  patch({ photos_uploaded: next });
                  if (next) advanceSiteVisitStatus(siteId, "Installation Done");
                }}
                validate={() => validateSectionLinks("Photos", [])}
              />
            </div>
          )}
        </Card>
      )}

      <div className="mt-8 flex justify-end">
        <Button 
          onClick={async () => {
            const saved = await save({ ...data, installation_phase_submitted: true });
            if (!saved) return;
            if (onSubmit) await onSubmit();
          }} 
          className="w-full sm:w-auto text-base py-3 px-8"
        >
          Submit Installation Phase
        </Button>
      </div>
    </>
  );
}
