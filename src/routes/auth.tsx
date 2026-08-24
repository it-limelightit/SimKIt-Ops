import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth-store";
import { Button, Card, Input, Label } from "@/components/ui-kit";
import { HardHat, Shield } from "lucide-react";
import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordActivityLog } from "@/lib/activity-log";

// Server Function: Request password reset link (sent via Resend/SMTP)
export const requestCustomPasswordResetFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { email: string; origin: string })
  .handler(async ({ data }) => {
    const { email, origin } = data;
    try {
      // Generate secure token
      const crypto = await import("crypto");
      const token = crypto.randomUUID();
      const expires = new Date(Date.now() + 3600000).toISOString(); // 1 hour

      // Call database RPC to check email and set token (SECURITY DEFINER bypasses RLS)
      const { data: rpcResult, error: rpcErr } = await supabase.rpc("set_reset_token", {
        user_email: email,
        token_val: token,
        expires_val: expires
      });

      if (rpcErr) {
        throw new Error(rpcErr.message);
      }

      const result = rpcResult as { success: boolean; name?: string; error?: string };

      if (!result.success) {
        return { success: false, error: result.error || "Failed to initiate reset." };
      }

      const userName = result.name || "User";

      // Send email via Resend / SMTP
      const resendApiKey = process.env.RESEND_API_KEY;
      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = process.env.SMTP_PORT;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpFrom = process.env.SMTP_FROM || '"SIM-Kit Ops" <no-reply@simkitops.com>';

      const resetUrl = `${origin}/auth?type=recovery&token=${token}`;
      const subject = "Reset your SIM-Kit Ops password";
      const htmlContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px; background-color: #fff; color: #000;">
          <h2 style="color: #800000; margin-bottom: 20px;">Password Reset Request</h2>
          <p>Hello ${userName},</p>
          <p>We received a request to reset the password for your SIM-Kit Ops account.</p>
          <p>Please click the button below to set a new password. This link is valid for 1 hour:</p>
          <div style="margin: 30px 0; text-align: center;">
            <a href="${resetUrl}" style="background-color: #800000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; text-transform: uppercase; font-size: 13px;">Reset Password</a>
          </div>
          <p style="font-size: 12px; color: #666;">Or copy and paste this link into your browser:</p>
          <p style="font-size: 12px; color: #3b82f6; word-break: break-all;">${resetUrl}</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="font-size: 10px; color: #999; text-align: center;">If you did not request this, you can safely ignore this email.</p>
        </div>
      `;

      if (resendApiKey) {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${resendApiKey}`
          },
          body: JSON.stringify({
            from: smtpFrom,
            to: [email],
            subject,
            html: htmlContent
          })
        });

        if (!response.ok) {
          throw new Error("Resend API failed to deliver email");
        }
      } else if (smtpHost && smtpUser && smtpPass) {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.default.createTransport({
          host: smtpHost,
          port: Number(smtpPort || 587),
          secure: Number(smtpPort) === 465,
          auth: { user: smtpUser, pass: smtpPass }
        });
        await transporter.sendMail({
          from: smtpFrom,
          to: email,
          subject,
          html: htmlContent
        });
      } else {
        const nodemailer = await import("nodemailer");
        const testAccount = await nodemailer.default.createTestAccount();
        const transporter = nodemailer.default.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: { user: testAccount.user, pass: testAccount.pass }
        });
        const info = await transporter.sendMail({
          from: smtpFrom,
          to: email,
          subject,
          html: htmlContent
        });
        const previewUrl = nodemailer.default.getTestMessageUrl(info);
        return {
          success: true,
          previewUrl,
          message: "Email sent successfully via Ethereal (Development mode)"
        };
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  });

