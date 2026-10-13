import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CalendarDays,
  Check,
  House,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button, Card, Input, Label, Select, Textarea } from "@/components/ui-kit";
import { attendanceRpc, dateLabel, indiaDate } from "@/lib/device-attendance";
import { useAuth } from "@/lib/auth-store";
import { canReviewLeave, isTarunLeaveReviewer } from "@/lib/attendance-access";
import { LeaveReviewTable } from "./LeaveReviewTable";
import { MyLeaveRequests } from "./MyLeaveRequests";
import "./leave-workspace.css";
import { toast } from "sonner";
import { prepareLeaveSubmission } from "@/lib/leave-request";

type DayDecision = { leave_date: string; status: "pending" | "approved" | "rejected" };
export type LeaveRequest = {
  id: string;
  employee_id: string | null;
  employee_name?: string;
  department?: string;
  request_type?: "leave" | "wfh";
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

function dayCount(from: string, to: string) {
  if (!from || !to) return 0;
  return (
    Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
  );
}
export function LeaveWorkspace({
  embedded = false,
  showHeader = true,
}: {
  embedded?: boolean;
  showHeader?: boolean;
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
  const [requestType, setRequestType] = useState<"leave" | "wfh">("leave");
  const [wfhEligible, setWfhEligible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyRequest, setBusyRequest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<{ id: string; message: string } | null>(null);
  const [tab, setTab] = useState<"my-requests" | "review">(reviewerOnly ? "review" : "my-requests");
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
      setMine(own ?? []);
      const eligible = reviewerOnly
        ? false
        : await attendanceRpc<boolean>("attendance_my_wfh_eligibility").catch(() => false);
      setWfhEligible(eligible);
      if (reviewer) {
        const pending = await attendanceRpc<LeaveRequest[]>("attendance_leave_review_queue");
        setQueue(pending ?? []);
        setDayDecisions(
          Object.fromEntries(
            (pending ?? []).map((request) => [
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
      const submission = prepareLeaveSubmission(
        { requestType, from, to, category, description },
        indiaDate(),
      );
      setSubmitting(true);
      await attendanceRpc(submission.name, submission.args);
      const message = `${requestType === "wfh" ? "Work-from-home" : "Leave"} request sent for review. Track its status in Your requests.`;
      setSubmitSuccess(message);
      setFormOpen(false);
      toast.success(message);
      setFrom("");
      setTo("");
      setCategory("");
      setDescription("");
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
              setFormOpen(true);
            }}
            onRefresh={() => void reload()}
          />

          {!reviewerOnly && formOpen && (
            <Card className="order-first min-w-0 overflow-hidden rounded-xl p-0">
              <div className="border-b border-border bg-surface-raised/50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${requestType === "wfh" ? "bg-indigo-500/15 text-violet" : "bg-lime/15 text-lime"}`}
                  >
                    {requestType === "wfh" ? <House size={19} /> : <CalendarDays size={19} />}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold leading-snug text-text-primary">
                      {requestType === "wfh" ? "Request work from home" : "Request leave"}
                    </h2>
                    <p className="mt-1 text-xs text-text-secondary">
                      Choose your dates and share a short reason.
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
                  {wfhEligible && (
                    <fieldset className="md:col-span-2">
                      <legend className="mb-2 text-xs font-semibold text-text-secondary">
                        Request type
                      </legend>
                      <div className="grid max-w-sm grid-cols-2 gap-2">
                        {(
                          [
                            { value: "leave", label: "Leave", icon: CalendarDays },
                            { value: "wfh", label: "Work from home", icon: House },
                          ] as const
                        ).map(({ value, label, icon: Icon }) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={requestType === value}
                            onClick={() => {
                              setRequestType(value);
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
                  )}
                  <div className={requestType === "wfh" ? "md:col-span-2" : ""}>
                    <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                      <div className="min-w-0">
                        <Label htmlFor="leave-from">Start date</Label>
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
                    </div>
                    {from && to && dayCount(from, to) > 0 && (
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
                  {requestType === "leave" && (
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
                        {categories.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </Select>
                    </div>
                  )}
                  <div className="md:col-span-2">
                    <Label htmlFor="leave-description">
                      {requestType === "wfh"
                        ? "Reason for working from home"
                        : "Tell your manager more"}
                    </Label>
                    <Textarea
                      id="leave-description"
                      required
                      minLength={5}
                      maxLength={1800}
                      rows={3}
                      aria-describedby="leave-description-help"
                      placeholder={
                        requestType === "wfh"
                          ? "Explain why you need to work from home..."
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
                      <span>At least 5 characters</span>
                      <span>{description.length}/1800</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 md:col-span-2 rounded-xl border border-border bg-surface-raised/50 p-3 text-xs leading-5 text-text-secondary">
                    <ShieldCheck size={17} className="mt-0.5 shrink-0 text-text-dim" />
                    <span>
                      Your manager will review each requested date. Follow the decision in{" "}
                      <strong className="font-medium text-text-primary">Your requests</strong>.
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
                <Button type="submit" disabled={submitting} className="min-h-12 w-full rounded-xl">
                  {submitting ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}{" "}
                  {submitting
                    ? "Sending request…"
                    : `Submit ${requestType === "wfh" ? "WFH" : "leave"} request`}
                </Button>
              </form>
            </Card>
          )}
        </div>
      )}
    </main>
  );
}
