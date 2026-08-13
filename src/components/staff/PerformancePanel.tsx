import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton, Badge } from "@/components/ui-kit";
import { ChevronDown, ChevronRight } from "lucide-react";

type Consultant = { id: string; name: string | null; is_active: boolean };
type Site = { id: string; name: string; city: string | null; assigned_at: string | null; appt_date: string | null; appt_time: string | null };
type PhaseData = Record<string, any> | null;
type Contact = { id: string; name: string | null; designation: string | null; mobile: string | null; whatsapp: string | null; email: string | null };
type Machine = { id: string; name: string | null; brand: string | null; model: string | null; serial: string | null; year: number | null; condition: string | null };

type SiteDetail = {
  site: Site;
  assessment: PhaseData;
  installation: PhaseData;
  commissioning: PhaseData;
  contacts: Contact[];
  machines: Machine[];
};

type ConsultantRow = { consultant: Consultant; sites: SiteDetail[] };

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

export function PerformancePanel() {
  const [rows, setRows] = useState<ConsultantRow[] | null>(null);
  const [openConsultant, setOpenConsultant] = useState<string | null>(null);
  const [openSite, setOpenSite] = useState<string | null>(null);
  const [openPhase, setOpenPhase] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: workerRoles } = await supabase.from("user_roles").select("user_id").eq("role", "worker");
      const ids = ((workerRoles ?? []) as any[]).map((r) => r.user_id);
      if (ids.length === 0) { setRows([]); return; }

      const [profsRes, sitesRes, aRes, iRes, cRes, contactsRes, machinesRes] = await Promise.all([
        supabase.from("profiles").select("id,name,is_active").in("id", ids),
        supabase.from("sites").select("id,name,city,assigned_worker_id,assigned_at,appt_date,appt_time").in("assigned_worker_id", ids),
        supabase.from("assessment").select("site_id,data"),
        supabase.from("installation").select("site_id,data"),
        supabase.from("commissioning").select("site_id,data"),
        supabase.from("contacts").select("*"),
        supabase.from("machines").select("*"),
      ]);

      const aMap = new Map<string, any>(((aRes.data ?? []) as any[]).map((r) => [r.site_id, r.data]));
      const iMap = new Map<string, any>(((iRes.data ?? []) as any[]).map((r) => [r.site_id, r.data]));
      const cMap = new Map<string, any>(((cRes.data ?? []) as any[]).map((r) => [r.site_id, r.data]));
      const contactsBySite: Record<string, Contact[]> = {};
      for (const c of (contactsRes.data ?? []) as any[]) {
        if (!contactsBySite[c.site_id]) contactsBySite[c.site_id] = [];
        contactsBySite[c.site_id].push(c);
      }
      const machinesBySite: Record<string, Machine[]> = {};
      for (const m of (machinesRes.data ?? []) as any[]) {
        if (!machinesBySite[m.site_id]) machinesBySite[m.site_id] = [];
        machinesBySite[m.site_id].push(m);
      }

      const sitesByWorker: Record<string, Site[]> = {};
      for (const s of (sitesRes.data ?? []) as any[]) {
        if (!sitesByWorker[s.assigned_worker_id]) sitesByWorker[s.assigned_worker_id] = [];
        sitesByWorker[s.assigned_worker_id].push(s);
      }

      const out: ConsultantRow[] = ((profsRes.data ?? []) as Consultant[]).map((p) => ({
        consultant: p,
        sites: (sitesByWorker[p.id] ?? []).map((site) => ({
          site,
          assessment: aMap.get(site.id) ?? null,
          installation: iMap.get(site.id) ?? null,
          commissioning: cMap.get(site.id) ?? null,
          contacts: contactsBySite[site.id] ?? [],
          machines: machinesBySite[site.id] ?? [],
        })),
      }));

      setRows(out.sort((a, b) => b.sites.length - a.sites.length));
    })();
  }, []);

  if (rows === null) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-widest text-stone">Team</p>
        <h1 className="mt-2 text-4xl">Performance</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Detailed data submitted by each Field Associate, organised by site and phase.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">No Field Associates yet</div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const isOpen = openConsultant === row.consultant.id;
            const totalDone = row.sites.filter((s) => {
              const a = s.assessment; const i = s.installation; const c = s.commissioning;
              return a && i && c && completionPct(a, ASSESSMENT_KEYS) === 100 && completionPct(i, INSTALLATION_KEYS) === 100 && completionPct(c, COMMISSIONING_KEYS) === 100;
            }).length;

            return (
              <div key={row.consultant.id} className="border border-border bg-surface">
                <button
                  className="w-full flex items-center justify-between p-5 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => { setOpenConsultant(isOpen ? null : row.consultant.id); setOpenSite(null); setOpenPhase(null); }}
                >
                  <div className="flex items-center gap-3">
                    {isOpen ? <ChevronDown size={16} className="text-muted-foreground flex-shrink-0" /> : <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />}
                    <div>
                      <div className="text-lg">{row.consultant.name ?? "Unnamed"}</div>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                        <Badge tone={row.consultant.is_active ? "success" : "warning"}>{row.consultant.is_active ? "Active" : "Pending"}</Badge>
                        <span>{row.sites.length} site{row.sites.length !== 1 ? "s" : ""}</span>
                        <span>{totalDone} fully done</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right hidden sm:block">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Overall</div>
                    <div className="text-2xl" style={{ fontFamily: "DM Serif Display, serif" }}>
                      {row.sites.length === 0 ? "—" : `${Math.round(row.sites.reduce((sum, s) => {
                        const a = completionPct(s.assessment, ASSESSMENT_KEYS);
                        const i = completionPct(s.installation, INSTALLATION_KEYS);
                        const c = completionPct(s.commissioning, COMMISSIONING_KEYS);
                        return sum + (a + i + c) / 3;
                      }, 0) / row.sites.length)}%`}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border divide-y divide-border">
                    {row.sites.length === 0 ? (
                      <div className="px-8 py-6 text-sm text-muted-foreground">No sites assigned yet.</div>
                    ) : (
                      row.sites.map((sd) => {
                        const siteKey = `${row.consultant.id}__${sd.site.id}`;
                        const isSiteOpen = openSite === siteKey;
                        const aP = completionPct(sd.assessment, ASSESSMENT_KEYS);
                        const iP = completionPct(sd.installation, INSTALLATION_KEYS);
                        const cP = completionPct(sd.commissioning, COMMISSIONING_KEYS);
                        const overall = Math.round((aP + iP + cP) / 3);
                        const timingStatus = getAppointmentTimingStatus(sd.site.appt_date, sd.site.appt_time, sd.assessment?.appointment_saved_at);

                        return (
                          <div key={sd.site.id}>
                            <button
                              className="w-full flex items-center justify-between px-8 py-4 text-left hover:bg-muted/20 transition-colors"
                              onClick={() => { setOpenSite(isSiteOpen ? null : siteKey); setOpenPhase(null); }}
                            >
                              <div className="flex items-center gap-3">
                                {isSiteOpen ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                                <div>
                                  <div className="text-sm font-medium flex items-center gap-2">
                                    {sd.site.name}
                                    {timingStatus && (
                                      <Badge tone={timingStatus === "Late" ? "danger" : "success"}>
                                        {timingStatus}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground">{sd.site.city ?? "—"}{sd.site.appt_date ? ` · Appt ${sd.site.appt_date}` : ""}</div>
                                </div>
                              </div>
                              <div className="flex gap-4 text-xs text-muted-foreground">
                                <PhasePill label="Assess" pct={aP} />
                                <PhasePill label="Install" pct={iP} />
                                <PhasePill label="Commish" pct={cP} />
                                <span className="font-mono text-foreground font-medium">{overall}%</span>
                              </div>
                            </button>

                            {isSiteOpen && (
                              <div className="px-12 pb-6 space-y-3">
                                <PhaseAccordion
                                  label="Assessment"
                                  phaseKey={`${siteKey}__a`}
                                  openPhase={openPhase}
                                  setOpenPhase={setOpenPhase}
                                  pct={aP}
                                >
                                  <AssessmentDetail 
                                    data={sd.assessment} 
                                    contacts={sd.contacts} 
                                    machines={sd.machines} 
                                    scheduledDate={sd.site.appt_date}
                                    scheduledTime={sd.site.appt_time}
                                  />
                                </PhaseAccordion>
                                <PhaseAccordion
                                  label="Installation"
                                  phaseKey={`${siteKey}__i`}
                                  openPhase={openPhase}
                                  setOpenPhase={setOpenPhase}
                                  pct={iP}
                                >
                                  <InstallationDetail data={sd.installation} />
                                </PhaseAccordion>
                                <PhaseAccordion
                                  label="Commissioning"
                                  phaseKey={`${siteKey}__c`}
                                  openPhase={openPhase}
                                  setOpenPhase={setOpenPhase}
                                  pct={cP}
                                >
                                  <CommissioningDetail data={sd.commissioning} />
                                </PhaseAccordion>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PhaseAccordion({ label, phaseKey, openPhase, setOpenPhase, pct, children }: {
  label: string; phaseKey: string; openPhase: string | null; setOpenPhase: (k: string | null) => void; pct: number; children: React.ReactNode;
}) {
  const isOpen = openPhase === phaseKey;
  return (
    <div className="border border-border">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setOpenPhase(isOpen ? null : phaseKey)}
      >
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRight size={13} className="text-muted-foreground" />}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-xs text-muted-foreground w-8 text-right">{pct}%</span>
        </div>
      </button>
      {isOpen && <div className="border-t border-border px-4 py-4 bg-muted/10">{children}</div>}
    </div>
  );
}

function PhasePill({ label, pct }: { label: string; pct: number }) {
  return (
    <span className={`font-mono ${pct === 100 ? "text-green-600" : pct > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
      {label} {pct}%
    </span>
  );
}

function AssessmentDetail({ 
  data, 
  contacts, 
  machines,
  scheduledDate,
  scheduledTime
}: { 
  data: PhaseData; 
  contacts: Contact[]; 
  machines: Machine[];
  scheduledDate: string | null;
  scheduledTime: string | null;
}) {
  if (!data && contacts.length === 0 && machines.length === 0) {
    return <p className="text-xs text-muted-foreground">No data submitted yet.</p>;
  }
  const d = data ?? {};
  const timingStatus = getAppointmentTimingStatus(scheduledDate, scheduledTime, d.appointment_saved_at);
  return (
    <div className="space-y-5 text-sm">
      <Section title="Factory Call">
        <Row label="Done" value={boolVal(d.factory_call_done)} />
        {d.factory_call_at && <Row label="Completed at" value={fmtDate(d.factory_call_at)} />}
      </Section>
      <Section title="Third Party Call">
        <Row label="Done" value={boolVal(d.third_party_call_done)} />
        {d.third_party_call_at && <Row label="Completed at" value={fmtDate(d.third_party_call_at)} />}
      </Section>
      <Section title="Appointment">
        <Row label="Company" value={d.appt_company} />
        <Row label="Date" value={d.appt_date} />
        <Row label="Time" value={d.appt_time} />
        <Row label="Mode" value={d.appt_mode} />
        {timingStatus && (
          <div className="flex items-center gap-2 py-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground w-28 shrink-0">Timing Status</span>
            <Badge tone={timingStatus === "Late" ? "danger" : "success"}>
              {timingStatus}
            </Badge>
          </div>
        )}
        <Row label="Notes" value={d.appt_notes} />
        <Row label="Saved" value={boolVal(d.appointment_saved)} />
      </Section>
      <Section title="Facility Visit">
        <Row label="Done" value={boolVal(d.facility_visit_done)} />
        {d.facility_visit_at && <Row label="Visited at" value={fmtDate(d.facility_visit_at)} />}
        <Row label="Visited by" value={d.facility_visited_by} />
      </Section>
      <Section title="Explanation">
        <Row label="Saved" value={boolVal(d.explanation_saved)} />
        <Row label="Notes" value={d.explanation_notes} multiline />
      </Section>
      {contacts.length > 0 && (
        <Section title="Contacts">
          {contacts.map((c, i) => (
            <div key={c.id} className="mb-3 last:mb-0">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Contact {i + 1}</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                <Row label="Name" value={c.name} />
                <Row label="Designation" value={c.designation} />
                <Row label="Mobile" value={c.mobile} />
                <Row label="Email" value={c.email} />
              </div>
            </div>
          ))}
        </Section>
      )}
      <Section title="Floor Visit">
        <Row label="Done" value={boolVal(d.floor_visit_done)} />
      </Section>
      <Section title="Business Profile">
        <Row label="Business Name" value={d.biz_name} />
        <Row label="Industry" value={d.biz_industry} />
        <Row label="GST" value={d.biz_gst} />
        <Row label="Contact Name" value={d.biz_contact_name} />
        <Row label="Mobile" value={d.biz_contact_mobile} />
        <Row label="Address" value={d.biz_address} />
        <Row label="City" value={d.biz_city} />
        <Row label="State" value={d.biz_state} />
        <Row label="PIN" value={d.biz_pin} />
        <Row label="Profile saved" value={boolVal(d.business_profile_saved)} />
      </Section>
      {machines.length > 0 && (
        <Section title="Machines">
          {machines.map((m, i) => (
            <div key={m.id} className="mb-3 last:mb-0">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Machine {i + 1}</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                <Row label="Name" value={m.name} />
                <Row label="Brand" value={m.brand} />
                <Row label="Model" value={m.model} />
                <Row label="Serial" value={m.serial} />
                <Row label="Year" value={m.year?.toString()} />
                <Row label="Condition" value={m.condition} />
              </div>
            </div>
          ))}
        </Section>
      )}
      <Section title="MOM">
        <Row label="Uploaded" value={boolVal(d.mom_uploaded)} />
        <Row label="Notes" value={d.mom_notes} multiline />
      </Section>
      <Section title="Media">
        <Row label="Complete" value={boolVal(d.media_uploaded)} />
      </Section>
    </div>
  );
}

function InstallationDetail({ data }: { data: PhaseData }) {
  if (!data) return <p className="text-xs text-muted-foreground">No data submitted yet.</p>;
  const d = data;
  return (
    <div className="space-y-5 text-sm">
      <Section title="Delivery">
        <Row label="Confirmed" value={boolVal(d.delivery_confirmed)} />
        <Row label="Date" value={d.delivery_date} />
        <Row label="Units received" value={d.delivery_units?.toString()} />
        <Row label="Condition" value={d.delivery_condition} />
        <Row label="Agent" value={d.delivery_agent} />
        <Row label="Notes" value={d.delivery_notes} multiline />
      </Section>
      <Section title="Coordination">
        <Row label="Done" value={boolVal(d.coordination_done)} />
        {d.coordination_at && <Row label="At" value={fmtDate(d.coordination_at)} />}
        <Row label="Notes" value={d.coordination_notes} multiline />
      </Section>
      <Section title="Photos">
        <Row label="Uploaded" value={boolVal(d.photos_uploaded)} />
      </Section>
    </div>
  );
}

function CommissioningDetail({ data }: { data: PhaseData }) {
  if (!data) return <p className="text-xs text-muted-foreground">No data submitted yet.</p>;
  const d = data;
  const steps = [
    { key: "coordination_done", label: "Coordination" },
    { key: "visit_done", label: "Visit" },
    { key: "connection_done", label: "Connection" },
    { key: "configure_done", label: "Configure" },
    { key: "testing_done", label: "Testing" },
  ];
  return (
    <div className="space-y-5 text-sm">
      {steps.map((s) => (
        <Section key={s.key} title={s.label}>
          <Row label="Done" value={boolVal(d[s.key])} />
          {d[`${s.key.replace("_done", "_at")}`] && <Row label="At" value={fmtDate(d[`${s.key.replace("_done", "_at")}`])} />}
          {d[`${s.key.replace("_done", "_notes")}`] && <Row label="Notes" value={d[`${s.key.replace("_done", "_notes")}`]} multiline />}
        </Section>
      ))}
      <Section title="Screenshots">
        <Row label="Uploaded" value={boolVal(d.screenshots_uploaded)} />
      </Section>
      <Section title="Completion Certificate">
        <Row label="Sent" value={boolVal(d.certificate_sent)} />
        {d.certificate_sent_at && <Row label="Date" value={fmtDate(d.certificate_sent_at)} />}
      </Section>
      <Section title="Final MOM">
        <Row label="Uploaded" value={boolVal(d.final_mom_uploaded)} />
        <Row label="Notes" value={d.final_mom_notes} multiline />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{title}</div>
      <div className="pl-3 border-l border-border space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value, multiline }: { label: string; value: string | null | undefined; multiline?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className={`flex ${multiline ? "flex-col gap-0.5" : "items-baseline justify-between gap-4"}`}>
      <span className="text-xs text-muted-foreground flex-shrink-0">{label}</span>
      <span className={`text-xs font-mono ${multiline ? "text-foreground whitespace-pre-wrap" : "text-foreground text-right"}`}>{value}</span>
    </div>
  );
}

function boolVal(v: any): string | undefined {
  if (v === true || v === "true") return "Yes";
  if (v === false || v === "false") return "No";
  return undefined;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return undefined;
  try { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

const ASSESSMENT_KEYS = [
  "mom_uploaded", "media_uploaded", "factory_operations_done",
];
const INSTALLATION_KEYS = ["delivery_confirmed", "coordination_done", "photos_uploaded"];
const COMMISSIONING_KEYS = [
  "coordination_done", "visit_done", "connection_done", "configure_done",
  "testing_done", "screenshots_uploaded", "certificate_sent", "final_mom_uploaded",
];

function completionPct(data: PhaseData, keys: string[]) {
  if (!data) return 0;
  const done = keys.filter((k) => !!data[k]).length;
  return Math.round((done / keys.length) * 100);
}
