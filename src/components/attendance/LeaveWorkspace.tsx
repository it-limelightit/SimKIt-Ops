import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CalendarDays,
  Clock3,
  Check,
  House,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button, Card, Input, Label, Select, Textarea } from "@/components/ui-kit";
import { attendanceRpc, dateLabel, indiaDate } from "@/lib/device-attendance";
import { useAuth } from "@/lib/auth-store";
import { canAccessLeave, canReviewLeave, isTarunLeaveReviewer } from "@/lib/attendance-access";
import { LeaveReviewTable } from "./LeaveReviewTable";
import { MyLeaveRequests } from "./MyLeaveRequests";
import "./leave-workspace.css";
import { LateJustificationFields, loadJustifiableLateDays, type LateDay } from "./LateJustification";
import { toast } from "sonner";
import {
  prepareLeaveSubmission,
  lateArrivalReasons,
  lateArrivalClosed,
  requestTypeLabel,
} from "@/lib/leave-request";

type DayDecision = { leave_date: string; status: "pending" | "approved" | "rejected" };
export type LeaveRequest = {
  id: string;
  employee_id: string | null;
  employee_name?: string;
  department?: string;
  request_type?: "leave" | "wfh" | "late" | "site_visit";
  /** "justification" = late arrival justified after the fact (decided by Tarun). */
  kind?: "advance" | "justification";
  tags?: string[];
  late_minutes?: number | null;
  expected_arrival?: string;
  is_half_day?: boolean;
  category?: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "partial" | string;
  created_at: string;
  comment: string | null;
  approver_emails?: string[];
  days?: DayDecision[];
};
const categories = ["Marriage", "Family medical", "Personal health", "Other"] as const;
type RequestType = "leave" | "wfh" | "late" | "justify" | "site_visit";
function dayCount(from: string, to: string) {
  if (!from || !to) return 0;
  return (
    Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
  );
}
export function LeaveWorkspace(props: {
  embedded?: boolean;
  showHeader?: boolean;
  initialTab?: "review";
}) {
  const email = useAuth((state) => state.email);
  return canAccessLeave(email) ? <LeaveWorkspaceContent {...props} /> : null;
}

