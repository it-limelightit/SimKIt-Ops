import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, Button, Input, Select, Badge, Skeleton, Label } from "@/components/ui-kit";
import { toast } from "sonner";
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
  FileJson,
  XCircle
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

export function FactoryDataPanel() {
  const [sites, setSites] = useState<Site[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, any>>({});


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
  // Filter out any site that does not have the form submitted by business consultant or client.
  const processedSitesList = useMemo(() => {
    return sites
      .map(s => {
        const assess = assessments.find(a => a.site_id === s.id);
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
          updatedAt: assess?.updated_at
        };
      })
      .filter(s => s.isSubmitted);
  }, [sites, assessments]);

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
      if (statusFilter === "all") return true;
      return s.fillStatus === statusFilter;
    });
  }, [processedSitesList, searchQuery, statusFilter]);

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

  const handleExportJson = () => {
    if (!selectedSite || !selectedAssessment) return;
    const exportObj = {
      site: {
        id: selectedSite.id,
        name: selectedSite.name,
        company_name: selectedSite.company_name,
        city: selectedSite.city,
        address: selectedSite.address,
      },
      assessment_data: selectedAssessment.data,
      contacts: selectedContacts,
      machines: selectedMachines,
    };
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    const fileName = `${selectedSite.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_factory_data.json`;
    downloadAnchor.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    toast.success("Data exported to JSON successfully");
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
        <div className="flex items-center gap-2">
          <Badge tone="success" className="px-2.5 py-1 text-xs">
            Auto-fetch: Active
          </Badge>
        </div>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-96 col-span-1" />
          <Skeleton className="h-96 col-span-2" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* Left Column: Factories List */}
          <div className="space-y-4">
            <Card className="p-4 space-y-4 bg-surface/50 backdrop-blur-md border border-border">
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-mono uppercase text-text-secondary">Search &amp; Filter</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-dim" />
                  <Input
                    placeholder="Search factory or city…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-9 text-xs"
                  />
                </div>
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 text-xs py-1"
                >
                  <option value="all">All Submissions</option>
                  <option value="completed">Completed Form</option>
                  <option value="in_progress">In Progress</option>
                </Select>
              </div>

              {/* Factories Vertical Selection Deck */}
              <div className="max-h-[500px] overflow-y-auto space-y-2 pr-1">
                {filteredSites.length === 0 ? (
                  <div className="text-center text-xs text-text-dim py-8 italic border border-dashed border-border rounded-lg">
                    No matching factories found
                  </div>
                ) : (
                  filteredSites.map((s) => {
                    const isActive = s.id === selectedSiteId;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSiteId(s.id)}
                        className={`w-full text-left p-3 rounded-lg border transition-all duration-200 cursor-pointer flex flex-col gap-1.5 ${
                          isActive
                            ? "bg-lime/10 border-lime ring-2 ring-lime/20"
                            : "bg-surface border-border/80 hover:border-border-bright"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="font-mono text-[9px] uppercase tracking-wider text-text-dim">
                            {s.city || "No Location"}
                          </span>
                          <span className="flex items-center">
                            {s.fillStatus === "completed" && (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Completed" />
                            )}
                            {s.fillStatus === "in_progress" && (
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" title="In Progress" />
                            )}
                          </span>
                        </div>
                        <h4 className="font-bold text-sm text-text-primary uppercase tracking-tight leading-tight truncate">
                          {s.name}
                        </h4>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-[10px] text-text-secondary">
                            {s.fillStatus === "completed"
                              ? "Form Completed"
                              : "In Progress"}
                          </span>
                          {s.updatedAt && (
                            <span className="text-[9px] font-mono text-text-dim">
                              {formatDate(s.updatedAt)}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </Card>
          </div>

          {/* Right Column: Factory Detail View */}
          <div className="lg:col-span-2 space-y-6">
            {!selectedSite ? (
              <Card className="p-12 text-center bg-surface/50 border border-border/60">
                <Building2 className="mx-auto h-12 w-12 text-text-dim stroke-[1.5] mb-4" />
                <h3 className="text-lg font-bold text-text-primary">No Factory Selected</h3>
                <p className="text-text-secondary text-xs mt-1">
                  Please choose a site from the list on the left to view its operations details.
                </p>
              </Card>
            ) : (
              <div className="space-y-6 animate-in fade-in duration-300">
                
                {/* Header Information Box */}
                <div className="bg-surface/55 backdrop-blur-md p-6 rounded-xl border border-border shadow-[0_4px_30px_rgba(0,0,0,0.05)] space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-4">
                    <div>
                      <span className="text-[10px] uppercase font-mono tracking-widest text-lime font-bold">
                        Detailed Form View
                      </span>
                      <h2 className="text-2xl font-extrabold font-syne text-text-primary uppercase tracking-tight mt-1">
                        {selectedSite.name}
                      </h2>
                      <div className="flex items-center gap-2 mt-1">
                        <MapPin size={13} className="text-text-secondary" />
                        <span className="text-xs text-text-secondary">
                          {selectedSite.address ? `${selectedSite.address}, ` : ""}{selectedSite.city}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        onClick={handleExportJson}
                        className="py-1 px-3 text-xs flex items-center gap-1.5"
                      >
                        <FileJson size={13} /> Export JSON
                      </Button>
                      
                      {isEditing ? (
                        <>
                          <Button
                            variant="secondary"
                            onClick={() => setIsEditing(false)}
                            className="py-1 px-3 text-xs flex items-center gap-1"
                          >
                            <XCircle size={13} /> Cancel
                          </Button>
                          <Button
                            onClick={handleSave}
                            className="py-1 px-3 text-xs bg-lime text-black hover:bg-lime/90 flex items-center gap-1"
                          >
                            <Save size={13} /> Save Changes
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            onClick={() => {
                              setEditData(selectedAssessment?.data || {});
                              setIsEditing(true);
                            }}
                            className="py-1 px-3 text-xs flex items-center gap-1"
                          >
                            Edit Data
                          </Button>
                          <Button
                            onClick={handleDeleteForm}
                            className="py-1 px-3 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 border border-red-500/20 flex items-center gap-1"
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
                      The Business Consultant has not started the Assessment phase for this site yet.
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label>Official Company Name</Label>
                            <Input
                              value={editData.factory_op_name || ""}
                              onChange={(e) => setEditData({ ...editData, factory_op_name: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label>Registered Address</Label>
                            <Input
                              value={editData.factory_op_address || ""}
                              onChange={(e) => setEditData({ ...editData, factory_op_address: e.target.value })}
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

                        {/* Operators array editor */}
                        <Card className="p-4 bg-surface/40 border border-border/60 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-mono font-bold uppercase text-text-secondary">Machine Operators</h4>
                            <Button
                              variant="secondary"
                              className="py-0.5 px-2 text-[10px]"
                              onClick={() => {
                                const operators = [...(editData.factory_op_operators || [])];
                                operators.push({ name: "", contact: "", email: "" });
                                setEditData({ ...editData, factory_op_operators: operators });
                              }}
                            >
                              + Add Operator
                            </Button>
                          </div>
                          
                          <div className="space-y-3">
                            {(editData.factory_op_operators || []).map((o: any, idx: number) => (
                              <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end border-b border-border/20 pb-3 last:border-0 last:pb-0">
                                <div>
                                  <Label className="text-[10px]">Operator Name</Label>
                                  <Input
                                    value={o.name || ""}
                                    onChange={(e) => {
                                      const operators = [...editData.factory_op_operators];
                                      operators[idx] = { ...operators[idx], name: e.target.value };
                                      setEditData({ ...editData, factory_op_operators: operators });
                                    }}
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <div>
                                  <Label className="text-[10px]">Operator Contact</Label>
                                  <Input
                                    value={o.contact || ""}
                                    onChange={(e) => {
                                      const operators = [...editData.factory_op_operators];
                                      operators[idx] = { ...operators[idx], contact: e.target.value };
                                      setEditData({ ...editData, factory_op_operators: operators });
                                    }}
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <Label className="text-[10px]">Operator Email</Label>
                                    <Input
                                      value={o.email || ""}
                                      onChange={(e) => {
                                        const operators = [...editData.factory_op_operators];
                                        operators[idx] = { ...operators[idx], email: e.target.value };
                                        setEditData({ ...editData, factory_op_operators: operators });
                                      }}
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                  <Button
                                    variant="danger"
                                    className="h-8 py-1 px-2.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                    onClick={() => {
                                      const operators = (editData.factory_op_operators || []).filter((_: any, i: number) => i !== idx);
                                      setEditData({ ...editData, factory_op_operators: operators });
                                    }}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            ))}
                            {(!editData.factory_op_operators || editData.factory_op_operators.length === 0) && (
                              <p className="text-xs text-text-dim italic">No operator records added</p>
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
                              shifts.push({ name: "", type: "General", startTime: "", endTime: "" });
                              setEditData({ ...editData, factory_op_shifts: shifts });
                            }}
                          >
                            + Add Shift
                          </Button>
                        </div>
                        
                        <div className="space-y-3">
                          {(editData.factory_op_shifts || []).map((s: any, idx: number) => (
                            <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end border-b border-border/20 pb-3 last:border-0 last:pb-0">
                              <div>
                                <Label className="text-[10px]">Shift Name</Label>
                                <Input
                                  value={s.name || ""}
                                  onChange={(e) => handleShiftChange(idx, "name", e.target.value)}
                                  className="h-8 text-xs"
                                />
                              </div>
                              <div>
                                <Label className="text-[10px]">Shift Type</Label>
                                <Input
                                  value={s.type || ""}
                                  onChange={(e) => handleShiftChange(idx, "type", e.target.value)}
                                  className="h-8 text-xs"
                                />
                              </div>
                              <div>
                                <Label className="text-[10px]">Start Time</Label>
                                <Input
                                  type="time"
                                  value={s.startTime || ""}
                                  onChange={(e) => handleShiftChange(idx, "startTime", e.target.value)}
                                  className="h-8 text-xs"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <Label className="text-[10px]">End Time</Label>
                                  <Input
                                    type="time"
                                    value={s.endTime || ""}
                                    onChange={(e) => handleShiftChange(idx, "endTime", e.target.value)}
                                    className="h-8 text-xs"
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
                  /* Read Only Mode View */
                  <div className="space-y-6">
                    
                    {/* SECTION 1: Factory Info & Contacts */}
                    <div className="space-y-3">
                      <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">1</span>
                        OPERATIONS GENERAL INFO &amp; CONTACTS
                      </h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Name & Address */}
                        <Card className="p-4 bg-surface/40 border border-border/60 space-y-3">
                          <div>
                            <div className="text-[10px] font-mono uppercase text-text-secondary">Official Company Name</div>
                            <p className="text-sm font-bold text-text-primary mt-0.5">
                              {selectedAssessment.data.factory_op_name || selectedSite.company_name || selectedSite.name}
                            </p>
                          </div>
                          <div>
                            <div className="text-[10px] font-mono uppercase text-text-secondary">Registered Address</div>
                            <p className="text-xs text-text-secondary mt-0.5">
                              {selectedAssessment.data.factory_op_address || selectedSite.address || "No address submitted"}
                            </p>
                          </div>
                        </Card>

                        {/* Additional Contacts Table/List */}
                        <Card className="p-4 bg-surface/40 border border-border/60 space-y-3">
                          <div className="text-[10px] font-mono uppercase text-text-secondary flex justify-between">
                            <span>Field Survey Contacts</span>
                            <span className="font-bold text-lime">{selectedContacts.length} Added</span>
                          </div>
                          {selectedContacts.length === 0 ? (
                            <p className="text-xs text-text-dim italic">No contacts added during survey</p>
                          ) : (
                            <div className="space-y-2.5 max-h-[140px] overflow-y-auto pr-1">
                              {selectedContacts.map((c) => (
                                <div key={c.id} className="border-b border-border/40 pb-2 last:border-0 last:pb-0 flex items-start justify-between gap-2 text-xs">
                                  <div>
                                    <p className="font-semibold text-text-primary">{c.name}</p>
                                    {c.designation && <p className="text-[10px] text-text-secondary">{c.designation}</p>}
                                  </div>
                                  <div className="text-right font-mono text-[10px]">
                                    <a href={`tel:${c.mobile}`} className="text-lime hover:underline block">{c.mobile}</a>
                                    {c.email && <span className="text-text-dim text-[9px]">{c.email}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </Card>
                      </div>

                      {/* Owners / Operators / Technicians Deck */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Owners */}
                        <div className="bg-surface/30 border border-border/60 p-4 rounded-lg space-y-3">
                          <div className="text-[10px] font-mono uppercase text-text-secondary font-bold flex items-center gap-1.5">
                            <Users size={12} className="text-lime" /> Factory Owners
                          </div>
                          <div className="space-y-2 max-h-[150px] overflow-y-auto">
                            {(selectedAssessment.data.factory_op_owners ?? []).map((o: any, idx: number) => (
                              <div key={idx} className="text-xs border-b border-border/30 pb-2 last:border-0 last:pb-0">
                                <p className="font-semibold text-text-primary">{o.name || "Unnamed Owner"}</p>
                                {o.contact && <a href={`tel:${o.contact}`} className="text-lime text-[10px] font-mono">{o.contact}</a>}
                                {o.email && <p className="text-[10px] text-text-dim font-mono truncate">{o.email}</p>}
                              </div>
                            ))}
                            {(!selectedAssessment.data.factory_op_owners || selectedAssessment.data.factory_op_owners.length === 0) && (
                              <p className="text-xs text-text-dim italic">No owner records</p>
                            )}
                          </div>
                        </div>

                        {/* Operators */}
                        <div className="bg-surface/30 border border-border/60 p-4 rounded-lg space-y-3">
                          <div className="text-[10px] font-mono uppercase text-text-secondary font-bold flex items-center gap-1.5">
                            <Users size={12} className="text-lime" /> Machine Operators
                          </div>
                          <div className="space-y-2 max-h-[150px] overflow-y-auto">
                            {(selectedAssessment.data.factory_op_operators ?? []).map((o: any, idx: number) => (
                              <div key={idx} className="text-xs border-b border-border/30 pb-2 last:border-0 last:pb-0">
                                <p className="font-semibold text-text-primary">{o.name || "Unnamed Operator"}</p>
                                {o.contact && <a href={`tel:${o.contact}`} className="text-lime text-[10px] font-mono">{o.contact}</a>}
                                {o.email && <p className="text-[10px] text-text-dim font-mono truncate">{o.email}</p>}
                              </div>
                            ))}
                            {(!selectedAssessment.data.factory_op_operators || selectedAssessment.data.factory_op_operators.length === 0) && (
                              <p className="text-xs text-text-dim italic">No operator records</p>
                            )}
                          </div>
                        </div>

                        {/* Technicians */}
                        <div className="bg-surface/30 border border-border/60 p-4 rounded-lg space-y-3">
                          <div className="text-[10px] font-mono uppercase text-text-secondary font-bold flex items-center gap-1.5">
                            <Users size={12} className="text-lime" /> Technicians / Engineers
                          </div>
                          <div className="space-y-2 max-h-[150px] overflow-y-auto">
                            {(selectedAssessment.data.factory_op_technicians ?? []).map((t: any, idx: number) => (
                              <div key={idx} className="text-xs border-b border-border/30 pb-2 last:border-0 last:pb-0">
                                <p className="font-semibold text-text-primary">{t.name || "Unnamed Tech"}</p>
                                {t.contact && <a href={`tel:${t.contact}`} className="text-lime text-[10px] font-mono">{t.contact}</a>}
                                {t.email && <p className="text-[10px] text-text-dim font-mono truncate">{t.email}</p>}
                              </div>
                            ))}
                            {(!selectedAssessment.data.factory_op_technicians || selectedAssessment.data.factory_op_technicians.length === 0) && (
                              <p className="text-xs text-text-dim italic">No technician records</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* SECTION 2: Machinery & Equipment */}
                    <div className="space-y-3">
                      <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">2</span>
                        MACHINES &amp; EQUIPMENT SURVEY
                      </h3>

                      {/* Main Survey Machines Grid */}
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
                              <Card key={m.id} className="p-4 bg-surface/40 border border-border/60 flex flex-col justify-between gap-3">
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

                      {/* General list of surveyed machines (Quick notes list) */}
                      {selectedAssessment.data.factory_op_machines && selectedAssessment.data.factory_op_machines.length > 0 && (
                        <div className="bg-surface/30 border border-border/60 p-4 rounded-lg">
                          <span className="text-[10px] font-mono uppercase text-text-secondary block mb-2">
                            Quick Machines Checklist
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {selectedAssessment.data.factory_op_machines.map((mName: string, i: number) => {
                              if (!mName) return null;
                              return (
                                <Badge key={i} tone="ghost" className="px-2.5 py-1 text-xs">
                                  {mName}
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* SECTION 3: Operations & Shifts */}
                    <div className="space-y-3">
                      <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">3</span>
                        SHIFT OPERATIONS &amp; DOWNTIME ANALYSIS
                      </h3>

                      {/* Shift List Cards */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono uppercase text-text-secondary">Operational Shifts</span>
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
                              <Card key={idx} className={`p-4 bg-surface/40 border flex items-center gap-3.5 justify-between ${
                                hasOverlap ? "border-red-500/20" : "border-border/60"
                              }`}>
                                <div className="flex items-center gap-3">
                                  <Clock className="text-lime h-5 w-5 shrink-0" />
                                  <div>
                                    <h4 className="font-bold text-xs uppercase tracking-tight text-text-primary">
                                      {s.name || `Shift ${idx + 1}`}
                                    </h4>
                                    <p className="text-[10px] text-text-secondary mt-0.5">
                                      Type: <strong className="text-lime">{s.type || "General"}</strong>
                                    </p>
                                  </div>
                                </div>
                                <div className="text-right font-mono text-xs font-bold text-text-primary">
                                  {s.startTime || "—"} ➔ {s.endTime || "—"}
                                </div>
                              </Card>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Downtime Reasons tag cloud */}
                      <Card className="p-4 bg-surface/40 border border-border/60 space-y-3">
                        <div className="text-[10px] font-mono uppercase text-text-secondary">
                          Downtime / Operational Pain Points
                        </div>
                        {(!selectedAssessment.data.factory_op_downtime_reasons || selectedAssessment.data.factory_op_downtime_reasons.length === 0) ? (
                          <p className="text-xs text-text-dim italic">No downtime pain points selected</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {selectedAssessment.data.factory_op_downtime_reasons.map((reason: string) => (
                              <span
                                key={reason}
                                className="px-2.5 py-1 text-xs rounded border border-lime/20 bg-lime/5 text-text-primary flex items-center gap-1.5"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                                {reason}
                              </span>
                            ))}
                          </div>
                        )}
                      </Card>
                    </div>

                    {/* SECTION 4: MOM Quick Notes */}
                    {selectedAssessment.data.mom_notes && (
                      <div className="space-y-3">
                        <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">4</span>
                          SURVEY NOTES &amp; MEMORANDUM
                        </h3>
                        <Card className="p-5 bg-surface/40 border border-border/60 flex items-start gap-3">
                          <FileText className="text-lime shrink-0 h-5 w-5 mt-0.5" />
                          <div className="space-y-1">
                            <span className="text-[10px] font-mono uppercase text-text-secondary">Survey Minutes Notes</span>
                            <p className="text-sm text-text-primary leading-relaxed whitespace-pre-line">
                              {selectedAssessment.data.mom_notes}
                            </p>
                          </div>
                        </Card>
                      </div>
                    )}

                    {/* SECTION 5: BUSINESS PROFILE & TRACKING CONFIG */}
                    <div className="space-y-3">
                      <h3 className="font-syne font-extrabold text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-lime/10 text-lime text-xs font-mono font-bold">5</span>
                        BUSINESS PROFILE &amp; TRACKING CONFIG
                      </h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Core Details */}
                        <Card className="p-4 bg-surface/40 border border-border/60 space-y-3 text-xs">
                          <div>
                            <span className="text-[10px] font-mono uppercase text-text-secondary">Electricity Board</span>
                            <p className="text-sm font-bold text-text-primary mt-0.5">
                              {selectedAssessment.data.factory_op_electricity_board || "Not selected"}
                            </p>
                          </div>
                          <div>
                            <span className="text-[10px] font-mono uppercase text-text-secondary">Ideal Threshold Time (Minutes)</span>
                            <p className="text-sm font-bold text-text-primary mt-0.5">
                              {selectedAssessment.data.factory_op_downtime_threshold !== undefined && selectedAssessment.data.factory_op_downtime_threshold !== null
                                ? `${selectedAssessment.data.factory_op_downtime_threshold} Minutes` 
                                : "Not specified"}
                            </p>
                          </div>
                        </Card>

                        {/* Machine classification & Tracking Mode */}
                        <Card className="p-4 bg-surface/40 border border-border/60 space-y-3 text-xs">
                          <div>
                            <span className="text-[10px] font-mono uppercase text-text-secondary">Tracking / Machine Type</span>
                            <p className="text-sm font-bold text-text-primary mt-0.5">
                              {selectedAssessment.data.company_type || "Not configured"}
                            </p>
                          </div>
                          <div>
                            <span className="text-[10px] font-mono uppercase text-text-secondary">Machine Classification</span>
                            <p className="text-sm font-bold text-text-primary mt-0.5">
                              {selectedAssessment.data.machine_usage_type || "Production"}
                            </p>
                          </div>
                        </Card>
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
