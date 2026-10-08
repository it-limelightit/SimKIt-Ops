import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, EmptyState } from "@/components/ui-kit";
import { Folder, FileText, ExternalLink, ArrowLeft, ArrowRight, ChevronRight, Info } from "lucide-react";
import { SiteDocumentLink } from "@/components/SiteDocumentLink";
import { getSiteDocumentPath } from "@/lib/site-documents";

type Company = { id: string; name: string; city: string | null };
type Mom = { id: string; site_id: string; file_path: string; caption: string | null; file_name: string | null };

export function DriveLinksPanel() {
  const [showMom, setShowMom] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [documents, setDocuments] = useState<Mom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!showMom) return;
    let active = true;
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const [sites, media] = await Promise.all([
          supabase.from("sites").select("id,name,city").order("name"),
          supabase.from("media").select("id,site_id,file_path,caption,file_name")
            .eq("phase", "assessment").eq("section", "mom")
            .order("created_at", { ascending: false }),
        ]);
        if (sites.error) throw sites.error;
        if (media.error) throw media.error;
        if (!active) return;
        const projectUrl = supabase.storage.from("site-docs").getPublicUrl("").data.publicUrl;
        const uploaded = (media.data ?? []).filter(doc => getSiteDocumentPath(doc.file_path, projectUrl));
        setDocuments(uploaded);
        setCompanies((sites.data ?? []).filter(site => uploaded.some(doc => doc.site_id === site.id)));
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [showMom, attempt]);

  const cardClass = "group flex h-full w-full flex-col rounded-2xl border border-border bg-surface p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-lime/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-6";
  return (
    <div className="space-y-6 font-sans animate-in fade-in duration-200">
      <header className="space-y-2">
        <p className="font-sans text-xs font-semibold uppercase tracking-[0.16em] text-lime">Document library</p>
        <h1 className="font-sans text-2xl font-semibold leading-tight tracking-tight break-words sm:text-3xl">
          {showMom ? company?.name || "MOM" : "Links of Drive"}
        </h1>
        <p className="font-sans text-sm font-normal leading-6 text-text-secondary">
          {company ? "Select a document to open your uploaded MOM." : showMom ? "Select a company to view its MOM documents." : "Your shared Drive folder and company MOM documents, in one place."}
        </p>
      </header>
      {!showMom ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <a href="https://drive.google.com/drive/folders/17I5gB1lJOG9sBaPGa5JwR-HE9wxUpHVA"
            target="_blank" rel="noopener noreferrer" className={cardClass}>
            <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-lime/10 text-lime"><Folder size={24} /></span>
            <h2 className="font-sans text-lg font-semibold leading-6 tracking-tight">Open Drive</h2>
            <p className="mt-2 font-sans text-sm font-normal leading-6 text-text-secondary">Access files in the shared Google Drive folder.</p>
            <span className="mt-6 flex items-center gap-2 text-sm font-medium text-lime">Open Google Drive <ExternalLink size={15} /></span>
          </a>
          <button type="button" className={cardClass} onClick={() => setShowMom(true)}>
            <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-lime/10 text-lime"><FileText size={24} /></span>
            <h2 className="font-sans text-lg font-semibold leading-6 tracking-tight">MOM documents</h2>
            <p className="mt-2 font-sans text-sm font-normal leading-6 text-text-secondary">Find uploaded minutes of meeting, organised by company.</p>
            <span className="mt-6 flex items-center gap-2 text-sm font-medium text-lime">Browse companies <ArrowRight size={15} /></span>
          </button>
        </div>
      ) : (
        <>
          <Button variant="secondary" onClick={() => company ? setCompany(null) : setShowMom(false)}>
            <ArrowLeft size={16} /> {company ? "All companies" : "Back"}
          </Button>
          {loading ? <p role="status" className="text-text-secondary">Loading MOM documents...</p>
            : error ? <div className="space-y-3"><p role="alert">Could not load MOM documents.</p>
              <Button variant="secondary" onClick={() => setAttempt(n => n + 1)}>Retry</Button></div>
            : company ? (
              <div className="space-y-3">
                {documents.filter(doc => doc.site_id === company.id).map(doc => (
                  <SiteDocumentLink key={doc.id} href={doc.file_path} target="_blank" rel="noopener noreferrer"
                    className="group flex items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-lime/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-lime/10 text-lime"><FileText size={20} /></span>
                    <span className="min-w-0 flex-1 break-words text-sm font-medium leading-6">{doc.file_name || doc.caption || "MOM document"}</span>
                    <ExternalLink size={16} className="shrink-0" />
                  </SiteDocumentLink>
                ))}
              </div>
            ) : companies.length === 0 ? <EmptyState icon={Info} text="No MOM documents have been uploaded yet." /> : (
              <div className="grid gap-4 sm:grid-cols-2">
                {companies.map(site => (
                  <button key={site.id} type="button" className={cardClass} onClick={() => setCompany(site)}>
                    <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-lime/10 text-lime"><Folder size={22} /></span>
                    <h2 className="font-sans text-base font-semibold leading-6 tracking-tight break-words">{site.name}</h2>
                    {site.city && <p className="mt-1 font-sans text-sm font-normal leading-5 text-text-secondary">{site.city}</p>}
                    <span className="mt-auto flex items-center justify-between gap-3 pt-5 text-xs font-medium text-text-secondary">
                      <span>{documents.filter(doc => doc.site_id === site.id).length} MOM document(s)</span>
                      <ChevronRight size={16} className="text-lime" />
                    </span>
                  </button>
                ))}
              </div>
            )}
        </>
      )}
    </div>
  );
}
