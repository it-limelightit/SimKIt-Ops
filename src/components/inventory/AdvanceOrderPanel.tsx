import { useEffect, useState } from "react";
import { Button, Card, Label } from "@/components/ui-kit";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { OrderTab } from "@/components/business-consultant/OrderTab";
import { supabase } from "@/integrations/supabase/client";

type Company = {
  id: string;
  name: string;
  company_name: string | null;
  city: string | null;
  address: string | null;
  associate_id: string | null;
  associate_name: string | null;
  contact_name: string;
  contact_mobile: string;
};

export function AdvanceOrderPanel() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void (async () => {
      const result = await (supabase.rpc as any)("logistics_advance_companies");
      if (!active) return;
      setLoading(false);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setCompanies(result.data || []);
    })().catch(() => {
      if (active) { setLoading(false); setError("Could not load companies. Please retry."); }
    });
    return () => { active = false; };
  }, [attempt]);

  const company = companies.find(item => item.id === selectedId);

  return <div className="space-y-5">
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-syne text-xl font-bold">Advance Order</h2>
        <p className="text-sm text-text-secondary mt-1">Select a company and place its device order. New orders enter Pending for logistics processing.</p>
      </div>
      {loading ? <p role="status">Loading companies…</p> : error ? <div role="alert" className="space-y-2">
        <p>{error}</p><Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>Retry</Button>
      </div> : <>
        <div>
          <Label htmlFor="advance-company">Company</Label>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button id="advance-company" type="button" variant="secondary" role="combobox" aria-expanded={pickerOpen} aria-controls="advance-company-options" disabled={!companies.length} className="w-full justify-between gap-3 text-left">
                <span className="min-w-0 truncate">{company ? `${company.company_name || company.name}${company.city ? ` · ${company.city}` : ""}` : "Search and select company…"}</span>
                <ChevronsUpDown size={16} className="shrink-0 text-text-secondary" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] border-border bg-surface text-text-primary p-0 shadow-xl">
              <Command className="bg-surface text-text-primary" filter={(value, search) => search.trim().toLowerCase().split(/\s+/).every(word => value.toLowerCase().includes(word)) ? 1 : 0}>
                <CommandInput aria-label="Search companies" placeholder="Company, city, or field associate…" />
                <CommandList id="advance-company-options">
                  <CommandEmpty>No matching companies found.</CommandEmpty>
                  {companies.map(item => <CommandItem key={item.id} value={`${item.id} ${item.company_name || ""} ${item.name} ${item.city || ""} ${item.associate_name || ""}`} onSelect={() => { setSelectedId(item.id); setPickerOpen(false); }} className="cursor-pointer py-3">
                    <Check className={item.id === selectedId ? "text-lime" : "invisible"} />
                    <span className="min-w-0">
                      <span className="block font-semibold">{item.company_name || item.name}</span>
                      <span className="block text-xs text-text-secondary">{[item.city, item.associate_name].filter(Boolean).join(" · ") || "No city or associate assigned"}</span>
                    </span>
                  </CommandItem>)}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        {!companies.length && <p className="text-sm text-text-secondary">No active companies available.</p>}
        {company && <dl className="grid gap-4 sm:grid-cols-2 border-t border-border pt-4 text-sm">
          <div><dt className="text-text-secondary">Field associate</dt><dd className="font-semibold">{company.associate_name || "No active field associate assigned"}</dd></div>
          <div><dt className="text-text-secondary">Delivery address</dt><dd>{company.address || "Delivery address not available"}</dd></div>
          <div><dt className="text-text-secondary">Contact</dt><dd>{company.contact_name || "Not available"}</dd></div>
          <div><dt className="text-text-secondary">Contact number</dt><dd>{company.contact_mobile || "Not available"}</dd></div>
        </dl>}
      </>}
    </Card>
    {company && (!company.associate_id || !company.address?.trim()) && <p role="alert" className="text-sm text-coral">An assigned active field associate and delivery address are required before ordering. Update the company in its existing management screen.</p>}
    {company?.associate_id && company.address?.trim() && <OrderTab
      key={company.id} site={company} workerId={company.associate_id} initiallyExpanded submitLabel="Give Order"
      createOrder={async selection => {
        const result = await (supabase.rpc as any)("logistics_create_advance_order", { _site: company.id, _selection: selection });
        if (result.error) throw new Error(result.error.message);
        return result.data;
      }}
    />}
  </div>;
}
