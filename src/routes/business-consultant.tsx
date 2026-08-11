import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-store";
import { Badge, Button, ProgressBar, Skeleton, Select, Label, Card, Input } from "@/components/ui-kit";
import { AssessmentTab } from "@/components/business-consultant/AssessmentTab";
import { InstallationTab } from "@/components/business-consultant/InstallationTab";
import { CommissioningTab } from "@/components/business-consultant/CommissioningTab";
import { LogOut, Check, CheckCircle2, MapPin, Calendar, Clock, BookOpen, Boxes, Sun, Moon, User, Phone, Mail } from "lucide-react";
import { parseTaskNotes } from "@/components/staff/TasksPanel";
import { parseSiteMetadata, serializeSiteMetadata } from "@/lib/site-metadata";
import { toast } from "sonner";
import { InventoryPanel } from "@/components/inventory/InventoryPanel";
import { OrderTab } from "@/components/business-consultant/OrderTab";


export const Route = createFileRoute("/business-consultant")({
  ssr: false,
  head: () => ({ meta: [{ title: "Business Consultant — SIM-Kit Ops" }] }),
  component: BusinessConsultantPage,
});

type Site = { id: string; name: string; company_name: string | null; city: string | null; address: string | null; assigned_at: string | null; appt_date: string | null; appt_time: string | null; task_notes: string | null; consultant_stage: string | null };

