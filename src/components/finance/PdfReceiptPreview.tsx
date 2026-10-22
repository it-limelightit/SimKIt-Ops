import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Button } from "@/components/ui-kit";

export function PdfReceiptPreview({ bytes }: { bytes: Uint8Array }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    setDocument(null);
    setPage(1);
    setError(null);
    void (async () => {
      try {
        const [pdfjs, worker] = await Promise.all([
          import("pdfjs-dist/legacy/build/pdf.mjs"),
          import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
        ]);
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        // PDF.js transfers this buffer to its worker; keep the source intact.
        task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true });
        const loaded = await task.promise;
        if (!disposed) setDocument(loaded);
      } catch (failure) {
        if (!disposed)
          setError(failure instanceof Error ? failure.message : "Could not read this PDF.");
      }
    })();
    return () => {
      disposed = true;
      void task?.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document || !canvas.current || width <= 0) return;
    let disposed = false;
    let task: RenderTask | undefined;
    const target = canvas.current;
    setRendering(true);
    setError(null);
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (disposed) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const scale = Math.max(0.1, (width - 24) / original.width);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({ scale: scale * pixelRatio });
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        target.style.width = `${viewport.width / pixelRatio}px`;
        target.style.height = `${viewport.height / pixelRatio}px`;
        task = pdfPage.render({ canvas: target, viewport });
        await task.promise;
        if (!disposed) setRendering(false);
      } catch (failure) {
        if (!disposed) {
          setError(failure instanceof Error ? failure.message : "Could not display this PDF page.");
          setRendering(false);
        }
      }
    })();
    return () => {
      disposed = true;
      task?.cancel();
    };
  }, [document, page, width]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <div className="flex shrink-0 items-center justify-center gap-3 border-b border-border bg-surface p-2">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Previous PDF page"
          disabled={!document || page <= 1}
          onClick={() => setPage((value) => value - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        <span className="text-xs text-text-secondary" role="status">
          {document ? `Page ${page} of ${document.numPages}` : "Loading PDF..."}
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Next PDF page"
          disabled={!document || page >= document.numPages}
          onClick={() => setPage((value) => value + 1)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
      <div ref={container} className="min-h-0 flex-1 overflow-auto p-3">
        {error ? (
          <p role="alert" className="p-4 text-sm text-coral">
            {error}
          </p>
        ) : (
          <>
            {(!document || rendering) && (
              <div className="flex justify-center p-4" role="status">
                <LoaderCircle
                  size={22}
                  className="animate-spin text-lime"
                  aria-label="Rendering PDF"
                />
              </div>
            )}
            <canvas
              ref={canvas}
              role="img"
              aria-label={`PDF page ${page}`}
              data-rendered={Boolean(document) && !rendering}
              className="mx-auto bg-white shadow-sm"
              style={{ display: document && !rendering ? "block" : "none" }}
            />
          </>
        )}
      </div>
    </div>
  );
}
