import { create } from "zustand";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "worker" | "supervisor" | "owner";

type AuthState = {
  ready: boolean;
  userId: string | null;
  email: string | null;
  role: AppRole | null;
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
  profile: null,
  setSession: (s) => set(s),
  refresh: async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) {
      set({ ready: true, userId: null, email: null, role: null, profile: null });
      return;
    }
    const [{ data: roleRow }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", user.id).limit(1).maybeSingle(),
      supabase.from("profiles").select("name,mobile,whatsapp,is_active").eq("id", user.id).maybeSingle(),
    ]);
    set({
      ready: true,
      userId: user.id,
      email: user.email ?? null,
      role: (roleRow?.role as AppRole) ?? "worker",
      profile: profile ?? null,
    });
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ userId: null, email: null, role: null, profile: null });
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
