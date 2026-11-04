import { useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  FileText,
  ImageOff,
  LoaderCircle,
  Maximize2,
  RotateCw,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-store";
import { expenseFileDownload, expenseFileRequest, type ExpenseFile } from "@/lib/finance";
import { PdfReceiptPreview } from "./PdfReceiptPreview";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const STEP = 0.25;
const clampZoom = (value: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));

/** Save bytes as a file with the receipt's original name. */
function saveBytes(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "receipt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExpenseReceipt({ file }: { file: ExpenseFile }) {
  const userId = useAuth((state) => state.userId);
  const image = ["image/jpeg", "image/png"].includes(file.mime_type);
  const pdf = file.mime_type === "application/pdf";
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogUrl, setDialogUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const viewer = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const preview = useQuery({
    queryKey: ["expense-receipt-preview", userId, file.id],
    queryFn: async () => {
      const result = await expenseFileRequest({ id: file.id, preview: true });
      if (!result.url) throw new Error("Receipt preview unavailable");
      return result.url;
    },
    enabled: image && Boolean(userId),
    staleTime: 45_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const open = async () => {
    setDialogOpen(true);
    setDialogUrl(null);
    setPdfBytes(null);
    setDialogError(null);
    setZoom(1);
    setRotation(0);
    setOpening(true);
    try {
      if (pdf) {
        setPdfBytes(await expenseFileDownload(file.id));
      } else if (image) {
        const result = await expenseFileRequest({ id: file.id, preview: true });
        if (!result.url) throw new Error("Receipt unavailable. Please try again.");
        setDialogUrl(result.url);
      } else {
        throw new Error(
          "This document format cannot be previewed. Use Download to open it on your device.",
        );
      }
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Could not open receipt");
    } finally {
      setOpening(false);
    }
  };
  const download = async () => {
    setDownloading(true);
    try {
      const bytes = pdfBytes ?? (await expenseFileDownload(file.id));
      saveBytes(bytes, file.filename, file.mime_type);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download this receipt.");
    } finally {
      setDownloading(false);
    }
  };
  // Keep the point under the cursor roughly in place while zooming.
  const zoomTo = (next: number) => {
    const target = clampZoom(next);
    const el = viewer.current;
    if (el && target !== zoom) {
      const ratio = target / zoom;
      const cx = el.scrollLeft + el.clientWidth / 2;
      const cy = el.scrollTop + el.clientHeight / 2;
      requestAnimationFrame(() => {
        el.scrollLeft = cx * ratio - el.clientWidth / 2;
        el.scrollTop = cy * ratio - el.clientHeight / 2;
      });
    }
    setZoom(target);
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return; // plain wheel scrolls; Ctrl + wheel zooms
    event.preventDefault();
    zoomTo(zoom + (event.deltaY < 0 ? STEP : -STEP));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || !viewer.current) return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewer.current.scrollLeft,
      top: viewer.current.scrollTop,
    };
    viewer.current.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || !viewer.current) return;
    viewer.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    viewer.current.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };
  const endDrag = () => {
    drag.current = null;
  };
  const canZoom = Boolean((image && dialogUrl) || pdfBytes) && !dialogError;

  return (
    <>
      <button
        type="button"
        className={`finance-receipt ${image ? "finance-receipt-image" : "finance-receipt-document"}`}
        onClick={() => void open()}
        disabled={opening}
        title={file.filename}
        aria-label={`Open receipt ${file.filename}`}
      >
        {image ? (
          <span className="finance-receipt-preview">
            {preview.isPending ? (
              <LoaderCircle className="animate-spin" size={20} aria-label="Loading preview" />
            ) : preview.isError || failed ? (
              <span className="finance-receipt-unavailable">
                <ImageOff size={22} />
              </span>
            ) : (
              <img
                src={preview.data}
                alt={file.filename}
                onError={() => setFailed(true)}
                onLoad={() => setFailed(false)}
              />
            )}
            <span className="finance-receipt-expand" aria-hidden="true">
              <Maximize2 size={13} />
            </span>
          </span>
        ) : (
          <span className="finance-receipt-file-icon" aria-hidden="true">
            <FileText size={24} />
            <span>{pdf ? "PDF" : "DOC"}</span>
          </span>
        )}
        <span className="finance-receipt-caption">
          <span className="finance-receipt-name">{file.filename}</span>
          <span className="finance-receipt-meta">
            {opening
              ? "Opening..."
              : `${image ? "View image" : "Open document"} · ${(file.size_bytes / 1e6).toFixed(2)} MB`}
          </span>
        </span>
      </button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="finance-receipt-dialog flex h-[90dvh] w-[calc(100%-1.5rem)] max-w-6xl flex-col gap-3 overflow-hidden border-border bg-surface p-4 sm:p-5">
          <DialogHeader className="shrink-0 pr-7 text-left">
            <DialogTitle className="break-all text-base">{file.filename}</DialogTitle>
            <DialogDescription>
              Receipt preview · {(file.size_bytes / 1e6).toFixed(2)} MB
              {canZoom && image ? " · Double-click to zoom, drag to move, Ctrl + wheel to zoom" : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="finance-receipt-toolbar" role="toolbar" aria-label="Receipt view controls">
            <div className="finance-receipt-toolbar-group">
              <button
                type="button"
                onClick={() => zoomTo(zoom - STEP)}
                disabled={!canZoom || zoom <= MIN_ZOOM}
                aria-label="Zoom out"
                title="Zoom out"
              >
                <ZoomOut size={16} />
              </button>
              <span className="finance-receipt-zoom" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => zoomTo(zoom + STEP)}
                disabled={!canZoom || zoom >= MAX_ZOOM}
                aria-label="Zoom in"
                title="Zoom in"
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setRotation(0);
                }}
                disabled={!canZoom || (zoom === 1 && rotation === 0)}
                aria-label="Fit to screen"
                title="Fit to screen"
              >
                <Scan size={16} />
                <span>Fit</span>
              </button>
              {image && (
                <button
                  type="button"
                  onClick={() => setRotation((value) => (value + 90) % 360)}
                  disabled={!canZoom}
                  aria-label="Rotate"
                  title="Rotate 90°"
                >
                  <RotateCw size={16} />
                  <span>Rotate</span>
                </button>
              )}
            </div>
            <button
              type="button"
              className="finance-receipt-download"
              onClick={() => void download()}
              disabled={downloading}
              aria-label={`Download ${file.filename}`}
            >
              {downloading ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
              <span>{downloading ? "Downloading…" : "Download"}</span>
            </button>
          </div>
          <div
            ref={viewer}
            className={`finance-receipt-viewer ${zoom > 1 ? "is-zoomed" : ""}`}
            onWheel={onWheel}
            onPointerDown={image ? onPointerDown : undefined}
            onPointerMove={image ? onPointerMove : undefined}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {opening ? (
              <LoaderCircle className="m-auto animate-spin text-lime" aria-label="Loading receipt" />
            ) : dialogError ? (
              <p role="alert" className="m-auto p-5 text-sm text-coral">
                {dialogError}
              </p>
            ) : pdfBytes ? (
              <PdfReceiptPreview bytes={pdfBytes} zoom={zoom} />
            ) : (
              dialogUrl && (
                <img
                  src={dialogUrl}
                  alt={file.filename}
                  draggable={false}
                  onDoubleClick={() => zoomTo(zoom > 1 ? 1 : 2)}
                  className="finance-receipt-full"
                  style={
                    zoom > 1
                      ? { width: `${zoom * 100}%`, transform: `rotate(${rotation}deg)` }
                      : { transform: `rotate(${rotation}deg)` }
                  }
                  onError={() =>
                    setDialogError(
                      "Could not display this receipt. Use Download to open it, or try again.",
                    )
                  }
                />
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
