import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, Users } from "lucide-react";
import { Button, Card } from "@/components/ui-kit";
import { attendanceRpc } from "@/lib/device-attendance";
import { EmployeeCalendar } from "./EmployeeCalendar";

export type TeamMember = {
  id: string;
  name: string;
  email: string | null;
  department: string | null;
  enroll_id: string | null;
  active: boolean;
};

/** The signed-in team lead's members (empty for everyone else). */
export async function loadMyTeam() {
  return (await attendanceRpc<TeamMember[]>("attendance_my_team").catch(() => [])) ?? [];
}

/**
 * Read-only attendance for a team lead's own team (e.g. Hitesh bhai -> Aryan,
 * Kuldeep -> Mayank, Suraj, Vikas). Membership and access are enforced on the server.
 */
export function TeamAttendance() {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    attendanceRpc<TeamMember[]>("attendance_my_team")
      .then((list) => {
        if (cancelled) return;
        const members = list ?? [];
        setTeam(members);
        setSelected((current) =>
          current && members.some((m) => m.id === current) ? current : (members[0]?.id ?? null),
        );
      })
      .catch((failure) => {
        if (!cancelled) {
          setTeam([]);
          setError(failure instanceof Error ? failure.message : "Could not load your team.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  if (team === null)
    return (
      <Card className="flex items-center gap-3 p-6 text-sm text-text-secondary" role="status">
        <LoaderCircle size={18} className="animate-spin text-lime" /> Loading your team…
      </Card>
    );
  if (error)
    return (
      <Card role="alert" className="space-y-3 p-5">
        <p className="text-sm text-coral">{error}</p>
        <Button size="sm" variant="secondary" onClick={() => setRefresh((n) => n + 1)}>
          <RefreshCw size={14} /> Try again
        </Button>
      </Card>
    );
  if (!team.length)
    return (
      <Card className="p-6 text-sm text-text-secondary">
        No team members are assigned to you yet. Ask an admin to add them.
      </Card>
    );

  const member = team.find((m) => m.id === selected) ?? team[0];
  return (
    <section className="space-y-4" aria-label="Team attendance">
      <Card className="rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime/10 text-lime">
              <Users size={18} />
            </span>
            <div>
              <h2 className="text-base font-semibold">Team attendance</h2>
              <p className="text-xs text-text-secondary">
                {team.length} {team.length === 1 ? "member" : "members"} · view only
              </p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Team members">
          {team.map((m) => {
            const active = m.id === member.id;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelected(m.id)}
                className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime ${active ? "border-lime/60 bg-lime/10" : "border-border bg-surface hover:border-border-bright"}`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${active ? "bg-lime text-primary-foreground" : "bg-surface-raised text-text-secondary"}`}
                  aria-hidden="true"
                >
                  {m.name
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")
                    .toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold capitalize text-text-primary">
                    {m.name}
                  </span>
                  <span className="block truncate text-[11px] text-text-secondary">
                    {m.email ?? m.department ?? "—"}
                    {m.active ? "" : " · inactive"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>
      <EmployeeCalendar key={member.id} employeeId={member.id} employeeName={member.name} />
    </section>
  );
}
