import { SimKitLogo } from "@/components/SimKitLogo";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Boxes,
  Check,
  Clock3,
  House,
  LayoutDashboard,
  LogOut,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import { FinanceWorkspace } from "@/components/finance/FinanceWorkspace";
import { canManageFinance } from "@/lib/finance";
import { useAuth } from "@/lib/auth-store";
import { isRestrictedManager, managerHomePath } from "@/lib/manager-access";
import { attendanceRpc, dateLabel, indiaDate, timeLabel } from "@/lib/device-attendance";
import { Button } from "@/components/ui-kit";
import { EmployeeCalendar } from "@/components/attendance/EmployeeCalendar";
import { LeaveWorkspace } from "@/components/attendance/LeaveWorkspace";
import { LeaveRequestsButton } from "@/components/attendance/LeaveRequestsButton";
import { canReviewLeave } from "@/lib/attendance-access";
import { FirmwareInventory } from "@/components/inventory/FirmwareInventory";
import { firmwareInventoryRpc } from "@/lib/firmware-inventory";
import "@/components/attendance/employee-portal.css";

export const Route = createFileRoute("/employee")({ ssr: false, component: EmployeePortal });
type Account = { id: string; name: string; enroll_id: string; active: boolean };
type Entry = { work_date: string; entry_at: string; late_minutes: number | null };
function entryStatus(entry: Entry) {
  return entry.late_minutes === null ? "review" : entry.late_minutes > 0 ? "late" : "on-time";
}
function EntryStatus({ entry }: { entry: Entry }) {
  const status = entryStatus(entry);
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${status === "review" ? "bg-violet/10 text-violet" : status === "late" ? "bg-warning/10 text-warning" : "bg-mint/10 text-mint"}`}
    >
      {status === "on-time" ? <Check size={12} /> : <Clock3 size={12} />}
      {status === "review"
        ? "Needs review"
        : status === "late"
          ? `${entry.late_minutes} min late`
          : "On time"}
    </span>
  );
}

function EmployeePortal() {
  const { ready, userId, role, email, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [firmwareInventory, setFirmwareInventory] = useState(false);
  const reviewer = canReviewLeave(email);
  const [selectedTab, setTab] = useState<
    "overview" | "review" | "leave" | "attendance" | "expense" | "inventory" | null
  >(null);
  const tab = selectedTab ?? (reviewer ? "overview" : "leave");

  useEffect(() => {
    if (!ready) return;
    if (!userId) {
      void navigate({ to: "/auth" });
      return;
    }
    if (isRestrictedManager(email)) {
      void navigate({ to: managerHomePath(email) });
      return;
    }
    if (role !== "employee") {
      void navigate({ to: role === "supervisor" ? "/manager/leave" : "/business-consultant" });
      return;
    }
    let cancelled = false;
    setAccount(null);
    setFirmwareInventory(false);
    setEntries([]);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const next = await attendanceRpc<Account | null>("attendance_my_account");
        if (!next?.active)
          throw new Error(
            "Your office account is inactive or not linked. Contact your administrator.",
          );
        const history = await attendanceRpc<Entry[]>("attendance_my_history");
        const inventoryAccess = await firmwareInventoryRpc<boolean>("firmware_inventory_access").catch(() => false);
        if (!cancelled) {
          setAccount(next);
          setEntries(history ?? []);
          setFirmwareInventory(inventoryAccess);
        }
      } catch (failure) {
        if (!cancelled)
          setError(
            failure instanceof Error ? failure.message : "Could not load your employee account.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, userId, role, email, navigate]);

  const todayEntry = entries.find((entry) => entry.work_date === indiaDate());
  const name = account?.name || profile?.name || "Employee";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  if (!ready || !userId || role !== "employee" || isRestrictedManager(email)) return null;
  return (
    <div className="employee-portal min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div>
              <a href="/employee" className="simkit-brand-link" aria-label="SimKit employee home"><SimKitLogo /></a>
              <p className="mt-0.5 text-xs text-text-secondary">
                {reviewer ? "Team approvals & employee portal" : "Employee portal"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{name}</p>
              <p className="mt-0.5 text-xs text-text-secondary">
                {account ? `Employee ID ${account.enroll_id}` : "Office employee"}
              </p>
            </div>
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full bg-lime/10 text-xs font-semibold text-lime"
              aria-hidden="true"
            >
              {initials}
            </div>
            <Button size="sm" variant="ghost" aria-label="Sign out" onClick={() => void signOut()}>
              <LogOut size={15} />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-6 lg:px-8 lg:pt-5">
        <section
          className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"
          aria-label="Welcome"
        >
          <div>
            <p className="mb-1 text-xs font-medium text-text-secondary">
              {new Date().toLocaleDateString("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "Asia/Kolkata",
              })}
            </p>
            <h1>Welcome, {name.split(" ")[0]}</h1>
            <p className="mt-2 text-sm text-text-secondary">
              {reviewer
                ? "Your team approvals, personal requests and attendance at a glance."
                : "Your leave requests and office attendance, in one place."}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            {reviewer && <LeaveRequestsButton onOpen={() => setTab("review")} />}
            {!loading && !error && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
                <Clock3 size={18} className="text-lime" />
                <div>
                  <p className="text-xs text-text-secondary">Today’s face scan</p>
                  <p className="mt-1 text-sm font-semibold">
                    {todayEntry ? timeLabel(todayEntry.entry_at) : "No scan recorded yet"}
                  </p>
                </div>
                {todayEntry && <EntryStatus entry={todayEntry} />}
              </div>
            )}
          </div>
        </section>
        <nav
          className="mb-5 flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-border bg-surface p-1"
          aria-label="Employee sections"
        >
          {(
            [
              { key: "overview", label: "Overview", icon: LayoutDashboard },
              { key: "review", label: "Team approvals", icon: ShieldCheck },
              { key: "leave", label: "Leave & WFH", icon: House },
              { key: "attendance", label: "My attendance", icon: Clock3 },
              { key: "expense", label: "Expense", icon: Receipt },
              { key: "inventory", label: "Inventory Own", icon: Boxes },
            ] as const
          )
            .filter(
              ({ key }) =>
                ((key !== "overview" && key !== "review") || reviewer) &&
                (key !== "expense" || !canManageFinance(email)) &&
                (key !== "inventory" || firmwareInventory),
            )
            .map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                aria-controls={`employee-${key}`}
                onClick={() => setTab(key)}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:px-5 sm:text-sm ${tab === key ? "bg-lime/10 text-lime" : "text-text-secondary hover:bg-surface-raised"}`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
        </nav>
        {tab === "overview" && reviewer ? (
          <section id="employee-overview" aria-label="Your overview" className="space-y-4">
            <div>
              <h2>Your overview</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Stay on top of team requests and your working day.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <LeaveRequestsButton card onOpen={() => setTab("review")} />
              <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
                <Clock3 size={22} className="text-lime" />
                <h3 className="mt-5">Today’s attendance</h3>
                <p className="mt-2 text-sm text-text-secondary" role="status">
                  {loading
                    ? "Loading attendance..."
                    : error
                      ? "Attendance unavailable"
                      : todayEntry
                        ? `Face scan at ${timeLabel(todayEntry.entry_at)}`
                        : "No scan recorded yet"}
                </p>
                {!loading && !error && todayEntry && (
                  <div className="mt-3">
                    <EntryStatus entry={todayEntry} />
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-5"
                  onClick={() => setTab("attendance")}
                >
                  View my attendance <ArrowRight size={15} />
                </Button>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
                <House size={22} className="text-lime" />
                <h3 className="mt-5">My leave & WFH</h3>
                <p className="mt-2 text-sm text-text-secondary">
                  Apply for time off or work from home, and track your own requests.
                </p>
                <Button variant="ghost" size="sm" className="mt-5" onClick={() => setTab("leave")}>
                  Open my requests <ArrowRight size={15} />
                </Button>
              </div>
            </div>
          </section>
        ) : tab === "review" && reviewer ? (
          <section id="employee-review" aria-label="Team leave approvals">
            <div className="mb-4">
              <h2>Team approvals</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Review leave and work-from-home requests assigned to you.
              </p>
            </div>
            <LeaveWorkspace key="review" embedded showHeader={false} initialTab="review" />
          </section>
        ) : tab === "inventory" && firmwareInventory ? (
          <section id="employee-inventory" aria-label="My testing inventory">
            <FirmwareInventory />
          </section>
        ) : tab === "expense" ? (
          <section id="employee-expense" aria-label="My expenses">
            <FinanceWorkspace personal embedded />
          </section>
        ) : tab === "leave" ? (
          <section id="employee-leave" aria-label="Leave and work-from-home requests">
            <LeaveWorkspace key="personal" embedded showHeader={false} />
          </section>
        ) : (
          <EmployeeCalendar />
        )}
      </div>
    </div>
  );
}