function BusinessConsultantPage() {
  const navigate = useNavigate();
  const { ready, userId, email, role, profile, signOut } = useAuth();
  
  const [view, setView] = useState<"dashboard" | "submission" | "inventory">("dashboard");
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
  const [tab, setTab] = useState<"assessment" | "installation" | "commissioning" | "order">("assessment");
  const [progress, setProgress] = useState({ assessment: 0, installation: 0, commissioning: 0 });
  const [submittedPhases, setSubmittedPhases] = useState<Set<string>>(new Set());
  const [thankYou, setThankYou] = useState(false);
  const [clientShareEmail, setClientShareEmail] = useState("");
  const [generatedLink, setGeneratedLink] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  const handleSendEmail = async () => {
    if (!site) return;
    if (!clientShareEmail.trim()) {
      toast.error("Please enter a client email address first.");
      return;
    }

    setSendingEmail(true);
    try {
      let token = parseSiteMetadata(site.task_notes).client_token;
      if (!token) {
        token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const { error } = await supabase.rpc("save_client_invitation", {
          site_id: site.id,
          client_email: clientShareEmail.trim(),
          token_val: token
        });

        if (error) {
          throw new Error("Failed to save client details: " + error.message);
        }
        await fetchSites();
      }

      const { sendClientFormEmailFn } = await import("./client-form");
      const res = await sendClientFormEmailFn({
        data: {
          email: clientShareEmail.trim(),
          token: token,
          siteName: site.company_name || site.name,
          origin: window.location.origin
        }
      });

      if (res.success) {
        if (res.previewUrl) {
          toast.success(res.message, {
            description: `Verify Ethereal mailbox here: ${res.previewUrl}`,
            action: {
              label: "Open Mail Inbox",
              onClick: () => window.open(res.previewUrl!, "_blank")
            },
            duration: 15000
          });
        } else {
          toast.success("Invitation email sent successfully to the client!");
        }
      } else {
        toast.error("Failed to send email: " + res.error);
      }
    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred while sending email.");
    } finally {
      setSendingEmail(false);
    }
  };

  useEffect(() => {
    if (site) {
      const siteMeta = parseSiteMetadata(site.task_notes);
      setClientShareEmail(siteMeta.client_email || "");
      if (siteMeta.client_token) {
        setGeneratedLink(`${window.location.origin}/client-form?token=${siteMeta.client_token}`);
      } else {
        setGeneratedLink("");
      }
    } else {
      setClientShareEmail("");
      setGeneratedLink("");
    }
  }, [site]);

  const handleGenerateShareLink = async () => {
    if (!site) return;
    try {
      const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      
      const { error } = await supabase.rpc("save_client_invitation", {
        site_id: site.id,
        client_email: clientShareEmail.trim(),
        token_val: token
      });

      if (error) {
        toast.error("Failed to generate link: " + error.message);
      } else {
        const link = `${window.location.origin}/client-form?token=${token}`;
        setGeneratedLink(link);
        toast.success("Share link generated successfully!");
        // Refresh site details
        await fetchSites();
      }
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
  };

  const handleCopyLink = () => {
    if (!generatedLink) return;
    navigator.clipboard.writeText(generatedLink);
    toast.success("Copied client form link to clipboard!");
  };

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
      .select("id,name,company_name,city,address,assigned_at,appt_date,appt_time,task_notes,consultant_stage")
      .or(`assigned_worker_id.eq.${userId},task_notes.ilike.%"${userId}"%`)
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

    const aMap = new Map((aRes.data ?? []).map(r => [r.site_id, r.data as any]));
    const iMap = new Map((iRes.data ?? []).map(r => [r.site_id, r.data as any]));
    const cMap = new Map((cRes.data ?? []).map(r => [r.site_id, r.data as any]));

    const sitesData = data.map(s => {
      const aData = aMap.get(s.id);
      const iData = iMap.get(s.id);
      const cData = cMap.get(s.id);
      
      const aPct = aData?.assessment_phase_submitted ? 100 : pctCount(aData, ASSESSMENT_KEYS);
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
  const displayedStatus = site?.consultant_stage || meta.status;

  const updateConsultantStage = async (stage: "Billing" | "Completion") => {
    if (!site) return;
    const { error } = await supabase.rpc("set_consultant_site_stage", {
      _site_id: site.id,
      _stage: stage,
    });
    if (error) {
      toast.error("Could not update the site stage: " + error.message);
      return;
    }
    toast.success(`Site moved to ${stage}`);
    await fetchSites();
  };

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
      <Shell onSignOut={signOut} profileName={profile?.name ?? undefined} onGoToDashboard={() => setView("dashboard")} onGoToInventory={() => setView("inventory")}>
        <div className="mt-8">
          <ConsultantDashboard sites={sitesWithProgress} onSelectSite={selectSiteFromDashboard} />
        </div>
      </Shell>
    );
  }

  if (view === "inventory") {
    return (
      <Shell onSignOut={signOut} profileName={profile?.name ?? undefined} onGoToDashboard={() => setView("dashboard")} onGoToInventory={() => setView("inventory")} inventoryActive>
        <div className="py-9"><InventoryPanel /></div>
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
    { k: "order", label: "DEVICE ORDER", pct: 100 },
  ] as const;

  return (
    <Shell onSignOut={signOut} profileName={profile?.name ?? undefined} showDashboardBtn={true} onGoToDashboard={() => setView("dashboard")}>
      <div className="mt-8 space-y-6">
        
        {/* Factory Details Box matching Mockup */}
        <div className="bg-surface/50 backdrop-blur-md p-6 rounded-xl border border-border hover:border-lime/20 transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.05)] space-y-6">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div>
              <div className="text-[10px] uppercase font-mono tracking-widest text-lime font-bold">
                Details of the Factory
              </div>
              <h3 className="text-2xl font-extrabold font-syne text-text-primary uppercase tracking-tight mt-1">
                {site.name}
              </h3>
            </div>
            <Badge tone={displayedStatus === "Running" || displayedStatus === "Completion" ? "success" : displayedStatus === "Stopped" ? "danger" : "warning"}>
              {displayedStatus}
            </Badge>
          </div>
          
          <div className="grid gap-4 md:grid-cols-3">
            {/* Location Address Card */}
            <div className="bg-surface-raised/40 p-4 rounded-xl border border-border/80 flex gap-3">
              <MapPin className="text-lime w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <div className="font-mono text-[9px] uppercase tracking-wider text-text-secondary">Location & Address</div>
                <p className="mt-1 font-semibold text-text-primary text-sm leading-snug">{site.address || "—"}</p>
                <span className="inline-block mt-2 font-mono text-[10px] bg-surface px-2 py-0.5 border border-border rounded text-text-secondary font-bold uppercase">{site.city || "—"}</span>
              </div>
            </div>

            {/* Primary Contact Card */}
            <div className="bg-surface-raised/40 p-4 rounded-xl border border-border/80 flex gap-3">
              <User className="text-lime w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[9px] uppercase tracking-wider text-text-secondary">Primary Contact</div>
                {(meta.c1_name || meta.c1_mobile || meta.c1_email) ? (
                  <div className="mt-1 space-y-1 text-sm">
                    {meta.c1_name && <p className="font-semibold text-text-primary truncate">{meta.c1_name}</p>}
                    {meta.c1_mobile && (
                      <a href={`tel:${meta.c1_mobile}`} className="text-lime hover:underline font-mono text-xs flex items-center gap-1.5 mt-0.5 font-bold">
                        <Phone size={11} /> {meta.c1_mobile}
                      </a>
                    )}
                    {meta.c1_email && (
                      <div className="text-text-secondary text-xs truncate flex items-center gap-1.5 mt-0.5 font-mono">
                        <Mail size={11} /> {meta.c1_email}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-text-dim italic">No contact details</p>
                )}
              </div>
            </div>

            {/* Secondary Contact Card */}
            <div className="bg-surface-raised/40 p-4 rounded-xl border border-border/80 flex gap-3">
              <User className="text-lime w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[9px] uppercase tracking-wider text-text-secondary">Secondary Contact</div>
                {(meta.c2_name || meta.c2_mobile || meta.c2_email) ? (
                  <div className="mt-1 space-y-1 text-sm">
                    {meta.c2_name && <p className="font-semibold text-text-primary truncate">{meta.c2_name}</p>}
                    {meta.c2_mobile && (
                      <a href={`tel:${meta.c2_mobile}`} className="text-lime hover:underline font-mono text-xs flex items-center gap-1.5 mt-0.5 font-bold">
                        <Phone size={11} /> {meta.c2_mobile}
                      </a>
                    )}
                    {meta.c2_email && (
                      <div className="text-text-secondary text-xs truncate flex items-center gap-1.5 mt-0.5 font-mono">
                        <Mail size={11} /> {meta.c2_email}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-text-dim italic">No contact details</p>
                )}
              </div>
            </div>
          </div>

          {/* Client Form Sharing */}
          <div className="bg-surface-raised/40 p-4 rounded-xl border border-border/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Mail className="text-lime w-5 h-5 shrink-0" />
              <div>
                <h4 className="font-syne font-bold text-xs uppercase tracking-wider text-text-primary">
                  Client Self-Submission Link
                </h4>
                <p className="text-[10px] text-text-secondary mt-0.5">
                  Generate a secure access key to invite the client to fill their factory details directly.
                </p>
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center w-full md:max-w-lg">
              <div className="flex-1 col-span-2">
                <Input
                  placeholder="Client email address"
                  value={clientShareEmail}
                  onChange={(e) => setClientShareEmail(e.target.value)}
                  className="h-8 text-xs bg-surface"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleGenerateShareLink}
                  className="py-1 px-3 text-xs bg-surface border border-border text-text-primary hover:bg-surface-raised font-bold uppercase tracking-wider shrink-0"
                >
                  Link Only
                </Button>
                <Button
                  onClick={handleSendEmail}
                  disabled={sendingEmail}
                  className="py-1 px-3 text-xs bg-lime text-black hover:bg-lime/90 font-bold uppercase tracking-wider shrink-0"
                >
                  {sendingEmail ? "Sending..." : "Send Mail"}
                </Button>
                {generatedLink && (
                  <Button
                    onClick={handleCopyLink}
                    className="py-1 px-3 text-xs bg-surface border border-border text-text-primary hover:bg-surface-raised shrink-0 font-mono"
                  >
                    Copy
                  </Button>
                )}
              </div>
            </div>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2 pt-4 border-t border-border/60 items-center">
            {/* Appointment Pills */}
            <div className="flex flex-wrap gap-2">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary bg-surface-raised px-3 py-1.5 border border-border rounded-full font-semibold shadow-sm">
                <Calendar size={13} className="text-lime shrink-0" />
                Appt: {site.appt_date ? site.appt_date : "Not scheduled"}
              </span>
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary bg-surface-raised px-3 py-1.5 border border-border rounded-full font-semibold shadow-sm">
                <Clock size={13} className="text-lime shrink-0" />
                Time: {site.appt_time ? site.appt_time.slice(0, 5) : "No time set"}
              </span>
            </div>
            
            {/* Update Stage dropdown */}
            <div className="flex flex-col gap-1.5 md:items-end">
              <div className="flex items-center gap-2 w-full md:max-w-xs justify-between md:justify-end">
                <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary font-bold shrink-0">Workflow Stage:</span>
                <Select
                  value={site.consultant_stage ?? ""}
                  onChange={(e) => {
                    const stage = e.target.value;
                    if (stage === "Billing" || stage === "Completion") void updateConsultantStage(stage);
                  }}
                  className="py-1 px-2 text-xs h-8 max-w-[160px]"
                >
                  <option value="">Select reached…</option>
                  <option value="Billing">Billing</option>
                  <option value="Completion">Completion</option>
                </Select>
              </div>
            </div>
          </div>
          
          {cleanNotes && (
            <div className="pt-4 border-t border-border/60 flex gap-2 text-sm text-text-secondary">
              <BookOpen size={16} className="text-lime shrink-0 mt-0.5" />
              <p>{cleanNotes}</p>
            </div>
          )}
        </div>

        {/* Chunky Horizontal Phase Progress Tabs */}
        <nav className="flex flex-col md:flex-row gap-4 mt-6">
          {segments.map((s) => {
            const isActive = tab === s.k;
            return (
              <button
                key={s.k}
                onClick={() => setTab(s.k)}
                className={`relative flex-1 h-[58px] bg-surface/80 backdrop-blur-sm border rounded-xl overflow-hidden flex items-center px-5 transition-all duration-300 cursor-pointer ${
                  isActive 
                    ? "border-lime ring-2 ring-lime/20 scale-[1.02] shadow-[0_0_20px_rgba(200,255,74,0.1)]" 
                    : "border-border hover:border-border-bright hover:bg-surface-raised/20"
                }`}
              >
                <div
                  className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-lime/30 to-mint/30 transition-all duration-500 ease-out"
                  style={{ width: `${s.pct}%` }}
                />
                <div className="relative z-10 w-full flex items-center justify-between font-mono text-[11px] font-bold tracking-widest text-text-primary">
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isActive ? "bg-lime animate-pulse" : "bg-text-dim"}`} />
                    {s.label}
                  </span>
                  <span className="bg-surface-raised px-2 py-0.5 rounded text-[10px] border border-border">
                    {s.pct}%
                  </span>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Phase Name Label matching Mockup */}
        <div className="pt-4 border-t border-border">
          <p className="font-mono text-[10px] uppercase tracking-widest text-text-secondary font-bold mb-2">Phase Name</p>
          <h2 className="text-2xl uppercase tracking-tight font-extrabold text-text-primary font-syne">
            {tab === "assessment" ? "Assessment Visit" : tab === "installation" ? "Installation Phase" : tab === "commissioning" ? "Commissioning Phase" : "Device & Sensor Order"}
          </h2>
        </div>
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
            : <CommissioningTab
                siteId={site.id}
                workerId={userId!}
                onSubmit={() => {
                  void updateConsultantStage("Billing").then(() => setThankYou(true));
                }}
              />
        )}
        {tab === "order" && (
          <OrderTab site={site} workerId={userId!} />
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
          <p className="mt-2 text-sm text-text-secondary font-mono">
            The site is now in Billing and is visible to your manager.
          </p>
          <Button className="mt-10" onClick={() => { setThankYou(false); setView("dashboard"); void fetchSites(); }}>
            Go back to Dashboard
          </Button>
        </div>
      )}
    </Shell>
  );
}

function siteStatusStyle(status: string) {
  switch (status) {
    case "Completion":    return { bg: "bg-mint-dim", text: "text-mint", border: "border-mint/20" };
    case "Billing":       return { bg: "bg-lime/10", text: "text-lime", border: "border-lime/20" };
    case "Running":       return { bg: "bg-mint-dim", text: "text-mint", border: "border-mint/20" };
    case "Reject":        return { bg: "bg-coral-dim", text: "text-coral", border: "border-coral/20" };
    case "Shipped":       return { bg: "bg-violet/10", text: "text-violet", border: "border-violet/20" };
    case "Verification":  return { bg: "bg-[#1D4ED8]/10", text: "text-[#1D4ED8]", border: "border-[#1D4ED8]/20" };
    case "Installation":  return { bg: "bg-warning/10", text: "text-warning", border: "border-warning/20" };
    case "Concept":       return { bg: "bg-warning/8", text: "text-warning", border: "border-warning/20" };
    case "Assessment & Visit": return { bg: "bg-[#C4E1F6]/20", text: "text-[#1D4ED8]", border: "border-[#1D4ED8]/20" };
    case "Assigned":      return { bg: "bg-[#800000]/10", text: "text-[#D07070]", border: "border-[#800000]/20" };
    case "Not Started Yet": return { bg: "bg-indigo-600/10", text: "text-indigo-600", border: "border-indigo-600/20" };
    default:              return { bg: "bg-surface-raised", text: "text-text-secondary", border: "border-border" };
  }
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

      {sites.length === 0 ? (
        <div className="border border-border rounded-[10px] bg-surface px-6 py-12 text-center text-text-dim italic text-sm">
          No factories or sites assigned to you yet.
        </div>
      ) : (
        <div className="space-y-3">
          {sites.map((s) => {
            const siteMeta = parseSiteMetadata(s.task_notes ?? null);
            const managerStatus = siteMeta.status || "";
            const st = siteStatusStyle(managerStatus);
            return (
              <div key={s.id} className="border border-border rounded-[10px] bg-surface px-5 py-4 hover:bg-surface-raised/30 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* Company name + location */}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-text-primary text-base leading-tight">{s.name}</div>
                    <div className="text-xs text-text-secondary mt-0.5">{s.city || "—"}{s.address ? ` · ${s.address}` : ""}</div>
                    {s.appt_date ? (
                      <div className="mt-1.5 text-[10px] font-mono text-text-secondary">
                        Appt: <span className="text-text-primary font-semibold">{s.appt_date}</span>
                        {s.appt_time && <span className="ml-1">{s.appt_time.slice(0, 5)}</span>}
                      </div>
                    ) : (
                      <div className="mt-1 text-[10px] font-mono text-text-dim">Not scheduled</div>
                    )}
                  </div>

                  {/* Overall progress */}
                  <div className="sm:w-48 shrink-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono text-text-secondary uppercase tracking-wider">Progress</span>
                      <span className="font-mono text-xs font-bold text-text-primary">{s.overall}%</span>
                    </div>
                    <ProgressBar value={s.overall} />
                    <div className="flex gap-2 mt-1.5 text-[9px] font-mono text-text-secondary">
                      <span>A: {s.aPct}%</span><span>·</span>
                      <span>I: {s.iPct}%</span><span>·</span>
                      <span>C: {s.cPct}%</span>
                    </div>
                  </div>

                  {/* Manager status badge */}
                  <div className="sm:w-36 shrink-0 flex sm:justify-center">
                    {managerStatus ? (
                      <span className={`inline-block rounded-[5px] border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider ${st.bg} ${st.text} ${st.border}`}>
                        {managerStatus}
                      </span>
                    ) : (
                      <span className="text-text-dim text-[10px] font-mono">—</span>
                    )}
                  </div>

                  {/* Action button */}
                  <div className="sm:w-36 shrink-0 flex sm:justify-end">
                    <Button
                      onClick={() => onSelectSite(s.id)}
                      variant={s.overall === 100 ? "secondary" : "primary"}
                      className="w-full sm:w-auto py-1.5 px-4 text-xs font-semibold uppercase tracking-wider"
                    >
                      {s.overall === 100 ? "View" : "Start / Continue"}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  onGoToDashboard,
  onGoToInventory,
  inventoryActive,
}: { 
  children: React.ReactNode; 
  onSignOut: () => void; 
  profileName?: string;
  showDashboardBtn?: boolean;
  onGoToDashboard?: () => void;
  onGoToInventory?: () => void;
  inventoryActive?: boolean;
}) {
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("themeMode");
      const initial = (stored === "dark" || stored === "light") ? stored : "light";
      setThemeMode(initial);
      const root = document.documentElement;
      if (initial === "light") {
        root.classList.add("light-theme");
      } else {
        root.classList.remove("light-theme");
      }
    }
  }, []);

  const toggleTheme = () => {
    const next = themeMode === "light" ? "dark" : "light";
    setThemeMode(next);
    const root = document.documentElement;
    if (next === "light") {
      root.classList.add("light-theme");
    } else {
      root.classList.remove("light-theme");
    }
    localStorage.setItem("themeMode", next);
  };

  return (
    <div className="min-h-screen bg-background text-text-primary font-sans antialiased">
      <div className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl h-14 items-center justify-between px-6">
          <button 
            onClick={onGoToDashboard}
            className="flex items-center gap-2 font-syne font-bold uppercase tracking-wider text-lime cursor-pointer bg-transparent border-0 outline-none"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-lime text-bg text-[10px] font-extrabold font-mono">⬡</span>
            <span>SIM-KIT OPS</span>
          </button>
          <div className="flex items-center gap-3">
            {onGoToInventory && (
              <Button variant={inventoryActive ? "primary" : "ghost"} onClick={onGoToInventory} className="py-1 px-3 text-xs">
                <Boxes size={14} /><span className="hidden sm:inline">Inventory</span>
              </Button>
            )}
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
            <button
              onClick={toggleTheme}
              className="text-text-secondary hover:text-lime transition-colors p-1.5 cursor-pointer bg-transparent border-0 outline-none flex items-center justify-center"
              title={themeMode === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {themeMode === "light" ? <Moon size={16} strokeWidth={2} /> : <Sun size={16} strokeWidth={2} />}
            </button>
            <Button variant="ghost" onClick={onSignOut} className="py-1 px-3 text-xs">
              <LogOut size={14} />
              <span>Sign out</span>
            </Button>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-6">{children}</div>
    </div>
  );
}

const ASSESSMENT_KEYS = [
  "mom_uploaded",
  "media_uploaded",
  "factory_operations_done",
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
