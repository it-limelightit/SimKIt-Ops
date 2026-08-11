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
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const hasRecovery = params.get("type") === "recovery" || hashParams.get("type") === "recovery" || window.location.href.includes("type=recovery");
      setIsRecovery(!!hasRecovery);
    }
  }, []);

  useEffect(() => {
    if (ready && userId && role && !isRecovery) {
      navigate({ to: role === "worker" ? "/business-consultant" : `/${role}` as "/business-consultant" });
    }
  }, [ready, userId, role, navigate, isRecovery]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-12">
        <div className="mb-12">
          <h1 className="text-3xl">SIM-Kit Ops</h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-stone">
            Field Operations
          </p>
        </div>

        {isRecovery ? (
          <RecoveryForm />
        ) : (
          <>
            <div className="mb-8 flex border-b border-border">
              {(["login", "signup"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`relative -mb-px px-5 py-3 text-sm transition-colors ${tab === t ? "text-foreground" : "text-muted-foreground"
                    }`}
                >
                  {t === "login" ? "Login" : "Sign Up"}
                  {tab === t && <span className="absolute -bottom-px left-0 right-0 h-[2px] bg-primary" />}
                </button>
              ))}
            </div>

            {tab === "login" ? <LoginForm onDone={refresh} /> : <SignupForm onDone={() => setTab("login")} />}
          </>
        )}
      </div>
    </div>
  );
}


function LoginForm({ onDone }: { onDone: () => void }) {
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
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

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const emailVal = resetEmail.trim();
      if (!emailVal.includes("@")) {
        throw new Error("Please enter a valid email address to receive the password reset link.");
      }
      const { error } = await supabase.auth.resetPasswordForEmail(emailVal, {
        redirectTo: window.location.origin + "/auth?type=recovery",
      });
      if (error) throw error;
      toast.success("Password reset link sent! Please check your email inbox.");
      setResetMode(false);
      setResetEmail("");
    } catch (err: any) {
      toast.error(err.message || "Failed to send reset link");
    } finally {
      setLoading(false);
    }
  }

  if (resetMode) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Reset Password</h2>
          <p className="mt-1 text-sm text-text-secondary">Enter your email address to receive a secure recovery link.</p>
        </div>
        <form onSubmit={sendReset} className="space-y-5">
          <div>
            <Label>Email Address</Label>
            <Input
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              placeholder="email@example.com"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending…" : "Send Reset Link"}
          </Button>
        </form>
        <button
          type="button"
          onClick={() => { setResetMode(false); setResetEmail(""); }}
          className="text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          &larr; Back to Sign In
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-8">
      <div>
        <Label>Mobile Number / Email</Label>
        <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="9876543210 or email" required />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>Password</Label>
          <button
            type="button"
            onClick={() => setResetMode(true)}
            className="text-xs text-text-secondary hover:text-lime transition-colors font-mono cursor-pointer"
          >
            Forgot password?
          </button>
        </div>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign In"}
      </Button>
    </form>
  );
}

function RecoveryForm() {
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPw.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      toast.success("Password updated successfully! You can now sign in.");
      window.location.href = window.location.origin + "/auth";
    } catch (err: any) {
      toast.error(err.message || "Failed to update password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Set New Password</h2>
        <p className="mt-1 text-sm text-text-secondary">Please enter your new secure password.</p>
      </div>
      <form onSubmit={handleResetSubmit} className="space-y-5">
        <div>
          <Label>New Password</Label>
          <Input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="Min. 6 characters"
            required
          />
        </div>
        <div>
          <Label>Confirm New Password</Label>
          <Input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Repeat password"
            required
          />
        </div>
        <Button type="submit" className="w-full cursor-pointer" disabled={loading}>
          {loading ? "Updating..." : "Update Password"}
        </Button>
      </form>
    </div>
  );
}

function SignupForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", email: "", mobile: "", whatsapp: "", password: "", confirm: "" });
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
          emailRedirectTo:
            window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
              ? window.location.origin
              : undefined,
          data: { name: f.name, mobile: f.mobile, whatsapp: f.whatsapp, role: "worker" },
        },
      });
      if (error) throw error;
      toast.success("Account created. Awaiting manager approval.");
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
