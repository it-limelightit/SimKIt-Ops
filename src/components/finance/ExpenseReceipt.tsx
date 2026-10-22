import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, ImageOff, LoaderCircle, Maximize2 } from "lucide-react";
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

export function ExpenseReceipt({ file }: { file: ExpenseFile }) {
  const userId = useAuth((state) => state.userId);
  const image = ["image/jpeg", "image/png"].includes(file.mime_type);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogUrl, setDialogUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
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
    setOpening(true);
    try {
      if (file.mime_type === "application/pdf") {
        setPdfBytes(await expenseFileDownload(file.id));
      } else if (image) {
        const result = await expenseFileRequest({ id: file.id, preview: true });
        if (!result.url) throw new Error("Receipt unavailable. Please try again.");
        setDialogUrl(result.url);
      } else {
        throw new Error(
          "This document format cannot be previewed. Please upload a PDF, JPG or PNG.",
        );
      }
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Could not open receipt");
    } finally {
      setOpening(false);
    }
  };

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
            <span>{file.mime_type === "application/pdf" ? "PDF" : "DOC"}</span>
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
        <DialogContent className="finance-receipt-dialog flex h-[85dvh] w-[calc(100%-2rem)] max-w-5xl flex-col gap-3 overflow-hidden border-border bg-surface p-4 sm:p-5">
          <DialogHeader className="shrink-0 pr-7 text-left">
            <DialogTitle className="break-all text-base">{file.filename}</DialogTitle>
            <DialogDescription>
              Receipt preview · {(file.size_bytes / 1e6).toFixed(2)} MB
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg border border-border bg-surface-raised">
            {opening ? (
              <LoaderCircle className="animate-spin text-lime" aria-label="Loading receipt" />
            ) : dialogError ? (
              <p role="alert" className="p-5 text-sm text-coral">
                {dialogError}
              </p>
            ) : pdfBytes ? (
              <PdfReceiptPreview bytes={pdfBytes} />
            ) : (
              dialogUrl && (
                <img
                  src={dialogUrl}
                  alt={file.filename}
                  className="h-full w-full object-contain"
                  onError={() =>
                    setDialogError(
                      "Could not display this receipt. Close the preview and try again.",
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
