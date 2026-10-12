import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui-kit";
import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { dateLabel, statusLabels, timeLabel, type History } from "@/lib/device-attendance";

export type AttendancePhoto = { url: string; expires_at: string; photo_expires_at: string };
export type AttendanceRecordView = { name: string; date: string; data: History } | null;

export function AttendanceEvidenceDialogs({
  record,
  onCloseRecord,
  photo,
  onClosePhoto,
  onViewPhoto,
}: {
  record: AttendanceRecordView;
  onCloseRecord: () => void;
  photo: AttendancePhoto | null;
  onClosePhoto: () => void;
  onViewPhoto: (eventId: string) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!photo) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [photo]);
  useEffect(() => {
    if (photo && Date.parse(photo.expires_at) <= now) onClosePhoto();
  }, [now, photo, onClosePhoto]);

  function photoAction(eventId: string, photoStatus?: string, photoExpiresAt?: string) {
    if (photoExpiresAt && Date.parse(photoExpiresAt) <= now)
      return <span className="text-xs text-text-secondary">Expired at 2:00 am IST</span>;
    if (eventId && photoStatus === "available")
      return (
        <Button size="sm" variant="ghost" onClick={() => onViewPhoto(eventId)}>
          <ImageIcon size={15} /> View photo
        </Button>
      );
    return <span className="text-xs text-text-secondary">Photo unavailable</span>;
  }

  return (
    <>
      <Dialog
        open={!!record}
        onOpenChange={(open) => {
          if (!open) onCloseRecord();
        }}
      >
        <DialogContent className="attendance-dialog max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{record?.name} · Scan history</DialogTitle>
            <DialogDescription>{dateLabel(record?.date || null)} · Times in IST</DialogDescription>
          </DialogHeader>
          {record?.data.events.map((event) => (
            <div key={event.id} className="rounded-xl border border-border bg-surface p-4">
              <p className="text-sm font-medium">
                Entry time: {timeLabel(event.scanned_at)} ·{" "}
                {statusLabels[event.validation_state] ||
                  event.validation_state.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                Saved to database:{" "}
                {new Date(event.received_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}{" "}
                IST
              </p>
              {photoAction(event.id, event.photo_status, event.photo_expires_at)}
            </div>
          ))}
          {record?.data.events.length === 0 && (
            <p className="text-sm text-text-secondary">No scans recorded.</p>
          )}
          {!!record?.data.audit.length && (
            <h3 className="mt-3 border-t border-border pt-4 text-sm font-semibold">Activity log</h3>
          )}
          {record?.data.audit.map((audit) => (
            <div key={audit.id} className="text-xs text-text-secondary">
              <p className="capitalize">
                {audit.action.replaceAll("_", " ")} · {timeLabel(audit.occurred_at)} IST
              </p>
              {typeof audit.details.before === "string" &&
                typeof audit.details.after === "string" &&
                Number.isFinite(Date.parse(audit.details.before)) &&
                Number.isFinite(Date.parse(audit.details.after)) && (
                  <p className="mt-1">
                    Entry updated from {timeLabel(audit.details.before)} to{" "}
                    {timeLabel(audit.details.after)} IST
                  </p>
                )}
            </div>
          ))}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!photo}
        onOpenChange={(open) => {
          if (!open) onClosePhoto();
        }}
      >
        <DialogContent className="attendance-dialog">
          <DialogHeader>
            <DialogTitle>Attendance photo</DialogTitle>
            <DialogDescription>
              Private evidence. Photo expiry:{" "}
              {photo
                ? new Date(photo.photo_expires_at).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })
                : ""}{" "}
              IST
            </DialogDescription>
          </DialogHeader>
          {photo && (
            <img
              src={photo.url}
              alt="Employee attendance scan"
              className="max-h-[60vh] w-full rounded-lg object-contain"
            />
          )}
          <p className="text-xs text-text-secondary">
            This preview closes when its short-lived access expires.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
