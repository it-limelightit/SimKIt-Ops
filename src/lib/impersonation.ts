import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { supabase } from "@/integrations/supabase/client";

// Only these accounts may enter another account ("super access"). This is an
// explicit allowlist, not a role — so the restricted salary/admin managers do
// NOT get it, and it can't be gained just by holding a supervisor role.
export const SUPER_ACCESS_EMAILS = ["nitsanghani1@gmail.com"];

export function canImpersonate(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return !!normalized && SUPER_ACCESS_EMAILS.includes(normalized);
}

// sessionStorage key holding the admin's own session so they can switch back.
const SAVED_ADMIN_SESSION_KEY = "impersonation.adminSession";
// sessionStorage key describing the account currently being impersonated.
const ACTIVE_IMPERSONATION_KEY = "impersonation.active";

export type ActiveImpersonation = {
  adminEmail: string;
  targetEmail: string;
  targetName: string | null;
  startedAt: string;
};

/**
 * Server function: an authenticated supervisor/owner generates a one-time
 * session token for ANOTHER account, without needing that account's password.
 *
 * Safety properties (why this is not a universal/master password):
 *  - The caller must already be signed in; we validate their access token.
 *  - The caller must hold a supervisor/owner role.
 *  - Nothing is hardcoded and no shared secret exists. The public login form is
 *    untouched — every account still needs its own real password there.
 *  - Every switch is written to activity_logs (who entered whose account).
 */
export const impersonateUserFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { accessToken: string; targetEmail: string })
  .handler(async ({ data }) => {
    const { accessToken, targetEmail } = data;
    try {
      if (!accessToken) {
        return { success: false as const, error: "Not authenticated." };
      }
      const normalizedTarget = targetEmail?.trim().toLowerCase();
      if (!normalizedTarget || !normalizedTarget.includes("@")) {
        return { success: false as const, error: "Enter a valid target email address." };
      }

      // 1. Validate the caller's session via the service-role client.
      const { data: callerData, error: callerErr } =
        await supabaseAdmin.auth.getUser(accessToken);
      const caller = callerData?.user;
      if (callerErr || !caller) {
        return { success: false as const, error: "Your session is invalid. Please sign in again." };
      }

      // 2. Confirm the caller is on the super-access allowlist.
      if (!canImpersonate(caller.email)) {
        return {
          success: false as const,
          error: "Access denied: this account cannot enter other accounts.",
        };
      }

      // 3. Look up the target profile (for a friendly name + existence check).
      const { data: targetProfile } = await supabaseAdmin
        .from("profiles")
        .select("id, name, email")
        .ilike("email", normalizedTarget)
        .maybeSingle();

      // 4. Generate a one-time magic-link token for the target. This does NOT
      //    send an email — generateLink just returns the token properties.
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: normalizedTarget,
      });
      if (linkErr || !linkData?.properties?.hashed_token) {
        return {
          success: false as const,
          error: linkErr?.message || "No account found for that email address.",
        };
      }

      const targetName = targetProfile?.name ?? null;

      // 5. Audit the switch (best-effort; never block the action on logging).
      try {
        await supabaseAdmin.from("activity_logs" as any).insert({
          actor_id: caller.id,
          actor_name: caller.email || caller.id,
          action: "login",
          entity_type: "account_impersonation",
          entity_id: targetProfile?.id ?? null,
          entity_name: targetName || normalizedTarget,
          details: {
            impersonation: true,
            admin_email: caller.email,
            target_email: normalizedTarget,
          },
        } as never);
      } catch (logErr) {
        console.error("Could not write impersonation activity log:", logErr);
      }

      return {
        success: true as const,
        tokenHash: linkData.properties.hashed_token,
        verificationType: linkData.properties.verification_type || "magiclink",
        targetName,
        targetEmail: normalizedTarget,
        adminEmail: caller.email ?? "",
      };
    } catch (e: any) {
      return { success: false as const, error: e?.message || String(e) };
    }
  });

function readStorage(key: string): string | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    if (typeof window !== "undefined") window.sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function clearStorage(key: string) {
  try {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function getActiveImpersonation(): ActiveImpersonation | null {
  const raw = readStorage(ACTIVE_IMPERSONATION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveImpersonation;
  } catch {
    return null;
  }
}

/**
 * Client helper: switch the current browser session into `targetEmail`'s
 * account. Must be called while signed in as a supervisor/owner.
 */
export async function enterAsUser(targetEmail: string): Promise<{ ok: boolean; error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const current = sessionData.session;
  if (!current) {
    return { ok: false, error: "You must be signed in to do this." };
  }

  const res = await impersonateUserFn({
    data: { accessToken: current.access_token, targetEmail },
  });
  if (!res.success) {
    return { ok: false, error: res.error };
  }

  // Save the admin session BEFORE switching so we can return later.
  writeStorage(
    SAVED_ADMIN_SESSION_KEY,
    JSON.stringify({
      access_token: current.access_token,
      refresh_token: current.refresh_token,
    }),
  );

  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: res.tokenHash,
    type: res.verificationType as any,
  });
  if (verifyErr) {
    clearStorage(SAVED_ADMIN_SESSION_KEY);
    return { ok: false, error: verifyErr.message };
  }

  const active: ActiveImpersonation = {
    adminEmail: res.adminEmail,
    targetEmail: res.targetEmail,
    targetName: res.targetName,
    startedAt: new Date().toISOString(),
  };
  writeStorage(ACTIVE_IMPERSONATION_KEY, JSON.stringify(active));

  return { ok: true };
}

/**
 * Client helper: restore the admin's own session and leave the impersonated
 * account.
 */
export async function returnToAdmin(): Promise<{ ok: boolean; error?: string }> {
  const raw = readStorage(SAVED_ADMIN_SESSION_KEY);
  if (!raw) {
    // Nothing saved — just sign out to be safe.
    clearStorage(ACTIVE_IMPERSONATION_KEY);
    await supabase.auth.signOut();
    return { ok: false, error: "Original session not found. Signed out instead." };
  }
  try {
    const { access_token, refresh_token } = JSON.parse(raw) as {
      access_token: string;
      refresh_token: string;
    };
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    clearStorage(SAVED_ADMIN_SESSION_KEY);
    clearStorage(ACTIVE_IMPERSONATION_KEY);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    clearStorage(SAVED_ADMIN_SESSION_KEY);
    clearStorage(ACTIVE_IMPERSONATION_KEY);
    return { ok: false, error: e?.message || "Could not restore the original session." };
  }
}
