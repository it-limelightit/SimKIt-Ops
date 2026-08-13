import { create } from "zustand";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "worker" | "supervisor";

type AuthState = {
  ready: boolean;
  userId: string | null;
  email: string | null;
  role: AppRole | null;
  roles: AppRole[];
  profile: {
    name: string | null;
    mobile: string | null;
    whatsapp: string | null;
    is_active: boolean;
  } | null;
  setSession: (s: Partial<AuthState>) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAuth = create<AuthState>((set, get) => ({
  ready: false,
  userId: null,
  email: null,
  role: null,
  roles: [],
  profile: null,
  setSession: (s) => set(s),
  refresh: async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) {
      set({ ready: true, userId: null, email: null, role: null, roles: [], profile: null });
      return;
    }
    const [{ data: roleRows }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", user.id),
      supabase.from("profiles").select("name,mobile,whatsapp,is_active").eq("id", user.id).maybeSingle(),
    ]);
    // Prioritize supervisor: if user has both worker+supervisor, treat them as supervisor
    const roles = (roleRows ?? []).map((r: any) => r.role as AppRole);
    const resolvedRole: AppRole = roles.includes("supervisor") ? "supervisor" : (roles[0] ?? "worker");
    set({
      ready: true,
      userId: user.id,
      email: user.email ?? null,
      role: resolvedRole,
      roles,
      profile: profile ?? null,
    });
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ userId: null, email: null, role: null, roles: [], profile: null });
  },
}));

export function useAuthInit() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    useAuth.getState().refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        useAuth.getState().refresh();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);
}