// Server Function: Reset password with valid token
export const resetPasswordWithTokenFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { token: string; newPw: string })
  .handler(async ({ data }) => {
    const { token, newPw } = data;
    try {
      const hasAdminKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (hasAdminKey) {
        // Find user with valid token
        const { data: profile, error: profileErr } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("reset_token", token)
          .gt("reset_token_expires", new Date().toISOString())
          .maybeSingle();

        if (profileErr || !profile) {
          return { success: false, error: "Invalid or expired password reset link." };
        }

        // Update password in Supabase Auth
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(
          profile.id,
          { password: newPw }
        );

        if (authErr) {
          return { success: false, error: authErr.message };
        }

        // Clear token
        await supabaseAdmin
          .from("profiles")
          .update({
            reset_token: null,
            reset_token_expires: null
          } as any)
          .eq("id", profile.id);
      } else {
        // Fallback to RPC function
        const { data: rpcSuccess, error: rpcErr } = await supabase.rpc("reset_password_by_token", {
          token_val: token,
          new_pw: newPw
        });
        if (rpcErr || !rpcSuccess) {
          return { success: false, error: rpcErr?.message || "Invalid or expired password reset link. Make sure the database SQL migration has been run." };
        }
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  });

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — SIM-Kit Ops" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { ready, userId, role, refresh } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [isRecovery, setIsRecovery] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const hasRecovery =
      params.get("type") === "recovery" ||
      hashParams.get("type") === "recovery" ||
      window.location.href.includes("type=recovery");

    setIsRecovery(hasRecovery);
    setToken(params.get("token") || hashParams.get("token"));
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && ready && userId && role && !isRecovery) {
      navigate({ to: role === "supervisor" ? "/manager" : "/business-consultant" });
    }
  }, [mounted, ready, userId, role, navigate, isRecovery]);

  if (!mounted) return null;

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
          <RecoveryForm token={token} />
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
        const [{ data: prof }, { data: rolesData }] = await Promise.all([
          supabase.from("profiles").select("name,mobile,email,is_active").eq("id", uid).maybeSingle(),
          supabase.from("user_roles").select("role").eq("user_id", uid),
        ]);
        const roleList = (rolesData ?? []).map((r: any) => r.role);
        const userRole = roleList.includes("supervisor") ? "supervisor" : "worker";
        if (userRole === "worker" && !prof?.is_active) {
          await supabase.auth.signOut();
          throw new Error("Your account is pending manager approval.");
        }
        const { error: loginUpdateError } = await supabase
          .from("profiles")
          .update({ last_login: new Date().toISOString() } as never)
          .eq("id", uid);
        if (loginUpdateError) {
          console.error("Could not update last login:", loginUpdateError);
          toast.error("Signed in, but last login time could not be saved.");
        }
        await recordActivityLog({
          actor_id: uid,
          actor_name: prof?.name || prof?.mobile || prof?.email || email || uid,
          action: "login",
          entity_type: "account",
          entity_id: uid,
          entity_name: prof?.name || prof?.mobile || prof?.email || email || "Account",
          details: { role: userRole },
        });
      }
      toast.success("Signed in");
      onDone();
    } catch (err: any) {
      toast.error(err?.message || "Invalid login credentials. Please check your ID/email and password.");
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

      const res = await requestCustomPasswordResetFn({
        data: {
          email: emailVal,
          origin: window.location.origin
        }
      });

      if (!res.success) {
        throw new Error(res.error);
      }

      if (res.previewUrl) {
        console.log("Ethereal Link:", res.previewUrl);
        toast.success(`Development mode: Reset link generated! Check console for Ethereal URL.`);
      } else {
        toast.success("Password reset link sent! Please check your email inbox.");
      }

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

function RecoveryForm({ token }: { token: string | null }) {
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
      if (token) {
        const res = await resetPasswordWithTokenFn({
          data: { token, newPw }
        });
        if (!res.success) {
          throw new Error(res.error);
        }
      } else {
        const { error } = await supabase.auth.updateUser({ password: newPw });
        if (error) throw error;
      }
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
          data: { name: f.name, mobile: f.mobile, whatsapp: f.whatsapp, role: "worker" },
        },
      });
      if (error) throw error;
      toast.success("Account created successfully! Please wait for manager approval.");
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
