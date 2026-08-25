import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, Button, Input, Select, Badge, Skeleton, Label } from "@/components/ui-kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import {
  ClipboardList,
  Building2,
  MapPin,
  Users,
  Wrench,
  Clock,
  AlertTriangle,
  FileText,
  Phone,
  Mail,
  Search,
  ArrowRight,
  AlertCircle,
  Calendar,
  CheckCircle2,
  HelpCircle,
  ExternalLink,
  Plus,
  Trash2,
  Save,
  XCircle,
  Copy,
  Check,
  KeyRound,
  Download,
} from "lucide-react";
import { parseSiteMetadata, serializeSiteMetadata } from "@/lib/site-metadata";

type Site = {
  id: string;
  name: string;
  company_name: string | null;
  city: string | null;
  address: string | null;
  task_notes: string | null;
  consultant_stage: string | null;
};

type Assessment = {
  site_id: string;
  data: Record<string, any>;
  updated_at: string;
};

type Contact = {
  id: string;
  site_id: string;
  name: string;
  designation?: string;
  mobile: string;
  email?: string;
};

type Machine = {
  id: string;
  site_id: string;
  name: string;
  brand?: string;
  model?: string;
  serial?: string;
  year?: number;
  condition?: string;
};

type SiteWithStatus = Site & {
  fillStatus: "completed" | "in_progress" | "no_data";
  isDone: boolean;
  isSubmitted: boolean;
  updatedAt?: string;
  credentialCreated: boolean;
  managerPassword: string;
  hasManagerPassword: boolean;
  submittedMonth: string;
};

const FACTORY_OPERATIONS_EXPORT_KEYS = [
  "factory_op_name",
  "factory_op_address",
  "factory_op_machine",
  "factory_op_machines",
  "factory_op_owners",
  "factory_op_technicians",
  "factory_op_shifts",
  "factory_op_working_days",
  "factory_op_downtime_reasons",
  "factory_op_downtime_custom_reasons",
  "factory_op_downtime_threshold",
  "factory_op_electricity_board",
  "company_type",
  "expected_daily_run_hours",
  "expected_runtime_day_min",
  "minimum_stop_duration_min",
  "production_count_meaningful",
  "vibration_monitoring_relevant",
  "machine_usage_type",
  "expected_meters_shift",
  "target_line_speed",
  "minimum_acceptable_speed",
] as const;

const WORKING_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function cleanFilledFactoryValue(value: any): any {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean") {
    return value ? value : undefined;
  }
  if (Array.isArray(value)) {
    const cleaned = value.map(cleanFilledFactoryValue).filter((item) => item !== undefined);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  if (value && typeof value === "object") {
    const cleaned = Object.entries(value).reduce<Record<string, any>>((acc, [key, item]) => {
      const cleanedItem = cleanFilledFactoryValue(item);
      if (cleanedItem !== undefined) acc[key] = cleanedItem;
      return acc;
    }, {});
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }
  return undefined;
}

function getFilledFactoryOperationsJson(data: Record<string, any>) {
  return FACTORY_OPERATIONS_EXPORT_KEYS.reduce<Record<string, any>>((acc, key) => {
    const cleanedValue = cleanFilledFactoryValue(data[key]);
    if (cleanedValue !== undefined) acc[key] = cleanedValue;
    return acc;
  }, {});
}

