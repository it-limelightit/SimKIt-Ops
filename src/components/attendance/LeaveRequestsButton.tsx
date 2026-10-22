import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui-kit";
import { canReviewLeave } from "@/lib/attendance-access";
import { useAuth } from "@/lib/auth-store";
import { attendanceRpc } from "@/lib/device-attendance";

export function LeaveRequestsButton({
  onOpen,
  card = false,
}: {
  onOpen?: () => void;
  card?: boolean;
}) {
  const { userId, email } = useAuth();
  const navigate = useNavigate();
  const allowed = canReviewLeave(email);
  const { data, isPending, isError } = useQuery({
    queryKey: ["overview-leave-requests", userId, email],
    queryFn: async () => {
      const [leave, late] = await Promise.all([
        attendanceRpc<{ id: string }[]>("attendance_leave_review_queue"),
        attendanceRpc<{ id: string }[]>("attendance_late_requests", { _review: true }),
      ]);
      return [...(leave ?? []), ...(late ?? [])];
    },
    enabled: Boolean(userId) && allowed,
    refetchInterval: 30_000,
    staleTime: 0,
  });

  if (!allowed) return null;

  const status = isError
    ? "Unable to load"
    : isPending
      ? "Checking…"
      : data?.length
        ? `${data.length} pending`
        : "No pending requests";

  const openRequests = () => {
    if (onOpen) onOpen();
    else void navigate({ to: "/manager/leave", search: { tab: "review" } });
  };

  if (card)
    return (
      <button
        type="button"
        onClick={openRequests}
        className="group flex h-full w-full flex-col rounded-2xl border border-lime/25 bg-gradient-to-br from-lime/10 via-surface to-surface p-5 text-left transition-colors hover:border-lime/60 sm:p-6"
      >
        <span className="flex w-full items-center justify-between gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-lime/10 text-lime">
            <CalendarDays size={22} />
          </span>
          <span className="rounded-full border border-lime/20 bg-surface px-2.5 py-1 text-xs font-medium text-lime">
            Team approvals
          </span>
        </span>
        <span
          role="status"
          className={`mt-5 text-2xl font-bold tracking-tight ${isError ? "text-coral" : "text-text-primary"}`}
        >
          {status}
        </span>
        <span className="mt-2 text-sm text-text-secondary">
          Leave, work-from-home and arrival requests assigned to you.
        </span>
        <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-lime">
          Review requests{" "}
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
        </span>
      </button>
    );

  return (
    <Button variant="secondary" className="w-full sm:w-auto" onClick={openRequests}>
      <CalendarDays size={16} aria-hidden="true" />
      Req Leave
      <span
        role="status"
        className={`rounded-full px-2 py-0.5 text-xs ${data?.length ? "bg-amber-500/15 text-warning" : "bg-surface-raised text-text-secondary"}`}
      >
        {status}
      </span>
    </Button>
  );
}
