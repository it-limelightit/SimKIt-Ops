import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Card, Input, Label, Select } from "@/components/ui-kit";
import { toast } from "sonner";
import { formatLocationName, isDistrictOnly, locationKey } from "@/utils/site-location";

type Site = { id: string; name: string; city: string | null; district_id: string | null };
type District = { id: string; name: string };
type Locality = District & { district_id: string };

export function SiteLocationReview({ sites, districts, localities, onSaved }: {
  sites: Site[]; districts: District[]; localities: Locality[]; onSaved: () => Promise<void>;
}) {
  const [groupKey, setGroupKey] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [localityName, setLocalityName] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = new Map<string, Site[]>();
  for (const site of sites) {
    if (site.district_id) continue;
    // District-only entries stay separate from actual city entries until reviewed.
    const key = `${isDistrictOnly(site.city ?? "") ? "district:" : "city:"}${locationKey(site.city ?? "")}`;
    groups.set(key, [...(groups.get(key) ?? []), site]);
  }
  const selected = groups.get(groupKey) ?? [];
  const selectGroup = (key: string) => {
    setGroupKey(key);
    const first = groups.get(key)?.[0];
    const name = first?.city ?? "";
    setDistrictId(districts.find(d => locationKey(d.name) === locationKey(name))?.id ?? "");
    setLocalityName(isDistrictOnly(name) ? "" : formatLocationName(name));
  };
  const save = async () => {
    if (busy || !selected.length) return;
    if (!districtId || !localityName.trim()) return toast.error("Select a district and enter its taluka/city.");
    if (isDistrictOnly(localityName)) return toast.error("Enter the taluka/city name and select the district separately.");
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("review_site_locations", {
        _site_ids: selected.map(site => site.id), _district_id: districtId, _locality_name: formatLocationName(localityName),
      });
      if (error) throw error;
      toast.success(`${data} sites mapped to ${formatLocationName(localityName)}. Original labels retained.`);
      setGroupKey(""); setDistrictId(""); setLocalityName("");
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (error as { message?: string }).message ?? "Could not review locations.");
    } finally { setBusy(false); }
  };
  return (
    <Card>
      <h2 className="text-lg font-bold">Review existing locations</h2>
      <p className="mt-1 text-sm text-text-secondary">
        {Array.from(groups.values()).reduce((count, group) => count + group.length, 0)} sites need review.
        Choose an old label, check the companies, then map them to a district and taluka/city.
        District-only labels need a city decision; areas and villages can keep their own names.
      </p>
      {groups.size > 0 && (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <Label>Existing label group</Label>
              <Select disabled={busy} value={groupKey} onChange={e => selectGroup(e.target.value)}>
                <option value="">Select old location</option>
                {[...groups.entries()].sort((a,b) => (a[1][0].city ?? "").localeCompare(b[1][0].city ?? "")).map(([key, group]) => (
                  <option key={key} value={key}>{[...new Set(group.map(site => site.city || "Empty location"))].join(" / ")} ({group.length})</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>District</Label>
              <Select disabled={busy || !selected.length} value={districtId} onChange={e => setDistrictId(e.target.value)}>
                <option value="">Select district</option>
                {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Taluka / City</Label>
              <Input disabled={busy || !districtId} value={localityName} maxLength={100} list="review-localities"
                onChange={e => setLocalityName(e.target.value)} placeholder="Choose existing or enter correct name" />
              <datalist id="review-localities">
                {localities.filter(l => l.district_id === districtId).map(l => <option key={l.id} value={l.name} />)}
              </datalist>
            </div>
          </div>
          {!!selected.length && (
            <div className="mt-4">
              <ul className="max-h-40 overflow-y-auto text-sm text-text-secondary">
                {selected.map(site => <li key={site.id}>{site.name} — {site.city || "Empty location"}</li>)}
              </ul>
              <p className="my-3 text-xs text-text-secondary">An existing matching name will be reused. A new taluka/city will be added to the selected district. If these companies need different locations, edit their sites individually.</p>
              <Button disabled={busy || !districtId || !localityName.trim()} onClick={save}>
                {busy ? "Saving…" : `Map ${selected.length} sites`}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