function LeaveWorkspaceContent({
  embedded = false,
  showHeader = true,
  initialTab,
}: {
  embedded?: boolean;
  showHeader?: boolean;
  initialTab?: "review";
}) {
  const { userId, email, profile } = useAuth();
  const reviewer = canReviewLeave(email);
  const reviewerOnly = isTarunLeaveReviewer(email);
  const [mine, setMine] = useState<LeaveRequest[]>([]);
  const [queue, setQueue] = useState<LeaveRequest[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [requestType, setRequestType] = useState<RequestType>("leave");
  const [officeStaff, setOfficeStaff] = useState(false);
  const [lateDays, setLateDays] = useState<LateDay[]>([]);
  const [justifyDate, setJustifyDate] = useState("");
  const [justifyTags, setJustifyTags] = useState<string[]>([]);
  const [expectedArrival, setExpectedArrival] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const lateClosed = requestType === "late" && lateArrivalClosed(from, now);
  useEffect(() => {
    if (!formOpen || requestType !== "late") return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [formOpen, requestType]);
  const [wfhEligible, setWfhEligible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyRequest, setBusyRequest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<{ id: string; message: string } | null>(null);
  const [tab, setTab] = useState<"my-requests" | "review">(
    reviewerOnly || (reviewer && initialTab === "review") ? "review" : "my-requests",
  );

  useEffect(() => {
    if (reviewer && initialTab === "review") setTab("review");
  }, [reviewer, initialTab]);
  const [dayDecisions, setDayDecisions] = useState<
    Record<string, Record<string, "pending" | "approved" | "rejected">>
  >({});

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const own = reviewerOnly
        ? []
        : await attendanceRpc<LeaveRequest[]>("attendance_my_leave_requests");
      const ownLate = reviewerOnly
        ? []
        : await attendanceRpc<LeaveRequest[]>("attendance_late_requests", { _review: false });
      setMine(
        [...(own ?? []), ...(ownLate ?? [])].sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        ),
      );
      const eligible = reviewerOnly
        ? false
        : await attendanceRpc<boolean>("attendance_my_wfh_eligibility").catch(() => false);
      setWfhEligible(eligible);
      // Office staff (linked attendance account) can justify late days and request site visits.
      const account = reviewerOnly
        ? null
        : await attendanceRpc<{ id: string } | null>("attendance_my_account").catch(() => null);
      setOfficeStaff(Boolean(account?.id));
      if (account?.id) {
        setLateDays(await loadJustifiableLateDays());
      } else setLateDays([]);
      if (reviewer) {
        const pending = await attendanceRpc<LeaveRequest[]>("attendance_leave_review_queue");
        const late = await attendanceRpc<LeaveRequest[]>("attendance_late_requests", {
          _review: true,
        });
        const combined = [...(pending ?? []), ...(late ?? [])];
        setQueue(combined);
        setDayDecisions(
          Object.fromEntries(
            combined.map((request) => [
              request.id,
              Object.fromEntries((request.days ?? []).map((day) => [day.leave_date, day.status])),
            ]),
          ),
        );
      } else {
        setQueue([]);
        setDayDecisions({});
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load leave requests.");
    } finally {
      setLoading(false);
    }
  }, [reviewer, reviewerOnly]);

  useEffect(() => {
    if (userId) void reload();
  }, [userId, reload]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      let submission: { name: string; args: Record<string, unknown> };
      if (requestType === "justify") {
        if (!justifyDate) throw new Error("Choose the late day you want to justify.");
        if (!justifyTags.length) throw new Error("Pick at least one reason tag.");
        if (justifyTags.includes("Other") && description.trim().length < 5)
          throw new Error("Describe your reason (at least 5 characters).");
        submission = {
          name: "attendance_submit_late_justification",
          args: { _date: justifyDate, _tags: justifyTags, _note: description.trim() },
        };
      } else {
        submission = prepareLeaveSubmission(
          { requestType, from, to, category, description, expectedArrival, halfDay },
          indiaDate(),
        );
      }
      setSubmitting(true);
      await attendanceRpc(submission.name, submission.args);
      const message =
        requestType === "justify"
          ? "Late justification sent to Tarun. If accepted, the day counts as a full day."
          : `${requestTypeLabel(requestType, halfDay)} request sent for review. Track its status in Your requests.`;
      setSubmitSuccess(message);
      setFormOpen(false);
      toast.success(message);
      setFrom("");
      setTo("");
      setCategory("");
      setDescription("");
      setExpectedArrival("");
      setHalfDay(false);
      setJustifyDate("");
      setJustifyTags([]);
      await reload();
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : "Could not submit your request. Try again.";
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (request: LeaveRequest) => {
    const decisions = dayDecisions[request.id] ?? {};
    const days = request.days ?? [];
    if (
      !days.length ||
      days.some((day) => !["approved", "rejected"].includes(decisions[day.leave_date]))
    ) {
      toast.error("Choose approve or reject for every requested day.");
      return;
    }
    setBusyRequest(request.id);
    setReviewError(null);
    try {
      if (request.request_type === "late") {
        await attendanceRpc("attendance_decide_late_request", {
          _request: request.id,
          _decision: decisions[request.start_date],
          _comment: null,
        });
      } else
        await attendanceRpc("attendance_decide_employee_leave_days", {
          _request: request.id,
          _decisions: days.map((day) => ({
            date: day.leave_date,
            decision: decisions[day.leave_date],
          })),
          _comment: null,
        });
      toast.success("Daily leave decisions saved.");
      await reload();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Could not update this request.";
      setReviewError({ id: request.id, message });
      toast.error(message);
    } finally {
      setBusyRequest(null);
    }
  };

  return (
    <main className={`leave-workspace w-full space-y-4 ${embedded ? "py-1" : "p-4 sm:p-5"}`}>
      {showHeader && !embedded && (
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <div>
            <h1>{reviewerOnly ? "Leave & WFH approvals" : "Leave & work from home"}</h1>
            <p className="mt-1 text-xs text-text-secondary">
              {reviewerOnly
                ? "Review requests and record decisions for each date."
                : "Apply for leave and follow the decision for each requested day."}
            </p>
          </div>
          {profile?.name && (
            <span className="text-xs font-medium text-text-secondary">{profile.name}</span>
          )}
        </header>
      )}

      {reviewer && !reviewerOnly && (
        <div
          className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface-raised/60 p-1"
          role="group"
          aria-label="Leave sections"
        >
          <button
            type="button"
            aria-pressed={tab === "my-requests"}
            onClick={() => setTab("my-requests")}
            className={`px-4 py-2 text-xs font-medium ${tab === "my-requests" ? "bg-surface text-lime shadow-sm" : "text-text-secondary hover:bg-surface hover:text-text-primary"}`}
          >
            My requests
          </button>
          <button
            type="button"
            aria-pressed={tab === "review"}
            onClick={() => setTab("review")}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium ${tab === "review" ? "bg-surface text-lime shadow-sm" : "text-text-secondary hover:bg-surface hover:text-text-primary"}`}
          >
            Review requests{" "}
            {queue.length > 0 && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-warning">
                {queue.length}
              </span>
            )}
          </button>
        </div>
      )}

      {error && (
        <Card
          className="flex flex-col gap-3 border-rose-500/25 p-4 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <p className="text-sm text-coral">{error}</p>
          <Button size="sm" variant="secondary" onClick={() => void reload()}>
            <RefreshCw size={14} /> Try again
          </Button>
        </Card>
      )}

      {submitSuccess && !formOpen && (
        <p
          role="status"
          className="rounded-lg border border-mint/20 bg-mint/10 px-3 py-2 text-xs text-mint"
        >
          {submitSuccess}
        </p>
      )}
      {loading ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-text-secondary" role="status">
          <LoaderCircle className="animate-spin" size={17} /> Loading your leave workspace...
        </Card>
      ) : tab === "review" && reviewer ? (
        <LeaveReviewTable
          requests={queue}
          decisions={dayDecisions}
          busyRequest={busyRequest}
          error={reviewError}
          onRefresh={() => void reload()}
          onSave={(request) => void decide(request)}
          onSelect={(id, values) => {
            setDayDecisions((current) => ({ ...current, [id]: values }));
            setReviewError(null);
          }}
        />
      ) : (
        <div className="grid gap-3">
          <MyLeaveRequests
            requests={mine}
            onCreate={() => {
              setSubmitSuccess(null);
              setSubmitError(null);
              if (requestType === "late" && !from) setFrom(indiaDate());
              setFormOpen(true);
            }}
            onRefresh={() => void reload()}
          />

          {!reviewerOnly && formOpen && (
            <Card className="order-first min-w-0 overflow-hidden rounded-xl p-0">
              <div className="border-b border-border bg-surface-raised/50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      requestType === "wfh"
                        ? "bg-indigo-500/15 text-violet"
                        : requestType === "site_visit"
                          ? "bg-teal-500/15 text-teal-600 dark:text-teal-300"
                          : requestType === "justify"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
                            : "bg-lime/15 text-lime"
                    }`}
                  >
                    {requestType === "wfh" ? (
                      <House size={19} />
                    ) : requestType === "site_visit" ? (
                      <MapPin size={19} />
                    ) : requestType === "justify" ? (
                      <MessageSquareText size={19} />
                    ) : (
                      <CalendarDays size={19} />
                    )}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold leading-snug text-text-primary">
                      {requestType === "late"
                        ? "Request late / half-day arrival"
                        : requestType === "wfh"
                          ? "Request work from home"
                          : requestType === "site_visit"
                            ? "Request a site visit"
                            : requestType === "justify"
                              ? "Justify a late arrival"
                              : "Request leave"}
                    </h2>
                    <p className="mt-1 text-xs text-text-secondary">
                      {requestType === "justify"
                        ? "Pick the late day, tag the reason and add a short note for Tarun."
                        : "Choose your dates and share a short reason."}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setFormOpen(false)}
                    className="ml-auto"
                    aria-label="Close request form"
                    disabled={submitting}
                  >
                    <X size={15} />
                    Close
                  </Button>
                </div>
              </div>
              <form
                className="space-y-3 p-4"
                noValidate
                aria-busy={submitting}
                onSubmit={(event) => void submit(event)}
              >
                <fieldset
                  disabled={submitting}
                  className="grid min-w-0 gap-3 md:grid-cols-2 disabled:opacity-70"
                >
                  {
                    <fieldset className="md:col-span-2">
                      <legend className="mb-2 text-xs font-semibold text-text-secondary">
                        Request type
                      </legend>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                        {(
                          [
                            { value: "leave", label: "Leave", icon: CalendarDays },
                            { value: "wfh", label: "Work from home", icon: House },
                            { value: "late", label: "Late / half-day arrival", icon: Clock3 },
                            { value: "justify", label: "Justify late arrival", icon: MessageSquareText },
                            { value: "site_visit", label: "Site visit", icon: MapPin },
                          ] as const
                        )
                          .filter(
                            ({ value }) =>
                              (value !== "wfh" || wfhEligible) &&
                              (!["justify", "site_visit"].includes(value) || officeStaff),
                          )
                          .map(({ value, label, icon: Icon }) => (
                            <button
                              key={value}
                              type="button"
                              aria-pressed={requestType === value}
                              onClick={() => {
                                setRequestType(value);
                                setCategory("");
                                if (value === "late" && !from) setFrom(indiaDate());
                                setSubmitError(null);
                                setSubmitSuccess(null);
                              }}
                              className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-2 py-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime sm:text-sm ${requestType === value ? "border-lime/60 bg-lime/10 text-text-primary" : "border-border bg-surface text-text-secondary hover:border-border-bright"}`}
                            >
                              <Icon size={16} className="shrink-0" />
                              {label}
                              {requestType === value && (
                                <Check size={14} className="shrink-0 text-lime" />
                              )}
                            </button>
                          ))}
                      </div>
                    </fieldset>
                  }
                  {requestType === "justify" && (
                    <LateJustificationFields
                      lateDays={lateDays}
                      date={justifyDate}
                      tags={justifyTags}
                      onDate={(value) => {
                        setJustifyDate(value);
                        setSubmitError(null);
                      }}
                      onTags={(value) => {
                        setJustifyTags(value);
                        setSubmitError(null);
                      }}
                    />
                  )}
                  {requestType !== "justify" && (
                  <div className={["wfh", "site_visit"].includes(requestType) ? "md:col-span-2" : ""}>
                    <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                      <div className="min-w-0">
                        <Label htmlFor="leave-from">
                          {requestType === "late" ? "Arrival date" : "Start date"}
                        </Label>
                        <Input
                          className="min-w-0"
                          id="leave-from"
                          type="date"
                          min={indiaDate()}
                          required
                          value={from}
                          onChange={(event) => {
                            setFrom(event.target.value);
                            if (to && event.target.value > to) setTo("");
                            setSubmitError(null);
                          }}
                        />
                      </div>
                      {requestType !== "late" && (
                        <div className="min-w-0">
                          <Label htmlFor="leave-to">End date</Label>
                          <Input
                            className="min-w-0"
                            id="leave-to"
                            type="date"
                            min={from || indiaDate()}
                            required
                            value={to}
                            onChange={(event) => {
                              setTo(event.target.value);
                              setSubmitError(null);
                            }}
                          />
                        </div>
                      )}
                    </div>
                    {requestType !== "late" && from && to && dayCount(from, to) > 0 && (
                      <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-raised px-3 py-2 text-xs text-text-secondary">
                        <CalendarDays size={14} className="shrink-0" />
                        <span>
                          <strong className="text-text-primary">
                            {dayCount(from, to)} calendar{" "}
                            {dayCount(from, to) === 1 ? "day" : "days"}
                          </strong>{" "}
                          requested · Dates use IST
                        </span>
                      </div>
                    )}
                  </div>
                  )}
                  {requestType === "late" && (
                    <>
                      <div>
                        <Label htmlFor="late-arrival-time">Expected arrival time (IST)</Label>
                        <Input
                          id="late-arrival-time"
                          type="time"
                          required
                          min="10:01"
                          value={expectedArrival}
                          onChange={(event) => {
                            setExpectedArrival(event.target.value);
                            setSubmitError(null);
                          }}
                        />
                      </div>
                      <div>
                        <Label htmlFor="late-arrival-kind">Arrival type</Label>
                        <Select
                          id="late-arrival-kind"
                          value={halfDay ? "half" : "late"}
                          onChange={(event) => setHalfDay(event.target.value === "half")}
                        >
                          <option value="late">Late arrival</option>
                          <option value="half">Half-day arrival</option>
                        </Select>
                      </div>
                      <p
                        role={lateClosed ? "alert" : undefined}
                        className={`rounded-lg border p-3 text-xs md:col-span-2 ${lateClosed ? "border-coral/30 bg-coral/5 text-coral" : "border-border bg-surface-raised text-text-secondary"}`}
                      >
                        {lateClosed ? "Applications for this date are closed. " : ""}Submit by 8:00
                        AM IST on the selected day, two hours before the 10:00 AM office start.
                        Approval is required from your reporting manager.
                      </p>
                    </>
                  )}
                  {(requestType === "leave" || requestType === "late") && (
                    <div>
                      <Label htmlFor="leave-category">Reason category</Label>
                      <Select
                        id="leave-category"
                        required
                        value={category}
                        onChange={(event) => {
                          setCategory(event.target.value);
                          setSubmitError(null);
                        }}
                      >
                        <option value="" disabled>
                          Select a category
                        </option>
                        {(requestType === "late" ? lateArrivalReasons : categories).map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </Select>
                    </div>
                  )}
                  <div className="md:col-span-2">
                    <Label htmlFor="leave-description">
                      {requestType === "wfh"
                        ? "Reason for working from home"
                        : requestType === "site_visit"
                          ? "Site / client and purpose of the visit"
                          : requestType === "justify"
                            ? justifyTags.includes("Other")
                              ? "Explain what happened"
                              : "Note for Tarun (optional)"
                            : "Tell your manager more"}
                    </Label>
                    <Textarea
                      id="leave-description"
                      required={
                        requestType === "justify"
                          ? justifyTags.includes("Other")
                          : requestType !== "late" || category === "Other"
                      }
                      minLength={5}
                      maxLength={1800}
                      rows={3}
                      aria-describedby="leave-description-help"
                      placeholder={
                        requestType === "wfh"
                          ? "Explain why you need to work from home..."
                          : requestType === "site_visit"
                            ? "e.g. Vision Enviro, Raikhad — panel installation and testing"
                            : requestType === "justify"
                              ? "e.g. Heavy traffic at Raikhad junction after the client call"
                              : requestType === "late"
                                ? "Explain your late or half-day arrival..."
                            : "Add a short explanation for your leave..."
                      }
                      value={description}
                      onChange={(event) => {
                        setDescription(event.target.value);
                        setSubmitError(null);
                      }}
                    />
                    <div
                      id="leave-description-help"
                      className="mt-2 flex justify-between gap-2 text-[11px] text-text-dim"
                    >
                      <span>
                        {(requestType === "late" && category !== "Other") ||
                        (requestType === "justify" && !justifyTags.includes("Other"))
                          ? "Additional details (optional)"
                          : "At least 5 characters"}
                      </span>
                      <span>{description.length}/1800</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 md:col-span-2 rounded-xl border border-border bg-surface-raised/50 p-3 text-xs leading-5 text-text-secondary">
                    <ShieldCheck size={17} className="mt-0.5 shrink-0 text-text-dim" />
                    <span>
                      {requestType === "justify" ? (
                        <>
                          <strong className="font-medium text-text-primary">Tarun</strong> decides
                          and Hardik can see it. If accepted, this day counts as a{" "}
                          <strong className="font-medium text-text-primary">full day</strong> instead
                          of a half day.
                        </>
                      ) : requestType === "site_visit" ? (
                        <>
                          <strong className="font-medium text-text-primary">Tarun</strong> approves
                          site visits. Approved days count as a full working day; no office face
                          scan is needed.
                        </>
                      ) : (
                        <>
                          Your manager will review each requested date. Follow the decision in{" "}
                          <strong className="font-medium text-text-primary">Your requests</strong>.
                        </>
                      )}
                    </span>
                  </div>
                </fieldset>
                {submitError && (
                  <p
                    role="alert"
                    className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-coral"
                  >
                    {submitError}
                  </p>
                )}
                {submitSuccess && (
                  <p
                    role="status"
                    className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-mint"
                  >
                    <Check size={17} className="mt-0.5 shrink-0" />
                    {submitSuccess}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={submitting || lateClosed}
                  className="min-h-12 w-full rounded-xl"
                >
                  {submitting ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}{" "}
                  {submitting
                    ? "Sending request…"
                    : lateClosed
                      ? "Deadline passed for this date"
                      : requestType === "justify"
                        ? "Send justification to Tarun"
                        : `Submit ${requestTypeLabel(requestType, halfDay).toLowerCase()} request`}
                </Button>
              </form>
            </Card>
          )}
        </div>
      )}
    </main>
  );
}
