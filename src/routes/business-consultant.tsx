import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-store";
import { Badge, Button, ProgressBar, Skeleton, Select, Label, Card } from "@/components/ui-kit";
import { AssessmentTab } from "@/components/business-consultant/AssessmentTab";
import { InstallationTab } from "@/components/business-consultant/InstallationTab";
import { CommissioningTab } from "@/components/business-consultant/CommissioningTab";
import { LogOut, Check, CheckCircle2, MapPin, Calendar, Clock, BookOpen } from "lucide-react";
import { parseTaskNotes } from "@/components/staff/TasksPanel";
import { parseSiteMetadata } from "@/components/staff/SitesPanel";

export const Route = createFileRoute("/business-consultant")({
  ssr: false,
  head: () => ({ meta: [{ title: "Business Consultant — SIM-Kit Ops" }] }),
  component: BusinessConsultantPage,
});

type Site = { id: string; name: string; city: string | null; address: string | null; assigned_at: string | null; appt_date: string | null; appt_time: string | null; task_notes: string | null };

function BusinessConsultantPage() {
  const navigate = useNavigate();
  const { ready, userId, email, role, profile, signOut } = useAuth();
  
  const [view, setView] = useState<"dashboard" | "submission">("dashboard");
  const [sitesList, setSitesList] = useState<Site[]>([]);
  const [sitesWithProgress, setSitesWithProgress] = useState<Array<Site & {
    aPct: number;
    iPct: number;
    cPct: number;
    overall: number;
    status: "Complete" | "Working" | "Pending";
  }>>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>("");
  const [site, setSite] = useState<Site | null | undefined>(undefined);
  
  const [queryError, setQueryError] = useState<string | null>(null);
  const [tab, setTab] = useState<"assessment" | "installation" | "commissioning">("assessment");
  const [progress, setProgress] = useState({ assessment: 0, installation: 0, commissioning: 0 });
  const [submittedPhases, setSubmittedPhases] = useState<Set<string>>(new Set());
  const [thankYou, setThankYou] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!userId) {
      navigate({ to: "/auth" });
      return;
    }
    if (role && role !== "worker") {
      navigate({ to: (role === "supervisor" ? "/manager" : `/${role}`) as "/manager" });
    }
  }, [ready, userId, role, navigate]);

  const fetchSites = async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("sites")
      .select("id,name,city,address,assigned_at,appt_date,appt_time,task_notes")
      .eq("assigned_worker_id", userId)
      .order("assigned_at", { ascending: false });
    
    if (error) {
      setQueryError(error.message);
      return;
    }

    if (!data || data.length === 0) {
      setSitesList([]);
      setSitesWithProgress([]);
      setSite(null);
      setSelectedSiteId("");
      setSelectedFactoryId("");
      return;
    }

    const siteIds = data.map(s => s.id);
    const [aRes, iRes, cRes] = await Promise.all([
      supabase.from("assessment").select("site_id,data").in("site_id", siteIds),
      supabase.from("installation").select("site_id,data").in("site_id", siteIds),
      supabase.from("commissioning").select("site_id,data").in("site_id", siteIds)
    ]);

    const aMap = new Map((aRes.data ?? []).map(r => [r.site_id, (r.data as any)?.data]));
    const iMap = new Map((iRes.data ?? []).map(r => [r.site_id, (r.data as any)?.data]));
    const cMap = new Map((cRes.data ?? []).map(r => [r.site_id, (r.data as any)?.data]));

    const sitesData = data.map(s => {
      const aData = aMap.get(s.id);
      const iData = iMap.get(s.id);
      const cData = cMap.get(s.id);
      
      const aPct = pctCount(aData, ASSESSMENT_KEYS);
      const iPct = pctCount(iData, INSTALLATION_KEYS);
      const cPct = pctCount(cData, COMMISSIONING_KEYS);
      const overall = Math.round((aPct + iPct + cPct) / 3);
      
      let status: "Complete" | "Working" | "Pending" = "Pending";
      if (overall === 100) {
        status = "Complete";
      } else if (overall > 0) {
        status = "Working";
      }
      
      return {
        ...s,
        aPct,
        iPct,
        cPct,
        overall,
        status
      };
    });

    setQueryError(null);
    setSitesList(data);
    setSitesWithProgress(sitesData);
    
    if (data.length > 0) {
      const currentStillExists = data.find(s => s.id === selectedSiteId);
      if (!currentStillExists) {
        setSite(data[0]);
        setSelectedSiteId(data[0].id);
        setSelectedFactoryId(data[0].id);
      } else {
        setSite(currentStillExists);
      }
    } else {
      setSite(null);
      setSelectedSiteId("");
      setSelectedFactoryId("");
    }
  };

  useEffect(() => {
    void fetchSites();

    const channel = supabase
      .channel("bc-sites-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sites",
        },
        () => {
          void fetchSites();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, selectedSiteId]);

  const handleSiteChange = (id: string) => {
    setSelectedSiteId(id);
    setSelectedFactoryId(id);
    const found = sitesList.find(s => s.id === id);
    if (found) {
      setSite(found);
    }
  };

  const selectSiteFromDashboard = (id: string) => {
    handleSiteChange(id);
    setView("submission");
  };

  const { phase: activePhase, cleanNotes } = parseTaskNotes(site?.task_notes ?? null);
  const meta = parseSiteMetadata(site?.task_notes ?? null);

  useEffect(() => {
    if (activePhase && (activePhase === "assessment" || activePhase === "installation" || activePhase === "commissioning")) {
      setTab(activePhase);
    }
  }, [activePhase]);

  useEffect(() => {
    if (!site) return;
    (async () => {
      const [a, i, c] = await Promise.all([
        supabase.from("assessment").select("data").eq("site_id", site.id).maybeSingle(),
        supabase.from("installation").select("data").eq("site_id", site.id).maybeSingle(),
        supabase.from("commissioning").select("data").eq("site_id", site.id).maybeSingle(),
      ]);
      setProgress({
        assessment: pctCount(a.data?.data, ASSESSMENT_KEYS),
        installation: pctCount(i.data?.data, INSTALLATION_KEYS),
        commissioning: pctCount(c.data?.data, COMMISSIONING_KEYS),
      });
    })();
  }, [site, tab]);

  if (!ready || site === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!profile?.is_active) {
    return (
      <Shell onSignOut={signOut} onGoToDashboard={() => setView("dashboard")}>
        <div className="card-surface mt-12 text-center">
          <h2 className="text-2xl font-bold text-lime uppercase tracking-wider font-syne">Awaiting approval</h2>
          <p className="mt-3 text-sm text-text-secondary">
            Your account is pending manager activation. Check back soon.
          </p>
        </div>
      </Shell>
    );
  }

  if (view === "dashboard") {
    return (
      <Shell onSignOut={signOut} profileName={profile?.name ?? undefined} onGoToDashboard={() => setView("dashboard")}>
        <div className="mt-8">
          <ConsultantDashboard sites={sitesWithProgress} onSelectSite={selectSiteFromDashboard} />
        </div>
      </Shell>
    );
  }

  if (!site) {
    return (
      <Shell onSignOut={signOut} showDashboardBtn={true} onGoToDashboard={() => setView("dashboard")}>
        <div className="card-surface mt-12 text-center">
          <h2 className="text-2xl font-bold text-lime uppercase tracking-wider font-syne">No site assigned</h2>
          <p className="mt-3 text-sm text-text-secondary">
            Task will be assigned. Check back soon.
          </p>
        </div>
      </Shell>
    );
  }

  const overall = Math.round((progress.assessment + progress.installation + progress.commissioning) / 3);

  const segments = [
    { k: "assessment", label: "ASSESSMENT", pct: progress.assessment },
    { k: "installation", label: "INSTALLATION", pct: progress.installation },
    { k: "commissioning", label: "COMMISSIONING", pct: progress.commissioning },
  ] as const;

  return (
    <Shell onSignOut={signOut} profileName={profile?.name ?? undefined} showDashboardBtn={true} onGoToDashboard={() => setView("dashboard")}>
      <div className="mt-8 space-y-6">
        
        {/* Site & Factory Dropdown selectors matching Mockup */}
        <div className="grid gap-4 sm:grid-cols-2 bg-surface p-6 border border-border rounded-[10px]">
          <div>
            <Label className="text-lime">Site Name Dropdown</Label>
            <Select value={selectedSiteId} onChange={(e) => handleSiteChange(e.target.value)}>
              {sitesList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.city ? `${s.city.toUpperCase()} - ${s.name}` : s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-lime">Factory Name Dropdown</Label>
            <Select value={selectedFactoryId} onChange={(e) => handleSiteChange(e.target.value)}>
              {sitesList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Factory Details Box matching Mockup */}
        <div className="border-l-[4px] border-lime bg-surface px-6 py-5 rounded-[8px] border border-border space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-widest text-lime font-bold">
              Details of the Factory
            </div>
            <Badge tone={meta.status === "Running" ? "success" : meta.status === "Stopped" ? "danger" : "warning"}>
              {meta.status}
            </Badge>
          </div>
          
          <div className="grid gap-6 md:grid-cols-3 text-sm">
            <div className="space-y-2">
              <div className="font-semibold text-text-primary uppercase text-xs tracking-wider">Location & Address</div>
              <div className="text-text-secondary text-xs">{site.address || "—"}</div>
              <div className="text-text-secondary text-xs">{site.city || "—"}</div>
            </div>
            
            <div className="space-y-2">
              <div className="font-semibold text-text-primary uppercase text-xs tracking-wider">Primary Contact</div>
              {meta.c1_name ? (
                <div className="text-xs space-y-1">
                  <div className="font-medium text-text-primary">{meta.c1_name}</div>
                  <div>
                    <a href={`tel:${meta.c1_mobile}`} className="text-lime hover:underline font-mono">
                      📞 {meta.c1_mobile}
                    </a>
                  </div>
                  <div className="text-text-secondary truncate">{meta.c1_email}</div>
                </div>
              ) : (
                <div className="text-text-dim text-xs">No primary contact</div>
              )}
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-text-primary uppercase text-xs tracking-wider">Secondary Contact</div>
              {meta.c2_name ? (
                <div className="text-xs space-y-1">
                  <div className="font-medium text-text-primary">{meta.c2_name}</div>
                  <div>
                    <a href={`tel:${meta.c2_mobile}`} className="text-lime hover:underline font-mono">
                      📞 {meta.c2_mobile}
                    </a>
                  </div>
                  <div className="text-text-secondary truncate">{meta.c2_email}</div>
                </div>
              ) : (
                <div className="text-text-dim text-xs">No secondary contact</div>
              )}
            </div>
          </div>
          
          <div className="grid gap-4 sm:grid-cols-3 text-xs pt-3 border-t border-border text-text-secondary">
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-lime shrink-0" />
              <span>Appt: {site.appt_date ? site.appt_date : "Not scheduled"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-lime shrink-0" />
              <span>Time: {site.appt_time ? site.appt_time.slice(0, 5) : "No time set"}</span>
            </div>
          </div>
          {cleanNotes && (
            <div className="pt-3 border-t border-border flex gap-2 text-sm text-text-secondary">
              <BookOpen size={16} className="text-lime shrink-0 mt-0.5" />
              <p>{cleanNotes}</p>
            </div>
          )}
        </div>

        {/* Phase Name Label matching Mockup */}
        <div className="pt-4 border-t border-border">
          <p className="font-mono text-[10px] uppercase tracking-widest text-text-secondary font-bold mb-2">Phase Name</p>
          <h2 className="text-2xl uppercase tracking-tight font-extrabold text-text-primary font-syne">
            {tab === "assessment" ? "Assessment Visit" : tab === "installation" ? "Installation Phase" : "Commissioning Phase"}
          </h2>
        </div>

        {/* Chunky Horizontal Phase Progress Tabs */}
        <nav className="flex flex-col md:flex-row gap-4">
          {segments.map((s) => {
            const isActive = tab === s.k;
            return (
              <button
                key={s.k}
                onClick={() => setTab(s.k)}
                className={`relative flex-1 h-[52px] bg-surface border rounded-[8px] overflow-hidden flex items-center px-4 transition-all duration-150 cursor-pointer ${
                  isActive ? "border-lime ring-2 ring-lime/20" : "border-border hover:border-border-bright"
                }`}
              >
                <div
                  className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-lime to-mint opacity-20 transition-all duration-600 ease-out"
                  style={{ width: `${s.pct}%` }}
                />
                <div className="relative z-10 w-full flex items-center justify-between font-mono text-[11px] font-bold tracking-widest text-text-primary">
                  <span>{s.label}</span>
                  <span>{s.pct}%</span>
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      <main className="mt-8 space-y-4 pb-24">
        {tab === "assessment" && (
          submittedPhases.has("assessment")
            ? <PhaseSubmittedCard label="Assessment Visit" onNext={() => setTab("installation")} nextLabel="Go to Installation" />
            : <AssessmentTab siteId={site.id} workerId={userId!} onSubmit={() => { setSubmittedPhases(prev => new Set([...prev, "assessment"])); }} />
        )}
        {tab === "installation" && (
          submittedPhases.has("installation")
            ? <PhaseSubmittedCard label="Installation" onNext={() => setTab("commissioning")} nextLabel="Go to Commissioning" />
            : <InstallationTab siteId={site.id} workerId={userId!} onSubmit={() => { setSubmittedPhases(prev => new Set([...prev, "installation"])); }} />
        )}
        {tab === "commissioning" && (
          submittedPhases.has("commissioning")
            ? null
            : <CommissioningTab siteId={site.id} workerId={userId!} onSubmit={() => setThankYou(true)} />
        )}
      </main>

      {thankYou && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#08080F] px-6 text-center animate-in fade-in duration-300" style={{ background: "radial-gradient(circle at center, #1A2A00 0%, #08080F 70%)" }}>
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-lime/20 text-lime animate-pulse mb-6">
            <CheckCircle2 size={48} strokeWidth={1.5} />
          </div>
          <h2 className="text-5xl uppercase tracking-tight font-extrabold text-lime font-syne">
            THANK YOU
          </h2>
          <p className="mt-4 text-lg text-text-primary max-w-md font-sans">
            All phases have been successfully submitted. Your work on <strong>{site.name}</strong> is complete.
          </p>
          <p className="mt-2 text-sm text-text-secondary font-mono">Your manager will review the submission shortly.</p>
          <Button className="mt-10" onClick={() => { setThankYou(false); setView("dashboard"); void fetchSites(); }}>
            Go back to Dashboard
          </Button>
        </div>
      )}
    </Shell>
  );
}

function ConsultantDashboard({ 
  sites, 
  onSelectSite 
}: { 
  sites: Array<Site & { aPct: number; iPct: number; cPct: number; overall: number; status: "Complete" | "Working" | "Pending" }>;
  onSelectSite: (siteId: string) => void;
}) {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-widest text-lime/80 font-bold">Overview</p>
        <h1 className="mt-2 text-4xl uppercase tracking-tight font-extrabold font-syne text-text-primary">My Assignments</h1>
      </header>

      <div className="overflow-x-auto border border-border rounded-[10px] bg-surface">
        <table className="w-full border-collapse text-left">
          <thead className="border-b border-border bg-surface-raised">
            <tr className="text-left font-mono text-[9px] uppercase tracking-widest text-text-secondary">
              <th className="px-6 py-4">Company / Factory</th>
              <th className="px-6 py-4">Location</th>
              <th className="px-6 py-4">Appt Details</th>
              <th className="px-6 py-4">Overall Progress</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {sites.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-text-dim italic text-sm">
                  No factories or sites assigned to you yet.
                </td>
              </tr>
            ) : (
              sites.map((s) => (
                <tr key={s.id} className="hover:bg-surface-raised/35 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-text-primary text-sm">{s.name}</div>
                    <div className="text-xs text-text-secondary mt-0.5 truncate max-w-[220px]">
                      {s.address || "—"}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-text-primary text-sm font-medium">
                    {s.city || "—"}
                  </td>
                  <td className="px-6 py-4 text-xs text-text-secondary space-y-0.5">
                    {s.appt_date ? (
                      <>
                        <div className="font-medium text-text-primary">{s.appt_date}</div>
                        <div className="font-mono text-[10px]">{s.appt_time ? s.appt_time.slice(0, 5) : "—"}</div>
                      </>
                    ) : (
                      <span className="text-text-dim">Not scheduled</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3 min-w-[120px]">
                      <div className="flex-1">
                        <ProgressBar value={s.overall} />
                      </div>
                      <span className="font-mono text-[11px] font-bold text-text-primary">{s.overall}%</span>
                    </div>
                    <div className="flex gap-2 mt-1.5 text-[9px] font-mono text-text-secondary">
                      <span>A: {s.aPct}%</span>
                      <span>•</span>
                      <span>I: {s.iPct}%</span>
                      <span>•</span>
                      <span>C: {s.cPct}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge tone={s.status === "Complete" ? "success" : s.status === "Working" ? "warning" : "neutral"}>
                      {s.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button 
                      onClick={() => onSelectSite(s.id)}
                      variant={s.status === "Complete" ? "secondary" : "primary"}
                      className="py-1.5 px-4 text-xs font-semibold uppercase tracking-wider"
                    >
                      {s.status === "Complete" ? "View Submission" : "Start / Continue"}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PhaseSubmittedCard({ label, onNext, nextLabel }: { label: string; onNext: () => void; nextLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center border-1.5 border-lime/20 bg-lime-dim rounded-[10px]">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-lime/20 text-lime mb-6">
        <Check size={28} strokeWidth={2} />
      </div>
      <h3 className="text-2xl font-syne font-bold uppercase tracking-wide text-lime">
        {label} Submitted
      </h3>
      <p className="mt-2 text-sm text-text-secondary max-w-xs">
        This phase is complete. Proceed to the next phase when ready.
      </p>
      <Button className="mt-8" onClick={onNext}>
        {nextLabel}
      </Button>
    </div>
  );
}

function Shell({ 
  children, 
  onSignOut, 
  profileName,
  showDashboardBtn,
  onGoToDashboard
}: { 
  children: React.ReactNode; 
  onSignOut: () => void; 
  profileName?: string;
  showDashboardBtn?: boolean;
  onGoToDashboard?: () => void;
}) {
  return (
    <div className="min-h-screen bg-background text-text-primary font-sans antialiased">
      <div className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl h-14 items-center justify-between px-6">
          <button 
            onClick={onGoToDashboard}
            className="flex items-center gap-2 font-syne font-bold uppercase tracking-wider text-lime cursor-pointer bg-transparent border-0 outline-none"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-lime text-bg text-[10px] font-extrabold font-mono">⬡</span>
            <span>SIM-KIT OPS</span>
          </button>
          <div className="flex items-center gap-3">
            {showDashboardBtn && (
              <Button variant="secondary" onClick={onGoToDashboard} className="py-1 px-3 text-xs">
                <span>Dashboard</span>
              </Button>
            )}
            {profileName && (
              <span className="hidden sm:inline-block font-mono text-[10px] tracking-widest text-text-secondary bg-surface-raised px-2.5 py-1 border border-border rounded-[4px]">
                {profileName.toUpperCase()}
              </span>
            )}
            <Button variant="ghost" onClick={onSignOut} className="py-1 px-3 text-xs">
              <LogOut size={14} />
              <span>Sign out</span>
            </Button>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-4xl px-6">{children}</div>
    </div>
  );
}

// Keys used to compute per-tab completion %
const ASSESSMENT_KEYS = [
  "factory_call_done",
  "third_party_call_done",
  "appointment_saved",
  "facility_visit_done",
  "explanation_saved",
  "contacts_done",
  "floor_visit_done",
  "business_profile_saved",
  "machines_done",
  "mom_uploaded",
  "media_uploaded",
];
const INSTALLATION_KEYS = ["delivery_confirmed", "coordination_done", "photos_uploaded"];
const COMMISSIONING_KEYS = [
  "coordination_done",
  "visit_done",
  "connection_done",
  "configure_done",
  "testing_done",
  "screenshots_uploaded",
  "certificate_sent",
  "final_mom_uploaded",
];

function pctCount(data: any, keys: string[]) {
  if (!data) return 0;
  const done = keys.filter((k) => !!data[k]).length;
  return Math.round((done / keys.length) * 100);
}
