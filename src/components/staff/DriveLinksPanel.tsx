import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, EmptyState } from "@/components/ui-kit";
import { Folder, ExternalLink, Link2, Info } from "lucide-react";
import { toast } from "sonner";

export type Site = {
  id: string;
  name: string;
  city: string | null;
  task_notes: string | null;
};

export type MediaRow = {
  id: string;
  site_id: string;
  phase: string;
  section: string;
  file_path: string;
  caption: string | null;
  file_name: string | null;
};

function parseSiteMetadata(taskNotes: string | null) {
  if (!taskNotes) return null;
  const match = taskNotes.match(/\[METADATA:([^\]]+)\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return null;
  }
}

export function DriveLinksPanel() {
  const [sites, setSites] = useState<Site[]>([]);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sRes, mRes] = await Promise.all([
        supabase.from("sites").select("id,name,city,task_notes").order("name"),
        supabase
          .from("media")
          .select("id,site_id,phase,section,file_path,caption,file_name")
          .eq("file_type", "link")
          .order("created_at", { ascending: true })
      ]);

      if (sRes.error) throw sRes.error;
      if (mRes.error) throw mRes.error;

      setSites(sRes.data ?? []);
      setMedia((mRes.data ?? []) as MediaRow[]);
    } catch (e) {
      toast.error("Failed to load drive links data");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const formatSectionName = (phase: string, section: string) => {
    const pName = phase.charAt(0).toUpperCase() + phase.slice(1);
    let sName = section.replace(/[\-_]/g, " ");
    sName = sName.charAt(0).toUpperCase() + sName.slice(1);
    return `${pName} — ${sName}`;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-widest text-lime/80 font-bold">Files & Folders</p>
          <h1 className="mt-2 text-4xl uppercase tracking-tight font-extrabold">Links of Drive</h1>
        </header>
        <div className="grid gap-6 md:grid-cols-2">
          {[1, 2, 3].map((n) => (
            <Card key={n} className="animate-pulse h-48 border-border bg-surface" />
          ))}
        </div>
      </div>
    );
  }

  const sitesWithLinks = sites.filter((site) => {
    const meta = parseSiteMetadata(site.task_notes);
    const hasMainLink = !!meta?.drive_folder_link;
    const hasSubLinks = media.some((m) => m.site_id === site.id);
    return hasMainLink || hasSubLinks;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-widest text-lime/80 font-bold">Files & Folders</p>
        <h1 className="mt-2 text-4xl uppercase tracking-tight font-extrabold">Links of Drive</h1>
      </header>

      {sitesWithLinks.length === 0 ? (
        <EmptyState icon={Info} text="No Google Drive links have been configured or uploaded yet." />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {sitesWithLinks.map((site) => {
            const meta = parseSiteMetadata(site.task_notes);
            const mainLink = meta?.drive_folder_link;
            const siteMedia = media.filter((m) => m.site_id === site.id);

            return (
              <Card key={site.id} className="border-l-[3px] border-lime flex flex-col justify-between h-full">
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    {mainLink ? (
                      <a
                        href={mainLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex flex-col text-left hover:opacity-90 transition-all"
                      >
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg uppercase tracking-tight font-bold text-text-primary group-hover:text-lime transition-colors">
                            {site.name}
                          </h3>
                          <ExternalLink size={14} className="text-text-secondary group-hover:text-lime transition-colors shrink-0" />
                        </div>
                        {site.city && (
                          <p className="text-[10px] font-mono text-text-secondary uppercase tracking-widest mt-0.5">{site.city}</p>
                        )}
                      </a>
                    ) : (
                      <div>
                        <h3 className="text-lg uppercase tracking-tight font-bold text-text-primary">{site.name}</h3>
                        {site.city && (
                          <p className="text-[10px] font-mono text-text-secondary uppercase tracking-widest mt-0.5">{site.city}</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 pt-2">
                    {/* Main Drive Link */}
                    {mainLink && (
                      <a
                        href={mainLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-2.5 rounded-[8px] bg-surface-raised border border-border hover:border-lime/30 transition-all hover:bg-surface-raised/85 group text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Folder className="h-4 w-4 text-lime shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-bold uppercase tracking-wider text-text-primary">Main Folder</div>
                            <div className="text-[10px] font-mono text-text-secondary truncate max-w-[220px] mt-0.5">{mainLink}</div>
                          </div>
                        </div>
                        <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-lime/10 text-lime group-hover:bg-lime group-hover:text-primary-foreground transition-all shrink-0">
                          <ExternalLink size={14} />
                        </div>
                      </a>
                    )}

                    {/* Consultant Sub Links */}
                    {siteMedia.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[9px] font-mono uppercase tracking-widest text-text-secondary font-bold mb-1">Uploaded Sections</div>
                        <div className="divide-y divide-border/50 border border-border rounded-[8px] overflow-hidden">
                          {siteMedia.map((m) => (
                            <a
                              key={m.id}
                              href={m.file_path}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between p-2.5 bg-surface-raised/40 hover:bg-surface-raised/85 transition-all border-b border-border/50 last:border-0 group cursor-pointer text-left"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Link2 className="h-3.5 w-3.5 text-lime/75 shrink-0" />
                                <div className="min-w-0">
                                  <div className="text-[11px] font-semibold text-text-primary truncate">
                                    {m.caption || m.file_name || "Document Link"}
                                  </div>
                                  <div className="text-[9px] font-mono text-lime/80 mt-0.5">
                                    {formatSectionName(m.phase, m.section)}
                                  </div>
                                </div>
                              </div>
                              <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-border hover:bg-lime/20 hover:text-lime text-text-primary transition-colors shrink-0 group-hover:bg-lime/10 group-hover:text-lime">
                                <ExternalLink size={12} />
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
