import { Fragment, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button, Card, Input, Select } from "@/components/ui-kit";
import { dateLabel } from "@/lib/device-attendance";
import type { LeaveRequest } from "./LeaveWorkspace";

type Decision = "pending" | "approved" | "rejected";
type Decisions = Record<string, Record<string, Decision>>;
type Props = {
  requests: LeaveRequest[];
  decisions: Decisions;
  busyRequest: string | null;
  error: { id: string; message: string } | null;
  onSelect: (id: string, values: Record<string, Decision>) => void;
  onSave: (request: LeaveRequest) => void;
  onRefresh: () => void;
};

export function LeaveReviewTable({
  requests,
  decisions,
  busyRequest,
  error,
  onSelect,
  onSave,
  onRefresh,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const filtered = useMemo(
    () =>
      requests.filter(
        (request) =>
          (type === "all" || (request.request_type ?? "leave") === type) &&
          `${request.employee_name ?? ""} ${request.department ?? ""} ${request.reason}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      ),
    [requests, search, type],
  );
  return (
    <section className="space-y-3" aria-label="Leave and WFH approvals">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-text-primary">Leave & WFH approvals</h2>
          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
            {requests.length} pending
          </span>
        </div>
        <Button size="sm" variant="secondary" disabled={busyRequest !== null} onClick={onRefresh}>
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>
      <Card className="overflow-hidden rounded-xl p-0">
        <div className="flex flex-col justify-between gap-3 border-b border-border bg-surface px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
              />
              <Input
                className="min-h-9 pl-9 text-sm sm:w-64"
                aria-label="Search leave requests"
                placeholder="Search employee or reason"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select
              aria-label="Request type filter"
              className="min-h-9 text-sm sm:w-40"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="all">All request types</option>
              <option value="leave">Leave</option>
              <option value="wfh">Work from home</option>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span>
              {filtered.length} {filtered.length === 1 ? "request" : "requests"} shown
            </span>
            {(search || type !== "all") && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setType("all");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
        {filtered.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">
                Pending leave and work-from-home requests. Expand a request to approve or reject its
                individual dates.
              </caption>
              <thead className="border-b border-border bg-surface-raised/60">
                <tr>
                  {["Employee", "Request", "Dates", "Reason", "Submitted", "Action"].map(
                    (label) => (
                      <th
                        key={label}
                        scope="col"
                        className="px-4 py-3 text-xs font-semibold text-text-secondary"
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((request) => {
                  const days = request.days ?? [];
                  const choices = decisions[request.id] ?? {};
                  const approved = days.filter(
                    (day) => choices[day.leave_date] === "approved",
                  ).length;
                  const rejected = days.filter(
                    (day) => choices[day.leave_date] === "rejected",
                  ).length;
                  const remaining = days.length - approved - rejected;
                  const ready = days.length > 0 && remaining === 0;
                  const open = expanded === request.id;
                  const selectAll = (choice: Decision) =>
                    onSelect(
                      request.id,
                      Object.fromEntries(days.map((day) => [day.leave_date, choice])),
                    );
                  return (
                    <Fragment key={request.id}>
                      <tr
                        className={`border-b border-border transition-colors ${open ? "bg-lime/5" : "hover:bg-surface-raised/40"}`}
                      >
                        <th scope="row" className="px-4 py-3 font-medium">
                          <p className="whitespace-nowrap text-sm text-text-primary">
                            {request.employee_name || "Employee"}
                          </p>
                          <p className="mt-1 text-xs font-normal capitalize text-text-secondary">
                            {request.department}
                          </p>
                        </th>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${request.request_type === "wfh" ? "bg-violet/10 text-violet" : "bg-lime/10 text-lime"}`}
                          >
                            {request.request_type === "wfh" ? "WFH" : "Leave"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="whitespace-nowrap text-xs text-text-primary">
                            {dateLabel(request.start_date)}
                            {request.end_date !== request.start_date && (
                              <> – {dateLabel(request.end_date)}</>
                            )}
                          </p>
                          <p className="mt-1 text-xs text-text-secondary">
                            {days.length} {days.length === 1 ? "day" : "days"}
                          </p>
                        </td>
                        <td className="max-w-64 px-4 py-3">
                          <p
                            className="line-clamp-2 break-words text-xs leading-5 text-text-secondary"
                            title={request.reason}
                          >
                            {request.reason}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-text-secondary">
                          {new Date(request.created_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            timeZone: "Asia/Kolkata",
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            size="sm"
                            variant={open ? "ghost" : "secondary"}
                            disabled={busyRequest !== null}
                            aria-expanded={open}
                            aria-controls={`review-${request.id}`}
                            onClick={() =>
                              setExpanded((current) => (current === request.id ? null : request.id))
                            }
                          >
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{" "}
                            {open ? "Close" : "Review dates"}
                          </Button>
                          {approved + rejected > 0 && !open && (
                            <p className="mt-1 text-[10px] text-text-secondary">
                              {approved + rejected}/{days.length} selected · unsaved
                            </p>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr id={`review-${request.id}`}>
                          <td
                            colSpan={6}
                            className="border-b border-border bg-surface-raised/30 p-4"
                          >
                            <div className="rounded-lg border border-border bg-surface">
                              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
                                <div className="max-w-xl">
                                  <p className="text-xs font-medium text-text-primary">
                                    Request reason
                                  </p>
                                  <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-text-secondary">
                                    {request.reason}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={busyRequest !== null || !days.length}
                                    className="text-mint"
                                    onClick={() => selectAll("approved")}
                                  >
                                    <Check size={13} />
                                    Select all approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={busyRequest !== null || !days.length}
                                    className="text-coral"
                                    onClick={() => selectAll("rejected")}
                                  >
                                    <X size={13} />
                                    Select all reject
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busyRequest !== null || approved + rejected === 0}
                                    onClick={() => selectAll("pending")}
                                  >
                                    Reset
                                  </Button>
                                </div>
                              </div>
                              <div className="max-h-64 overflow-y-auto">
                                <table className="w-full text-left text-xs">
                                  <caption className="sr-only">
                                    Daily decisions for {request.employee_name}
                                  </caption>
                                  <thead className="bg-surface-raised/40">
                                    <tr>
                                      <th
                                        scope="col"
                                        className="px-4 py-2 font-medium text-text-secondary"
                                      >
                                        Date
                                      </th>
                                      <th
                                        scope="col"
                                        className="px-4 py-2 font-medium text-text-secondary"
                                      >
                                        Day
                                      </th>
                                      <th
                                        scope="col"
                                        className="px-4 py-2 font-medium text-text-secondary"
                                      >
                                        Decision
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {days.map((day) => {
                                      const chosen = choices[day.leave_date] ?? "pending";
                                      return (
                                        <tr key={day.leave_date} className="border-t border-border">
                                          <td className="px-4 py-2 font-medium">
                                            {dateLabel(day.leave_date)}
                                          </td>
                                          <td className="px-4 py-2 text-text-secondary">
                                            {new Date(
                                              `${day.leave_date}T12:00:00+05:30`,
                                            ).toLocaleDateString("en-IN", {
                                              weekday: "short",
                                              timeZone: "Asia/Kolkata",
                                            })}
                                          </td>
                                          <td className="px-4 py-2">
                                            <div
                                              className="flex gap-2"
                                              role="group"
                                              aria-label={`Decision for ${dateLabel(day.leave_date)}`}
                                            >
                                              {(["approved", "rejected"] as const).map((choice) => (
                                                <button
                                                  key={choice}
                                                  type="button"
                                                  disabled={busyRequest !== null}
                                                  aria-pressed={chosen === choice}
                                                  aria-label={`${choice === "approved" ? "Approve" : "Reject"} ${dateLabel(day.leave_date)}`}
                                                  onClick={() =>
                                                    onSelect(request.id, {
                                                      ...choices,
                                                      [day.leave_date]: choice,
                                                    })
                                                  }
                                                  className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-lime disabled:opacity-50 ${chosen === choice ? (choice === "approved" ? "border-mint/30 bg-mint/10 text-mint" : "border-coral/30 bg-coral/10 text-coral") : "border-border text-text-secondary hover:bg-surface-raised"}`}
                                                >
                                                  {choice === "approved" ? (
                                                    <Check size={12} />
                                                  ) : (
                                                    <X size={12} />
                                                  )}{" "}
                                                  {choice === "approved" ? "Approve" : "Reject"}
                                                </button>
                                              ))}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              {error?.id === request.id && (
                                <p
                                  role="alert"
                                  className="mx-4 mb-3 rounded-lg bg-coral/10 p-3 text-xs text-coral"
                                >
                                  {error.message}
                                </p>
                              )}
                              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                                <div className="text-xs text-text-secondary" aria-live="polite">
                                  <span className="font-medium text-mint">{approved} approved</span>{" "}
                                  ·{" "}
                                  <span className="font-medium text-coral">
                                    {rejected} rejected
                                  </span>
                                  {remaining > 0 && <> · {remaining} to choose</>}
                                  <p className="mt-1">
                                    {days.length
                                      ? "Selections take effect after saving."
                                      : "No dates available. Refresh this list."}
                                  </p>
                                </div>
                                <Button
                                  size="sm"
                                  disabled={!ready || busyRequest !== null}
                                  onClick={() => onSave(request)}
                                >
                                  {busyRequest === request.id ? (
                                    <LoaderCircle size={14} className="animate-spin" />
                                  ) : (
                                    <Check size={14} />
                                  )}{" "}
                                  {busyRequest === request.id ? "Saving…" : "Save decisions"}
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center px-5 py-10 text-center">
            <ShieldCheck size={25} className="mb-3 text-mint" />
            <h3 className="text-sm font-semibold">
              {requests.length ? "No matching requests" : "All caught up"}
            </h3>
            <p className="mt-1 text-xs text-text-secondary">
              {requests.length
                ? "Try another employee or request type."
                : "There are no pending requests to review."}
            </p>
          </div>
        )}
      </Card>
      <p className="text-xs text-text-secondary">
        Open a request to approve all dates or record a different decision for each day.
      </p>
    </section>
  );
}
