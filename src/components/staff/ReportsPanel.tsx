import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Input, Label, Select } from "@/components/ui-kit";
import { Download } from "lucide-react";

export function ReportsPanel() {
  const [filters, setFilters] = useState({ from: "", to: "", city: "", businessConsultant: "", phase: "all" });
  const [rows, setRows] = useState<any[]>([]);
  const [businessConsultants, setBusinessConsultants] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id,name").order("name");
      setBusinessConsultants(data ?? []);
    })();
  }, []);

  const run = async () => {
    let q = supabase
      .from("sites")
      .select("id,name,city,assigned_worker_id,assigned_at,created_at");
    if (filters.city) q = q.ilike("city", `%${filters.city}%`);
    if (filters.businessConsultant) q = q.eq("assigned_worker_id", filters.businessConsultant);
    if (filters.from) q = q.gte("created_at", filters.from);
    if (filters.to) q = q.lte("created_at", filters.to);
    const { data } = await q.order("created_at", { ascending: false });
    setRows(data ?? []);
  };

  useEffect(() => { void run(); /* eslint-disable-next-line */ }, []);

  const exportCsv = () => {
    const header = ["Site", "City", "Business Consultant", "Assigned", "Created"];
    const lines = [header.join(",")];
    const nameOf = (id: string | null) => businessConsultants.find((w) => w.id === id)?.name ?? "—";
    for (const r of rows) {
      lines.push(
        [r.name, r.city ?? "", nameOf(r.assigned_worker_id), r.assigned_at ?? "", r.created_at]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sites-report-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-stone">Analytics</p>
          <h1 className="mt-2 text-4xl">Reports</h1>
        </div>
        <Button onClick={exportCsv} variant="secondary"><Download size={16} strokeWidth={1.5} /> Export CSV</Button>
      </header>

      <div className="card-surface">
        <div className="grid gap-4 md:grid-cols-5">
          <div><Label>From</Label><Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
          <div><Label>To</Label><Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
          <div><Label>City</Label><Input value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} /></div>
          <div>
            <Label>Business Consultant</Label>
            <Select value={filters.businessConsultant} onChange={(e) => setFilters({ ...filters, businessConsultant: e.target.value })}>
              <option value="">All</option>
              {businessConsultants.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>Phase</Label>
            <Select value={filters.phase} onChange={(e) => setFilters({ ...filters, phase: e.target.value })}>
              <option value="all">All</option>
              <option>assessment</option>
              <option>installation</option>
              <option>commissioning</option>
            </Select>
          </div>
        </div>
        <div className="mt-6 flex justify-end"><Button onClick={run}>Run Report</Button></div>
      </div>

      <div className="overflow-x-auto border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted">
            <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-3">Site</th><th className="px-4 py-3">City</th><th className="px-4 py-3">Business Consultant</th><th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No results</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">{r.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.city ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{businessConsultants.find((w) => w.id === r.assigned_worker_id)?.name ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-[11px]">{new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
