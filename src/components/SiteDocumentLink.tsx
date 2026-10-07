import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getSiteDocumentPath, resolveSiteDocumentUrl } from "@/lib/site-documents";

export function SiteDocumentLink({
  href = "",
  onClick,
  onAuxClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  async function openDocument(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || (event.type === "auxclick" && event.button !== 1)) return;
    const projectUrl = supabase.storage.from("site-docs").getPublicUrl("").data.publicUrl;
    if (!getSiteDocumentPath(href, projectUrl)) return;
    event.preventDefault();
    // Open during the click so browsers do not block the asynchronous download.
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      toast.error("Allow pop-ups to open this document.");
      return;
    }
    tab.opener = null;
    try {
      const url = await resolveSiteDocumentUrl(href, projectUrl, supabase.storage);
      if (!tab.closed) tab.location.replace(url);
    } catch {
      tab.close();
      toast.error("Unable to open document. Check your access or sign in again.");
    }
  }

  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        void openDocument(event);
      }}
      onAuxClick={(event) => {
        onAuxClick?.(event);
        void openDocument(event);
      }}
    />
  );
}
