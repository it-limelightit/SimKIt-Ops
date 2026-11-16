import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, Check, Clock3, Loader2, Pencil, Plus, Sun, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Textarea } from "@/components/ui-kit";
import { attendanceRpc, indiaDate, type Settings } from "@/lib/device-attendance";
import {
  groupOffDays,
  inclusiveDays,
  offDayDateLabel,
  type OfficeOffDay,
  type OfficeOffDayRange,
} from "@/lib/office-off-days";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-2 text-sm">
      <span className="font-medium text-text-primary">{label}</span>
      {children}
    </label>
  );
}

export function OfficeAttendanceSettings({
  current,
  busy,
  staffCount,
  saveSchedule,
  onChange,
  onSavingChange,
}: {
  current: Settings | null;
  busy: boolean;
  staffCount: number;
  saveSchedule: (input: Record<string, unknown>) => Promise<void>;
  onChange: () => Promise<void>;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [section, setSection] = useState("off-days");
  const [start, setStart] = useState(current?.shift_start.slice(0, 5) || "10:00");
  const [grace, setGrace] = useState(current?.grace_minutes ?? 15);
  const [workingDays, setWorkingDays] = useState(current?.working_days ?? [1, 2, 3, 4, 5]);
  const [from, setFrom] = useState(indiaDate());
  const [through, setThrough] = useState(indiaDate());
  const [reason, setReason] = useState("");
  const [offDays, setOffDays] = useState<OfficeOffDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<OfficeOffDayRange | null>(null);
  const disabled = busy || saving;
  const count = inclusiveDays(from, through);
  const ranges = groupOffDays(offDays);
  const presets = ["Diwali vacation", "Public holiday", "Office closed", "Team holiday"];

  async function loadDays() {
    setLoading(true);
    setLoadError("");
    try {
      setOffDays(await attendanceRpc<OfficeOffDay[]>("attendance_office_off_days"));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load office holidays.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadDays();
  }, []);

  async function changeOffDays(remove?: OfficeOffDayRange) {
    if (!remove && (!count || count > 366 || reason.trim().length < 3)) {
      toast.error("Choose up to 366 days and add a reason of at least 3 characters.");
      return;
    }
    setSaving(true);
    onSavingChange?.(true);
    try {
      if (remove)
        await attendanceRpc("attendance_remove_off_days", {
          _start: remove.start,
          _end: remove.end,
        });
      else
        await attendanceRpc("attendance_save_off_days", {
          _start: from,
          _end: through,
          _reason: reason.trim(),
        });
      setRemoving(null);
      if (!remove) setReason("");
      toast.success(
        remove
          ? "Office off days removed. Weekly off days still apply."
          : "Off days saved for all office staff.",
      );
      await Promise.all([loadDays(), onChange()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save off days.");
    } finally {
      setSaving(false);
      onSavingChange?.(false);
    }
  }

  return (
    <div className="space-y-5">
      <div
        className="grid grid-cols-2 gap-1 rounded-xl bg-surface-raised p-1"
        role="tablist"
        aria-label="Office attendance settings"
      >
        {[
          { id: "off-days", label: "Off days", icon: Sun },
          { id: "schedule", label: "Office schedule", icon: Clock3 },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`office-tab-${id}`}
            aria-controls={`office-panel-${id}`}
            aria-selected={section === id}
            disabled={disabled}
            tabIndex={section === id ? 0 : -1}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const tabs = Array.from(
                event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                ),
              );
              const index = tabs.indexOf(event.currentTarget);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              tabs[next].click();
              tabs[next].focus();
            }}
            onClick={() => {
              setSection(id);
              setRemoving(null);
            }}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold transition-colors sm:text-sm ${section === id ? "bg-surface text-lime shadow-sm" : "text-text-secondary hover:bg-surface/60"}`}
          >
            <Icon className="hidden h-4 w-4 sm:block" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {section === "off-days" && (
        <div
          role="tabpanel"
          id="office-panel-off-days"
          aria-labelledby="office-tab-off-days"
          className="space-y-5"
        >
          <div className="flex items-start gap-3 rounded-xl border border-lime/15 bg-lime/5 p-4">
            <div className="rounded-lg bg-lime/10 p-2 text-lime">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Give the whole office a day off
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                Choose a single day or a vacation range. All {staffCount || "active"} office staff
                will have off days instead of absences, including for past dates.
              </p>
            </div>
          </div>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void changeOffDays();
            }}
          >
            <fieldset
              disabled={disabled || loading || !!loadError}
              className="space-y-4 disabled:opacity-60"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="From">
                  <Input
                    type="date"
                    required
                    min="2000-01-01"
                    max="2100-12-31"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      if (e.target.value > through) setThrough(e.target.value);
                    }}
                  />
                </Field>
                <Field label="Through (inclusive)">
                  <Input
                    type="date"
                    required
                    min={from}
                    max="2100-12-31"
                    value={through}
                    onChange={(e) => setThrough(e.target.value)}
                  />
                </Field>
              </div>
              <div className="space-y-2">
                <Field label="Reason / holiday name">
                  <Textarea
                    required
                    minLength={3}
                    maxLength={200}
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Diwali vacation"
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {presets.map((preset) => (
                    <button
                      type="button"
                      key={preset}
                      onClick={() => setReason(preset)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${reason === preset ? "border-lime/40 bg-lime/10 text-lime" : "border-border text-text-secondary hover:border-lime/40 hover:text-text-primary"}`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised/50 p-3">
                <div className="text-xs text-text-secondary">
                  <span className="font-semibold text-text-primary">
                    {count ? `${count} ${count === 1 ? "day" : "days"}` : "Choose dates"}
                  </span>{" "}
                  · All office staff
                  <span className="mt-1 block">
                    {count
                      ? `${offDayDateLabel(from)}${from !== through ? ` – ${offDayDateLabel(through)}` : ""}`
                      : "Both dates are included."}
                  </span>
                </div>
                <Button
                  type="submit"
                  disabled={
                    disabled ||
                    loading ||
                    !!loadError ||
                    !count ||
                    count > 366 ||
                    reason.trim().length < 3
                  }
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}{" "}
                  {saving ? "Saving…" : "Save off days"}
                </Button>
              </div>
            </fieldset>
          </form>
          <div className="border-t border-border pt-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-text-primary">
                Saved holidays & vacations
              </h3>
              <span className="text-xs text-text-secondary">
                {offDays.length} {offDays.length === 1 ? "day" : "days"}
              </span>
            </div>
            {loading ? (
              <p role="status" className="py-5 text-center text-sm text-text-secondary">
                Loading holidays…
              </p>
            ) : loadError ? (
              <div
                role="alert"
                className="space-y-2 rounded-lg border border-coral/20 p-3 text-sm text-coral"
              >
                <p>{loadError}</p>
                <Button type="button" variant="secondary" onClick={() => void loadDays()}>
                  Try again
                </Button>
              </div>
            ) : !ranges.length ? (
              <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-text-secondary">
                No office holidays yet. Add your first day off above.
              </p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {ranges.map((range) => (
                  <div key={range.start} className="rounded-xl border border-border bg-surface p-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-lg bg-mint/10 p-2 text-mint">
                        <Sun className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-semibold text-text-primary">
                          {range.reason}
                        </p>
                        <p className="mt-1 text-xs text-text-secondary">
                          {offDayDateLabel(range.start)}
                          {range.start !== range.end && ` – ${offDayDateLabel(range.end)}`} ·{" "}
                          {range.days} {range.days === 1 ? "day" : "days"}
                        </p>
                        <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-mint">
                          <Check className="h-3 w-3" />
                          Off day · All office staff
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`Edit ${range.reason}`}
                        title="Use these dates and reason"
                        className="rounded-lg p-2 text-text-secondary hover:bg-surface-raised"
                        onClick={() => {
                          setFrom(range.start);
                          setThrough(range.end);
                          setReason(range.reason);
                          setRemoving(null);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`Remove ${range.reason}`}
                        title="Remove off days"
                        className="rounded-lg p-2 text-text-secondary hover:bg-coral/10 hover:text-coral"
                        onClick={() => setRemoving(range)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {removing?.start === range.start && (
                      <div className="mt-3 space-y-2 border-t border-border pt-3">
                        <p className="text-xs text-text-secondary">
                          Remove these office holidays? Attendance will follow the weekly schedule
                          and any approved leave.
                        </p>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={disabled}
                            onClick={() => setRemoving(null)}
                          >
                            Keep holidays
                          </Button>
                          <Button
                            type="button"
                            disabled={disabled}
                            onClick={() => void changeOffDays(range)}
                          >
                            {saving ? "Removing…" : "Remove off days"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {section === "schedule" && (
        <form
          role="tabpanel"
          id="office-panel-schedule"
          aria-labelledby="office-tab-schedule"
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!workingDays.length) {
              toast.error("Select at least one working day.");
              return;
            }
            void saveSchedule({
              _start: start,
              _grace: grace,
              _cutoff: null,
              _days: workingDays,
              _holidays: current?.holidays || [],
            });
          }}
        >
          <fieldset disabled={disabled} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Office start (IST)">
                <Input
                  type="time"
                  required
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </Field>
              <Field label="Grace period (minutes)">
                <Input
                  type="number"
                  required
                  min={0}
                  max={120}
                  value={grace}
                  onChange={(e) => setGrace(Number(e.target.value))}
                />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-text-primary">
                Weekly working days
              </legend>
              <div className="grid grid-cols-7 gap-1.5">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, index) => (
                  <label
                    key={label}
                    className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-1 py-3 text-xs font-medium ${workingDays.includes(index) ? "border-lime/30 bg-lime/5 text-lime" : "border-border text-text-secondary"}`}
                  >
                    <input
                      type="checkbox"
                      checked={workingDays.includes(index)}
                      onChange={(e) =>
                        setWorkingDays(
                          e.target.checked
                            ? [...workingDays, index]
                            : workingDays.filter((day) => day !== index),
                        )
                      }
                      className="accent-[var(--color-lime)]"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-text-secondary">
                Unchecked days are weekly off days.
              </p>
            </fieldset>
            <p className="rounded-xl bg-surface-raised p-3 text-xs leading-relaxed text-text-secondary">
              Schedule changes apply from today. Use Off days to mark holidays on past or future
              dates. A working day is marked absent after midnight IST if no valid scan or approved
              leave is recorded.
            </p>
            <Button type="submit" disabled={disabled} className="w-full">
              {busy ? "Saving…" : "Save office schedule"}
            </Button>
          </fieldset>
        </form>
      )}
    </div>
  );
}
