import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, Plus, Link as LinkIcon, ExternalLink } from "lucide-react";
import { Input, Button } from "@/components/ui-kit";

export type MediaRow = {
  id: string;
  file_path: string;
  file_type: string | null;
  file_name: string | null;
  caption: string | null;
  size_bytes: number | null;
  created_at: string;
};

export function MediaUploader({
  siteId,
  phase,
  section,
  disabled = false,
}: {
  siteId: string;
  phase: string;
  section: string;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<MediaRow[]>([]);
  const [isLinkUploadChecked, setIsLinkUploadChecked] = useState(false);
  const [localLinks, setLocalLinks] = useState<Record<string, { file_path: string; caption: string }>>({});

  async function load() {
    const { data } = await supabase
      .from("media")
      .select("*")
      .eq("site_id", siteId)
      .eq("phase", phase)
      .eq("section", section)
      .order("created_at", { ascending: true });
    
    let rows = (data ?? []) as MediaRow[];
    if (rows.length === 0) {
      const { data: newRow, error } = await supabase
        .from("media")
        .insert({
          site_id: siteId,
          phase,
          section,
          file_path: "",
          file_name: "Link",
          file_type: "link",
          caption: ""
        } as never)
        .select()
        .single();
      if (!error && newRow) {
        rows = [newRow as MediaRow];
      }
    } else if (rows.length > 1) {
      const keep = rows[0];
      const toDelete = rows.slice(1).map(r => r.id);
      await supabase.from("media").delete().in("id", toDelete);
      rows = [keep];
    }
    setItems(rows);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, phase, section]);

  useEffect(() => {
    const nextLocal: Record<string, { file_path: string; caption: string }> = {};
    items.forEach((it) => {
      nextLocal[it.id] = { file_path: it.file_path || "", caption: it.caption || "" };
    });
    setLocalLinks(nextLocal);
  }, [items]);

  async function updateLinkPath(id: string, path: string) {
    if (disabled) return;
    try {
      await supabase.from("media").update({ file_path: path } as never).eq("id", id);
    } catch (e) {
      console.error(e);
    }
  }

  async function updateLinkCaption(id: string, caption: string) {
    if (disabled) return;
    try {
      await supabase.from("media").update({ caption } as never).eq("id", id);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="space-y-3">
      {items.map((it) => {
        const isUrl = it.file_path && (it.file_path.startsWith("http://") || it.file_path.startsWith("https://"));
        return (
          <div key={it.id} className="flex gap-2 items-center">
            <div className="relative flex-1 flex items-center">
              <LinkIcon size={14} className="absolute left-3 text-text-secondary pointer-events-none" />
              <Input 
                value={localLinks[it.id]?.file_path ?? ""} 
                onChange={(e) => setLocalLinks({
                  ...localLinks,
                  [it.id]: { ...(localLinks[it.id] || { caption: "" }), file_path: e.target.value }
                })} 
                onBlur={(e) => updateLinkPath(it.id, e.target.value)}
                placeholder="Paste URL (e.g. Google Drive link, doc link...)" 
                className="pl-9"
                disabled={disabled}
              />
            </div>
            <Input 
              value={localLinks[it.id]?.caption ?? ""} 
              onChange={(e) => setLocalLinks({
                ...localLinks,
                [it.id]: { ...(localLinks[it.id] || { file_path: "" }), caption: e.target.value }
              })} 
              onBlur={(e) => updateLinkCaption(it.id, e.target.value)}
              placeholder="Label / Title..." 
              className="w-1/3"
              disabled={disabled}
            />
            
            {isUrl && (
              <a 
                href={it.file_path} 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-2 text-lime hover:text-lime/80"
                title="Open link in new tab"
              >
                <ExternalLink size={16} strokeWidth={1.5} />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
