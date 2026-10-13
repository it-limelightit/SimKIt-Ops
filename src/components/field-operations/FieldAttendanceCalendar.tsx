import { useEffect, useState } from "react";
import { CalendarDays, LoaderCircle } from "lucide-react";
import { Input, Label } from "@/components/ui-kit";
import {
  fieldRpc,
  indiaDate,
  indiaTime,
  monthDays,
  type Associate,
  type FieldBoard,
} from "@/lib/field-operations";
import { useAuth } from "@/lib/auth-store";
import { requestCalendarStyle } from "@/lib/request-calendar";
import "./field-attendance-calendar.css";

type LeaveDay = { date: string; request_type: string; request_status: string; reason: string };
export function FieldAttendanceCalendar({
  board,
  associate,
  month,
  date,
  onMonth,
  onDate,
}: {
  board: FieldBoard;
  associate: Associate;
  month: string;
  date: string;
  onMonth: (month: string) => void;
  onDate: (date: string) => void;
}) {
  const userId = useAuth((state) => state.userId);
  const [requests, setRequests] = useState<LeaveDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fieldRpc("field_ops_leave_calendar", { _associate: associate.id, _month: `${month}-01` })
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error.message);
          return;
        }
        setRequests((result.data as LeaveDay[]) ?? []);
        setError(null);
      })
      .catch((failure) => {
        if (!cancelled)
          setError(failure instanceof Error ? failure.message : "Could not load leave decisions.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [associate.id, month, board, userId]);
  useEffect(() => {
    setRequests([]);
    setLoading(true);
    setError(null);
  }, [associate.id, month, userId]);
  const events = board.attendance.filter((event) => event.associate_id === associate.id);
  const worked = new Set(
    board.earnings
      .filter((entry) => entry.associate_id === associate.id && (entry.eligible || entry.paid))
      .map((entry) => entry.earning_date),
  );
  const days = monthDays(month);
  const selected = requests.find((request) => request.date === date);
  const selectedStyle = requestCalendarStyle(selected?.request_type, selected?.request_status);
  return (
    <aside className="field-attendance-calendar min-w-0 rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <CalendarDays size={16} className="text-lime" />
        <h3 className="text-sm font-semibold">Attendance & leave</h3>
        {loading && <LoaderCircle size={13} className="animate-spin text-text-dim" />}
      </div>
      <Label htmlFor={`field-month-${associate.id}`}>Calendar month</Label>
      <Input
        id={`field-month-${associate.id}`}
        type="month"
        min="2000-01"
        max="2100-12"
        value={month}
        onChange={(event) => {
          if (event.target.value) onMonth(event.target.value);
        }}
      />
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-coral/10 p-2 text-xs text-coral">
          Leave decisions unavailable: {error}
        </p>
      )}
      <div className="field-calendar-grid mt-3 text-center text-xs">
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
          <span key={index} className="py-1 text-text-secondary">
            {day}
          </span>
        ))}
        {Array.from(
          { length: (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7 },
          (_, index) => (
            <span key={`pad-${index}`} aria-hidden="true" />
          ),
        )}
        {days.map((day) => {
          const last = events.find((event) => event.work_date === day);
          const future = day > board.today;
          const before =
            day < indiaDate(new Date(associate.joined)) || day < board.tracking_started;
          const completed = worked.has(day);
          const online = Boolean(last?.online || completed);
          const request = requests.find((value) => value.date === day);
          const style = requestCalendarStyle(request?.request_type, request?.request_status);
          const attendance =
            future || before
              ? "No attendance expected"
              : completed
                ? "Completed work"
                : online
                  ? "Online"
                  : "Offline";
          return (
            <button
              key={day}
              type="button"
              aria-pressed={date === day}
              aria-label={`${day}: ${attendance}${style ? `, ${style.label}` : ""}`}
              title={`${day}: ${attendance}${style ? ` · ${style.label}` : ""}`}
              onClick={() => onDate(day)}
              className={`field-calendar-day border text-xs font-medium focus-visible:outline-2 focus-visible:outline-lime ${style?.tone ?? (future || before ? "border-transparent text-text-secondary" : online ? "border-emerald-200 bg-emerald-100 text-emerald-800" : "border-red-200 bg-red-100 text-red-800")} ${date === day ? "ring-2 ring-lime" : ""}`}
            >
              <span className="block">{Number(day.slice(-2))}</span>
              {request && <span className="field-calendar-decision-marker" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-secondary">
        {[
          { label: "Leave approved", color: "bg-violet-500" },
          { label: "WFH approved", color: "bg-indigo-500" },
          { label: "Rejected", color: "bg-rose-500" },
          { label: "Pending", color: "bg-amber-500" },
          { label: "Online", color: "bg-emerald-500" },
          { label: "Offline", color: "bg-red-300" },
        ].map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1">
            <i aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${item.color}`} />
            {item.label}
          </span>
        ))}
      </div>
      <div className="mt-3 border-t border-border pt-3">
        <h4 className="text-xs font-semibold">{date}</h4>
        {selectedStyle && (
          <>
            <p
              className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[11px] ${selectedStyle.tone}`}
            >
              {selectedStyle.label}
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs text-text-secondary">
              {selected?.reason}
            </p>
          </>
        )}
        <p className="mt-2 text-[11px] text-text-secondary">
          {date > board.today
            ? "Upcoming day"
            : date < board.tracking_started || date < indiaDate(new Date(associate.joined))
              ? "Before tracking"
              : worked.has(date)
                ? "Completed work recorded"
                : events.find((event) => event.work_date === date)?.online
                  ? "Marked online"
                  : "No online activity recorded"}
        </p>
        <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">
          {events
            .filter((event) => event.work_date === date)
            .map((event) => (
              <p key={event.id} className="text-[11px] text-text-secondary">
                {indiaTime(event.occurred_at)} · {event.online ? "Online" : "Offline"} ·{" "}
                {event.actor_name}
              </p>
            ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-text-secondary">
        Active days this month:{" "}
        {
          days.filter(
            (day) => events.find((event) => event.work_date === day)?.online || worked.has(day),
          ).length
        }
      </p>
    </aside>
  );
}
