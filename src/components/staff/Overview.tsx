import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton, Badge } from "@/components/ui-kit";

type Appt = {
  status: "early" | "late" | "ontime" | "scheduled" | "none";
  scheduled: string | null;
  completed: string | null;
};
type SiteRow = {
  id: string;
  name: string;
  city: string | null;
  assigned_worker_id: string | null;
  assigned_at: string | null;
  appt_date: string | null;
  appt_time: string | null;
  progress: { a: number; i: number; c: number; updated: string | null; appt: Appt };
  businessConsultantName: string | null;
};

const ASSESSMENT_KEYS = [
  "factory_call_done","third_party_call_done","appointment_saved","facility_visit_done",
  "explanation_saved","contacts_done","floor_visit_done","business_profile_saved",
  "machines_done","mom_uploaded","media_uploaded",
];
const INSTALLATION_KEYS = ["delivery_confirmed","coordination_done","photos_uploaded"];
const COMMISSIONING_KEYS = [
  "coordination_done","visit_done","connection_done","configure_done",
  "testing_done","screenshots_uploaded","certificate_sent","final_mom_uploaded",
];

function pctKeys(data: any, keys: string[]) {
  if (!data) return 0;
  return Math.round(keys.filter((k) => !!data[k]).length / keys.length * 100);
}

