import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth-store";
import { Button, Card, Input, Label } from "@/components/ui-kit";
import { HardHat, Shield } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — SIM-Kit Ops" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { ready, userId, role, refresh } = useAuth();
  const [tab, setTab] = useState<"login" | "signup">("login");

  useEffect(() => {
    if (ready && userId && role) {
      navigate({ to: role === "worker" ? "/business-consultant" : `/${role}` as "/business-consultant" });
    }
  }, [ready, userId, role, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-12">
        <div className="mb-12">
          <h1 className="text-3xl">SIM-Kit Ops</h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-stone">
            Field Operations
          </p>
        </div>

        <div className="mb-8 flex border-b border-border">
          {(["login", "signup"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative -mb-px px-5 py-3 text-sm transition-colors ${
                tab === t ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {t === "login" ? "Login" : "Sign Up"}
              {tab === t && <span className="absolute -bottom-px left-0 right-0 h-[2px] bg-primary" />}
            </button>
          ))}
        </div>

        {tab === "login" ? <LoginForm onDone={refresh} /> : <SignupForm onDone={() => setTab("login")} />}
      </div>
    </div>
  );
}

const SIGNUP_ROLES: { value: AppRole; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; desc: string }[] = [
  { value: "supervisor", label: "Manager", icon: Shield, desc: "Manage sites, tasks & consultants" },
  { value: "worker", label: "Business Consultant", icon: HardHat, desc: "Perform field assessments & installs" },
];

function LoginForm({ onDone }: { onDone: () => void }) {
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Mobile is the identifier; we look up the email via profile
      const id = mobile.trim();
      const isEmail = id.includes("@");
      let email = id;
      if (!isEmail) {
        const { data } = await supabase.from("profiles").select("email").eq("mobile", id).maybeSingle();
        if (!data?.email) throw new Error("No account found for that mobile number.");
        email = data.email;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Check approval status — only workers need manager approval
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (uid) {
        const [{ data: prof }, { data: roleRow }] = await Promise.all([
          supabase.from("profiles").select("is_active").eq("id", uid).maybeSingle(),
          supabase.from("user_roles").select("role").eq("user_id", uid).limit(1).maybeSingle(),
        ]);
        const userRole = roleRow?.role as string | undefined;
        if (userRole === "worker" && !prof?.is_active) {
          await supabase.auth.signOut();
          throw new Error("Your account is pending manager approval.");
        }
      }
      toast.success("Signed in");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      <div>
        <Label>Mobile Number / Email</Label>
        <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="9876543210 or email" required />
      </div>
      <div>
        <Label>Password</Label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign In"}
      </Button>
    </form>
  );
}

function SignupForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", email: "", mobile: "", whatsapp: "", password: "", confirm: "" });
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) {
      toast.error("Please select a role");
      return;
    }
    if (f.password !== f.confirm) {
      toast.error("Passwords do not match");
      return;
    }
    if (f.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: f.email,
        password: f.password,
        options: {
          emailRedirectTo: window.location.origin,
          data: { name: f.name, mobile: f.mobile, whatsapp: f.whatsapp, role },
        },
      });
      if (error) throw error;
      toast.success(
        role === "supervisor"
          ? "Account created. You can sign in now."
          : "Account created. Awaiting manager approval."
      );
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <Label>I am a <span className="text-[#A63D2F]">*</span></Label>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {SIGNUP_ROLES.map((r) => {
            const Icon = r.icon;
            const active = role === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => setRole(r.value)}
                className={`flex flex-col items-start gap-2 border p-4 text-left transition-colors ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-surface hover:border-foreground/40"
                }`}
              >
                <Icon size={20} strokeWidth={1.5} />
                <span className="text-sm font-medium leading-tight">{r.label}</span>
                <span className={`text-xs leading-snug ${active ? "text-background/70" : "text-muted-foreground"}`}>
                  {r.desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <Label>Full Name <span className="text-[#A63D2F]">*</span></Label>
        <Input value={f.name} onChange={set("name")} required />
      </div>
      <div>
        <Label>Email Address <span className="text-[#A63D2F]">*</span></Label>
        <Input type="email" value={f.email} onChange={set("email")} required />
      </div>
      <div>
        <Label>Mobile Number <span className="text-[#A63D2F]">*</span></Label>
        <Input value={f.mobile} onChange={set("mobile")} required />
      </div>
      <div>
        <Label>WhatsApp Number <span className="text-[#A63D2F]">*</span></Label>
        <Input value={f.whatsapp} onChange={set("whatsapp")} placeholder="With country code" required />
      </div>
      <div>
        <Label>Password <span className="text-[#A63D2F]">*</span></Label>
        <Input type="password" value={f.password} onChange={set("password")} required />
      </div>
      <div>
        <Label>Confirm Password <span className="text-[#A63D2F]">*</span></Label>
        <Input type="password" value={f.confirm} onChange={set("confirm")} required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating…" : "Create Account"}
      </Button>
    </form>
  );
}
