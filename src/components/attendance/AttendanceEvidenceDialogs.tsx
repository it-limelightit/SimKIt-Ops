import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, Input, Textarea } from "@/components/ui-kit";
import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { attendanceRpc, dateLabel, statusLabels, timeLabel, type History } from "@/lib/device-attendance";
import { scanTimeExplanation } from "@/lib/attendance-review";

function VerifyScanTime({ eventId, onResolved }: { eventId: string; onResolved: () => void }) {
  const [time, setTime] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <form className="mt-3 space-y-2" onSubmit={async (event) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await attendanceRpc("attendance_resolve_scan_time", {
        _event: eventId, _verified_at: new Date(`${time}:00+05:30`).toISOString(), _evidence: evidence,
      });
      onResolved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not verify scan time."); }
    finally { setBusy(false); }
  }}>
    <p className="text-xs text-text-secondary">Verify the actual scan time using independent evidence. Arrival time is not proof of entry.</p>
    <label className="block text-xs">Verified scan date and time (IST)
      <Input type="datetime-local" required value={time} onChange={(event) => setTime(event.target.value)} disabled={busy} />
    </label>
    <label className="block text-xs">Supporting evidence
      <Textarea required minLength={10} maxLength={2000} value={evidence} onChange={(event) => setEvidence(event.target.value)} disabled={busy} placeholder="Describe the verified device record or other attendance evidence." />
    </label>
    {error && <p role="alert" className="text-xs text-coral">{error}</p>}
    <Button size="sm" type="submit" disabled={busy}>{busy ? "Saving…" : "Verify scan time"}</Button>
  </form>;
}

export type AttendancePhoto = { url: string; expires_at: string; photo_expires_at: string };
export type AttendanceRecordView = { name: string; date: string; data: History } | null;

export function AttendanceEvidenceDialogs({
  record,
  onCloseRecord,
  photo,
  onClosePhoto,
  onViewPhoto,
  onResolved,
}: {
  record: AttendanceRecordView;
  onCloseRecord: () => void;
  photo: AttendancePhoto | null;
  onClosePhoto: () => void;
  onViewPhoto: (eventId: string) => void;
  onResolved?: () => void;
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
                {event.validation_state === "time_unverified" ? "Entry time unverified" : `Entry time: ${timeLabel(event.scanned_at)}`} ·{" "}
                {(event.validation_state === "time_unverified" ? scanTimeExplanation(event.time_review_reason).title : statusLabels[event.validation_state]) ||
                  event.validation_state.replaceAll("_", " ")}
              </p>
              {event.validation_state === "time_unverified" && <>
                <p className="mt-1 text-xs text-text-secondary">{scanTimeExplanation(event.time_review_reason).reason}</p>
                <p className="mt-1 text-xs text-text-secondary"><span className="font-medium text-text-primary">How to fix: </span>{scanTimeExplanation(event.time_review_reason).fix}</p>
                {event.receiver_received_at && <p className="mt-1 text-xs text-text-secondary">Record arrived: {new Date(event.receiver_received_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>}
                {event.device_time_raw && <p className="mt-1 text-xs text-text-secondary">Unverified device time: {event.device_time_raw}</p>}
                <VerifyScanTime eventId={event.id} onResolved={() => { onCloseRecord(); onResolved?.(); }} />
              </>}
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
