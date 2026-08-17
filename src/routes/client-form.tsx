import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { supabase } from "@/integrations/supabase/client";

// Use admin client if service role key is set, otherwise fall back to standard client
const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : supabase;

import { Card, Button, Input, Select, Label, Badge } from "@/components/ui-kit";
import { toast } from "sonner";
import {
  Building2,
  Users,
  Clock,
  Wrench,
  FileText,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Plus,
  Trash2,
  Lightbulb,
  ShieldAlert
} from "lucide-react";

const COMMON_DOWNTIME_REASONS = [
  "Machine Breakdown",
  "Power Failure",
  "Material Shortage",
  "Die / Mould Change",
  "Planned Preventive Maintenance",
  "changeover",
  "Tool Breakage / Tool Change",
  "Quality Rejection / Rework",
  "Operator Absence",
  "Electrical Fault",
  "Hydraulic / Pneumatic Failure",
  "Lubrication Issue",
  "Cooling System Failure",
  "PLC / Sensor Fault",
  "Raw Material Quality Issue",
  "Safety Issue / Accident",
  "Shift Changeover",
  "Material Jam / Choking",
  "Vendor / External Delay",
  "Machine Warm-up"
];

// Server Function to fetch Site details and Assessment data by Token
export const getClientFormSiteByTokenFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { token: string })
  .handler(async ({ data }) => {
    const { token } = data;
    if (!token) return { success: false, error: "No token provided" };

    const { data: res, error } = await supabase.rpc("get_client_form_site_by_token", {
      token_val: token
    });

    if (error) {
      console.error("Error executing RPC get_client_form_site_by_token:", error);
      return { success: false, error: error.message };
    }

    return res as {
      success: boolean;
      error?: string;
      site?: {
        id: string;
        name: string;
        company_name: string;
        address: string;
        city: string;
        consultant_stage: string;
        client_email: string;
      };
      assessmentData?: Record<string, any>;
    };
  });

// Server Function to save the form data
export const saveClientFormByTokenFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { token: string; assessmentData: Record<string, any> })
  .handler(async ({ data }) => {
    const { token, assessmentData } = data;
    if (!token) return { success: false, error: "No token provided" };

    const { data: res, error } = await supabase.rpc("save_client_form_by_token", {
      token_val: token,
      assessment_data: assessmentData
    });

    if (error) {
      console.error("Error executing RPC save_client_form_by_token:", error);
      return { success: false, error: error.message };
    }

    return res as { success: boolean; error?: string };
  });