function formatTime24(value?: string) {
  if (!value) return "—";
  const trimmed = String(value).trim();
  const twelveHourMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (twelveHourMatch) {
    let hours = Number(twelveHourMatch[1]);
    const minutes = twelveHourMatch[2];
    const period = twelveHourMatch[3].toUpperCase();
    if (period === "PM" && hours < 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
    return `${String(hours).padStart(2, "0")}:${minutes}`;
  }
  const twentyFourHourMatch = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (twentyFourHourMatch) {
    return `${twentyFourHourMatch[1].padStart(2, "0")}:${twentyFourHourMatch[2]}`;
  }
  return trimmed;
}

function formatCertificateDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function makeDownloadFilename(companyName: string, extension: "doc" | "pdf") {
  const safeCompany = companyName
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "company";
  return `Installation-Commissioning-Certificate-${safeCompany}.${extension}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getCertificateSections(companyName: string, certificateDate: string) {
  return {
    title: "Installation and Commissioning Certificate",
    subtitle: "(Implementation of Shopfloor Insight & Monitoring Kit - SIM Kit)",
    dateLine: `Date: ${certificateDate}`,
    toLines: [
      "To,",
      "National Productivity Council (NPC)",
      "(Under Ministry of Commerce & Industry, Government of India)",
    ],
    subject: "Subject: Certification of Successful Installation & Commissioning of SIM Kit",
    greeting: "Dear Sir,",
    paragraphs: [
      "This is to certify that the Shopfloor Insight & Monitoring Kit (SIM Kit) has been successfully installed and commissioned at our facility under the project \"Scaling up Industry 4.0 Transformation in Gujarat's Manufacturing Sector.\"",
      "We are pleased to confirm that:",
    ],
    bullets: [
      "The SIM Kit device has been successfully installed and integrated with our machine.",
      "Machine data acquisition has commenced, and real-time data is being captured.",
      "The digital dashboard has been developed and is fully functional, providing clear visualization of operational parameters.",
      "The system is currently operational across its key modules, including Overall Equipment Effectiveness (OEE) Monitoring, Breakdown Analysis, Condition Monitoring, and Energy Monitoring.",
    ],
    closingParagraphs: [
      "With the implementation of SIM Kit, we are now able to monitor machine performance, analyze downtime, track energy consumption, and make informed decisions through data-driven insights. The initiative has significantly improved our shopfloor visibility and strengthened our journey towards Industry 4.0 adoption.",
      "We appreciate the efforts of the Service Provider Startup, LimelightIT Research PVT LTD, for their technical support and smooth execution of the installation. We also extend our gratitude to the National Productivity Council (NPC) for their guidance and support throughout the project.",
      "This certificate is issued as a confirmation of successful installation, commissioning, and operationalization of the SIM Kit system at our unit.",
    ],
    signOffLines: [
      "With regards,",
      `For ${companyName}`,
      "Authorized Signatory",
      "Name:",
      "Designation:",
      "Company Seal",
    ],
  };
}

function getShiftWorkingDays(shift: any, data?: Record<string, any>) {
  if (Array.isArray(shift?.workingDays)) return shift.workingDays;
  if (Array.isArray(data?.factory_op_working_days)) return data.factory_op_working_days;
  return [];
}

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }
}

export function FactoryDataPanel() {
  const [sites, setSites] = useState<Site[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("credential_remaining");
  const [passwordFilter, setPasswordFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [credentialStatus, setCredentialStatus] = useState<Record<string, boolean | undefined>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [savingPasswordSiteId, setSavingPasswordSiteId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [certificateDialogOpen, setCertificateDialogOpen] = useState(false);
  const [certificateCompanyName, setCertificateCompanyName] = useState("");
  const [certificateDate, setCertificateDate] = useState(() => new Date().toISOString().slice(0, 10));


  const loadData = async () => {
    try {
      const [sitesRes, assessmentsRes, contactsRes, machinesRes] = await Promise.all([
        supabase.from("sites").select("id, name, company_name, city, address, task_notes, consultant_stage").order("name"),
        supabase.from("assessment").select("site_id, data, updated_at"),
        supabase.from("contacts").select("*"),
        supabase.from("machines").select("*"),
      ]);

      setSites(sitesRes.data ?? []);
      setAssessments(assessmentsRes.data ?? []);
      setContacts(contactsRes.data ?? []);
      setMachines(machinesRes.data ?? []);
    } catch (err) {
      console.error("Error loading factory form data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();

    // Set up Real-Time Subscriptions for Auto-fetch
    const channel = supabase
      .channel("factory-form-data-channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assessment" },
        () => {
          void loadData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sites" },
        () => {
          void loadData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contacts" },
        () => {
          void loadData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "machines" },
        () => {
          void loadData();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  // Helpers to get specific data
  const selectedSite = useMemo(() => sites.find(s => s.id === selectedSiteId), [sites, selectedSiteId]);
  
  const selectedAssessment = useMemo(() => 
    assessments.find(a => a.site_id === selectedSiteId),
    [assessments, selectedSiteId]
  );

  const selectedContacts = useMemo(() => 
    contacts.filter(c => c.site_id === selectedSiteId),
    [contacts, selectedSiteId]
  );

  const selectedMachines = useMemo(() => 
    machines.filter(m => m.site_id === selectedSiteId),
    [machines, selectedSiteId]
  );

  const parsedMetadata = useMemo(() => {
    if (!selectedSite) return null;
    return parseSiteMetadata(selectedSite.task_notes);
  }, [selectedSite]);

  // Derived shift overlap validation helper
  const checkShiftOverlap = (shifts: any[]): boolean => {
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
  };

  const hasOverlap = useMemo(() => {
    const shifts = selectedAssessment?.data?.factory_op_shifts ?? [];
    return checkShiftOverlap(shifts);
  }, [selectedAssessment]);

  const editHasOverlap = useMemo(() => {
    const shifts = editData.factory_op_shifts ?? [];
    return checkShiftOverlap(shifts);
  }, [editData.factory_op_shifts]);

  // List of processed sites with their form completeness info
  // Filter out any site that does not have the form submitted by Field Associate or client.
  const processedSitesList = useMemo<SiteWithStatus[]>(() => {
    return sites
      .map(s => {
        const assess = assessments.find(a => a.site_id === s.id);
        const siteMeta = parseSiteMetadata(s.task_notes);
        const isSubmitted = !!assess?.data?.assessment_phase_submitted;
        const isDone = !!assess?.data?.factory_operations_done;
        
        let fillStatus: "completed" | "in_progress" | "no_data" = "no_data";
        if (isSubmitted) {
          fillStatus = isDone ? "completed" : "in_progress";
        }

        return {
          ...s,
          fillStatus,
          isDone,
          isSubmitted,
          updatedAt: assess?.updated_at,
          credentialCreated: credentialStatus[s.id] ?? !!siteMeta.credential_created,
          managerPassword: siteMeta.manager_password || "",
          hasManagerPassword: !!(siteMeta.manager_password || "").trim(),
          submittedMonth: assess?.updated_at ? assess.updated_at.slice(0, 7) : "",
        };
      })
      .filter(s => s.isSubmitted)
      .sort((a, b) => {
        if (a.credentialCreated !== b.credentialCreated) {
          return a.credentialCreated ? 1 : -1;
        }
        if (a.hasManagerPassword !== b.hasManagerPassword) {
          return a.hasManagerPassword ? 1 : -1;
        }
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      });
  }, [sites, assessments, credentialStatus]);

  useEffect(() => {
    setPasswordDrafts((prev) => {
      const next = { ...prev };
      for (const site of processedSitesList) {
        if (next[site.id] === undefined) {
          next[site.id] = site.managerPassword;
        }
      }
      return next;
    });
  }, [processedSitesList]);

  // Auto-select first site from the form-filled sites list if selection becomes invalid
  useEffect(() => {
    if (processedSitesList.length > 0) {
      const isValid = processedSitesList.some(s => s.id === selectedSiteId);
      if (!isValid) {
        setSelectedSiteId(processedSitesList[0].id);
      }
    } else {
      setSelectedSiteId("");
    }
  }, [processedSitesList, selectedSiteId]);

  // Sync editData state when selected site changes
  useEffect(() => {
    if (selectedAssessment) {
      setEditData(selectedAssessment.data || {});
    } else {
      setEditData({});
    }
    setIsEditing(false);
  }, [selectedSiteId, selectedAssessment]);


  // Filtered sites list
  const filteredSites = useMemo(() => {
    return processedSitesList.filter(s => {
      const matchSearch = 
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.company_name && s.company_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (s.city && s.city.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchSearch) return false;
      if (monthFilter !== "all" && s.submittedMonth !== monthFilter) return false;
      if (cityFilter !== "all" && (s.city || "Unknown") !== cityFilter) return false;
      if (statusFilter === "credential_created" && !s.credentialCreated) return false;
      if (statusFilter === "credential_remaining" && s.credentialCreated) return false;
      if (passwordFilter === "password_created" && !s.hasManagerPassword) return false;
      if (passwordFilter === "password_remaining" && s.hasManagerPassword) return false;
      return true;
    });
  }, [processedSitesList, searchQuery, statusFilter, passwordFilter, monthFilter, cityFilter]);

  const availableMonths = useMemo(() => {
    return Array.from(new Set(processedSitesList.map(s => s.submittedMonth).filter(Boolean))).sort().reverse();
  }, [processedSitesList]);

  const availableCities = useMemo(() => {
    return Array.from(new Set(processedSitesList.map(s => s.city || "Unknown"))).sort((a, b) => a.localeCompare(b));
  }, [processedSitesList]);

  const analyticsSites = useMemo(() => {
    return processedSitesList.filter(s => {
      if (monthFilter !== "all" && s.submittedMonth !== monthFilter) return false;
      if (cityFilter !== "all" && (s.city || "Unknown") !== cityFilter) return false;
      return true;
    });
  }, [processedSitesList, monthFilter, cityFilter]);

  const credentialCreatedCount = analyticsSites.filter(s => s.credentialCreated).length;
  const credentialRemainingCount = analyticsSites.length - credentialCreatedCount;
  const passwordCreatedCount = analyticsSites.filter(s => s.hasManagerPassword).length;
  const passwordRemainingCount = analyticsSites.length - passwordCreatedCount;

  const saveManagerPassword = async (siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;

    const nextPassword = passwordDrafts[siteId] ?? "";
    setSavingPasswordSiteId(siteId);

    const meta = parseSiteMetadata(site.task_notes);
    const nextNotes = serializeSiteMetadata(site.task_notes, {
      ...meta,
      manager_password: nextPassword,
    });

    const { error } = await supabase
      .from("sites")
      .update({ task_notes: nextNotes } as never)
      .eq("id", siteId);

    setSavingPasswordSiteId(null);

    if (error) {
      toast.error("Could not save manager password: " + error.message);
      return;
    }

    setSites(prev => prev.map((s) => (s.id === siteId ? { ...s, task_notes: nextNotes } : s)));
    toast.success(nextPassword.trim() ? "Manager password saved." : "Manager password cleared.");
  };

  const toggleCredentialCreated = async (siteId: string, checked: boolean) => {
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;

    const previousValue = credentialStatus[siteId];
    setCredentialStatus(prev => ({ ...prev, [siteId]: checked }));

    const meta = parseSiteMetadata(site.task_notes);
    const nextNotes = serializeSiteMetadata(site.task_notes, {
      ...meta,
      credential_created: checked,
    });

    const { error } = await supabase
      .from("sites")
      .update({ task_notes: nextNotes } as never)
      .eq("id", siteId);

    if (error) {
      setCredentialStatus(prev => ({ ...prev, [siteId]: previousValue }));
      toast.error("Could not save credential status: " + error.message);
      return;
    }

    setSites(prev => prev.map((s) => (s.id === siteId ? { ...s, task_notes: nextNotes } : s)));
    toast.success(checked ? "Moved to Credential Created." : "Moved back to Pending.");
  };

  const formatDate = (isoStr?: string) => {
    if (!isoStr) return "N/A";
    const date = new Date(isoStr);
    return date.toLocaleDateString(undefined, { 
      month: "short", 
      day: "numeric", 
      hour: "2-digit", 
      minute: "2-digit" 
    });
  };

  const handleSave = async () => {
    // 1. Factory Name
    if (!editData.factory_op_name || !editData.factory_op_name.trim()) {
      toast.error("Validation Error: Official Company Name is required");
      return;
    }

    // 2. Monitored Machine Name
    const singleMachine = Array.isArray(editData.factory_op_machines) ? (editData.factory_op_machines[0] || "") : (editData.factory_op_machine || "");
    if (!singleMachine || !singleMachine.trim()) {
      toast.error("Validation Error: Monitored Machine Name is required");
      return;
    }

    // 3. Registered Address
    if (!editData.factory_op_address || !editData.factory_op_address.trim()) {
      toast.error("Validation Error: Registered Address is required");
      return;
    }

    // 4. Owners Validation
    const owners = editData.factory_op_owners || [];
    if (owners.length === 0) {
      toast.error("Validation Error: At least 1 Factory Owner entry is required");
      return;
    }
    for (let idx = 0; idx < owners.length; idx++) {
      const o = owners[idx];
      if (!o.name || !o.name.trim()) {
        toast.error(`Validation Error: Owner #${idx + 1} Name is required`);
        return;
      }
      if (!o.contact || !o.contact.trim()) {
        toast.error(`Validation Error: Owner #${idx + 1} Contact Mobile is required`);
        return;
      }
      if (!o.email || !o.email.trim()) {
        toast.error(`Validation Error: Owner #${idx + 1} Email Address is required`);
        return;
      }
    }

    // 5. Shift Validation
    const shifts = editData.factory_op_shifts || [];
    if (shifts.length === 0) {
      toast.error("Validation Error: At least 1 Shift timing entry is required");
      return;
    }
    for (let idx = 0; idx < shifts.length; idx++) {
      const s = shifts[idx];
      if (!s.name || !s.name.trim()) {
        toast.error(`Validation Error: Shift #${idx + 1} Name is required`);
        return;
      }
      if (!s.startTime) {
        toast.error(`Validation Error: Shift #${idx + 1} Start Time is required`);
        return;
      }
      if (!s.endTime) {
        toast.error(`Validation Error: Shift #${idx + 1} End Time is required`);
        return;
      }
      if (!Array.isArray(s.workingDays) || s.workingDays.length === 0) {
        toast.error(`Validation Error: Shift #${idx + 1} Working Day is required`);
        return;
      }
    }

    // 6. Electricity Board
    if (!editData.factory_op_electricity_board || !editData.factory_op_electricity_board.trim()) {
      toast.error("Validation Error: Electricity Board selection is required");
      return;
    }

    try {
      const { error } = await supabase
        .from("assessment")
        .update({
          data: editData,
          updated_at: new Date().toISOString()
        } as never)
        .eq("site_id", selectedSiteId);

      if (error) {
        toast.error("Failed to save changes: " + error.message);
      } else {
        toast.success("Changes saved successfully");
        setIsEditing(false);
        await loadData();
      }
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
  };

  const handleCopyFactoryJson = async (targetSite?: SiteWithStatus) => {
    const siteObj = targetSite || selectedSite;
    if (!siteObj) return;

    const siteAssessment = assessments.find((a) => a.site_id === siteObj.id) || (siteObj.id === selectedSiteId ? selectedAssessment : undefined);
    const factoryJson = getFilledFactoryOperationsJson(siteAssessment?.data || {});

    if (Object.keys(factoryJson).length === 0) {
      toast.error(`No Factory Operations data available for ${siteObj.name}`);
      return;
    }

    try {
      const copied = await copyTextToClipboard(JSON.stringify(factoryJson, null, 2));
      if (!copied) throw new Error("Copy command failed");
      toast.success(`Copied Factory Operations JSON for ${siteObj.name}`);
    } catch {
      toast.error("Could not copy JSON. Your browser blocked clipboard access.");
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    if (!text || !text.trim()) {
      toast.error(`No ${label} available to copy`);
      return;
    }
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} to clipboard!`);
  };

  const copyFullSummary = () => {
    if (!selectedSite || !selectedAssessment) return;
    const d = selectedAssessment.data || {};
    const text = `
=== FACTORY ASSESSMENT SUMMARY ===
Official Company Name: ${d.factory_op_name || selectedSite.company_name || selectedSite.name}
Registered Address: ${d.factory_op_address || selectedSite.address || "N/A"}
Monitored Machine: ${Array.isArray(d.factory_op_machines) ? d.factory_op_machines[0] : d.factory_op_machine || "N/A"}
Electricity Board: ${d.factory_op_electricity_board || "N/A"}

--- FACTORY OWNERS ---
${(d.factory_op_owners || []).map((o: any) => `- Name: ${o.name || "N/A"} | Mobile: ${o.contact || "N/A"} | Email: ${o.email || "N/A"}`).join("\n") || "No owner records"}

--- TECHNICIANS / ENGINEERS ---
${(d.factory_op_technicians || []).map((t: any) => `- Name: ${t.name || "N/A"} | Mobile: ${t.contact || "N/A"} | Email: ${t.email || "N/A"}`).join("\n") || "No technician records"}

--- SHIFT TIMINGS ---
${(d.factory_op_shifts || []).map((s: any) => `- ${s.name || "Shift"}: ${formatTime24(s.startTime)} to ${formatTime24(s.endTime)} | Working Days: ${getShiftWorkingDays(s, d).join(", ") || "N/A"}`).join("\n") || "No shift records"}

--- DOWNTIME REASONS ---
Reasons: ${(d.factory_op_downtime_reasons || []).join(", ") || "None"}
Threshold Duration: ${d.factory_op_downtime_threshold ?? "N/A"} mins

--- TELEMETRY & TRACKING CONFIG ---
Machine Type: ${d.company_type || "N/A"}
Classification: ${d.machine_usage_type || "N/A"}
Daily Run Hours: ${d.expected_daily_run_hours ?? "N/A"}
Target Line Speed: ${d.target_line_speed ?? "N/A"}
Min Acceptable Speed: ${d.minimum_acceptable_speed ?? "N/A"}
==================================
    `.trim();

    navigator.clipboard.writeText(text);
    toast.success("Full Factory Summary copied to clipboard!");
  };

  const handleDeleteForm = async () => {
    if (!selectedSiteId) return;
    const confirmDelete = window.confirm(
      `Are you sure you want to delete the submitted factory questionnaire form data for ${selectedSite?.name}? This action cannot be undone.`
    );
    if (!confirmDelete) return;

    try {
      const { error } = await supabase
        .from("assessment")
        .delete()
        .eq("site_id", selectedSiteId);

      if (error) {
        toast.error("Failed to delete submission: " + error.message);
      } else {
        toast.success("Submission deleted successfully.");
        setSelectedSiteId("");
        await loadData();
      }
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
  };

  const handleShiftChange = (index: number, key: string, value: any) => {
    const shifts = [...(editData.factory_op_shifts || [])];
    shifts[index] = { ...shifts[index], [key]: value };
    setEditData({ ...editData, factory_op_shifts: shifts });
  };

  const openCertificateDialog = () => {
    const defaultCompanyName =
      selectedAssessment?.data?.factory_op_name ||
      selectedSite?.company_name ||
      selectedSite?.name ||
      "";
    setCertificateCompanyName(defaultCompanyName);
    setCertificateDate(new Date().toISOString().slice(0, 10));
    setCertificateDialogOpen(true);
  };

  const validateCertificateFields = () => {
    if (!certificateCompanyName.trim()) {
      toast.error("Company name is required.");
      return null;
    }
    if (!certificateDate) {
      toast.error("Date is required.");
      return null;
    }
    return {
      companyName: certificateCompanyName.trim(),
      certificateDate: formatCertificateDate(certificateDate),
    };
  };

  const downloadCertificateWord = () => {
    const fields = validateCertificateFields();
    if (!fields) return;

    const certificate = getCertificateSections(fields.companyName, fields.certificateDate);
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(certificate.title)}</title>
  <style>
    @page { size: A4; margin: 1in; }
    body { font-family: "Times New Roman", serif; font-size: 12pt; line-height: 1.45; color: #000; }
    h1 { font-size: 16pt; text-align: center; margin: 0 0 4pt; }
    .subtitle { text-align: center; margin: 0 0 18pt; }
    .date { text-align: left; margin: 0 0 18pt; }
    .subject { font-weight: bold; margin: 18pt 0; }
    p { margin: 0 0 12pt; }
    ul { margin: 0 0 12pt 20pt; padding: 0; }
    li { margin: 0 0 6pt; }
    .signoff { margin-top: 30pt; }
    .signoff p { margin: 0 0 8pt; }
  </style>
</head>
<body>
  <h1>${escapeHtml(certificate.title)}</h1>
  <p class="subtitle">${escapeHtml(certificate.subtitle)}</p>
  <p class="date">${escapeHtml(certificate.dateLine)}</p>
  ${certificate.toLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
  <p class="subject">${escapeHtml(certificate.subject)}</p>
  <p>${escapeHtml(certificate.greeting)}</p>
  ${certificate.paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
  <ul>${certificate.bullets.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
  ${certificate.closingParagraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
  <div class="signoff">
    ${certificate.signOffLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
  </div>
</body>
</html>`;

    downloadBlob(
      new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" }),
      makeDownloadFilename(fields.companyName, "doc")
    );
    toast.success("Word certificate downloaded.");
  };

  const downloadCertificatePdf = () => {
    const fields = validateCertificateFields();
    if (!fields) return;

    const certificate = getCertificateSections(fields.companyName, fields.certificateDate);
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 56;
    const maxWidth = pageWidth - margin * 2;
    let y = 58;

    const addWrappedText = (text: string, options: { size?: number; bold?: boolean; center?: boolean; gap?: number } = {}) => {
      pdf.setFont("times", options.bold ? "bold" : "normal");
      pdf.setFontSize(options.size ?? 12);
      const lines = pdf.splitTextToSize(text, maxWidth);
      lines.forEach((line: string) => {
        if (y > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
        pdf.text(line, options.center ? pageWidth / 2 : margin, y, { align: options.center ? "center" : "left" });
        y += (options.size ?? 12) + 5;
      });
      y += options.gap ?? 7;
    };

    addWrappedText(certificate.title, { size: 16, bold: true, center: true, gap: 2 });
    addWrappedText(certificate.subtitle, { center: true, gap: 18 });
    addWrappedText(certificate.dateLine, { gap: 18 });
    certificate.toLines.forEach((line) => addWrappedText(line, { gap: 0 }));
    y += 10;
    addWrappedText(certificate.subject, { bold: true, gap: 18 });
    addWrappedText(certificate.greeting);
    certificate.paragraphs.forEach((line) => addWrappedText(line));
    certificate.bullets.forEach((line) => addWrappedText(`- ${line}`, { gap: 1 }));
    y += 4;
    certificate.closingParagraphs.forEach((line) => addWrappedText(line));
    y += 18;
    certificate.signOffLines.forEach((line) => addWrappedText(line, { gap: 0 }));

    pdf.save(makeDownloadFilename(fields.companyName, "pdf"));
    toast.success("PDF certificate downloaded.");
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Title Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-lime font-bold">
            Operations &amp; Submissions
          </span>
          <h1 className="mt-2 text-4xl font-extrabold uppercase tracking-tight font-syne text-text-primary">
            Factory Form Submissions
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Browse, edit and verify operational questionnaires submitted during assessment visits.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={openCertificateDialog}>
            <FileText size={16} />
            Create Commission Certificate
          </Button>
          <Badge tone="success" className="px-2.5 py-1 text-xs">
            Auto-fetch: Active
          </Badge>
        </div>
      </header>

      <Dialog open={certificateDialogOpen} onOpenChange={setCertificateDialogOpen}>
        <DialogContent className="border-border bg-surface text-text-primary sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-syne uppercase tracking-tight">
              Create Commission Certificate
            </DialogTitle>
            <DialogDescription className="text-text-secondary">
              Enter the certificate details. This information is used only for the downloaded file.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Company Name</Label>
              <Input
                value={certificateCompanyName}
                onChange={(e) => setCertificateCompanyName(e.target.value)}
                placeholder="Enter company name"
              />
            </div>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={certificateDate}
                onChange={(e) => setCertificateDate(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="secondary" onClick={downloadCertificateWord}>
              <Download size={16} />
              Download Word
            </Button>
            <Button type="button" onClick={downloadCertificatePdf}>
              <Download size={16} />
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <div className="space-y-8">
          
          {/* PART 1 (TOP HORIZONTAL SECTION): Factory Companies Row Deck */}
          <Card className="p-5 bg-surface/50 backdrop-blur-md border border-border space-y-4 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <button
                type="button"
                onClick={() => setStatusFilter("credential_remaining")}
                className={`rounded-xl border p-4 text-left transition-all cursor-pointer ${
                  statusFilter === "credential_remaining"
                    ? "border-amber-400 bg-amber-500/15 ring-2 ring-amber-500/20"
                    : "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15"
                }`}
              >
                <div className="text-[9px] font-mono uppercase tracking-widest text-amber-400">Pending Credential</div>
                <div className="mt-1 text-2xl font-extrabold text-amber-400 font-mono">{credentialRemainingCount}</div>
                <div className="mt-1 text-[10px] text-text-secondary">Click to show pending companies</div>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("credential_created")}
                className={`rounded-xl border p-4 text-left transition-all cursor-pointer ${
                  statusFilter === "credential_created"
                    ? "border-lime bg-lime/15 ring-2 ring-lime/20"
                    : "border-lime/30 bg-lime/10 hover:bg-lime/15"
                }`}
              >
                <div className="text-[9px] font-mono uppercase tracking-widest text-lime">Credential Created</div>
                <div className="mt-1 text-2xl font-extrabold text-lime font-mono">{credentialCreatedCount}</div>
                <div className="mt-1 text-[10px] text-text-secondary">Click to show created companies</div>
              </button>
              <button
                type="button"
                onClick={() => setPasswordFilter("password_remaining")}
                className={`rounded-xl border p-4 text-left transition-all cursor-pointer ${
                  passwordFilter === "password_remaining"
                    ? "border-amber-400 bg-amber-500/15 ring-2 ring-amber-500/20"
                    : "border-border bg-surface/70 hover:border-amber-400/50"
                }`}
              >
                <div className="text-[9px] font-mono uppercase tracking-widest text-amber-400">Password Remaining</div>
                <div className="mt-1 text-2xl font-extrabold text-amber-400 font-mono">{passwordRemainingCount}</div>
                <div className="mt-1 text-[10px] text-text-secondary">Click to show password pending</div>
              </button>
              <button
                type="button"
                onClick={() => setPasswordFilter("password_created")}
                className={`rounded-xl border p-4 text-left transition-all cursor-pointer ${
                  passwordFilter === "password_created"
                    ? "border-lime bg-lime/15 ring-2 ring-lime/20"
                    : "border-border bg-surface/70 hover:border-lime/50"
                }`}
              >
                <div className="text-[9px] font-mono uppercase tracking-widest text-lime">Password Created</div>
                <div className="mt-1 text-2xl font-extrabold text-lime font-mono">{passwordCreatedCount}</div>
                <div className="mt-1 text-[10px] text-text-secondary">Click to show passwords saved</div>
              </button>
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-3">
              <div>
                <span className="font-mono text-[9px] uppercase tracking-widest text-lime font-bold">
                  Part 1 &bull; Active Company Submissions
                </span>
                <h3 className="text-base font-extrabold font-syne uppercase text-text-primary mt-0.5">
                  Factory Assessment Directory ({filteredSites.length})
                </h3>
              </div>

              {/* Controls: Search & Filter */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-64">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-text-dim" />
                  <Input
                    placeholder="Search factory or city…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-8 text-xs bg-surface"
                  />
                </div>
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8 text-xs py-0.5 bg-surface"
                >
                  <option value="credential_remaining">Pending Credential</option>
                  <option value="credential_created">Credential Created</option>
                </Select>
                <Select
                  value={passwordFilter}
                  onChange={(e) => setPasswordFilter(e.target.value)}
                  className="h-8 text-xs py-0.5 bg-surface"
                >
                  <option value="all">All Passwords</option>
                  <option value="password_remaining">Password Remaining</option>
                  <option value="password_created">Password Created</option>
                </Select>
                <Select
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  className="h-8 text-xs py-0.5 bg-surface"
                >
                  <option value="all">All Months</option>
                  {availableMonths.map((month) => (
                    <option key={month} value={month}>
                      {new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                    </option>
                  ))}
                </Select>
                <Select
                  value={cityFilter}
                  onChange={(e) => setCityFilter(e.target.value)}
                  className="h-8 text-xs py-0.5 bg-surface"
                >
                  <option value="all">All Cities</option>
                  {availableCities.map((city) => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Horizontal Company Rows Deck */}
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {filteredSites.length === 0 ? (
                <div className="text-center text-xs text-text-dim py-8 italic border border-dashed border-border rounded-xl">
                  No matching factory companies found
                </div>
              ) : (
                filteredSites.map((s) => {
                  const isActive = s.id === selectedSiteId;
                  return (
                    <div
                      key={s.id}
                      className={`w-full overflow-x-auto rounded-xl border transition-all duration-200 ${
                        isActive
                          ? "bg-lime/10 border-lime ring-2 ring-lime/20 shadow-sm"
                          : "bg-surface/70 border-border/80 hover:border-border-bright"
                      }`}
                    >
                      <div className="min-w-[1680px] p-4 flex items-center justify-between gap-4">
                      {/* Left Company Info */}
                      <div className="w-[1040px] min-w-0 flex items-center gap-4">
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <label
                            className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised/30 px-3 py-2 cursor-pointer select-none"
                            title={s.credentialCreated ? "Credential created" : "Mark credential as created"}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={s.credentialCreated}
                              onChange={(e) => toggleCredentialCreated(s.id, e.target.checked)}
                              className="h-4 w-4 accent-lime cursor-pointer"
                            />
                            <span className={`text-[9px] font-mono font-bold uppercase ${s.credentialCreated ? "text-lime" : "text-amber-400"}`}>
                              {s.credentialCreated ? "Credential Created" : "Pending Credential"}
                            </span>
                          </label>

                          <div
                            className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised/30 px-3 py-2 select-none"
                            title={s.hasManagerPassword ? "Manager password created" : "Manager password remaining"}
                          >
                            <KeyRound size={14} className={s.hasManagerPassword ? "text-lime" : "text-amber-400"} />
                            <span className={`text-[9px] font-mono font-bold uppercase ${s.hasManagerPassword ? "text-lime" : "text-amber-400"}`}>
                              {s.hasManagerPassword ? "Password Created" : "Password Remaining"}
                            </span>
                          </div>
                        </div>

                        <div className="w-[280px] min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[9px] uppercase tracking-wider text-text-dim">
                              {s.city || "No Location"}
                            </span>
                            {s.fillStatus === "completed" && (
                              <Badge tone="success" className="text-[9px] py-0 px-1.5 font-mono">Completed</Badge>
                            )}
                            {s.fillStatus === "in_progress" && (
                              <Badge tone="warning" className="text-[9px] py-0 px-1.5 font-mono animate-pulse">In Progress</Badge>
                            )}
                          </div>
                          <h4 className="font-bold text-sm text-text-primary uppercase tracking-tight truncate mt-0.5">
                            {s.name}
                          </h4>
                        </div>

                        <div className="w-[360px] text-xs text-text-secondary truncate">
                          {s.address || "No registered address provided"}
                        </div>

                        {s.updatedAt && (
                          <div className="w-[130px] text-[10px] font-mono text-text-dim">
                            Updated: {formatDate(s.updatedAt)}
                          </div>
                        )}
                      </div>

                      {/* Right Action Options: Copy JSON & View Details */}
                      <div className="w-[590px] flex items-center justify-end gap-2 shrink-0">
                        <div className="flex items-center gap-2 rounded-lg border border-border/80 bg-surface/80 p-1.5">
                          <Input
                            type="text"
                            value={passwordDrafts[s.id] ?? s.managerPassword}
                            onChange={(e) => setPasswordDrafts(prev => ({ ...prev, [s.id]: e.target.value }))}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Enter password"
                            className="h-8 w-36 text-xs font-mono"
                          />
                          <Button
                            onClick={() => saveManagerPassword(s.id)}
                            disabled={savingPasswordSiteId === s.id}
                            className="h-8 py-1 px-3 text-xs bg-lime text-black hover:bg-lime/90 flex items-center gap-1 font-bold cursor-pointer"
                          >
                            <Save size={12} />
                            {savingPasswordSiteId === s.id ? "Saving" : "Save"}
                          </Button>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleCopyFactoryJson(s)}
                          className="py-1 px-3 text-xs flex items-center gap-1.5 bg-surface-raised border border-border hover:border-lime/50 transition-all cursor-pointer"
                          title="Copy filled Factory Operations JSON for this company"
                        >
                          <Copy size={14} className="text-lime" />
                          <span>Copy Entire JSON</span>
                        </Button>

                        <Button
                          variant={isActive ? "primary" : "outline"}
                          size="sm"
                          onClick={() => setSelectedSiteId(s.id)}
                          className="py-1 px-4 text-xs font-bold uppercase tracking-wider cursor-pointer"
                        >
                          {isActive ? "Viewing Form" : "View Details"}
                        </Button>
                      </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {/* PART 2 (BOTTOM HORIZONTAL SECTION): Selected Factory Detail Form View */}
          <div className="space-y-6">
            {!selectedSite ? (
              <Card className="p-12 text-center bg-surface/50 border border-border/60">
                <Building2 className="mx-auto h-12 w-12 text-text-dim stroke-[1.5] mb-4" />
                <h3 className="text-lg font-bold text-text-primary">No Factory Selected</h3>
                <p className="text-text-secondary text-xs mt-1">
                  Please choose a site from the factory directory above to view its operational details.
                </p>
              </Card>
            ) : (
              <div className="space-y-6 animate-in fade-in duration-300">
                
                {/* Sticky Header Information Box */}
                <div className="sticky top-2 z-20 bg-surface/90 backdrop-blur-xl p-5 rounded-xl border border-border shadow-lg space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-mono tracking-widest text-lime font-bold">
                          Part 2 &bull; Detailed Form Showcase
                        </span>
                        {selectedSite.fillStatus === "completed" && (
                          <Badge tone="success" className="text-[9px] py-0 px-2 font-mono">Completed</Badge>
                        )}
                        {selectedSite.fillStatus === "in_progress" && (
                          <Badge tone="warning" className="text-[9px] py-0 px-2 font-mono animate-pulse">In Progress</Badge>
                        )}
                      </div>
                      <h2 className="text-xl font-extrabold font-syne text-text-primary uppercase tracking-tight mt-0.5">
                        {selectedSite.name}
                      </h2>
                      <div className="flex items-center gap-2 mt-0.5">
                        <MapPin size={12} className="text-text-secondary" />
                        <span className="text-xs text-text-secondary">
                          {selectedSite.address ? `${selectedSite.address}, ` : ""}{selectedSite.city}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={copyFullSummary}
                        className="py-1 px-3 text-xs flex items-center gap-1.5 bg-lime/10 border border-lime/30 text-lime hover:bg-lime/20 cursor-pointer font-bold"
                        title="Copy entire formatted factory form summary to clipboard"
                      >
                        <Copy size={13} /> Copy Summary
                      </Button>

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleCopyFactoryJson()}
                        className="py-1 px-3 text-xs flex items-center gap-1.5 cursor-pointer"
                        title="Copy filled Factory Operations JSON"
                      >
                        <Copy size={13} /> Copy Entire JSON
                      </Button>
                      
                      {isEditing ? (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setIsEditing(false)}
                            className="py-1 px-3 text-xs flex items-center gap-1 cursor-pointer"
                          >
                            <XCircle size={13} /> Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSave}
                            className="py-1 px-3 text-xs bg-lime text-black hover:bg-lime/90 flex items-center gap-1 font-bold cursor-pointer"
                          >
                            <Save size={13} /> Save Changes
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            onClick={() => {
                              setEditData(selectedAssessment?.data || {});
                              setIsEditing(true);
                            }}
                            className="py-1 px-3 text-xs flex items-center gap-1 cursor-pointer"
                          >
                            <Wrench size={13} /> Edit Data
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleDeleteForm}
                            className="py-1 px-3 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 border border-red-500/20 flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 size={13} /> Delete Form
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="bg-surface-raised/40 p-3.5 rounded-lg border border-border/60">
                      <div className="text-text-secondary font-mono text-[9px] uppercase tracking-wider">
                        Primary Contact (Metadata)
                      </div>
                      {parsedMetadata && (parsedMetadata.c1_name || parsedMetadata.c1_mobile) ? (
                        <div className="mt-1.5 space-y-1 font-semibold">
                          <p className="text-text-primary">{parsedMetadata.c1_name || "—"}</p>
                          {parsedMetadata.c1_mobile && (
                            <a href={`tel:${parsedMetadata.c1_mobile}`} className="text-lime hover:underline flex items-center gap-1">
                              <Phone size={11} /> {parsedMetadata.c1_mobile}
                            </a>
                          )}
                          {parsedMetadata.c1_email && (
                            <p className="text-text-secondary font-mono text-[10px] flex items-center gap-1 font-normal">
                              <Mail size={11} /> {parsedMetadata.c1_email}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="mt-1.5 text-text-dim italic">No primary metadata contact</p>
                      )}
                    </div>

                    <div className="bg-surface-raised/40 p-3.5 rounded-lg border border-border/60">
                      <div className="text-text-secondary font-mono text-[9px] uppercase tracking-wider">
                        Credential Status
                      </div>
                      <label className="mt-2 flex w-fit items-center gap-2 rounded-lg border border-border bg-surface/70 px-3 py-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!parsedMetadata?.credential_created}
                          onChange={(e) => toggleCredentialCreated(selectedSite.id, e.target.checked)}
                          className="h-4 w-4 accent-lime cursor-pointer"
                        />
                        <span className={`text-[10px] font-mono font-bold uppercase ${parsedMetadata?.credential_created ? "text-lime" : "text-amber-400"}`}>
                          {parsedMetadata?.credential_created ? "Credential Created" : "Pending Credential"}
                        </span>
                      </label>
                    </div>

                    <div className="bg-surface-raised/40 p-3.5 rounded-lg border border-border/60">
                      <div className="text-text-secondary font-mono text-[9px] uppercase tracking-wider">
                        Manager Password
                      </div>
                      <div className="mt-2 flex flex-col sm:flex-row gap-2">
                        <Input
                          type="text"
                          value={passwordDrafts[selectedSite.id] ?? parsedMetadata?.manager_password ?? ""}
                          onChange={(e) => setPasswordDrafts(prev => ({ ...prev, [selectedSite.id]: e.target.value }))}
                          placeholder="Enter or set password"
                          className="h-8 text-xs font-mono"
                        />
                        <Button
                          onClick={() => saveManagerPassword(selectedSite.id)}
                          disabled={savingPasswordSiteId === selectedSite.id}
                          className="h-8 py-1 px-3 text-xs bg-lime text-black hover:bg-lime/90 flex items-center gap-1 font-bold cursor-pointer"
                        >
                          <Save size={12} />
                          {savingPasswordSiteId === selectedSite.id ? "Saving" : "Save"}
                        </Button>
                      </div>
                      <div className={`mt-2 text-[10px] font-mono font-bold uppercase ${(parsedMetadata?.manager_password || "").trim() ? "text-lime" : "text-amber-400"}`}>
                        {(parsedMetadata?.manager_password || "").trim() ? "Password Created" : "Password Remaining"}
                      </div>
                    </div>

                    <div className="bg-surface-raised/40 p-3.5 rounded-lg border border-border/60">
                      <div className="text-text-secondary font-mono text-[9px] uppercase tracking-wider">
                        Form Info
                      </div>
                      <div className="mt-1.5 space-y-1">
                        <p className="text-text-primary">
                          Stage Reached: <strong className="uppercase text-lime">{selectedSite.consultant_stage || "Assessment"}</strong>
                        </p>
                        <p className="text-text-secondary">
                          Last Updated: <strong>{formatDate(selectedAssessment?.updated_at)}</strong>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Main Sections Showcase */}
                {!selectedAssessment ? (
                  <Card className="p-12 text-center bg-surface/50 border border-border/60">
                    <AlertCircle className="mx-auto h-10 w-10 text-text-dim stroke-[1.5] mb-3" />
                    <h4 className="text-sm font-bold text-text-primary">No Assessment Form Filled</h4>
                    <p className="text-text-secondary text-xs mt-1">
                      The Field Associate has not started the Assessment phase for this site yet.
                    </p>
                  </Card>
                ) : isEditing ? (
                  /* Editable Mode View */
                  <div className="space-y-6 animate-in fade-in duration-200">
                    {/* SECTION 1: General Info */}
                    <div className="space-y-3">
                      <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">1</span>
                        General Info & Verification
                      </h3>
                      <Card className="p-4 bg-surface/40 border border-border/60 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <Label>Official Company Name <span className="text-red-400">*</span></Label>
                            <Input
                              value={editData.factory_op_name || ""}
                              onChange={(e) => setEditData({ ...editData, factory_op_name: e.target.value })}
                              placeholder="Enter Company Name"
                            />
                          </div>
                          <div>
                            <Label>Registered Address <span className="text-red-400">*</span></Label>
                            <Input
                              value={editData.factory_op_address || ""}
                              onChange={(e) => setEditData({ ...editData, factory_op_address: e.target.value })}
                              placeholder="Enter Registered Address"
                            />
                          </div>
                          <div>
                            <Label>Monitored Machine Name <span className="text-red-400">*</span></Label>
                            <Input
                              value={Array.isArray(editData.factory_op_machines) ? (editData.factory_op_machines[0] || "") : (editData.factory_op_machine || "")}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditData({ ...editData, factory_op_machine: val, factory_op_machines: [val] });
                              }}
                              placeholder="e.g. CNC Lathe Machine 01"
                              className="font-medium text-lime"
                            />
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 pt-2">
                          <input
                            type="checkbox"
                            id="factory_operations_done"
                            checked={!!editData.factory_operations_done}
                            onChange={(e) => setEditData({ ...editData, factory_operations_done: e.target.checked })}
                            className="rounded border-border text-lime focus:ring-lime h-4 w-4 bg-surface"
                          />
                          <label htmlFor="factory_operations_done" className="text-xs font-bold text-text-primary cursor-pointer select-none">
                            Mark Assessment Form / Operations Questionnaire as Completed
                          </label>
                        </div>
                      </Card>
                    </div>

                    {/* SECTION 2: Owners, Operators, Technicians */}
                    <div className="space-y-3">
                      <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">2</span>
                        People &amp; Personnel
                      </h3>
                      
                      <div className="grid grid-cols-1 gap-6">
                        {/* Owners array editor */}
                        <Card className="p-4 bg-surface/40 border border-border/60 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-mono font-bold uppercase text-text-secondary">Factory Owners</h4>
                            <Button
                              variant="secondary"
                              className="py-0.5 px-2 text-[10px]"
                              onClick={() => {
                                const owners = [...(editData.factory_op_owners || [])];
                                owners.push({ name: "", contact: "", email: "" });
                                setEditData({ ...editData, factory_op_owners: owners });
                              }}
                            >
                              + Add Owner
                            </Button>
                          </div>
                          
                          <div className="space-y-3">
                            {(editData.factory_op_owners || []).map((o: any, idx: number) => (
                              <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end border-b border-border/20 pb-3 last:border-0 last:pb-0">
                                <div>
                                  <Label className="text-[10px]">Owner Name</Label>
                                  <Input
                                    value={o.name || ""}
                                    onChange={(e) => {
                                      const owners = [...editData.factory_op_owners];
                                      owners[idx] = { ...owners[idx], name: e.target.value };
                                      setEditData({ ...editData, factory_op_owners: owners });
                                    }}
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <div>
                                  <Label className="text-[10px]">Owner Contact</Label>
                                  <Input
                                    value={o.contact || ""}
                                    onChange={(e) => {
                                      const owners = [...editData.factory_op_owners];
                                      owners[idx] = { ...owners[idx], contact: e.target.value };
                                      setEditData({ ...editData, factory_op_owners: owners });
                                    }}
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <Label className="text-[10px]">Owner Email</Label>
                                    <Input
                                      value={o.email || ""}
                                      onChange={(e) => {
                                        const owners = [...editData.factory_op_owners];
                                        owners[idx] = { ...owners[idx], email: e.target.value };
                                        setEditData({ ...editData, factory_op_owners: owners });
                                      }}
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                  <Button
                                    variant="danger"
                                    className="h-8 py-1 px-2.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                    onClick={() => {
                                      const owners = (editData.factory_op_owners || []).filter((_: any, i: number) => i !== idx);
                                      setEditData({ ...editData, factory_op_owners: owners });
                                    }}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            ))}
                            {(!editData.factory_op_owners || editData.factory_op_owners.length === 0) && (
                              <p className="text-xs text-text-dim italic">No owner records added</p>
                            )}
                          </div>
                        </Card>

                        {/* Technicians array editor */}
                        <Card className="p-4 bg-surface/40 border border-border/60 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-mono font-bold uppercase text-text-secondary">Technicians / Engineers</h4>
                            <Button
                              variant="secondary"
                              className="py-0.5 px-2 text-[10px]"
                              onClick={() => {
                                const technicians = [...(editData.factory_op_technicians || [])];
                                technicians.push({ name: "", contact: "", email: "" });
                                setEditData({ ...editData, factory_op_technicians: technicians });
                              }}
                            >
                              + Add Technician
                            </Button>
                          </div>
                          
                          <div className="space-y-3">
                            {(editData.factory_op_technicians || []).map((t: any, idx: number) => (
                              <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end border-b border-border/20 pb-3 last:border-0 last:pb-0">
                                <div>
                                  <Label className="text-[10px]">Technician Name</Label>
                                  <Input
                                    value={t.name || ""}
                                    onChange={(e) => {
                                      const technicians = [...editData.factory_op_technicians];
                                      technicians[idx] = { ...technicians[idx], name: e.target.value };
                                      setEditData({ ...editData, factory_op_technicians: technicians });
                                    }}
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <div>
                                  <Label className="text-[10px]">Technician Contact</Label>
                                  <Input
                                    value={t.contact || ""}
                                    onChange={(e) => {
                                      const technicians = [...editData.factory_op_technicians];
                                      technicians[idx] = { ...technicians[idx], contact: e.target.value };
                                      setEditData({ ...editData, factory_op_technicians: technicians });
                                    }}
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <Label className="text-[10px]">Technician Email</Label>
                                    <Input
                                      value={t.email || ""}
                                      onChange={(e) => {
                                        const technicians = [...editData.factory_op_technicians];
                                        technicians[idx] = { ...technicians[idx], email: e.target.value };
                                        setEditData({ ...editData, factory_op_technicians: technicians });
                                      }}
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                  <Button
                                    variant="danger"
                                    className="h-8 py-1 px-2.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                    onClick={() => {
                                      const technicians = (editData.factory_op_technicians || []).filter((_: any, i: number) => i !== idx);
                                      setEditData({ ...editData, factory_op_technicians: technicians });
                                    }}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            ))}
                            {(!editData.factory_op_technicians || editData.factory_op_technicians.length === 0) && (
                              <p className="text-xs text-text-dim italic">No technician records added</p>
                            )}
                          </div>
                        </Card>
                      </div>
                    </div>

                    {/* SECTION 3: Shift Management */}
                    <div className="space-y-3">
                      <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">3</span>
                        Shifts &amp; Downtime Analysis
                      </h3>
                      
                      <Card className="p-4 bg-surface/40 border border-border/60 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-mono font-bold uppercase text-text-secondary">Shifts</h4>
                            {editHasOverlap && (
                              <span className="flex items-center gap-1 font-mono text-[9px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">
                                <AlertTriangle size={9} /> OVERLAP DETECTED
                              </span>
                            )}
                          </div>
                          <Button
                            variant="secondary"
                            className="py-0.5 px-2 text-[10px]"
                            onClick={() => {
                              const shifts = [...(editData.factory_op_shifts || [])];
                              shifts.push({ name: "", startTime: "", endTime: "", workingDays: [] });
                              setEditData({ ...editData, factory_op_shifts: shifts });
                            }}
                          >
                            + Add Shift
                          </Button>
                        </div>
                        
                        <div className="space-y-3">
                          {(editData.factory_op_shifts || []).map((s: any, idx: number) => (
                            <div key={idx} className="space-y-3 border-b border-border/20 pb-3 last:border-0 last:pb-0">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                                <div>
                                  <Label className="text-[10px]">Shift Name <span className="text-red-400">*</span></Label>
                                  <Input
                                    value={s.name || ""}
                                    onChange={(e) => handleShiftChange(idx, "name", e.target.value)}
                                    className="h-8 text-xs bg-surface"
                                  />
                                </div>
                                <div>
                                  <Label className="text-[10px]">Start Time <span className="text-red-400">*</span></Label>
                                  <Input
                                    type="time"
                                    value={s.startTime ? formatTime24(s.startTime) : ""}
                                    onChange={(e) => handleShiftChange(idx, "startTime", e.target.value)}
                                    className="h-8 text-xs bg-surface"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <Label className="text-[10px]">End Time <span className="text-red-400">*</span></Label>
                                    <Input
                                      type="time"
                                      value={s.endTime ? formatTime24(s.endTime) : ""}
                                      onChange={(e) => handleShiftChange(idx, "endTime", e.target.value)}
                                      className="h-8 text-xs bg-surface"
                                    />
                                  </div>
                                  <Button
                                    variant="danger"
                                    className="h-8 py-1 px-2.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                    onClick={() => {
                                      const shifts = (editData.factory_op_shifts || []).filter((_: any, i: number) => i !== idx);
                                      setEditData({ ...editData, factory_op_shifts: shifts });
                                    }}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </div>

                              <div>
                                <Label className="text-[10px]">Working Days <span className="text-red-400">*</span></Label>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {WORKING_DAYS.map((day) => {
                                    const selectedDays = s.workingDays || [];
                                    const isChecked = selectedDays.includes(day);
                                    return (
                                      <label
                                        key={day}
                                        className={`flex items-center gap-2 cursor-pointer select-none py-2 px-3 rounded border text-[10px] font-mono font-bold transition-all ${
                                          isChecked
                                            ? "border-lime bg-lime/10 text-lime"
                                            : "border-border text-text-secondary bg-surface/30 hover:border-border-bright"
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => {
                                            const shifts = [...(editData.factory_op_shifts || [])];
                                            shifts[idx] = {
                                              ...shifts[idx],
                                              workingDays: isChecked
                                                ? selectedDays.filter((item: string) => item !== day)
                                                : [...selectedDays, day]
                                            };
                                            setEditData({ ...editData, factory_op_shifts: shifts });
                                          }}
                                          className="sr-only"
                                        />
                                        <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded border ${isChecked ? "border-lime bg-lime text-bg" : "border-text-dim"}`}>
                                          {isChecked && <Check size={10} />}
                                        </span>
                                        <span>{day}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          ))}
                          {(!editData.factory_op_shifts || editData.factory_op_shifts.length === 0) && (
                            <p className="text-xs text-text-dim italic">No shift records added</p>
                          )}
                        </div>

                        <div className="pt-2">
                          <Label>Downtime Reasons (comma-separated)</Label>
                          <Input
                            value={(editData.factory_op_downtime_reasons || []).join(", ")}
                            onChange={(e) => {
                              const reasons = e.target.value.split(",").map(r => r.trim()).filter(Boolean);
                              setEditData({ ...editData, factory_op_downtime_reasons: reasons });
                            }}
                            placeholder="e.g. Raw material shortage, Power cuts, Machine breakdown"
                          />
                        </div>
                      </Card>
                    </div>

                    {/* SECTION 4: MOM Notes */}
                    <div className="space-y-3">
                      <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">4</span>
                        Survey Minutes Notes
                      </h3>
                      <Card className="p-4 bg-surface/40 border border-border/60">
                        <textarea
                          className="w-full min-h-[120px] rounded border border-border bg-surface px-3 py-2 text-xs text-text-primary placeholder:text-text-dim focus:border-lime focus:outline-none transition-colors"
                          value={editData.mom_notes || ""}
                          onChange={(e) => setEditData({ ...editData, mom_notes: e.target.value })}
                          placeholder="Enter MOM survey notes here..."
                        />
                      </Card>
                    </div>

                    {/* SECTION 5: Business Profile & Machinery Details */}
                    <div className="space-y-3">
                      <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">5</span>
                        Business Profile &amp; Machinery Details
                      </h3>
                      <Card className="p-4 bg-surface/40 border border-border/60 space-y-4 text-xs">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label>Electricity Board</Label>
                            <Select
                              value={editData.factory_op_electricity_board || ""}
                              onChange={(e) => setEditData({ ...editData, factory_op_electricity_board: e.target.value })}
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
                              value={editData.factory_op_downtime_threshold ?? ""}
                              onChange={(e) => setEditData({ ...editData, factory_op_downtime_threshold: e.target.value ? Number(e.target.value) : "" })}
                              placeholder="e.g. 10"
                            />
                          </div>
                        </div>

                        <div>
                          <Label>Surveyed Machine Names (comma-separated)</Label>
                          <Input
                            value={(editData.factory_op_machines || []).join(", ")}
                            onChange={(e) => {
                              const machines = e.target.value.split(",").map(m => m.trim()).filter(Boolean);
                              setEditData({ ...editData, factory_op_machines: machines });
                            }}
                            placeholder="e.g. Extruder-01, Mixer-A, Compressor"
                          />
                        </div>

                        <div className="border-t border-border/40 pt-4 space-y-4">
                          <div>
                            <Label className="text-[10px] uppercase tracking-widest text-text-secondary">Company / Machine Tracking Type</Label>
                            <Select
                              value={editData.company_type || ""}
                              onChange={(e) => setEditData({ ...editData, company_type: e.target.value })}
                              className="w-full bg-surface mt-1"
                            >
                              <option value="">Select Type...</option>
                              <option value="Runtime Machine">Runtime Machine (Time-based Tracking)</option>
                              <option value="Length-based Machine">Length-based Machine (Continuous Extruder)</option>
                            </Select>
                          </div>

                          {editData.company_type === "Runtime Machine" && (
                            <div className="grid gap-4 md:grid-cols-3 bg-surface/20 p-3 rounded-lg border border-border/30">
                              <div>
                                <Label>Expected daily run (hours)</Label>
                                <Input
                                  type="number"
                                  value={editData.expected_daily_run_hours ?? ""}
                                  onChange={(e) => setEditData({ ...editData, expected_daily_run_hours: e.target.value ? Number(e.target.value) : "" })}
                                  placeholder="e.g. 9"
                                />
                              </div>
                              <div>
                                <Label>Expected runtime / day (min)</Label>
                                <Input
                                  type="number"
                                  value={editData.expected_runtime_day_min ?? ""}
                                  onChange={(e) => setEditData({ ...editData, expected_runtime_day_min: e.target.value ? Number(e.target.value) : "" })}
                                  placeholder="540"
                                />
                              </div>
                              <div>
                                <Label>Minimum stop duration (min)</Label>
                                <Input
                                  type="number"
                                  value={editData.minimum_stop_duration_min ?? ""}
                                  onChange={(e) => setEditData({ ...editData, minimum_stop_duration_min: e.target.value ? Number(e.target.value) : "" })}
                                  placeholder="5"
                                />
                              </div>
                              <div className="md:col-span-3 grid grid-cols-2 gap-4 pt-2">
                                <label className="flex items-center gap-2 cursor-pointer select-none font-semibold">
                                  <input
                                    type="checkbox"
                                    checked={!!editData.production_count_meaningful}
                                    onChange={(e) => setEditData({ ...editData, production_count_meaningful: e.target.checked })}
                                    className="rounded border-border text-lime focus:ring-lime h-4 w-4 bg-surface"
                                  />
                                  Production count is meaningful
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer select-none font-semibold">
                                  <input
                                    type="checkbox"
                                    checked={!!editData.vibration_monitoring_relevant}
                                    onChange={(e) => setEditData({ ...editData, vibration_monitoring_relevant: e.target.checked })}
                                    className="rounded border-border text-lime focus:ring-lime h-4 w-4 bg-surface"
                                  />
                                  Vibration monitoring relevant
                                </label>
                              </div>
                            </div>
                          )}

                          {editData.company_type === "Length-based Machine" && (
                            <div className="grid gap-4 md:grid-cols-3 bg-surface/20 p-3 rounded-lg border border-border/30">
                              <div>
                                <Label>Expected meters / shift (m)</Label>
                                <Input
                                  type="number"
                                  value={editData.expected_meters_shift ?? ""}
                                  onChange={(e) => setEditData({ ...editData, expected_meters_shift: e.target.value ? Number(e.target.value) : "" })}
                                  placeholder="Target meters"
                                />
                              </div>
                              <div>
                                <Label>Target line speed (mpm)</Label>
                                <Input
                                  type="number"
                                  value={editData.target_line_speed ?? ""}
                                  onChange={(e) => setEditData({ ...editData, target_line_speed: e.target.value ? Number(e.target.value) : "" })}
                                  placeholder="Ideal speed"
                                />
                              </div>
                              <div>
                                <Label>Minimum acceptable speed (mpm)</Label>
                                <Input
                                  type="number"
                                  value={editData.minimum_acceptable_speed ?? ""}
                                  onChange={(e) => setEditData({ ...editData, minimum_acceptable_speed: e.target.value ? Number(e.target.value) : "" })}
                                  placeholder="Idle speed threshold"
                                />
                              </div>
                            </div>
                          )}

                          {editData.company_type && (
                            <div className="space-y-2">
                              <Label>Machine Classification</Label>
                              <div className="flex gap-1.5 flex-wrap">
                                {["Production", "Utility", "Auxiliary", "Support"].map((type) => {
                                  const isActive = (editData.machine_usage_type ?? "Production") === type;
                                  return (
                                    <button
                                      key={type}
                                      type="button"
                                      onClick={() => setEditData({ ...editData, machine_usage_type: type })}
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
                      </Card>
                    </div>
                  </div>
                ) : (
                  /* Read Only Mode View - Exact Input Form Section Sequence & Titles */
                  <div className="space-y-6">
                    
                    {/* SECTION 1: Factory Operations General Info & Address */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">1</span>
                          1. FACTORY OPERATIONS GENERAL INFO &amp; ADDRESS
                        </h3>
                        <Badge tone="ghost" className="text-[9px] font-mono">Input Order #1</Badge>
                      </div>
                      
                      <Card className="p-4 bg-surface/50 border border-border/70 space-y-3.5 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary font-bold">Official Company Name</div>
                            <p className="text-sm font-extrabold text-text-primary mt-0.5">
                              {selectedAssessment.data.factory_op_name || selectedSite.company_name || selectedSite.name}
                            </p>
                          </div>
                          <button
                            onClick={() => copyToClipboard(selectedAssessment.data.factory_op_name || selectedSite.company_name || selectedSite.name, "Company Name")}
                            className="text-text-dim hover:text-lime transition-colors p-1 rounded hover:bg-surface-raised cursor-pointer shrink-0"
                            title="Copy Official Company Name"
                          >
                            <Copy size={13} />
                          </button>
                        </div>

                        <div className="flex items-start justify-between gap-2 border-t border-border/40 pt-2.5">
                          <div>
                            <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary font-bold">Registered Address</div>
                            <p className="text-xs text-text-secondary mt-0.5">
                              {selectedAssessment.data.factory_op_address || selectedSite.address || "No registered address provided"}
                            </p>
                          </div>
                          <button
                            onClick={() => copyToClipboard(selectedAssessment.data.factory_op_address || selectedSite.address || "", "Registered Address")}
                            className="text-text-dim hover:text-lime transition-colors p-1 rounded hover:bg-surface-raised cursor-pointer shrink-0"
                            title="Copy Registered Address"
                          >
                            <Copy size={13} />
                          </button>
                        </div>

                        <div className="flex items-start justify-between gap-2 border-t border-border/40 pt-2.5">
                          <div>
                            <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary font-bold">Monitored Machine Name</div>
                            <p className="text-xs font-bold text-lime mt-0.5">
                              {Array.isArray(selectedAssessment.data.factory_op_machines) ? selectedAssessment.data.factory_op_machines[0] : (selectedAssessment.data.factory_op_machine || "No machine specified")}
                            </p>
                          </div>
                          <button
                            onClick={() => copyToClipboard(Array.isArray(selectedAssessment.data.factory_op_machines) ? selectedAssessment.data.factory_op_machines[0] : (selectedAssessment.data.factory_op_machine || ""), "Monitored Machine Name")}
                            className="text-text-dim hover:text-lime transition-colors p-1 rounded hover:bg-surface-raised cursor-pointer shrink-0"
                            title="Copy Machine Name"
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      </Card>
                    </div>

                    {/* SECTION 2: Executive Leadership & Owners Detail */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">2</span>
                          2. EXECUTIVE LEADERSHIP &amp; OWNERS DETAIL
                        </h3>
                        <span className="text-[9px] text-text-dim font-mono">{(selectedAssessment.data.factory_op_owners ?? []).length} Owner(s)</span>
                      </div>

                      <div className="bg-surface/50 border border-border/70 p-4 rounded-xl space-y-3 shadow-sm">
                        <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                          {(selectedAssessment.data.factory_op_owners ?? []).map((o: any, idx: number) => (
                            <div key={idx} className="text-xs border-b border-border/30 pb-2.5 last:border-0 last:pb-0 flex items-center justify-between gap-2">
                              <div>
                                <p className="font-bold text-text-primary text-xs">{o.name || "Unnamed Owner"}</p>
                                <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px]">
                                  {o.contact && (
                                    <a href={`tel:${o.contact}`} className="text-lime font-mono hover:underline flex items-center gap-1">
                                      <Phone size={11} /> {o.contact}
                                    </a>
                                  )}
                                  {o.email && (
                                    <span className="text-text-secondary font-mono flex items-center gap-1">
                                      <Mail size={11} /> {o.email}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => copyToClipboard(`${o.name} | ${o.contact || "No Phone"} | ${o.email || "No Email"}`, "Owner Details")}
                                className="text-text-dim hover:text-lime p-1 rounded cursor-pointer shrink-0"
                                title="Copy Owner Details"
                              >
                                <Copy size={13} />
                              </button>
                            </div>
                          ))}
                          {(!selectedAssessment.data.factory_op_owners || selectedAssessment.data.factory_op_owners.length === 0) && (
                            <p className="text-xs text-text-dim italic">No owner details recorded</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* SECTION 3: Technical & Engineering Team Details */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">3</span>
                          3. TECHNICAL &amp; ENGINEERING TEAM DETAILS
                        </h3>
                        <span className="text-[9px] text-text-dim font-mono">{(selectedAssessment.data.factory_op_technicians ?? []).length} Technician(s)</span>
                      </div>

                      <div className="bg-surface/50 border border-border/70 p-4 rounded-xl space-y-3 shadow-sm">
                        <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                          {(selectedAssessment.data.factory_op_technicians ?? []).map((t: any, idx: number) => (
                            <div key={idx} className="text-xs border-b border-border/30 pb-2.5 last:border-0 last:pb-0 flex items-center justify-between gap-2">
                              <div>
                                <p className="font-bold text-text-primary text-xs">{t.name || "Unnamed Tech"}</p>
                                <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px]">
                                  {t.contact && (
                                    <a href={`tel:${t.contact}`} className="text-lime font-mono hover:underline flex items-center gap-1">
                                      <Phone size={11} /> {t.contact}
                                    </a>
                                  )}
                                  {t.email && (
                                    <span className="text-text-secondary font-mono flex items-center gap-1">
                                      <Mail size={11} /> {t.email}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => copyToClipboard(`${t.name} | ${t.contact || "No Phone"} | ${t.email || "No Email"}`, "Technician Details")}
                                className="text-text-dim hover:text-lime p-1 rounded cursor-pointer shrink-0"
                                title="Copy Technician Details"
                              >
                                <Copy size={13} />
                              </button>
                            </div>
                          ))}
                          {(!selectedAssessment.data.factory_op_technicians || selectedAssessment.data.factory_op_technicians.length === 0) && (
                            <p className="text-xs text-text-dim italic">No technician details recorded</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* SECTION 4: Operational Shift Schedule & Timings */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">4</span>
                          4. OPERATIONAL SHIFT SCHEDULE &amp; TIMINGS
                        </h3>
                        {hasOverlap && (
                          <span className="flex items-center gap-1 font-mono text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded">
                            <AlertTriangle size={11} /> OVERLAP DETECTED
                          </span>
                        )}
                      </div>

                      {(!selectedAssessment.data.factory_op_shifts || selectedAssessment.data.factory_op_shifts.length === 0) ? (
                        <p className="text-xs text-text-dim italic">No shift information submitted</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {selectedAssessment.data.factory_op_shifts.map((s: any, idx: number) => (
                            <Card key={idx} className={`p-4 bg-surface/50 border flex items-center gap-3.5 justify-between shadow-sm ${
                              hasOverlap ? "border-red-500/30" : "border-border/70"
                            }`}>
                              <div className="flex items-center gap-3">
                                <Clock className="text-lime h-5 w-5 shrink-0" />
                                <div>
                                  <h4 className="font-bold text-xs uppercase tracking-tight text-text-primary">
                                    {s.name || `Shift ${idx + 1}`}
                                  </h4>
                                  <p className="text-[10px] text-text-secondary mt-0.5">
                                    Shift Timing: <strong className="text-lime font-mono">{formatTime24(s.startTime)} to {formatTime24(s.endTime)}</strong>
                                  </p>
                                  <p className="text-[10px] text-text-secondary mt-1">
                                    Working Days: <strong className="text-text-primary font-mono">{getShiftWorkingDays(s, selectedAssessment.data).join(", ") || "Not specified"}</strong>
                                  </p>
                                </div>
                              </div>
                              <button
                                onClick={() => copyToClipboard(`${s.name || `Shift ${idx + 1}`}: ${formatTime24(s.startTime)} to ${formatTime24(s.endTime)} | Working Days: ${getShiftWorkingDays(s, selectedAssessment.data).join(", ") || "Not specified"}`, "Shift Timings")}
                                className="text-text-dim hover:text-lime p-1.5 rounded hover:bg-surface-raised cursor-pointer shrink-0"
                                title="Copy Shift Timing"
                              >
                                <Copy size={13} />
                              </button>
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* SECTION 5: Electricity Board & Power Configuration */}
                    <div className="space-y-3">
                      <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">5</span>
                        5. ELECTRICITY BOARD &amp; POWER CONFIGURATION
                      </h3>
                      
                      <Card className="p-4 bg-surface/50 border border-border/70 space-y-3 text-xs shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[10px] font-mono uppercase text-text-secondary font-bold">Electricity Board Provider</span>
                            <p className="text-sm font-extrabold text-text-primary mt-0.5">
                              {selectedAssessment.data.factory_op_electricity_board || "Not selected / None specified"}
                            </p>
                          </div>
                          <button
                            onClick={() => copyToClipboard(selectedAssessment.data.factory_op_electricity_board || "", "Electricity Board")}
                            className="text-text-dim hover:text-lime p-1 rounded cursor-pointer"
                            title="Copy Electricity Board Provider"
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      </Card>
                    </div>

                    {/* SECTION 6: Downtime Reasons & Threshold Matrix */}
                    <div className="space-y-3">
                      <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">6</span>
                        6. DOWNTIME REASONS &amp; THRESHOLD MATRIX
                      </h3>

                      <Card className="p-4 bg-surface/50 border border-border/70 space-y-3.5 shadow-sm">
                        <div className="text-[10px] font-mono uppercase text-text-secondary font-bold flex justify-between items-center">
                          <span>Active Downtime Reasons (Selected by Field Associate/Client)</span>
                          {selectedAssessment.data.factory_op_downtime_reasons && (
                            <button
                              onClick={() => copyToClipboard((selectedAssessment.data.factory_op_downtime_reasons || []).join(", "), "Downtime Reasons")}
                              className="text-text-dim hover:text-lime text-[10px] flex items-center gap-1 cursor-pointer"
                            >
                              <Copy size={11} /> Copy All Reasons
                            </button>
                          )}
                        </div>
                        {(!selectedAssessment.data.factory_op_downtime_reasons || selectedAssessment.data.factory_op_downtime_reasons.length === 0) ? (
                          <p className="text-xs text-text-dim italic">No downtime pain points selected</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {selectedAssessment.data.factory_op_downtime_reasons.map((reason: string) => (
                              <span
                                key={reason}
                                className="px-2.5 py-1 text-xs rounded-lg border border-lime/25 bg-lime/10 text-text-primary flex items-center gap-1.5 font-medium"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                                {reason}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="border-t border-border/40 pt-3 flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[10px] font-mono uppercase text-text-secondary font-bold">Ideal Downtime Threshold Time (Minutes)</span>
                            <p className="text-sm font-extrabold text-lime mt-0.5">
                              {selectedAssessment.data.factory_op_downtime_threshold !== undefined && selectedAssessment.data.factory_op_downtime_threshold !== null
                                ? `${selectedAssessment.data.factory_op_downtime_threshold} Minutes` 
                                : "Not specified"}
                            </p>
                          </div>
                          <button
                            onClick={() => copyToClipboard(String(selectedAssessment.data.factory_op_downtime_threshold ?? ""), "Threshold Time")}
                            className="text-text-dim hover:text-lime p-1 rounded cursor-pointer"
                            title="Copy Threshold Time"
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      </Card>
                    </div>

                    {/* SECTION 7: Survey Notes & Minutes of Meeting (MOM) */}
                    {selectedAssessment.data.mom_notes && (
                      <div className="space-y-3">
                        <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">7</span>
                          7. SURVEY NOTES &amp; MINUTES OF MEETING (MOM)
                        </h3>
                        <Card className="p-5 bg-surface/50 border border-border/70 flex items-start justify-between gap-3 shadow-sm">
                          <div className="flex items-start gap-3">
                            <FileText className="text-lime shrink-0 h-5 w-5 mt-0.5" />
                            <div className="space-y-1">
                              <span className="text-[10px] font-mono uppercase text-text-secondary font-bold">Survey Minutes Notes</span>
                              <p className="text-sm text-text-primary leading-relaxed whitespace-pre-line">
                                {selectedAssessment.data.mom_notes}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => copyToClipboard(selectedAssessment.data.mom_notes, "Survey Notes")}
                            className="text-text-dim hover:text-lime p-1 rounded hover:bg-surface-raised cursor-pointer shrink-0"
                            title="Copy Survey Notes"
                          >
                            <Copy size={13} />
                          </button>
                        </Card>
                      </div>
                    )}

                    {/* SECTION 8: Additional Field Survey Contacts */}
                    {selectedContacts.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">8</span>
                          8. ADDITIONAL FIELD SURVEY CONTACTS
                        </h3>
                        <Card className="p-4 bg-surface/50 border border-border/70 space-y-3 shadow-sm">
                          <div className="space-y-2.5 max-h-[180px] overflow-y-auto pr-1">
                            {selectedContacts.map((c) => (
                              <div key={c.id} className="border-b border-border/40 pb-2.5 last:border-0 last:pb-0 flex items-start justify-between gap-2 text-xs">
                                <div>
                                  <p className="font-bold text-text-primary">{c.name}</p>
                                  {c.designation && <p className="text-[10px] text-text-secondary">{c.designation}</p>}
                                </div>
                                <div className="text-right font-mono text-[10px] flex items-center gap-1.5">
                                  <div>
                                    <a href={`tel:${c.mobile}`} className="text-lime hover:underline font-bold block">{c.mobile}</a>
                                    {c.email && <span className="text-text-dim text-[9px]">{c.email}</span>}
                                  </div>
                                  <button
                                    onClick={() => copyToClipboard(`${c.name} - ${c.mobile} ${c.email || ""}`, "Contact")}
                                    className="text-text-dim hover:text-lime p-1 rounded cursor-pointer"
                                    title="Copy Contact Details"
                                  >
                                    <Copy size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </Card>
                      </div>
                    )}

                    {/* SECTION 9: Machinery & Equipment Survey */}
                    <div className="space-y-3">
                      <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">9</span>
                        9. MACHINERY &amp; EQUIPMENT SURVEY
                      </h3>

                      {selectedMachines.length === 0 ? (
                        <Card className="p-6 text-center bg-surface/30 border border-border/60">
                          <Wrench className="mx-auto h-8 w-8 text-text-dim stroke-[1.5] mb-2" />
                          <p className="text-xs text-text-dim italic">No machinery added in the inventory details section</p>
                        </Card>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {selectedMachines.map((m, idx) => {
                            let condColor = "bg-stone text-stone";
                            if (m.condition === "Good") condColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                            else if (m.condition === "Average") condColor = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                            else if (m.condition === "Poor") condColor = "bg-red-500/10 text-red-400 border-red-500/20";

                            return (
                              <Card key={m.id} className="p-4 bg-surface/40 border border-border/60 flex flex-col justify-between gap-3 shadow-sm">
                                <div>
                                  <div className="flex items-center justify-between w-full">
                                    <span className="font-mono text-[9px] text-text-secondary uppercase">
                                      Machine {String(idx + 1).padStart(2, "0")}
                                    </span>
                                    {m.condition && (
                                      <span className={`px-2 py-0.5 border text-[9px] rounded font-bold uppercase ${condColor}`}>
                                        {m.condition}
                                      </span>
                                    )}
                                  </div>
                                  <h4 className="font-bold text-sm text-text-primary mt-1 uppercase tracking-tight">
                                    {m.name || "Unnamed Machine"}
                                  </h4>
                                </div>
                                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px] border-t border-border/40 pt-2.5 font-mono">
                                  <div>
                                    <span className="text-text-dim block text-[9px] uppercase">Make / Brand</span>
                                    <span className="text-text-primary font-semibold">{m.brand || "—"}</span>
                                  </div>
                                  <div>
                                    <span className="text-text-dim block text-[9px] uppercase">Model</span>
                                    <span className="text-text-primary font-semibold">{m.model || "—"}</span>
                                  </div>
                                  <div>
                                    <span className="text-text-dim block text-[9px] uppercase">Serial No.</span>
                                    <span className="text-text-primary font-semibold">{m.serial || "—"}</span>
                                  </div>
                                  <div>
                                    <span className="text-text-dim block text-[9px] uppercase">Mfg Year</span>
                                    <span className="text-text-primary font-semibold">{m.year || "—"}</span>
                                  </div>
                                </div>
                              </Card>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Detail Metrics depending on Type */}
                      {selectedAssessment.data.company_type && (
                        <Card className="p-4 bg-surface/40 border border-border/60 text-xs">
                          <span className="text-[10px] font-mono uppercase text-text-secondary block mb-3">
                            {selectedAssessment.data.company_type} Specifics
                          </span>

                          {selectedAssessment.data.company_type === "Runtime Machine" ? (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div className="bg-surface/20 p-2.5 rounded border border-border/40">
                                <span className="text-[9px] text-text-secondary block font-mono">EXPECTED DAILY RUN</span>
                                <span className="text-sm font-bold text-text-primary">
                                  {selectedAssessment.data.expected_daily_run_hours ?? "—"} hrs
                                </span>
                              </div>
                              <div className="bg-surface/20 p-2.5 rounded border border-border/40">
                                <span className="text-[9px] text-text-secondary block font-mono">EXPECTED RUNTIME/DAY</span>
                                <span className="text-sm font-bold text-text-primary">
                                  {selectedAssessment.data.expected_runtime_day_min ?? "—"} mins
                                </span>
                              </div>
                              <div className="bg-surface/20 p-2.5 rounded border border-border/40">
                                <span className="text-[9px] text-text-secondary block font-mono">MIN STOP DURATION</span>
                                <span className="text-sm font-bold text-text-primary">
                                  {selectedAssessment.data.minimum_stop_duration_min ?? "—"} mins
                                </span>
                              </div>
                              <div className="sm:col-span-3 flex gap-6 pt-2 font-mono text-[10px] text-text-secondary">
                                <div className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${selectedAssessment.data.production_count_meaningful ? "bg-lime" : "bg-text-dim"}`} />
                                  Production Count Meaningful: <strong>{selectedAssessment.data.production_count_meaningful ? "YES" : "NO"}</strong>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${selectedAssessment.data.vibration_monitoring_relevant ? "bg-lime" : "bg-text-dim"}`} />
                                  Vibration Monitoring: <strong>{selectedAssessment.data.vibration_monitoring_relevant ? "YES" : "NO"}</strong>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div className="bg-surface/20 p-2.5 rounded border border-border/40">
                                <span className="text-[9px] text-text-secondary block font-mono">EXPECTED METERS/SHIFT</span>
                                <span className="text-sm font-bold text-text-primary">
                                  {selectedAssessment.data.expected_meters_shift ?? "—"} m
                                </span>
                              </div>
                              <div className="bg-surface/20 p-2.5 rounded border border-border/40">
                                <span className="text-[9px] text-text-secondary block font-mono">TARGET LINE SPEED</span>
                                <span className="text-sm font-bold text-text-primary">
                                  {selectedAssessment.data.target_line_speed ?? "—"} mpm
                                </span>
                              </div>
                              <div className="bg-surface/20 p-2.5 rounded border border-border/40">
                                <span className="text-[9px] text-text-secondary block font-mono">MIN ACCEPTABLE SPEED</span>
                                <span className="text-sm font-bold text-text-primary">
                                  {selectedAssessment.data.minimum_acceptable_speed ?? "—"} mpm
                                </span>
                              </div>
                            </div>
                          )}
                        </Card>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
      )}
    </div>
  );
}
