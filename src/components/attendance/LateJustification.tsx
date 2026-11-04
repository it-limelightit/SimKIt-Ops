import { useEffect, useState } from "react";
import { Check, LoaderCircle, MessageSquareText, Send } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Label, Textarea } from "@/components/ui-kit";
import { attendanceRpc, dateLabel, indiaDate, timeLabel } from "@/lib/device-attendance";
import type { EmployeeCalendar } from "@/lib/employee-calendar";
import { lateJustificationTags } from "@/lib/leave-request";

export type LateDay = { date: string; entry_at: string | null; late_minutes: number };

/** Months whose late days can still be justified: this month, and last month until the 7th (IST). */
export function justificationMonths(today: string) {
  const current = today.slice(0, 7);
  if (Number(today.slice(8, 10)) > 7) return [current];
  const date = new Date(`${current}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return [current, date.toISOString().slice(0, 7)];
}
export function monthTitle(month: string) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}


/** The signed-in employee's late days that can still be justified (not already pending / accepted). */
export async function loadJustifiableLateDays(): Promise<LateDay[]> {
  const today = indiaDate();
  const calendars = await Promise.all(
    justificationMonths(today).map((month) =>
      attendanceRpc<EmployeeCalendar>("attendance_my_calendar", { _month: `${month}-01` }).catch(() => null),
    ),
  );
  return calendars
    .flatMap((calendar) => calendar?.days ?? [])
    .filter(
      (day) =>
        day.status === "late" &&
        (day.late_minutes ?? 0) > 0 &&
        day.date <= today &&
        !(day.late_justification && day.late_justification.status !== "rejected"),
    )
    .map((day) => ({ date: day.date, entry_at: day.entry_at, late_minutes: day.late_minutes ?? 0 }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * "Justify late arrival" card for the attendance section: pick a late day, tag the
 * reason, add a note, send to Tarun. Accepted -> the day counts as a full day.
 */
export function LateJustificationPanel({
  preselect,
  onSubmitted,
}: {
  /** Date chosen from the calendar ("Justify this day"). */
  preselect?: string | null;
  onSubmitted?: () => void;
}) {
  const [lateDays, setLateDays] = useState<LateDay[] | null>(null);
  const [date, setDate] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadJustifiableLateDays().then((days) => {
      if (cancelled) return;
      setLateDays(days);
      setDate((current) => (days.some((d) => d.date === current) ? current : ""));
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (preselect) setDate(preselect);
  }, [preselect]);

  const submit = async () => {
    if (!date) return toast.error("Choose the late day you want to justify.");
    if (!tags.length) return toast.error("Pick at least one reason tag.");
    if (tags.includes("Other") && note.trim().length < 5)
      return toast.error("Describe your reason (at least 5 characters).");
    setBusy(true);
    try {
      await attendanceRpc("attendance_submit_late_justification", {
        _date: date,
        _tags: tags,
        _note: note.trim(),
      });
      toast.success("Late justification sent to Tarun. If accepted, the day counts as a full day.");
      setDate("");
      setTags([]);
      setNote("");
      setRefresh((n) => n + 1);
      onSubmitted?.();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not send the justification.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="justify-late-arrival" className="rounded-2xl p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300">
            <MessageSquareText size={18} />
          </span>
          <div>
            <h3>Justify late arrival</h3>
            <p className="mt-0.5 text-xs text-text-secondary">
              Tarun decides; Hardik can see it. If accepted, the day counts as a full day instead of a
              half day.
            </p>
          </div>
        </div>
        {lateDays && lateDays.length > 0 && (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            {lateDays.length} late {lateDays.length === 1 ? "day" : "days"} to justify
          </span>
        )}
      </div>
      {lateDays === null ? (
        <p className="flex items-center gap-2 text-sm text-text-secondary" role="status">
          <LoaderCircle size={16} className="animate-spin text-lime" /> Loading late days…
        </p>
      ) : !lateDays.length ? (
        <LateJustificationFields lateDays={[]} date="" tags={[]} onDate={() => {}} onTags={() => {}} />
      ) : (
        <div className="space-y-4">
          <LateJustificationFields
            lateDays={lateDays}
            date={date}
            tags={tags}
            onDate={setDate}
            onTags={setTags}
          />
          <div>
            <Label htmlFor="late-justify-note">
              {tags.includes("Other") ? "Explain what happened" : "Note for Tarun (optional)"}
            </Label>
            <Textarea
              id="late-justify-note"
              rows={2}
              maxLength={1800}
              value={note}
              placeholder="e.g. Heavy traffic at Raikhad junction after the client call"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <Button className="w-full sm:w-auto" disabled={busy || !date || !tags.length} onClick={() => void submit()}>
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}
            {busy ? "Sending…" : date ? `Send justification for ${dateLabel(date)}` : "Send justification to Tarun"}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Pick one late day of this month and 1-4 reason tags for a late justification. */
export function LateJustificationFields({
  lateDays,
  date,
  tags,
  onDate,
  onTags,
}: {
  lateDays: LateDay[];
  date: string;
  tags: string[];
  onDate: (date: string) => void;
  onTags: (tags: string[]) => void;
}) {
  const toggle = (tag: string) =>
    onTags(
      tags.includes(tag)
        ? tags.filter((item) => item !== tag)
        : tags.length >= 4
          ? tags
          : [...tags, tag],
    );
  return (
    <div className="space-y-4 md:col-span-2">
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-text-secondary">
          Which late day?{" "}
          <span className="font-normal">(this month, or last month until the 7th)</span>
        </legend>
        {lateDays.length ? (
          <div className="space-y-3">
            {[...new Set(lateDays.map((day) => day.date.slice(0, 7)))].map((month) => (
              <div key={month}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  {monthTitle(month)}
                  {month !== indiaDate().slice(0, 7) && (
                    <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 normal-case tracking-normal text-amber-700 dark:text-amber-300">
                      open until 7 {monthTitle(indiaDate().slice(0, 7)).split(" ")[0]}
                    </span>
                  )}
                </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup">
            {lateDays.filter((day) => day.date.startsWith(month)).map((day) => {
              const active = date === day.date;
              return (
                <button
                  key={day.date}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onDate(day.date)}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime ${active ? "border-lime/60 bg-lime/10" : "border-border bg-surface hover:border-border-bright"}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-primary">
                      {dateLabel(day.date)}
                    </span>
                    <span className="mt-0.5 block text-xs text-text-secondary">
                      Arrived {day.entry_at ? `${timeLabel(day.entry_at)} IST` : "—"}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                    {day.late_minutes} min late
                  </span>
                </button>
              );
            })}
          </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-border bg-surface-raised px-3 py-3 text-xs text-text-secondary">
            No late days to justify. Late days from this month (and last month until the 7th) are
            listed here; days already justified (pending or accepted) are not shown.
          </p>
        )}
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-text-secondary">
          Reason tags <span className="font-normal">(choose 1–4)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {lateJustificationTags.map((tag) => {
            const active = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(tag)}
                disabled={!active && tags.length >= 4}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime disabled:opacity-40 ${active ? "border-lime/60 bg-lime/15 text-text-primary" : "border-border bg-surface text-text-secondary hover:border-border-bright hover:text-text-primary"}`}
              >
                {active && <Check size={12} className="text-lime" />}
                {tag}
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
