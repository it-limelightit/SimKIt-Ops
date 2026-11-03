import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { UserCog, X, LogIn, ShieldAlert } from "lucide-react";
import { Button, Input, Label } from "@/components/ui-kit";
import {
  enterAsUser,
  returnToAdmin,
  getActiveImpersonation,
  listImpersonationTargets,
  type ActiveImpersonation,
  type ImpersonationTarget,
} from "@/lib/impersonation";

/**
 * Admin-only trigger + modal to enter another account.
 * Render this only for supervisor/owner accounts.
 */
export function ImpersonateButton({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [targets, setTargets] = useState<ImpersonationTarget[] | null>(null);
  const [targetsError, setTargetsError] = useState<string | null>(null);

  // Load every account for the dropdown the first time the dialog opens.
  useEffect(() => {
    if (!open || targets !== null) return;
    let cancelled = false;
    listImpersonationTargets()
      .then((list) => !cancelled && setTargets(list))
      .catch((err) => {
        if (cancelled) return;
        setTargets([]);
        setTargetsError(err instanceof Error ? err.message : "could not load");
      });
    return () => {
      cancelled = true;
    };
  }, [open, targets]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const target = email.trim();
    if (!target.includes("@")) {
      toast.error("Select an account.");
      return;
    }
    setLoading(true);
    try {
      const res = await enterAsUser(target);
      if (!res.ok) {
        throw new Error(res.error || "Could not enter that account.");
      }
      toast.success(`Entered ${target}. Reloading…`);
      // Full reload so the app re-initialises cleanly with the new session.
      window.location.href = window.location.origin + "/auth";
    } catch (err: any) {
      toast.error(err?.message || "Could not enter that account.");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-text-secondary hover:text-lime transition-colors p-1.5 cursor-pointer"
        title="Enter another account"
        aria-label="Enter another account"
      >
        <UserCog size={16} strokeWidth={2} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-[8px] border border-border bg-surface p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-2">
                <UserCog size={18} className="text-lime" strokeWidth={2} />
                <h2 className="text-base font-semibold text-text-primary">Enter another account</h2>
              </div>
              <button
                onClick={() => !loading && setOpen(false)}
                className="text-text-secondary hover:text-text-primary"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <p className="mb-4 text-xs leading-relaxed text-text-secondary">
              You'll be signed in as this account using your manager access — no password needed.
              Your own session is kept so you can switch back. This action is logged.
            </p>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="impersonate-email">Account</Label>
                {targets && targets.length > 0 ? (
                  <select
                    id="impersonate-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                    required
                    className="mt-1 w-full rounded-[6px] border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:border-lime focus:outline-none"
                  >
                    <option value="" disabled>
                      Select an account…
                    </option>
                    {targets.map((t) => (
                      <option key={t.email} value={t.email}>
                        {t.name ? `${t.name} — ${t.email}` : t.email}
                        {t.active ? "" : " (inactive)"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <Input
                      id="impersonate-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={targets === null ? "Loading accounts…" : "person@example.com"}
                      autoFocus
                      required
                    />
                    {targetsError && (
                      <p className="mt-1 text-[11px] text-text-secondary">
                        Account list unavailable ({targetsError}). Type the email instead.
                      </p>
                    )}
                  </>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                <LogIn size={14} strokeWidth={2} />
                {loading ? "Entering…" : "Enter as this user"}
              </Button>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Global banner shown whenever the current session is an impersonation.
 * Mounted at the app root so it appears in every role's layout.
 */
export function ImpersonationBanner() {
  const [active, setActive] = useState<ActiveImpersonation | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setActive(getActiveImpersonation());
  }, []);

  if (!active) return null;

  async function handleReturn() {
    setLeaving(true);
    const res = await returnToAdmin();
    if (!res.ok && res.error) {
      toast.error(res.error);
    }
    window.location.href = window.location.origin + "/auth";
  }

  const label = active.targetName
    ? `${active.targetName} (${active.targetEmail})`
    : active.targetEmail;

  return (
    <div className="fixed inset-x-0 top-0 z-[200] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-coral px-4 py-2 text-center text-xs font-semibold text-white">
      <span className="flex items-center gap-1.5">
        <ShieldAlert size={14} strokeWidth={2} />
        Viewing as <span className="font-bold">{label}</span>
      </span>
      <button
        onClick={handleReturn}
        disabled={leaving}
        className="rounded-[4px] bg-white/20 px-2.5 py-1 font-bold uppercase tracking-wide hover:bg-white/30 disabled:opacity-60"
      >
        {leaving ? "Returning…" : "Return to my account"}
      </button>
    </div>
  );
}
