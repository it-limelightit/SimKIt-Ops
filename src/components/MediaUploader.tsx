import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, Link as LinkIcon, ExternalLink, FileText, UploadCloud, Loader2 } from "lucide-react";
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
  const [uploading, setUploading] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [pastedLink, setPastedLink] = useState("");
  const [pastedCaption, setPastedCaption] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const { data } = await supabase
      .from("media")
      .select("*")
      .eq("site_id", siteId)
      .eq("phase", phase)
      .eq("section", section)
      .order("created_at", { ascending: true });
    
    setItems((data ?? []) as MediaRow[]);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, phase, section]);

  const isMom = section === "mom" || section === "final-mom";

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (isMom) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext !== 'pdf' && ext !== 'doc' && ext !== 'docx') {
        toast.error("Only PDF or Word documents (.doc, .docx) are allowed for MOM.");
        return;
      }
    }

    setUploading(true);
    try {
      const bucketName = isMom ? "site-docs" : "site-media";
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9.]/g, "_");
      const filePath = `${siteId}/${phase}/${section}/${Date.now()}_${cleanFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        console.error("Storage upload error:", uploadError);
        throw new Error(uploadError.message);
      }

      const { data: { publicUrl } } = supabase.storage
        .from(bucketName)
        .getPublicUrl(filePath);

      const { error: mediaError } = await supabase
        .from("media")
        .insert({
          site_id: siteId,
          phase,
          section,
          file_path: publicUrl,
          file_name: file.name,
          file_type: file.type || 'application/octet-stream',
          caption: isMom ? "MOM Document" : "Uploaded Media",
          size_bytes: file.size
        } as never);

      if (mediaError) throw mediaError;

      toast.success("File uploaded successfully!");
      await load();
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to upload: " + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleLinkSubmit() {
    if (!pastedLink.trim()) return;
    try {
      const { error } = await supabase
        .from("media")
        .insert({
          site_id: siteId,
          phase,
          section,
          file_path: pastedLink.trim(),
          file_name: "Link Document",
          file_type: "link",
          caption: pastedCaption.trim() || "Google Drive Link"
        } as never);

      if (error) throw error;
      toast.success("Link added successfully!");
      setPastedLink("");
      setPastedCaption("");
      setShowLinkInput(false);
      await load();
    } catch (err: any) {
      toast.error("Failed to add link: " + err.message);
    }
  }

  async function handleDelete(id: string, filePath: string) {
    if (disabled) return;
    try {
      const bucketName = isMom ? "site-docs" : "site-media";
      const marker = `/public/${bucketName}/`;
      const index = filePath.indexOf(marker);
      if (index !== -1) {
        const storagePath = filePath.substring(index + marker.length);
        await supabase.storage.from(bucketName).remove([storagePath]);
      }

      await supabase.from("media").delete().eq("id", id);
      toast.success("Item deleted");
      await load();
    } catch (e: any) {
      toast.error("Delete failed: " + e.message);
    }
  }

  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between p-3 bg-surface border border-border rounded-lg shadow-sm">
              <div className="flex items-center gap-3">
                <FileText className="text-lime h-5 w-5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate max-w-[250px] md:max-w-[400px]">
                    {it.file_name || "Attachment"}
                  </p>
                  {it.caption && (
                    <p className="text-xs text-text-secondary truncate">
                      {it.caption}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={it.file_path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-text-secondary hover:text-lime rounded-md hover:bg-muted transition-colors"
                  title="View / Download"
                >
                  <ExternalLink size={16} />
                </a>
                {!disabled && (
                  <button
                    onClick={() => handleDelete(it.id, it.file_path)}
                    className="p-2 text-text-secondary hover:text-red-500 rounded-md hover:bg-muted transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept={isMom ? ".pdf,.doc,.docx" : undefined}
                className="hidden"
                id={`file-upload-${section}`}
              />
              <label
                htmlFor={`file-upload-${section}`}
                className={`flex flex-col items-center justify-center p-6 border-2 border-dashed border-border hover:border-lime rounded-xl cursor-pointer hover:bg-lime-dim/5 transition-all text-center group ${uploading ? 'pointer-events-none opacity-60' : ''}`}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-8 w-8 text-lime animate-spin mb-2" />
                    <span className="text-sm font-medium text-text-primary">Uploading file...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-8 w-8 text-text-secondary group-hover:text-lime transition-colors mb-2" />
                    <span className="text-sm font-medium text-text-primary">
                      {isMom ? "Upload MOM document" : "Upload File"}
                    </span>
                    <span className="text-xs text-text-secondary mt-1">
                      {isMom ? "PDF, DOC, DOCX files only" : "Click to select a file"}
                    </span>
                  </>
                )}
              </label>
            </div>

            {!isMom && (
              <div className="sm:w-1/3 flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-fit py-6"
                  onClick={() => setShowLinkInput(!showLinkInput)}
                >
                  <LinkIcon size={16} className="mr-2" />
                  {showLinkInput ? "Hide Link Form" : "Paste Drive Link"}
                </Button>
              </div>
            )}
          </div>

          {showLinkInput && (
            <div className="p-4 bg-muted/30 border border-border rounded-xl space-y-3">
              <h4 className="text-sm font-semibold">Paste Google Drive or Document Link</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={pastedLink}
                  onChange={(e) => setPastedLink(e.target.value)}
                  placeholder="https://drive.google.com/..."
                />
                <Input
                  value={pastedCaption}
                  onChange={(e) => setPastedCaption(e.target.value)}
                  placeholder="Label / Title (optional)"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setShowLinkInput(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleLinkSubmit} disabled={!pastedLink.trim()}>
                  Add Link
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
