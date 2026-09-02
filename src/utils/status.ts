import { parseSiteMetadata } from "@/lib/site-metadata";

export const ASSESSMENT_KEYS = [
  "media_uploaded",
  "factory_operations_done",
];

export function isAssessmentMomPending(data: any) {
  return !!data?.assessment_phase_submitted && !data?.mom_uploaded;
}

export function getAssessmentPendingReasons(data: any, deviceOrderExists = false) {
  const reasons: string[] = [];
  if (!data?.assessment_phase_submitted) return ["Assessment Submit Pending"];
  if (!data?.mom_uploaded) reasons.push("MOM Pending");
  if (!data?.media_uploaded) reasons.push("Media Pending");
  if (!data?.factory_operations_done) reasons.push("Factory Form Pending");
  if (!data?.device_order_completed && !deviceOrderExists) reasons.push("Device Order Pending");
  return reasons;
}

export function getSubmittedLogisticsOrder(site: any, materials: any[]) {
  if (!site || !Array.isArray(materials)) return null;
  return materials.find((m) => {
    if (m.submitted === false) return false;
    const normMat = normalizeCompanyName(m.material_name);
    const normComp = normalizeCompanyName(site.company_name);
    const normName = normalizeCompanyName(site.name);
    return (normComp && (normMat.includes(normComp) || normComp.includes(normMat))) ||
      (normName && (normMat.includes(normName) || normName.includes(normMat)));
  }) ?? null;
}

export function hasDeviceOrder(site: any, assessmentData: any, materials: any[]) {
  return !!assessmentData?.device_order_completed || !!getSubmittedLogisticsOrder(site, materials);
}

export const INSTALLATION_KEYS = [
  "delivery_confirmed",
  "coordination_done",
  "photos_uploaded",
];

export const COMMISSIONING_KEYS = [
  "coordination_done",
  "visit_done",
  "connection_done",
  "configure_done",
  "testing_done",
  "screenshots_uploaded",
  "certificate_sent",
  "final_mom_uploaded",
];

export function pctKeys(data: any, keys: string[]) {
  if (!data) return 0;
  return Math.round((keys.filter((k) => !!data[k]).length / keys.length) * 100);
}

export type PhaseProgress = {
  a: number;
  i: number;
  c: number;
};

export function getDisplayPhaseProgress(
  status: string,
  progress: PhaseProgress,
  options: { isLogisticsDispatched?: boolean } = {},
): PhaseProgress {
  if (status === "Assessed" || status === "Panel Dispatched" || options.isLogisticsDispatched) {
    return { a: 100, i: 0, c: 0 };
  }
  if (status === "Installed") {
    return { a: 100, i: 100, c: 0 };
  }
  if (status === "Commissioned" || status === "Submitted" || status === "Certification Pending") {
    return { a: 100, i: 100, c: 100 };
  }
  if (status === "Not Started Yet" || status === "Pending Assignment" || status === "Dropped / Rejected") {
    return { a: 0, i: 0, c: 0 };
  }
  return progress;
}

export const getSiteWorkerIds = (s: any): string[] => {
  if (!s) return [];
  const meta = parseSiteMetadata(s.task_notes);
  if (meta.worker_ids && meta.worker_ids.length > 0) return meta.worker_ids;
  if (s.assigned_worker_id) return [s.assigned_worker_id];
  return [];
};

export const isSiteDropped = (site: any): boolean => {
  if (!site) return false;
  const meta = parseSiteMetadata(site.task_notes);
  const stage = (site.consultant_stage || meta.status || "").toLowerCase();
  return stage.includes("drop") || stage.includes("reject");
};

export const normalizeCompanyName = (name: string): string => {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/^m\/s\.?\s+|^ms\.?\s+/i, "")
    .replace(/\s+pvt\.?\s*ltd\.?|\s+private\s+limited/i, "")
    .replace(/\s+ltd\.?/i, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
};

export const getLogisticsStatus = (m: any): string => {
  try {
    if (!m.notes) return m.state === "In transit" ? "Transit" : (m.state || "Pending");
    
    let parsed = m.notes;
    if (typeof m.notes === "string") {
      const trimmed = m.notes.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        parsed = JSON.parse(trimmed);
      } else {
        return m.state === "In transit" ? "Transit" : (m.state || "Pending");
      }
    }
    
    if (parsed && typeof parsed === "object" && parsed.logistics_status) {
      return parsed.logistics_status;
    }
  } catch (e) {
    console.error("Error parsing logistics status:", e);
  }
  return m.state === "In transit" ? "Transit" : (m.state || "Pending");
};

