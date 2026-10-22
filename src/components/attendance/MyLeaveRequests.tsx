import { useMemo, useState } from "react";
import { ChevronDown, FileText, Plus, RefreshCw } from "lucide-react";
import { Button, Card, Input, Select } from "@/components/ui-kit";
import { dateLabel } from "@/lib/device-attendance";
import { requestTypeLabel, arrivalTimeLabel } from "@/lib/leave-request";
import type { LeaveRequest } from "./LeaveWorkspace";
import { requestCalendarStyle } from "@/lib/request-calendar";

export function MyLeaveRequests({
  requests,
  onCreate,
  onRefresh,
}: {
  requests: LeaveRequest[];
  onCreate: () => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const filtered = useMemo(
    () =>
      requests.filter(
        (request) =>
          (status === "all" || request.status === status) &&
          (kind === "all" || (request.request_type ?? "leave") === kind) &&
          request.reason.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [requests, status, kind, search],
  );
  const labels: Record<string, string> = {
    "tarun@limelightit.io": "Tarun sir",
    "tarun@limelight.io": "Tarun sir",
    "associatelimelight@gmail.com": "Hitesh Bhai",
    "info@limelightit.io": "Raghav",
    "kuldeepshrimali.limelight@gmail.com": "Kuldeep",
  };
  const tone = (status: string) =>
    status === "approved"
      ? "bg-mint/10 text-mint"
      : status === "rejected"
        ? "bg-coral/10 text-coral"
        : status === "partial"
          ? "bg-violet/10 text-violet"
          : "bg-warning/10 text-warning";
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Request history</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Your requests and the decision for each date.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={onRefresh}
            aria-label="Refresh my requests"
          >
            <RefreshCw size={14} />
          </Button>
          <Button size="sm" onClick={onCreate}>
            <Plus size={14} />
            New request
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {["pending", "approved", "partial", "rejected"].map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={status === value}
            onClick={() => setStatus((current) => (current === value ? "all" : value))}
            className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs ${status === value ? "border-lime bg-lime/5" : "border-border bg-surface hover:bg-surface-raised"}`}
          >
            <span className="capitalize text-text-secondary">
              {value === "partial" ? "Partially approved" : value}
            </span>
            <strong className={tone(value).split(" ")[1]}>
              {requests.filter((request) => request.status === value).length}
            </strong>
          </button>
        ))}
      </div>
      <Card className="overflow-hidden rounded-xl p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface p-3">
          <Input
            aria-label="Search my requests"
            placeholder="Search reason"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-h-9 text-sm sm:w-72"
          />
          <Select
            aria-label="Request status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="min-h-9 text-sm sm:w-44"
          >
            <option value="all">All statuses</option>
            {["pending", "approved", "partial", "rejected"].map((value) => (
              <option key={value} value={value}>
                {value === "partial"
                  ? "Partially approved"
                  : value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Request type"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="min-h-9 text-sm sm:w-40"
          >
            <option value="all">All request types</option>
            <option value="leave">Leave</option>
            <option value="wfh">Work from home</option>
            <option value="late">Late / half-day arrival</option>
          </Select>
        </div>
        {filtered.length ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="leave-history-table w-full text-left text-xs">
                <colgroup>
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "32%" }} />
                  <col style={{ width: "17%" }} />
                  <col style={{ width: "23%" }} />
                </colgroup>
                <caption className="sr-only">My leave and work-from-home request history</caption>
                <thead className="bg-surface-raised/50 text-text-secondary">
                  <tr>
                    {["Request", "Dates", "Reason", "Status", "Day decisions"].map((label) => (
                      <th key={label} scope="col" className="px-4 py-2.5 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((request) => (
                    <tr key={request.id} className="align-top hover:bg-surface-raised/30">
                      <td className="px-4 py-3 font-medium">
                        {requestTypeLabel(request.request_type, request.is_half_day)}
                        <p className="mt-1 whitespace-nowrap text-[10px] font-normal text-text-secondary">
                          {new Date(request.created_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            timeZone: "Asia/Kolkata",
                          })}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="whitespace-nowrap">{dateLabel(request.start_date)}</p>
                        {request.request_type === "late" && (
                          <p className="mt-1 text-xs text-text-secondary">
                            Expected: {arrivalTimeLabel(request.expected_arrival)}
                          </p>
                        )}
                        {request.end_date !== request.start_date && (
                          <p className="mt-1 whitespace-nowrap text-text-secondary">
                            to {dateLabel(request.end_date)}
                          </p>
                        )}
                      </td>
                      <td className="max-w-sm px-4 py-3">
                        <p
                          className="line-clamp-2 break-words text-xs font-normal leading-5 text-text-primary"
                          title={request.reason}
                        >
                          {request.reason.includes(" — ")
                            ? request.reason.split(" — ").slice(1).join(" — ")
                            : request.reason}
                        </p>
                        {request.reason.includes(" — ") && (
                          <p className="mt-1 text-[10px] text-text-secondary">
                            {request.reason.split(" — ")[0]}
                          </p>
                        )}
                        {request.approver_emails?.length ? (
                          <p className="mt-1 text-[10px] text-text-secondary">
                            Review:{" "}
                            {request.approver_emails
                              .map((email) => labels[email] ?? email)
                              .join(", ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 capitalize ${tone(request.status)}`}
                        >
                          {request.status === "partial" ? "Partially approved" : request.status}
                        </span>
                      </td>
                      <td className="min-w-48 px-4 py-3">
                        <RequestDays request={request} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-border md:hidden">
              {filtered.map((request) => (
                <article key={request.id} className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {requestTypeLabel(request.request_type, request.is_half_day)}
                    </p>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] capitalize ${tone(request.status)}`}
                    >
                      {request.status === "partial" ? "Partially approved" : request.status}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">
                    {dateLabel(request.start_date)} – {dateLabel(request.end_date)}
                  </p>
                  {request.request_type === "late" && (
                    <p className="text-xs font-medium text-text-primary">
                      Expected arrival: {arrivalTimeLabel(request.expected_arrival)}
                    </p>
                  )}
                  <p className="break-words text-xs leading-5 text-text-secondary">
                    {request.reason}
                  </p>
                  <RequestDays request={request} />
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="px-4 py-7 text-center">
            <FileText size={23} className="mx-auto mb-2 text-text-dim" />
            <h3 className="text-sm font-semibold">
              {requests.length ? "No matching requests" : "No requests yet"}
            </h3>
            <p className="mt-1 text-xs text-text-secondary">
              {requests.length
                ? "Change or clear the filters."
                : "Use New request to apply for leave or available WFH dates."}
            </p>
            {requests.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                  setKind("all");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        )}
      </Card>
      <p className="text-[11px] text-text-secondary">
        {filtered.length} {filtered.length === 1 ? "request" : "requests"} shown. Expand day
        decisions to see mixed approvals or manager notes.
      </p>
    </section>
  );
}
function RequestDays({ request }: { request: LeaveRequest }) {
  const days = request.days ?? [];
  const approved = days.filter((day) => day.status === "approved").length;
  const rejected = days.filter((day) => day.status === "rejected").length;
  const pending = days.length - approved - rejected;
  return (
    <div className="space-y-2">
      {days.length > 0 && (
        <>
          <div
            className="flex h-1.5 max-w-48 overflow-hidden rounded-full bg-surface-raised"
            role="img"
            aria-label={`${approved} approved, ${rejected} rejected, ${pending} pending days`}
          >
            <span className="bg-mint" style={{ width: `${(approved / days.length) * 100}%` }} />
            <span className="bg-coral" style={{ width: `${(rejected / days.length) * 100}%` }} />
            <span className="bg-warning" style={{ width: `${(pending / days.length) * 100}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px]">
            <span className="text-mint">{approved} approved</span>
            <span className="text-coral">{rejected} rejected</span>
            {pending > 0 && <span className="text-warning">{pending} pending</span>}
          </div>
        </>
      )}
      <details className="text-xs">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-lime">
          <ChevronDown size={13} />
          {days.length
            ? `View ${days.length} ${days.length === 1 ? "date" : "dates"}`
            : "Request details"}
        </summary>
        <div className="mt-2 space-y-1.5">
          {days.map((day) => {
            const style = requestCalendarStyle(request.request_type, day.status);
            return (
              <div
                key={day.leave_date}
                className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
              >
                <span>{dateLabel(day.leave_date)}</span>
                <span className={`rounded border px-1.5 py-0.5 ${style?.tone ?? ""}`}>
                  {day.status}
                </span>
              </div>
            );
          })}
          {request.comment && (
            <p className="rounded-lg bg-surface-raised p-2 text-[11px] text-text-secondary">
              Manager note: {request.comment}
            </p>
          )}
          {!days.length && !request.comment && (
            <p className="text-[11px] text-text-secondary">Status: {request.status}</p>
          )}
        </div>
      </details>
    </div>
  );
}