export function Overview() {
  const [stats, setStats] = useState<null | {
    sites: number;
    workers: number;
    a: number;
    i: number;
    c: number;
  }>(null);
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [funnel, setFunnel] = useState({ unassigned: 0, scheduled: 0, assess: 0, install: 0, commission: 0, done: 0 });
  const [trend, setTrend] = useState<{ date: string; sites: number; done: number }[]>([]);
  const [upcoming, setUpcoming] = useState<SiteRow[]>([]);
  const [stuck, setStuck] = useState<SiteRow[]>([]);
  const [apptRate, setApptRate] = useState({ onTime: 0, late: 0, total: 0 });

  useEffect(() => {
    (async () => {
      const [s, w, a, i, c, list] = await Promise.all([
        supabase.from("sites").select("id", { count: "exact", head: true }),
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "worker"),
        supabase.from("assessment").select("data,updated_at,site_id"),
        supabase.from("installation").select("data,updated_at,site_id"),
        supabase.from("commissioning").select("data,updated_at,site_id"),
        supabase
          .from("sites")
          .select("id,name,city,assigned_worker_id,assigned_at,appt_date,appt_time,created_at")
          .order("created_at", { ascending: false }),
      ]);
      const sites = (list.data ?? []) as any[];
      const workerIds = Array.from(
        new Set(sites.map((s: any) => s.assigned_worker_id).filter(Boolean)),
      );
      const profilesRes = workerIds.length
        ? await supabase.from("profiles").select("id,name").in("id", workerIds)
        : { data: [] as any[] };
      const nameById: Record<string, string> = {};
      for (const p of (profilesRes.data ?? []) as any[]) nameById[p.id] = p.name;

      setStats({
        sites: s.count ?? 0,
        workers: w.count ?? 0,
        a: ((a.data ?? []) as any[]).filter((r) => !!(r.data as any)?.assessment_phase_submitted).length,
        i: ((i.data ?? []) as any[]).filter((r) => pctKeys(r.data, INSTALLATION_KEYS) === 100).length,
        c: ((c.data ?? []) as any[]).filter((r) => pctKeys(r.data, COMMISSIONING_KEYS) === 100).length,
      });

      const aMap = new Map<string, any>(((a.data ?? []) as any[]).map((r) => [r.site_id, r]));
      const iMap = new Map<string, any>(((i.data ?? []) as any[]).map((r) => [r.site_id, r]));
      const cMap = new Map<string, any>(((c.data ?? []) as any[]).map((r) => [r.site_id, r]));

      const built: SiteRow[] = sites.map((site) => {
        const ar = aMap.get(site.id), ir = iMap.get(site.id), cr = cMap.get(site.id);
        const aP = (ar?.data as any)?.assessment_phase_submitted ? 100 : pctKeys(ar?.data, ASSESSMENT_KEYS);
        const iP = pctKeys(ir?.data, INSTALLATION_KEYS);
        const cP = pctKeys(cr?.data, COMMISSIONING_KEYS);
        const updated = [ar?.updated_at, ir?.updated_at, cr?.updated_at].filter(Boolean).sort().pop() ?? null;

        let appt: Appt = { status: "none", scheduled: null, completed: null };
        if (site.appt_date) {
          const scheduled = new Date(`${site.appt_date}T${site.appt_time || "00:00"}`);
          const completed = ar?.data?.facility_visit_at ? new Date(ar.data.facility_visit_at) : null;
          if (!completed) {
            appt = { status: "scheduled", scheduled: scheduled.toISOString(), completed: null };
          } else {
            const diffMin = (completed.getTime() - scheduled.getTime()) / 60000;
            const status: Appt["status"] = diffMin < -5 ? "early" : diffMin > 15 ? "late" : "ontime";
            appt = { status, scheduled: scheduled.toISOString(), completed: completed.toISOString() };
          }
        }

        return {
          id: site.id,
          name: site.name,
          city: site.city,
          assigned_worker_id: site.assigned_worker_id,
          assigned_at: site.assigned_at,
          appt_date: site.appt_date,
          appt_time: site.appt_time,
          progress: { a: aP, i: iP, c: cP, updated, appt },
          businessConsultantName: site.assigned_worker_id ? nameById[site.assigned_worker_id] ?? null : null,
        };
      });
      setRows(built.slice(0, 50));

      // Funnel
      const f = { unassigned: 0, scheduled: 0, assess: 0, install: 0, commission: 0, done: 0 };
      for (const r of built) {
        if (!r.assigned_worker_id) f.unassigned++;
        else if (r.progress.c === 100 && r.progress.i === 100 && r.progress.a === 100) f.done++;
        else if (r.progress.i === 100) f.commission++;
        else if (r.progress.a === 100) f.install++;
        else if (r.progress.a > 0) f.assess++;
        else f.scheduled++;
      }
      setFunnel(f);

      // Appointment rate
      let onTime = 0, late = 0, total = 0;
      for (const r of built) {
        if (r.progress.appt.status === "early" || r.progress.appt.status === "ontime") { onTime++; total++; }
        else if (r.progress.appt.status === "late") { late++; total++; }
      }
      setApptRate({ onTime, late, total });

      // Upcoming next 7 days
      const now = Date.now();
      const in7 = now + 7 * 86400000;
      setUpcoming(
        built
          .filter((r) => r.progress.appt.status === "scheduled" && r.progress.appt.scheduled)
          .filter((r) => {
            const t = new Date(r.progress.appt.scheduled!).getTime();
            return t >= now - 12 * 3600000 && t <= in7;
          })
          .sort((a, b) =>
            new Date(a.progress.appt.scheduled!).getTime() - new Date(b.progress.appt.scheduled!).getTime(),
          )
          .slice(0, 8),
      );

      // Stuck: no update in 7+ days, not done
      setStuck(
        built
          .filter((r) => {
            if (r.progress.c === 100 && r.progress.i === 100 && r.progress.a === 100) return false;
            if (!r.assigned_worker_id) return false;
            const last = r.progress.updated ?? r.assigned_at;
            if (!last) return false;
            return Date.now() - new Date(last).getTime() > 7 * 86400000;
          })
          .slice(0, 8),
      );

      // Trend last 30 days
      const days: { date: string; sites: number; done: number }[] = [];
      for (let d = 29; d >= 0; d--) {
        const dt = new Date();
        dt.setHours(0, 0, 0, 0);
        dt.setDate(dt.getDate() - d);
        const next = new Date(dt);
        next.setDate(next.getDate() + 1);
        const sitesCount = sites.filter((s: any) => {
          const t = new Date(s.created_at).getTime();
          return t >= dt.getTime() && t < next.getTime();
        }).length;
        const doneCount = ((c.data ?? []) as any[]).filter((r) => {
          if (pctKeys(r.data, COMMISSIONING_KEYS) !== 100) return false;
          const t = new Date(r.updated_at).getTime();
          return t >= dt.getTime() && t < next.getTime();
        }).length;
        days.push({
          date: dt.toLocaleDateString([], { month: "short", day: "numeric" }),
          sites: sitesCount,
          done: doneCount,
        });
      }
      setTrend(days);
    })();
  }, []);

  const apptPct = apptRate.total > 0 ? Math.round((apptRate.onTime / apptRate.total) * 100) : 0;

  return (
    <div className="space-y-10">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-widest text-stone">Dashboard</p>
        <h1 className="mt-2 text-4xl">Overview</h1>
      </header>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {stats === null
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          : [
              { label: "Total Sites", v: stats.sites },
              { label: "Business Consultants", v: stats.workers },
              { label: "Assessments", v: stats.a },
              { label: "Installations", v: stats.i },
              { label: "Commissioning", v: stats.c },
            ].map((s) => (
              <div key={s.label} className="border border-border bg-surface p-6">
                <div className="text-4xl" style={{ fontFamily: "DM Serif Display, serif" }}>
                  {s.v}
                </div>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {s.label}
                </div>
              </div>
            ))}
      </div>

      {/* Trend + appt rate */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="border border-border bg-surface p-6 lg:col-span-2">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-xl">Last 30 days</h2>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Sites added · sites completed
            </span>
          </div>
          <TrendChart data={trend} />
        </div>
        <div className="border border-border bg-surface p-6">
          <h2 className="text-xl">Appointment rate</h2>
          <div className="mt-4 text-5xl" style={{ fontFamily: "DM Serif Display, serif" }}>
            {apptPct}%
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            On-time, {apptRate.total} completed visits
          </div>
          <div className="mt-5 space-y-2 text-sm">
            <Row label="On-time / early" value={apptRate.onTime} color="#1F5130" />
            <Row label="Late" value={apptRate.late} color="#8A2A1F" />
          </div>
        </div>
      </section>

      {/* Funnel + Upcoming + Stuck */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="border border-border bg-surface p-6">
          <h2 className="text-xl">Phase funnel</h2>
          <div className="mt-4 space-y-3">
            <FunnelBar label="Unassigned" v={funnel.unassigned} total={stats?.sites ?? 0} />
            <FunnelBar label="Waiting for task" v={funnel.scheduled} total={stats?.sites ?? 0} />
            <FunnelBar label="In assessment" v={funnel.assess} total={stats?.sites ?? 0} />
            <FunnelBar label="In installation" v={funnel.install} total={stats?.sites ?? 0} />
            <FunnelBar label="In commissioning" v={funnel.commission} total={stats?.sites ?? 0} />
            <FunnelBar label="Done" v={funnel.done} total={stats?.sites ?? 0} done />
          </div>
        </div>

        <div className="border border-border bg-surface p-6">
          <h2 className="text-xl">Upcoming · 7 days</h2>
          {upcoming.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No appointments scheduled</div>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {upcoming.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                  <div>
                    <div className="text-sm">{r.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {r.businessConsultantName ?? "—"} · {r.city ?? "—"}
                    </div>
                  </div>
                  <div className="text-right font-mono text-xs">
                    {new Date(r.progress.appt.scheduled!).toLocaleString([], {
                      weekday: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border border-border bg-surface p-6">
          <h2 className="text-xl">Stuck sites</h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            No update in 7+ days
          </p>
          {stuck.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">All sites moving</div>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {stuck.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                  <div>
                    <div className="text-sm">{r.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {r.businessConsultantName ?? "—"} · {r.city ?? "—"}
                    </div>
                  </div>
                  <Badge tone="danger">
                    {r.progress.updated
                      ? `${Math.floor((Date.now() - new Date(r.progress.updated).getTime()) / 86400000)}d`
                      : "—"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Full table */}
      <section>
        <h2 className="mb-4 text-xl">All Sites</h2>
        <div className="overflow-x-auto border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted">
              <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">City</th>
                <th className="px-4 py-3">Business Consultant</th>
                <th className="px-4 py-3">Appointment</th>
                <th className="px-4 py-3">Assess</th>
                <th className="px-4 py-3">Install</th>
                <th className="px-4 py-3">Commission</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    No sites yet
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">{r.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.city ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.businessConsultantName ?? "—"}</td>
                    <td className="px-4 py-3"><ApptBadge appt={r.progress.appt} /></td>
                    <td className="px-4 py-3"><Pct v={r.progress.a} /></td>
                    <td className="px-4 py-3"><Pct v={r.progress.i} /></td>
                    <td className="px-4 py-3"><Pct v={r.progress.c} /></td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                      {r.progress.updated ? new Date(r.progress.updated).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function TrendChart({ data }: { data: { date: string; sites: number; done: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.sites, d.done)));
  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {data.map((d, idx) => (
          <div key={idx} className="flex flex-1 flex-col items-center justify-end gap-[2px]" title={`${d.date} · added ${d.sites} · done ${d.done}`}>
            <div className="w-full bg-primary/60" style={{ height: `${(d.sites / max) * 100}%` }} />
            <div className="w-full bg-[#3D6B4F]" style={{ height: `${(d.done / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[9px] text-muted-foreground">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
      <div className="mt-3 flex gap-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span className="flex items-center gap-2"><span className="inline-block h-2 w-3 bg-primary/60" /> Added</span>
        <span className="flex items-center gap-2"><span className="inline-block h-2 w-3 bg-[#3D6B4F]" /> Done</span>
      </div>
    </div>
  );
}

function FunnelBar({ label, v, total, done }: { label: string; v: number; total: number; done?: boolean }) {
  const pct = total > 0 ? (v / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{v}</span>
      </div>
      <div className="h-2 w-full bg-border">
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, background: done ? "#3D6B4F" : "var(--primary, #3D6B4F)" }}
        />
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className="inline-block h-2 w-2" style={{ background: color }} />
        {label}
      </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function ApptBadge({ appt }: { appt: Appt }) {
  if (!appt || appt.status === "none") return <span className="text-muted-foreground">—</span>;
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    early: { label: "Early", bg: "#DCEFD8", fg: "#1F5130" },
    ontime: { label: "On time", bg: "#DCEFD8", fg: "#1F5130" },
    late: { label: "Late", bg: "#F8D7D2", fg: "#8A2A1F" },
    scheduled: { label: "Scheduled", bg: "#E2E0DA", fg: "#3a3a3a" },
  };
  const m = map[appt.status] ?? map.scheduled;
  const title = appt.completed
    ? `Done ${new Date(appt.completed).toLocaleString()} • Booked ${appt.scheduled ? new Date(appt.scheduled).toLocaleString() : ""}`
    : appt.scheduled
      ? `Booked ${new Date(appt.scheduled).toLocaleString()}`
      : "";
  return (
    <span
      title={title}
      className="inline-block px-2 py-1 font-mono text-[10px] uppercase tracking-widest"
      style={{ background: m.bg, color: m.fg }}
    >
      {m.label}
    </span>
  );
}

function Pct({ v }: { v: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-xs">{v}%</span>
      <span className="block h-[2px] w-12 bg-border">
        <span className="block h-full bg-primary" style={{ width: `${v}%` }} />
      </span>
    </span>
  );
}