export function isActualDispatchLogisticsStatus(status: string) {
  return ["shipped", "transit", "in transit", "delivered"].includes((status || "").trim().toLowerCase());
}

export function getCanonicalStatus(
  site: any,
  aMap: Map<string, any> | { get: (id: string) => any },
  iMap: Map<string, any> | { get: (id: string) => any },
  cMap: Map<string, any> | { get: (id: string) => any },
  materialsOrLogisticsStatus: any[] | string
): string {
  if (!site) return "Pending Assignment";
  
  const meta = parseSiteMetadata(site.task_notes);
  const workerIds = getSiteWorkerIds(site);
  const hasWorker = workerIds.length > 0;

  // Determine logisticsStatus
  let logisticsStatus = "Pending";
  if (typeof materialsOrLogisticsStatus === "string") {
    logisticsStatus = materialsOrLogisticsStatus;
  } else if (Array.isArray(materialsOrLogisticsStatus)) {
    const matchingMaterial = getSubmittedLogisticsOrder(site, materialsOrLogisticsStatus);
    logisticsStatus = matchingMaterial ? getLogisticsStatus(matchingMaterial) : "Pending";
  }
  const isPanelDispatched = isActualDispatchLogisticsStatus(logisticsStatus);

  // Dynamic progress calculations from submitted phase rows.
  const ar = aMap.get(site.id);
  const ir = iMap.get(site.id);
  const cr = cMap.get(site.id);

  const realAP = pctKeys(ar?.data, ASSESSMENT_KEYS);
  const realIP = pctKeys(ir?.data, INSTALLATION_KEYS);
  const realCP = pctKeys(cr?.data, COMMISSIONING_KEYS);
  const isInstallationSubmitted = !!ir?.data?.installation_phase_submitted;
  const isCommissioningSubmitted = !!cr?.data?.commissioning_phase_submitted;

  // 1. Drop/Reject check (Highest priority override)
  if (isSiteDropped(site) || meta.status === "Dropped / Rejected" || meta.status === "Reject") {
    return "Dropped / Rejected";
  }

  // 2. Explicit manager metadata overrides phase values.
  if (meta.status === "Submitted") return "Submitted";
  if (meta.status === "Certification Pending") return "Certification Pending";
  if (meta.status === "Unsubmitted") return "Unsubmitted";
  if (meta.status === "Commissioned") return "Commissioned";
  if (meta.status === "Installed") return "Installed";

  // 3. Billing / Completion is the consultant-side submitted state.
  // It must outrank stale lower metadata such as Assessed.
  if (site.consultant_stage === "Completion" || site.consultant_stage === "Billing") {
    return "Submitted";
  }

  if (meta.status === "Panel Dispatched" && isPanelDispatched) return "Panel Dispatched";
  if (meta.status === "Assessed" || meta.status === "In Assessment") return "Assessed";
  if (meta.status === "Not Started Yet" && !isPanelDispatched) return "Not Started Yet";
  if (meta.status === "Pending Assignment" && !isPanelDispatched) return hasWorker ? "Not Started Yet" : "Pending Assignment";

  // 4. Completed phase submissions should advance stale lower-stage metadata.
  if (realCP === 100 || isCommissioningSubmitted) {
    const isCertSent = !!cr?.data?.certificate_sent || !!ar?.data?.certificate_sent;
    if (isCertSent) return "Submitted";
    return "Commissioned";
  }

  if (realIP === 100 || isInstallationSubmitted) {
    return "Installed";
  }

  // 5. Actual panel movement requires a submitted logistics order.
  if (isPanelDispatched) {
    return "Panel Dispatched";
  }

  // 6. Assessed once assessment is submitted or required assessment work is complete.
  // MOM and device order are follow-up reasons, not blockers for this lifecycle bucket.
  if (realAP === 100 || !!ar?.data?.assessment_phase_submitted) {
    return "Assessed";
  }

  // 7. Default: Not Started Yet / Pending Assignment
  if (hasWorker) {
    return "Not Started Yet";
  }
  return "Pending Assignment";
}
