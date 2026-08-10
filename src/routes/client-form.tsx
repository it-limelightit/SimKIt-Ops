import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
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

// Server Function to fetch Site details and Assessment data by Token
export const getClientFormSiteByTokenFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { token: string })
  .handler(async ({ data }) => {
    const { token } = data;
    if (!token) return { success: false, error: "No token provided" };

    // Query all sites to search their task_notes for the client token
    const { data: sites, error: sitesError } = await supabaseAdmin
      .from("sites")
      .select("id, name, company_name, address, city, task_notes, consultant_stage");

    if (sitesError) {
      console.error("Error fetching sites via admin:", sitesError);
      return { success: false, error: sitesError.message };
    }

    // Find the site with the matching token
    let matchedSite: any = null;
    for (const site of sites ?? []) {
      const notes = site.task_notes || "";
      const prefix = "[METADATA:";
      const idx = notes.indexOf(prefix);
      if (idx !== -1) {
        const start = idx + prefix.length;
        let depth = 0;
        let jsonStr = "";
        for (let i = start; i < notes.length; i++) {
          if (notes[i] === "{") depth++;
          else if (notes[i] === "}") {
            depth--;
            if (depth === 0) {
              jsonStr = notes.slice(start, i + 1);
              break;
            }
          }
        }
        if (jsonStr) {
          try {
            const meta = JSON.parse(jsonStr);
            if (meta.client_token === token) {
              matchedSite = site;
              break;
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }

    if (!matchedSite) {
      return { success: false, error: "Invalid client access link or form has expired" };
    }

    // Now get the existing assessment data for this site if it exists
    const { data: assessData, error: assessError } = await supabaseAdmin
      .from("assessment")
      .select("data")
      .eq("site_id", matchedSite.id)
      .maybeSingle();

    return {
      success: true,
      site: {
        id: matchedSite.id,
        name: matchedSite.name,
        company_name: matchedSite.company_name,
        address: matchedSite.address,
        city: matchedSite.city,
        consultant_stage: matchedSite.consultant_stage
      },
      assessmentData: assessData?.data || {}
    };
  });

// Server Function to save the form data
export const saveClientFormByTokenFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { token: string; assessmentData: Record<string, any> })
  .handler(async ({ data }) => {
    const { token, assessmentData } = data;
    if (!token) return { success: false, error: "No token provided" };

    // Query all sites to search their task_notes for the client token
    const { data: sites, error: sitesError } = await supabaseAdmin
      .from("sites")
      .select("id, name, company_name, address, city, task_notes, consultant_stage");

    if (sitesError) return { success: false, error: sitesError.message };

    let matchedSite: any = null;
    for (const site of sites ?? []) {
      const notes = site.task_notes || "";
      const prefix = "[METADATA:";
      const idx = notes.indexOf(prefix);
      if (idx !== -1) {
        const start = idx + prefix.length;
        let depth = 0;
        let jsonStr = "";
        for (let i = start; i < notes.length; i++) {
          if (notes[i] === "{") depth++;
          else if (notes[i] === "}") {
            depth--;
            if (depth === 0) {
              jsonStr = notes.slice(start, i + 1);
              break;
            }
          }
        }
        if (jsonStr) {
          try {
            const meta = JSON.parse(jsonStr);
            if (meta.client_token === token) {
              matchedSite = site;
              break;
            }
          } catch {}
        }
      }
    }

    if (!matchedSite) {
      return { success: false, error: "Invalid client access link or form has expired" };
    }

    // Save/upsert assessment data.
    // Setting assessment_phase_submitted: true and factory_operations_done: true.
    const finalData = {
      ...assessmentData,
      factory_operations_done: true,
      assessment_phase_submitted: true
    };

    // Check if assessment record exists
    const { data: existingAssess } = await supabaseAdmin
      .from("assessment")
      .select("site_id")
      .eq("site_id", matchedSite.id)
      .maybeSingle();

    let saveError: any = null;
    if (existingAssess) {
      const { error } = await supabaseAdmin
        .from("assessment")
        .update({
          data: finalData,
          updated_at: new Date().toISOString()
        })
        .eq("site_id", matchedSite.id);
      saveError = error;
    } else {
      const { error } = await supabaseAdmin
        .from("assessment")
        .insert({
          site_id: matchedSite.id,
          data: finalData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      saveError = error;
    }

    if (saveError) {
      return { success: false, error: saveError.message };
    }

    return { success: true };
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
      let nodemailer: any;
      try {
        nodemailer = await import("nodemailer");
      } catch (e: any) {
        return {
          success: false,
          error: "Nodemailer package is not installed. Please run 'npm install nodemailer' in your terminal."
        };
      }

      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = process.env.SMTP_PORT;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpFrom = process.env.SMTP_FROM || '"SIM-Kit Ops" <no-reply@simkitops.com>';

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
        // Fallback: create ethereal test account
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
            error: "SMTP is not configured, and failed to generate temporary Ethereal test mail account. Please add SMTP config (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) to your .env file."
          };
        }
      }

      const formUrl = `${origin}/client-form?token=${token}`;

      const info = await transporter.sendMail({
        from: smtpFrom,
        to: email,
        subject: `Invitation to complete Factory Operations Form - ${siteName}`,
        html: `
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
        `,
      });

      if (!smtpHost) {
        previewUrl = nodemailer.default.getTestMessageUrl(info);
      }

      return {
        success: true,
        message: smtpHost ? "Email sent successfully!" : "Test email sent via Ethereal!",
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

function ClientFormPage() {
  const { token } = Route.useSearch();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [site, setSite] = useState<any>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);

  useEffect(() => {
    const fetchFormDetails = async () => {
      if (!token) {
        setErrorMsg("No access token provided. Please use the complete link shared by your consultant.");
        setLoading(false);
        return;
      }
      try {
        const res = await getClientFormSiteByTokenFn({ data: { token } });
        if (res.success) {
          setSite(res.site);
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
  }, [token]);

  const saveForm = async () => {
    setSubmitting(true);
    try {
      const res = await saveClientFormByTokenFn({
        data: {
          token: token || "",
          assessmentData: formData
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
            Thank you for filling out the factory operational questionnaire. Your consultant and project managers have been notified and will review your inputs.
          </p>
          <div className="text-[10px] font-mono text-text-dim border-t border-border/40 pt-4">
            You can safely close this window now.
          </div>
        </Card>
      </div>
    );
  }

  const stepsList = [
    { title: "General Info", icon: Building2 },
    { title: "Personnel", icon: Users },
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
        <div className="grid grid-cols-5 gap-2 text-center select-none">
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
          {/* STEP 1: General Info */}
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div>
                <h3 className="text-sm font-mono uppercase text-lime mb-1">Company Details</h3>
                <p className="text-[10px] text-text-secondary mb-4">Please verify or update your registered factory details.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Official Company Name</Label>
                  <Input
                    value={formData.factory_op_name || ""}
                    onChange={(e) => setFormData({ ...formData, factory_op_name: e.target.value })}
                    placeholder="Enter company name"
                  />
                </div>
                <div>
                  <Label>Registered Address</Label>
                  <Input
                    value={formData.factory_op_address || ""}
                    onChange={(e) => setFormData({ ...formData, factory_op_address: e.target.value })}
                    placeholder="Enter address"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Personnel */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <h3 className="text-sm font-mono uppercase text-lime mb-1">Factory Personnel</h3>
                <p className="text-[10px] text-text-secondary mb-4">Add your factory contact information, machine operators, and technical engineers.</p>
              </div>

              {/* Owners list */}
              <div className="space-y-3 bg-surface/10 p-4 rounded-xl border border-border/40">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-mono font-bold uppercase text-text-secondary">Factory Owners / Key Contacts</h4>
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
                        <Label className="text-[10px]">Name</Label>
                        <Input
                          value={o.name || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_owners];
                            list[idx] = { ...list[idx], name: e.target.value };
                            setFormData({ ...formData, factory_op_owners: list });
                          }}
                          className="h-8 text-xs bg-surface"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Contact Mobile</Label>
                        <Input
                          value={o.contact || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_owners];
                            list[idx] = { ...list[idx], contact: e.target.value };
                            setFormData({ ...formData, factory_op_owners: list });
                          }}
                          className="h-8 text-xs bg-surface"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Label className="text-[10px]">Email Address</Label>
                          <Input
                            value={o.email || ""}
                            onChange={(e) => {
                              const list = [...formData.factory_op_owners];
                              list[idx] = { ...list[idx], email: e.target.value };
                              setFormData({ ...formData, factory_op_owners: list });
                            }}
                            className="h-8 text-xs bg-surface"
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
                    <p className="text-[10px] text-text-dim italic">No owner records added</p>
                  )}
                </div>
              </div>

              {/* Operators list */}
              <div className="space-y-3 bg-surface/10 p-4 rounded-xl border border-border/40">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-mono font-bold uppercase text-text-secondary">Machine Operators</h4>
                  <Button
                    variant="secondary"
                    className="py-1 px-2.5 text-[9px] uppercase tracking-wider"
                    onClick={() => {
                      const list = [...(formData.factory_op_operators || [])];
                      list.push({ name: "", contact: "", email: "" });
                      setFormData({ ...formData, factory_op_operators: list });
                    }}
                  >
                    + Add Operator
                  </Button>
                </div>
                <div className="space-y-3">
                  {(formData.factory_op_operators || []).map((o: any, idx: number) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end border-b border-border/20 pb-3 last:border-0 last:pb-0">
                      <div>
                        <Label className="text-[10px]">Name</Label>
                        <Input
                          value={o.name || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_operators];
                            list[idx] = { ...list[idx], name: e.target.value };
                            setFormData({ ...formData, factory_op_operators: list });
                          }}
                          className="h-8 text-xs bg-surface"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Contact Mobile</Label>
                        <Input
                          value={o.contact || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_operators];
                            list[idx] = { ...list[idx], contact: e.target.value };
                            setFormData({ ...formData, factory_op_operators: list });
                          }}
                          className="h-8 text-xs bg-surface"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Label className="text-[10px]">Email Address</Label>
                          <Input
                            value={o.email || ""}
                            onChange={(e) => {
                              const list = [...formData.factory_op_operators];
                              list[idx] = { ...list[idx], email: e.target.value };
                              setFormData({ ...formData, factory_op_operators: list });
                            }}
                            className="h-8 text-xs bg-surface"
                          />
                        </div>
                        <Button
                          variant="danger"
                          className="h-8 py-1 px-2.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          onClick={() => {
                            const list = (formData.factory_op_operators || []).filter((_: any, i: number) => i !== idx);
                            setFormData({ ...formData, factory_op_operators: list });
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                  {(!formData.factory_op_operators || formData.factory_op_operators.length === 0) && (
                    <p className="text-[10px] text-text-dim italic">No operator records added</p>
                  )}
                </div>
              </div>

              {/* Technicians list */}
              <div className="space-y-3 bg-surface/10 p-4 rounded-xl border border-border/40">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-mono font-bold uppercase text-text-secondary">Technicians & Engineers</h4>
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
                        <Label className="text-[10px]">Name</Label>
                        <Input
                          value={o.name || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_technicians];
                            list[idx] = { ...list[idx], name: e.target.value };
                            setFormData({ ...formData, factory_op_technicians: list });
                          }}
                          className="h-8 text-xs bg-surface"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Contact Mobile</Label>
                        <Input
                          value={o.contact || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_technicians];
                            list[idx] = { ...list[idx], contact: e.target.value };
                            setFormData({ ...formData, factory_op_technicians: list });
                          }}
                          className="h-8 text-xs bg-surface"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Label className="text-[10px]">Email Address</Label>
                          <Input
                            value={o.email || ""}
                            onChange={(e) => {
                              const list = [...formData.factory_op_technicians];
                              list[idx] = { ...list[idx], email: e.target.value };
                              setFormData({ ...formData, factory_op_technicians: list });
                            }}
                            className="h-8 text-xs bg-surface"
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
                    <p className="text-[10px] text-text-dim italic">No technician records added</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Shifts & Downtime */}
          {step === 3 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <h3 className="text-sm font-mono uppercase text-lime mb-1">Operational Shifts & Downtimes</h3>
                <p className="text-[10px] text-text-secondary mb-4">Set up factory shift timings and downtime reasons.</p>
              </div>

              {/* Shifts list */}
              <div className="space-y-3 bg-surface/10 p-4 rounded-xl border border-border/40">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-mono font-bold uppercase text-text-secondary">Shift Timings</h4>
                  <Button
                    variant="secondary"
                    className="py-1 px-2.5 text-[9px] uppercase tracking-wider"
                    onClick={() => {
                      const list = [...(formData.factory_op_shifts || [])];
                      list.push({ name: "", type: "", startTime: "", endTime: "" });
                      setFormData({ ...formData, factory_op_shifts: list });
                    }}
                  >
                    + Add Shift
                  </Button>
                </div>
                <div className="space-y-3">
                  {(formData.factory_op_shifts || []).map((s: any, idx: number) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end border-b border-border/20 pb-3 last:border-0 last:pb-0">
                      <div>
                        <Label className="text-[10px]">Shift Name (e.g. Morning)</Label>
                        <Input
                          value={s.name || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_shifts];
                            list[idx] = { ...list[idx], name: e.target.value };
                            setFormData({ ...formData, factory_op_shifts: list });
                          }}
                          className="h-8 text-xs bg-surface"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Type</Label>
                        <Input
                          value={s.type || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_shifts];
                            list[idx] = { ...list[idx], type: e.target.value };
                            setFormData({ ...formData, factory_op_shifts: list });
                          }}
                          className="h-8 text-xs bg-surface"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Start Time</Label>
                        <Input
                          type="time"
                          value={s.startTime || ""}
                          onChange={(e) => {
                            const list = [...formData.factory_op_shifts];
                            list[idx] = { ...list[idx], startTime: e.target.value };
                            setFormData({ ...formData, factory_op_shifts: list });
                          }}
                          className="h-8 text-xs bg-surface"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Label className="text-[10px]">End Time</Label>
                          <Input
                            type="time"
                            value={s.endTime || ""}
                            onChange={(e) => {
                              const list = [...formData.factory_op_shifts];
                              list[idx] = { ...list[idx], endTime: e.target.value };
                              setFormData({ ...formData, factory_op_shifts: list });
                            }}
                            className="h-8 text-xs bg-surface"
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
                    <p className="text-[10px] text-text-dim italic">No shift timings added</p>
                  )}
                </div>
              </div>

              {/* Downtime Reasons tag list */}
              <div className="space-y-2">
                <Label>Downtime Reasons (comma-separated)</Label>
                <Input
                  value={(formData.factory_op_downtime_reasons || []).join(", ")}
                  onChange={(e) => {
                    const list = e.target.value.split(",").map(r => r.trim()).filter(Boolean);
                    setFormData({ ...formData, factory_op_downtime_reasons: list });
                  }}
                  placeholder="e.g. Raw material shortage, Power cuts, Maintenance"
                />
              </div>
            </div>
          )}

          {/* STEP 4: Machinery Details */}
          {step === 4 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <h3 className="text-sm font-mono uppercase text-lime mb-1">Machinery & Tracking Configuration</h3>
                <p className="text-[10px] text-text-secondary mb-4">Choose tracking methodology and input engineering limits.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Electricity Board</Label>
                  <Select
                    value={formData.factory_op_electricity_board || ""}
                    onChange={(e) => setFormData({ ...formData, factory_op_electricity_board: e.target.value })}
                    className="w-full bg-surface"
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

              <div>
                <Label>Surveyed Machine Names (comma-separated)</Label>
                <Input
                  value={(formData.factory_op_machines || []).join(", ")}
                  onChange={(e) => {
                    const list = e.target.value.split(",").map(m => m.trim()).filter(Boolean);
                    setFormData({ ...formData, factory_op_machines: list });
                  }}
                  placeholder="e.g. Extruder-01, Compressor, Mixer-A"
                />
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

          {/* STEP 5: Extra Notes */}
          {step === 5 && (
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

            {step < 5 ? (
              <Button
                onClick={() => setStep(step + 1)}
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