// Server Function to send email invitation
export const sendClientFormEmailFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { email: string; token: string; siteName: string; origin: string })
  .handler(async ({ data }) => {
    const { email, token, siteName, origin } = data;
    if (!email || !token) {
      return { success: false, error: "Missing recipient email or token" };
    }

    try {
      const resendApiKey = process.env.RESEND_API_KEY;
      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = process.env.SMTP_PORT;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpFrom = process.env.SMTP_FROM || '"SIM-Kit Ops" <no-reply@simkitops.com>';
      const formUrl = `${origin}/client-form?token=${token}`;
      const subject = `Invitation to complete Factory Operations Form - ${siteName}`;
      const htmlContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
          <h2 style="color: #22c55e; margin-bottom: 20px;">Factory Assessment Invitation</h2>
          <p>Hello,</p>
          <p>You have been invited to complete the <strong>Factory Operations Form</strong> for <strong>${siteName}</strong>.</p>
          <p>Please click the button below to access the secure, login-free questionnaire wizard and fill out the details:</p>
          <div style="margin: 30px 0; text-align: center;">
            <a href="${formUrl}" style="background-color: #22c55e; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; text-transform: uppercase; font-size: 13px;">Complete Factory Form</a>
          </div>
          <p style="font-size: 12px; color: #666;">Or copy and paste this link into your browser:</p>
          <p style="font-size: 12px; color: #3b82f6; word-break: break-all;">${formUrl}</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="font-size: 10px; color: #999; text-align: center;">This is an automated invitation sent via SIM-Kit Ops.</p>
        </div>
      `;

      // Option 1: Use Resend API if API Key is configured
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
          const errBody = await response.json().catch(() => ({ message: "Unknown API error" }));
          throw new Error(`Resend API failed: ${errBody.message || response.statusText}`);
        }

        return {
          success: true,
          message: "Email sent successfully via Resend API!"
        };
      }

      // Option 2: Fallback to standard SMTP if SMTP_HOST is configured
      let nodemailer: any;
      try {
        nodemailer = await import("nodemailer");
      } catch (e: any) {
        return {
          success: false,
          error: "Nodemailer package is not installed. Please run 'npm install nodemailer' in your terminal."
        };
      }

      let transporter;
      let previewUrl = null;

      if (smtpHost && smtpUser && smtpPass) {
        transporter = nodemailer.default.createTransport({
          host: smtpHost,
          port: Number(smtpPort || 587),
          secure: Number(smtpPort) === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });
      } else {
        // Fallback Option 3: Ethereal test mail
        try {
          const testAccount = await nodemailer.default.createTestAccount();
          transporter = nodemailer.default.createTransport({
            host: "smtp.ethereal.email",
            port: 587,
            secure: false,
            auth: {
              user: testAccount.user,
              pass: testAccount.pass,
            },
          });
        } catch (etherealErr: any) {
          return {
            success: false,
            error: "No Resend API Key or SMTP credentials are configured, and failed to generate a test Ethereal account."
          };
        }
      }

      const info = await transporter.sendMail({
        from: smtpFrom,
        to: email,
        subject,
        html: htmlContent,
      });

      if (!smtpHost) {
        previewUrl = nodemailer.default.getTestMessageUrl(info);
      }

      return {
        success: true,
        message: smtpHost ? "Email sent successfully via SMTP!" : "Test email sent via Ethereal!",
        previewUrl
      };
    } catch (err: any) {
      console.error("Error sending email:", err);
      return { success: false, error: err.message };
    }
  });

type ClientFormSearch = {
  token?: string;
};

export const Route = createFileRoute("/client-form")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ClientFormSearch => {
    return {
      token: search.token as string | undefined,
    };
  },
  component: ClientFormPage,
});

function checkShiftOverlap(shifts: any[]): boolean {
  const parsedShifts = (shifts ?? [])
    .filter(s => s && s.startTime && s.endTime)
    .map(s => {
      const [sh, sm] = s.startTime.split(":").map(Number);
      const [eh, em] = s.endTime.split(":").map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      if (end <= start) {
        return [
          { start, end: 1440 },
          { start: 0, end }
        ];
      } else {
        return [{ start, end }];
      }
    });

  for (let i = 0; i < parsedShifts.length; i++) {
    for (let j = i + 1; j < parsedShifts.length; j++) {
      const intervalsI = parsedShifts[i];
      const intervalsJ = parsedShifts[j];
      for (const intI of intervalsI) {
        for (const intJ of intervalsJ) {
          const maxStart = Math.max(intI.start, intJ.start);
          const minEnd = Math.min(intI.end, intJ.end);
          if (maxStart < minEnd) return true;
        }
      }
    }
  }
  return false;
}

function ClientFormPage() {
  const { token } = Route.useSearch();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [site, setSite] = useState<any>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [invalidSections, setInvalidSections] = useState<Set<string>>(new Set());
  
  const [emailInput, setEmailInput] = useState("");
  const [isEmailVerified, setIsEmailVerified] = useState(() => {
    if (typeof window !== "undefined" && token) {
      return sessionStorage.getItem(`client_verified_email_${token}`) === "true";
    }
    return false;
  });

  useEffect(() => {
    // Force clean light theme on client form page load
    const htmlEl = document.documentElement;
    const hadLightTheme = htmlEl.classList.contains("light-theme");
    htmlEl.classList.add("light-theme");

    const fetchFormDetails = async () => {
      if (!token) {
        setErrorMsg("No access token provided. Please use the complete link shared by your Field Associate.");
        setLoading(false);
        return;
      }
      try {
        const res = await getClientFormSiteByTokenFn({ data: { token } });
        if (res.success) {
          setSite(res.site);
          if (!res.site.client_email) {
            setIsEmailVerified(true);
          }
          // Initialize pre-filled company name/address in the form itself if they aren't set
          const initialData = { ...res.assessmentData };
          if (!initialData.factory_op_name && res.site.company_name) {
            initialData.factory_op_name = res.site.company_name;
          }
          if (!initialData.factory_op_address && res.site.address) {
            initialData.factory_op_address = res.site.address;
          }
          setFormData(initialData);
        } else {
          setErrorMsg(res.error || "Failed to validate form link.");
        }
      } catch (err: any) {
        setErrorMsg(err.message || "An unexpected error occurred.");
      } finally {
        setLoading(false);
      }
    };

    void fetchFormDetails();

    return () => {
      if (!hadLightTheme) {
        htmlEl.classList.remove("light-theme");
      }
    };
  }, [token]);

  const validateForm = () => {
    const errs: Record<string, string> = {};
    const sections = new Set<string>();

    // 1. Factory Name
    if (!formData.factory_op_name || !formData.factory_op_name.trim()) {
      errs.factory_op_name = "Factory Name is required";
      sections.add("company");
    }

    // 2. Single Machine Detail (Mandatory)
    const singleMachine = Array.isArray(formData.factory_op_machines) ? (formData.factory_op_machines[0] || "") : (formData.factory_op_machine || "");
    if (!singleMachine || !singleMachine.trim()) {
      errs.machine = "Machine Name is required";
      sections.add("company");
      sections.add("machinery");
    }

    // 3. Registered Address
    if (!formData.factory_op_address || !formData.factory_op_address.trim()) {
      errs.factory_op_address = "Registered Address is required";
      sections.add("company");
    }

    // 4. Owners List (Mandatory: ALL fields for every owner)
    const owners = formData.factory_op_owners || [];
    if (owners.length === 0) {
      errs.owners = "At least 1 Factory Owner details entry is required";
      sections.add("owners");
    } else {
      owners.forEach((o: any, idx: number) => {
        if (!o.name || !o.name.trim()) {
          errs[`owner_${idx}_name`] = `Owner #${idx + 1} Name is required`;
          sections.add("owners");
        }
        if (!o.contact || !o.contact.trim()) {
          errs[`owner_${idx}_contact`] = `Owner #${idx + 1} Mobile Contact is required`;
          sections.add("owners");
        }
        if (!o.email || !o.email.trim()) {
          errs[`owner_${idx}_email`] = `Owner #${idx + 1} Email is required`;
          sections.add("owners");
        }
      });
    }

    // 5. Technicians List (Mandatory: ALL fields for every technician)
    const technicians = formData.factory_op_technicians || [];
    if (technicians.length === 0) {
      errs.technicians = "At least 1 Technical detail entry is required";
      sections.add("technicians");
    } else {
      technicians.forEach((t: any, idx: number) => {
        if (!t.name || !t.name.trim()) {
          errs[`tech_${idx}_name`] = `Technician #${idx + 1} Name is required`;
          sections.add("technicians");
        }
        if (!t.contact || !t.contact.trim()) {
          errs[`tech_${idx}_contact`] = `Technician #${idx + 1} Mobile Contact is required`;
          sections.add("technicians");
        }
        if (!t.email || !t.email.trim()) {
          errs[`tech_${idx}_email`] = `Technician #${idx + 1} Email is required`;
          sections.add("technicians");
        }
      });
    }

    // 6. Shift Panel (Mandatory: remaining fields name, startTime, endTime)
    const shifts = formData.factory_op_shifts || [];
    if (shifts.length === 0) {
      errs.shifts = "At least 1 Shift timing entry is required";
      sections.add("shifts");
    } else {
      shifts.forEach((s: any, idx: number) => {
        if (!s.name || !s.name.trim()) {
          errs[`shift_${idx}_name`] = `Shift #${idx + 1} Name is required`;
          sections.add("shifts");
        }
        if (!s.startTime) {
          errs[`shift_${idx}_start`] = `Shift #${idx + 1} Start Time is required`;
          sections.add("shifts");
        }
        if (!s.endTime) {
          errs[`shift_${idx}_end`] = `Shift #${idx + 1} End Time is required`;
          sections.add("shifts");
        }
      });
      if (checkShiftOverlap(shifts)) {
        errs.shift_overlap = "Shift timings overlap. Please adjust start/end times.";
        sections.add("shifts");
      }
    }

    // 7. Electricity Board
    if (!formData.factory_op_electricity_board || !formData.factory_op_electricity_board.trim()) {
      errs.electricity_board = "Electricity Board selection is required";
      sections.add("electricity");
    }

    setErrors(errs);
    setInvalidSections(sections);
    return { isValid: Object.keys(errs).length === 0, errs, sections };
  };

  const saveForm = async () => {
    const { isValid, errs } = validateForm();
    if (!isValid) {
      const firstErrKey = Object.keys(errs)[0];
      toast.error(`Validation Error: ${errs[firstErrKey]}`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await saveClientFormByTokenFn({
        data: {
          token: token || "",
          assessmentData: {
            ...formData,
            assessment_phase_submitted: true,
            factory_form_submitted_at: new Date().toISOString(),
          }
        }
      });
      if (res.success) {
        setSubmittedSuccess(true);
        toast.success("Factory details submitted successfully!");
      } else {
        toast.error("Failed to save: " + res.error);
      }
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!site?.client_email) {
      setIsEmailVerified(true);
      return;
    }
    const cleanInput = emailInput.trim().toLowerCase();
    const cleanClientEmail = site.client_email.trim().toLowerCase();
    if (cleanInput === cleanClientEmail) {
      sessionStorage.setItem(`client_verified_email_${token}`, "true");
      setIsEmailVerified(true);
      toast.success("Identity verified successfully!");
    } else {
      toast.error("Email address does not match our records for this link.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lime mb-4"></div>
        <p className="font-mono text-xs uppercase tracking-widest text-text-secondary">
          Validating Access Key & Pre-fetching Metadata...
        </p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <Card className="max-w-md w-full p-8 border border-red-500/20 bg-surface/40 text-center space-y-4">
          <ShieldAlert className="mx-auto h-12 w-12 text-red-400 stroke-[1.5]" />
          <h2 className="text-lg font-syne font-extrabold uppercase tracking-wide text-text-primary">
            Access Denied
          </h2>
          <p className="text-xs text-text-secondary leading-relaxed">
            {errorMsg}
          </p>
        </Card>
      </div>
    );
  }

  if (submittedSuccess) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <Card className="max-w-md w-full p-8 border border-lime/20 bg-surface/40 text-center space-y-5 animate-in zoom-in-95 duration-200">
          <CheckCircle2 className="mx-auto h-16 w-16 text-lime stroke-[1.5]" />
          <div>
            <h2 className="text-xl font-syne font-extrabold uppercase tracking-wide text-text-primary">
              Submission Complete!
            </h2>
            <p className="text-xs text-lime mt-1 font-mono uppercase tracking-wider">
              {site?.company_name || site?.name}
            </p>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">
            Thank you for filling out the factory operational questionnaire. Your Field Associate and project managers have been notified and will review your inputs.
          </p>
          <div className="text-[10px] font-mono text-text-dim border-t border-border/40 pt-4">
            You can safely close this window now.
          </div>
        </Card>
      </div>
    );
  }

  if (!isEmailVerified) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <Card className="max-w-md w-full p-8 border border-border/80 bg-surface/40 space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto h-12 w-12 rounded-full bg-lime/10 flex items-center justify-center mb-2">
              <Building2 className="h-6 w-6 text-lime" />
            </div>
            <h2 className="text-lg font-syne font-extrabold uppercase tracking-wide text-text-primary">
              Verify Your Email
            </h2>
            <p className="text-xs text-text-secondary leading-relaxed">
              Please enter the email address where you received the invitation to access the factory form for <strong>{site?.company_name || site?.name}</strong>.
            </p>
          </div>
          
          <form onSubmit={handleVerifyEmail} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="verification_email">Email Address</Label>
              <Input
                id="verification_email"
                type="email"
                placeholder="email@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                required
                className="w-full bg-surface"
              />
            </div>
            
            <Button type="submit" className="w-full bg-lime text-black hover:bg-lime/90 font-bold uppercase tracking-wider text-xs py-2.5">
              Verify & Access Form
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  const stepsList = [
    { title: "General & Personnel", icon: Building2 },
    { title: "Shifts & Downtime", icon: Clock },
    { title: "Machinery Details", icon: Wrench },
    { title: "Extra Notes", icon: FileText }
  ];

  return (
    <div className="min-h-screen bg-background text-text-primary font-sans flex flex-col">
      {/* Header */}
      <header className="border-b border-border/60 bg-surface/30 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-syne font-extrabold tracking-wider uppercase text-lime">
            Factory Data Submission
          </h1>
          <p className="text-[10px] font-mono text-text-secondary uppercase">
            Client Portal — {site?.company_name || site?.name}
          </p>
        </div>
        <Badge tone="ghost" className="text-[10px]">restricted access</Badge>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-4 md:p-6 space-y-6">
        {/* Progress Bar & Wizard Steps */}
        <div className="grid grid-cols-4 gap-2 text-center select-none">
          {stepsList.map((s, idx) => {
            const num = idx + 1;
            const Icon = s.icon;
            const isActive = step === num;
            const isCompleted = step > num;

            return (
              <div
                key={num}
                onClick={() => {
                  if (num < step) setStep(num);
                }}
                className={`p-3 rounded-lg border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  isActive
                    ? "border-lime bg-lime-dim/5 text-lime"
                    : isCompleted
                    ? "border-lime/30 bg-surface/20 text-lime/75 hover:border-lime/60"
                    : "border-border/60 bg-surface/10 text-text-dim cursor-not-allowed"
                }`}
              >
                <Icon size={16} className={isActive ? "animate-pulse" : ""} />
                <span className="text-[9px] font-mono tracking-tight uppercase hidden md:block">{s.title}</span>
              </div>
            );
          })}
        </div>

        {/* Form Area */}
        <Card className="p-6 bg-surface/40 border border-border/60 space-y-6">
          {/* STEP 1: General Info & Personnel */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <h3 className="text-sm font-mono uppercase text-lime mb-1">Company Details & Key Personnel</h3>
                <p className="text-[10px] text-text-secondary mb-4">Please verify company info and add factory owner and technical contacts below. <span className="text-red-400 font-bold">* Fields marked with asterisk are mandatory.</span></p>
              </div>

              {/* Company & Machine Info Box */}
              <div className={`p-4 rounded-xl border transition-all ${
                invalidSections.has("company") ? "border-red-500 bg-red-500/5 ring-1 ring-red-500" : "border-border/40 bg-surface/10"
              }`}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label className="flex items-center justify-between">
                      <span>Official Company Name <span className="text-red-400">*</span></span>
                      {errors.factory_op_name && <span className="text-[10px] text-red-400">{errors.factory_op_name}</span>}
                    </Label>
                    <Input
                      value={formData.factory_op_name || ""}
                      onChange={(e) => setFormData({ ...formData, factory_op_name: e.target.value })}
                      placeholder="Enter company name"
                      className={`bg-surface ${errors.factory_op_name ? "border-red-500 ring-1 ring-red-500" : ""}`}
                    />
                  </div>
                  <div>
                    <Label className="flex items-center justify-between">
                      <span>Registered Address <span className="text-red-400">*</span></span>
                      {errors.factory_op_address && <span className="text-[10px] text-red-400">{errors.factory_op_address}</span>}
                    </Label>
                    <Input
                      value={formData.factory_op_address || ""}
                      onChange={(e) => setFormData({ ...formData, factory_op_address: e.target.value })}
                      placeholder="Enter full factory address"
                      className={`bg-surface ${errors.factory_op_address ? "border-red-500 ring-1 ring-red-500" : ""}`}
                    />
                  </div>
                  <div>
                    <Label className="flex items-center justify-between">
                      <span>Monitored Machine Name <span className="text-red-400">*</span></span>
                      {errors.machine && <span className="text-[10px] text-red-400">{errors.machine}</span>}
                    </Label>
                    <Input
                      value={Array.isArray(formData.factory_op_machines) ? (formData.factory_op_machines[0] || "") : (formData.factory_op_machine || "")}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormData({ ...formData, factory_op_machine: val, factory_op_machines: [val] });
                      }}
                      placeholder="e.g. CNC Lathe Machine 01"
                      className={`bg-surface font-medium text-lime ${errors.machine ? "border-red-500 ring-1 ring-red-500" : ""}`}
                    />
                  </div>
                </div>
              </div>

              {/* Owners list */}
              <div className={`space-y-3 p-4 rounded-xl border transition-all ${
                invalidSections.has("owners") ? "border-red-500 bg-red-500/5 ring-1 ring-red-500" : "border-border/40 bg-surface/10"
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-mono font-bold uppercase text-text-secondary flex items-center gap-1.5">
                      Factory Owners / Key Contacts <span className="text-red-400">*</span>
                    </h4>
                    {errors.owners && <p className="text-[10px] text-red-400 mt-0.5">{errors.owners}</p>}
                  </div>
                  <Button
                    variant="secondary"
                    className="py-1 px-2.5 text-[9px] uppercase tracking-wider"
                    onClick={() => {
                      const list = [...(formData.factory_op_owners || [])];
                      list.push({ name: "", contact: "", email: "" });
                      setFormData({ ...formData, factory_op_owners: list });
                    }}
                  >
                    + Add Owner
                  </Button>
                </div>

                <div className="space-y-3">
                  {(formData.factory_op_owners || []).map((o: any, idx: number) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end border-b border-border/20 pb-3 last:border-0 last:pb-0">
                      <div>
                        <Label className="text-[10px]">Owner Name <span className="text-red-400">*</span></Label>
                        <Input
                          value={o.name || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_owners];
                            list[idx] = { ...list[idx], name: e.target.value };
                            setFormData({ ...formData, factory_op_owners: list });
                          }}
                          placeholder="Full Name"
                          className={`h-8 text-xs bg-surface ${errors[`owner_${idx}_name`] ? "border-red-500 ring-1 ring-red-500" : ""}`}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Contact Mobile <span className="text-red-400">*</span></Label>
                        <Input
                          value={o.contact || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_owners];
                            list[idx] = { ...list[idx], contact: e.target.value };
                            setFormData({ ...formData, factory_op_owners: list });
                          }}
                          placeholder="+91 Mobile No."
                          className={`h-8 text-xs bg-surface ${errors[`owner_${idx}_contact`] ? "border-red-500 ring-1 ring-red-500" : ""}`}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Label className="text-[10px]">Email Address <span className="text-red-400">*</span></Label>
                          <Input
                            value={o.email || ""}
                            onChange={(e) => {
                              const list = [...formData.factory_op_owners];
                              list[idx] = { ...list[idx], email: e.target.value };
                              setFormData({ ...formData, factory_op_owners: list });
                            }}
                            placeholder="Email address"
                            className={`h-8 text-xs bg-surface ${errors[`owner_${idx}_email`] ? "border-red-500 ring-1 ring-red-500" : ""}`}
                          />
                        </div>
                        <Button
                          variant="danger"
                          className="h-8 py-1 px-2.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          onClick={() => {
                            const list = (formData.factory_op_owners || []).filter((_: any, i: number) => i !== idx);
                            setFormData({ ...formData, factory_op_owners: list });
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                  {(!formData.factory_op_owners || formData.factory_op_owners.length === 0) && (
                    <p className="text-[10px] text-text-dim italic">No owner records added yet. Click "+ Add Owner".</p>
                  )}
                </div>
              </div>

              {/* Technicians list */}
              <div className={`space-y-3 p-4 rounded-xl border transition-all ${
                invalidSections.has("technicians") ? "border-red-500 bg-red-500/5 ring-1 ring-red-500" : "border-border/40 bg-surface/10"
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-mono font-bold uppercase text-text-secondary flex items-center gap-1.5">
                      Technicians & Engineers Details <span className="text-red-400">*</span>
                    </h4>
                    {errors.technicians && <p className="text-[10px] text-red-400 mt-0.5">{errors.technicians}</p>}
                  </div>
                  <Button
                    variant="secondary"
                    className="py-1 px-2.5 text-[9px] uppercase tracking-wider"
                    onClick={() => {
                      const list = [...(formData.factory_op_technicians || [])];
                      list.push({ name: "", contact: "", email: "" });
                      setFormData({ ...formData, factory_op_technicians: list });
                    }}
                  >
                    + Add Technician
                  </Button>
                </div>

                <div className="space-y-3">
                  {(formData.factory_op_technicians || []).map((o: any, idx: number) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end border-b border-border/20 pb-3 last:border-0 last:pb-0">
                      <div>
                        <Label className="text-[10px]">Technician Name <span className="text-red-400">*</span></Label>
                        <Input
                          value={o.name || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_technicians];
                            list[idx] = { ...list[idx], name: e.target.value };
                            setFormData({ ...formData, factory_op_technicians: list });
                          }}
                          placeholder="Name"
                          className={`h-8 text-xs bg-surface ${errors[`tech_${idx}_name`] ? "border-red-500 ring-1 ring-red-500" : ""}`}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Contact Mobile <span className="text-red-400">*</span></Label>
                        <Input
                          value={o.contact || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_technicians];
                            list[idx] = { ...list[idx], contact: e.target.value };
                            setFormData({ ...formData, factory_op_technicians: list });
                          }}
                          placeholder="+91 Mobile No."
                          className={`h-8 text-xs bg-surface ${errors[`tech_${idx}_contact`] ? "border-red-500 ring-1 ring-red-500" : ""}`}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Label className="text-[10px]">Email Address <span className="text-red-400">*</span></Label>
                          <Input
                            value={o.email || ""}
                            onChange={(e) => {
                              const list = [...formData.factory_op_technicians];
                              list[idx] = { ...list[idx], email: e.target.value };
                              setFormData({ ...formData, factory_op_technicians: list });
                            }}
                            placeholder="Email address"
                            className={`h-8 text-xs bg-surface ${errors[`tech_${idx}_email`] ? "border-red-500 ring-1 ring-red-500" : ""}`}
                          />
                        </div>
                        <Button
                          variant="danger"
                          className="h-8 py-1 px-2.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          onClick={() => {
                            const list = (formData.factory_op_technicians || []).filter((_: any, i: number) => i !== idx);
                            setFormData({ ...formData, factory_op_technicians: list });
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                  {(!formData.factory_op_technicians || formData.factory_op_technicians.length === 0) && (
                    <p className="text-[10px] text-text-dim italic">No technician records added yet. Click "+ Add Technician".</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Shifts & Downtime */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <h3 className="text-sm font-mono uppercase text-lime mb-1">Operational Shifts & Downtimes</h3>
                <p className="text-[10px] text-text-secondary mb-4">Set up factory shift timings and downtime reasons. <span className="text-red-400 font-bold">* Shift timings are mandatory.</span></p>
              </div>

              {/* Shifts list */}
              <div className={`space-y-3 p-4 rounded-xl border transition-all ${
                invalidSections.has("shifts") ? "border-red-500 bg-red-500/5 ring-1 ring-red-500" : "border-border/40 bg-surface/10"
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-mono font-bold uppercase text-text-secondary flex items-center gap-1.5">
                      Shift Timings <span className="text-red-400">*</span>
                    </h4>
                    {errors.shifts && <p className="text-[10px] text-red-400 mt-0.5">{errors.shifts}</p>}
                    {errors.shift_overlap && <p className="text-[10px] text-red-400 mt-0.5 font-bold">{errors.shift_overlap}</p>}
                  </div>
                  <Button
                    variant="secondary"
                    className="py-1 px-2.5 text-[9px] uppercase tracking-wider"
                    onClick={() => {
                      const list = [...(formData.factory_op_shifts || [])];
                      list.push({ name: "", startTime: "", endTime: "" });
                      setFormData({ ...formData, factory_op_shifts: list });
                    }}
                  >
                    + Add Shift
                  </Button>
                </div>

                <div className="space-y-3">
                  {(formData.factory_op_shifts || []).map((s: any, idx: number) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end border-b border-border/20 pb-3 last:border-0 last:pb-0">
                      <div>
                        <Label className="text-[10px]">Shift Name (e.g. Shift A / Morning) <span className="text-red-400">*</span></Label>
                        <Input
                          value={s.name || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_shifts];
                            list[idx] = { ...list[idx], name: e.target.value };
                            setFormData({ ...formData, factory_op_shifts: list });
                          }}
                          placeholder="Shift Name"
                          className={`h-8 text-xs bg-surface ${errors[`shift_${idx}_name`] ? "border-red-500 ring-1 ring-red-500" : ""}`}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Start Time <span className="text-red-400">*</span></Label>
                        <Input
                          type="time"
                          value={s.startTime || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_shifts];
                            list[idx] = { ...list[idx], startTime: e.target.value };
                            setFormData({ ...formData, factory_op_shifts: list });
                          }}
                          className={`h-8 text-xs bg-surface ${errors[`shift_${idx}_start`] ? "border-red-500 ring-1 ring-red-500" : ""}`}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Label className="text-[10px]">End Time <span className="text-red-400">*</span></Label>
                          <Input
                            type="time"
                            value={s.endTime || ""}
                            onChange={(e) => {
                              const list = [...formData.factory_op_shifts];
                              list[idx] = { ...list[idx], endTime: e.target.value };
                              setFormData({ ...formData, factory_op_shifts: list });
                            }}
                            className={`h-8 text-xs bg-surface ${errors[`shift_${idx}_end`] ? "border-red-500 ring-1 ring-red-500" : ""}`}
                          />
                        </div>
                        <Button
                          variant="danger"
                          className="h-8 py-1 px-2.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          onClick={() => {
                            const list = (formData.factory_op_shifts || []).filter((_: any, i: number) => i !== idx);
                            setFormData({ ...formData, factory_op_shifts: list });
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                  {(!formData.factory_op_shifts || formData.factory_op_shifts.length === 0) && (
                    <p className="text-[10px] text-text-dim italic">No shift timings added yet. Click "+ Add Shift".</p>
                  )}
                </div>
              </div>

              {/* Downtime Reasons selection */}
              <div className="space-y-3">
                <Label>Downtime Reasons (Select all that apply)</Label>
                <div className="flex flex-wrap gap-2 py-1">
                  {[...COMMON_DOWNTIME_REASONS, ...(formData.factory_op_downtime_custom_reasons || [])].map((reason: string) => {
                    const isChecked = (formData.factory_op_downtime_reasons || []).includes(reason);
                    return (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => {
                          const current = formData.factory_op_downtime_reasons || [];
                          let updated;
                          if (current.includes(reason)) {
                            updated = current.filter((r: string) => r !== reason);
                          } else {
                            updated = [...current, reason];
                          }
                          setFormData({ ...formData, factory_op_downtime_reasons: updated });
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border text-xs font-mono font-medium transition-all duration-150 cursor-pointer ${
                          isChecked
                            ? "border-lime bg-lime-dim/40 text-lime"
                            : "border-border hover:border-border-bright text-text-secondary bg-surface-raised/20"
                        }`}
                      >
                        {isChecked && <span className="h-1.5 w-1.5 rounded-full bg-lime" />}
                        <span>{reason}</span>
                      </button>
                    );
                  })}
                </div>
                
                {/* Custom add downtime reason */}
                <div className="flex gap-2 max-w-md pt-1">
                  <Input
                    id="new-custom-downtime"
                    placeholder="Enter custom downtime reason"
                    className="h-8 text-xs bg-surface"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const val = e.currentTarget.value.trim();
                        if (val) {
                          const customList = formData.factory_op_downtime_custom_reasons || [];
                          if (!customList.includes(val)) {
                            const nextCustom = [...customList, val];
                            const nextReasons = [...(formData.factory_op_downtime_reasons || []), val];
                            setFormData({
                              ...formData,
                              factory_op_downtime_custom_reasons: nextCustom,
                              factory_op_downtime_reasons: nextReasons
                            });
                          }
                          e.currentTarget.value = "";
                        }
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 py-1 px-3 text-[10px] uppercase font-bold tracking-wider"
                    onClick={() => {
                      const input = document.getElementById("new-custom-downtime") as HTMLInputElement;
                      const val = input?.value.trim();
                      if (val) {
                        const customList = formData.factory_op_downtime_custom_reasons || [];
                        if (!customList.includes(val)) {
                          const nextCustom = [...customList, val];
                          const nextReasons = [...(formData.factory_op_downtime_reasons || []), val];
                          setFormData({
                            ...formData,
                            factory_op_downtime_custom_reasons: nextCustom,
                            factory_op_downtime_reasons: nextReasons
                          });
                        }
                        input.value = "";
                      }
                    }}
                  >
                    + Add
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Machinery Details */}
          {step === 3 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <h3 className="text-sm font-mono uppercase text-lime mb-1">Machinery & Tracking Configuration</h3>
                <p className="text-[10px] text-text-secondary mb-4">Provide mandatory machine detail and electricity board information.</p>
              </div>

              {/* Single Machine Input Box */}
              <div className={`p-4 rounded-xl border transition-all space-y-4 ${
                invalidSections.has("machinery") ? "border-red-500 bg-red-500/5 ring-1 ring-red-500" : "border-border/40 bg-surface/10"
              }`}>
                <div>
                  <Label className="flex items-center justify-between">
                    <span>Machine Name <span className="text-red-400">*</span></span>
                    {errors.machine && <span className="text-[10px] text-red-400">{errors.machine}</span>}
                  </Label>
                  <Input
                    value={Array.isArray(formData.factory_op_machines) ? (formData.factory_op_machines[0] || "") : (formData.factory_op_machine || "")}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormData({ ...formData, factory_op_machine: val, factory_op_machines: [val] });
                    }}
                    placeholder="Enter machine name (e.g. CNC Lathe Machine 01)"
                    className={`bg-surface ${errors.machine ? "border-red-500 ring-1 ring-red-500" : ""}`}
                  />
                  <p className="text-[10px] text-text-dim mt-1 italic">Single machine monitoring configuration.</p>
                </div>
              </div>

              <div className={`p-4 rounded-xl border transition-all ${
                invalidSections.has("electricity") ? "border-red-500 bg-red-500/5 ring-1 ring-red-500" : "border-border/40 bg-surface/10"
              }`}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="flex items-center justify-between">
                      <span>Electricity Board <span className="text-red-400">*</span></span>
                      {errors.electricity_board && <span className="text-[10px] text-red-400">{errors.electricity_board}</span>}
                    </Label>
                    <Select
                      value={formData.factory_op_electricity_board || ""}
                      onChange={(e) => setFormData({ ...formData, factory_op_electricity_board: e.target.value })}
                      className={`w-full bg-surface ${errors.electricity_board ? "border-red-500 ring-1 ring-red-500" : ""}`}
                    >
                      <option value="">Select Board...</option>
                      <option value="PGVCL">PGVCL</option>
                      <option value="UGVCL">UGVCL</option>
                      <option value="MGVCL">MGVCL</option>
                      <option value="DGVCL">DGVCL</option>
                      <option value="Torrent">Torrent</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Ideal Threshold Time (Minutes)</Label>
                    <Input
                      type="number"
                      value={formData.factory_op_downtime_threshold ?? ""}
                      onChange={(e) => setFormData({ ...formData, factory_op_downtime_threshold: e.target.value ? Number(e.target.value) : "" })}
                      placeholder="e.g. 10"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-border/40 pt-4 space-y-4">
                <div>
                  <Label className="text-[10px] uppercase tracking-widest text-text-secondary">Company / Machine Tracking Type</Label>
                  <Select
                    value={formData.company_type || ""}
                    onChange={(e) => setFormData({ ...formData, company_type: e.target.value })}
                    className="w-full bg-surface mt-1"
                  >
                    <option value="">Select Type...</option>
                    <option value="Runtime Machine">Runtime Machine (Time-based Tracking)</option>
                    <option value="Length-based Machine">Length-based Machine (Continuous Extruder)</option>
                  </Select>
                </div>

                {formData.company_type === "Runtime Machine" && (
                  <div className="grid gap-4 md:grid-cols-3 bg-surface/20 p-3 rounded-lg border border-border/30">
                    <div>
                      <Label>Expected daily run (hours)</Label>
                      <Input
                        type="number"
                        value={formData.expected_daily_run_hours ?? ""}
                        onChange={(e) => setFormData({ ...formData, expected_daily_run_hours: e.target.value ? Number(e.target.value) : "" })}
                        placeholder="e.g. 9"
                      />
                    </div>
                    <div>
                      <Label>Expected runtime / day (min)</Label>
                      <Input
                        type="number"
                        value={formData.expected_runtime_day_min ?? ""}
                        onChange={(e) => setFormData({ ...formData, expected_runtime_day_min: e.target.value ? Number(e.target.value) : "" })}
                        placeholder="540"
                      />
                    </div>
                    <div>
                      <Label>Minimum stop duration (min)</Label>
                      <Input
                        type="number"
                        value={formData.minimum_stop_duration_min ?? ""}
                        onChange={(e) => setFormData({ ...formData, minimum_stop_duration_min: e.target.value ? Number(e.target.value) : "" })}
                        placeholder="5"
                      />
                    </div>
                    <div className="md:col-span-3 grid grid-cols-2 gap-4 pt-2">
                      <label className="flex items-center gap-2 cursor-pointer select-none font-semibold">
                        <input
                          type="checkbox"
                          checked={!!formData.production_count_meaningful}
                          onChange={(e) => setFormData({ ...formData, production_count_meaningful: e.target.checked })}
                          className="rounded border-border text-lime focus:ring-lime h-4 w-4 bg-surface"
                        />
                        Production count is meaningful
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none font-semibold">
                        <input
                          type="checkbox"
                          checked={!!formData.vibration_monitoring_relevant}
                          onChange={(e) => setFormData({ ...formData, vibration_monitoring_relevant: e.target.checked })}
                          className="rounded border-border text-lime focus:ring-lime h-4 w-4 bg-surface"
                        />
                        Vibration monitoring relevant
                      </label>
                    </div>
                  </div>
                )}

                {formData.company_type === "Length-based Machine" && (
                  <div className="grid gap-4 md:grid-cols-3 bg-surface/20 p-3 rounded-lg border border-border/30">
                    <div>
                      <Label>Expected meters / shift (m)</Label>
                      <Input
                        type="number"
                        value={formData.expected_meters_shift ?? ""}
                        onChange={(e) => setFormData({ ...formData, expected_meters_shift: e.target.value ? Number(e.target.value) : "" })}
                        placeholder="Target meters"
                      />
                    </div>
                    <div>
                      <Label>Target line speed (mpm)</Label>
                      <Input
                        type="number"
                        value={formData.target_line_speed ?? ""}
                        onChange={(e) => setFormData({ ...formData, target_line_speed: e.target.value ? Number(e.target.value) : "" })}
                        placeholder="Ideal speed"
                      />
                    </div>
                    <div>
                      <Label>Minimum acceptable speed (mpm)</Label>
                      <Input
                        type="number"
                        value={formData.minimum_acceptable_speed ?? ""}
                        onChange={(e) => setFormData({ ...formData, minimum_acceptable_speed: e.target.value ? Number(e.target.value) : "" })}
                        placeholder="Idle speed threshold"
                      />
                    </div>
                  </div>
                )}

                {formData.company_type && (
                  <div className="space-y-2">
                    <Label>Machine Classification</Label>
                    <div className="flex gap-1.5 flex-wrap">
                      {["Production", "Utility", "Auxiliary", "Support"].map((type) => {
                        const isActive = (formData.machine_usage_type ?? "Production") === type;
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setFormData({ ...formData, machine_usage_type: type })}
                            className={`px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                              isActive
                                ? "bg-lime text-black font-bold shadow-sm"
                                : "bg-surface-raised border border-border text-text-secondary hover:text-text-primary"
                            }`}
                          >
                            {type}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 4: Extra Notes */}
          {step === 4 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div>
                <h3 className="text-sm font-mono uppercase text-lime mb-1">Survey Remarks / MOM Notes</h3>
                <p className="text-[10px] text-text-secondary mb-4">Please include any extra specifications or survey notes you want the engineering team to know.</p>
              </div>

              <textarea
                className="w-full min-h-[140px] rounded border border-border bg-surface px-3 py-2 text-xs text-text-primary placeholder:text-text-dim focus:border-lime focus:outline-none transition-colors"
                value={formData.mom_notes || ""}
                onChange={(e) => setFormData({ ...formData, mom_notes: e.target.value })}
                placeholder="Enter any notes, pain points or special requests..."
              />
            </div>
          )}

          {/* Wizard Footer Navigation */}
          <div className="flex justify-between items-center pt-4 border-t border-border/40">
            <Button
              variant="secondary"
              onClick={() => setStep(step - 1)}
              disabled={step === 1 || submitting}
              className="py-1 px-4 text-xs flex items-center gap-1.5"
            >
              <ArrowLeft size={13} /> Back
            </Button>

            {step < 4 ? (
              <Button
                onClick={() => {
                  const { isValid, errs } = validateForm();
                  // Check current step valid fields before allowing next
                  if (step === 1) {
                    const hasStep1Err = Boolean(
                      errs.factory_op_name ||
                      errs.machine ||
                      errs.factory_op_address ||
                      errs.owners ||
                      errs.technicians ||
                      Object.keys(errs).some(k => k.startsWith("owner_") || k.startsWith("tech_"))
                    );
                    if (hasStep1Err) {
                      const firstErr = Object.values(errs)[0] || "Please fill all mandatory fields in Step 1 before proceeding.";
                      toast.error(`Validation Error: ${firstErr}`);
                      return;
                    }
                  }
                  if (step === 2 && errs.shifts) {
                    toast.error("Please fill shift details before proceeding.");
                    return;
                  }
                  if (step === 3 && (errs.machine || errs.electricity_board)) {
                    toast.error("Please provide Machine Name and Electricity Board.");
                    return;
                  }
                  setStep(step + 1);
                }}
                className="py-1 px-4 text-xs bg-lime text-black hover:bg-lime/90 flex items-center gap-1.5"
              >
                Next <ArrowRight size={13} />
              </Button>
            ) : (
              <Button
                onClick={saveForm}
                disabled={submitting}
                className="py-1.5 px-5 text-xs bg-lime text-black hover:bg-lime/90 font-bold flex items-center gap-1.5 shadow-[0_0_15px_rgba(200,255,74,0.15)]"
              >
                {submitting ? "Submitting..." : "Submit to Manager"}
              </Button>
            )}
          </div>
        </Card>
      </main>

      {/* Footer */}
      <footer className="py-6 border-t border-border/40 text-center font-mono text-[9px] text-text-dim">
        &copy; {new Date().getFullYear()} SIM-Kit Ops. All rights reserved. Secure assessment platform.
      </footer>
    </div>
  );
}
