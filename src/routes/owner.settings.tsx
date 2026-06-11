import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Input, Label, Textarea } from "@/components/ui-kit";
import { toast } from "sonner";

export const Route = createFileRoute("/owner/settings")({ ssr: false, component: SettingsPanel });

function SettingsPanel() {
  const [s, setS] = useState({ company_name: "", default_cities: "" });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
      if (data) setS({
        company_name: data.company_name ?? "",
        default_cities: Array.isArray(data.default_cities) ? data.default_cities.join(", ") : "",
      });
    })();
  }, []);

  const save = async () => {
    const cities = s.default_cities.split(",").map((c) => c.trim()).filter(Boolean);
    const { error } = await supabase
      .from("settings")
      .update({ company_name: s.company_name, default_cities: cities, updated_at: new Date().toISOString() } as never)
      .eq("id", 1);
    if (error) toast.error(error.message);
    else toast.success("Settings saved");
  };

  return (
    <div className="space-y-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-widest text-stone">Owner</p>
        <h1 className="mt-2 text-4xl">Settings</h1>
      </header>
      <div className="card-surface space-y-6">
        <div>
          <Label>Company Name</Label>
          <Input value={s.company_name} onChange={(e) => setS({ ...s, company_name: e.target.value })} />
        </div>
        <div>
          <Label>Default Cities (comma separated)</Label>
          <Textarea rows={3} value={s.default_cities} onChange={(e) => setS({ ...s, default_cities: e.target.value })} />
        </div>
        <div className="flex justify-end"><Button onClick={save}>Save Settings</Button></div>
      </div>
    </div>
  );
}
