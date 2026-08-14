import { parseSiteMetadata } from "@/lib/site-metadata";

export const ASSESSMENT_KEYS = [
  "mom_uploaded",
  "media_uploaded",
  "factory_operations_done",
];

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
    const matchingMaterial = materialsOrLogisticsStatus.find((m) => {
      if (m.submitted === false) return false;
      const normMat = normalizeCompanyName(m.material_name);
      const normComp = normalizeCompanyName(site.company_name);
      const normName = normalizeCompanyName(site.name);
      return (normComp && (normMat.includes(normComp) || normComp.includes(normMat))) ||
             (normName && (normMat.includes(normName) || normName.includes(normMat)));
    });
    logisticsStatus = matchingMaterial ? getLogisticsStatus(matchingMaterial) : "Pending";
  }

  // 1. Drop/Reject check (Highest priority override)
  if (isSiteDropped(site) || meta.status === "Dropped / Rejected" || meta.status === "Reject") {
    return "Dropped / Rejected";
  }

  // 2. Billing / Completion check (Submitted)
  if (meta.status === "Submitted") {
    return "Submitted";
  }

  // 3. Dynamic progress calculations
  const ar = aMap.get(site.id);
  const ir = iMap.get(site.id);
  const cr = cMap.get(site.id);

  const realAP = ar?.data?.assessment_phase_submitted ? 100 : pctKeys(ar?.data, ASSESSMENT_KEYS);
  const realIP = pctKeys(ir?.data, INSTALLATION_KEYS);
  const realCP = pctKeys(cr?.data, COMMISSIONING_KEYS);

  // 4. Commissioned (C === 100)
  if (realCP === 100 || meta.status === "Commissioned") {
    const isCertSent = !!cr?.data?.certificate_sent || !!ar?.data?.certificate_sent;
    if (isCertSent || meta.status === "Submitted") return "Submitted";
    return "Commissioned";
  }

  // 5. Installed (I === 100)
  if (realIP === 100 || meta.status === "Installed") {
    return "Installed";
  }

  // 6. Panel Dispatched
  const isMaterialDelivered = logisticsStatus === "Delivered";
  if (isMaterialDelivered || meta.status === "Panel Dispatched") {
    return "Panel Dispatched";
  }

  // 7. Assessed (A === 100)
  if (realAP === 100 || meta.status === "Assessed") {
    return "Assessed";
  }

  // 8. In Progress Assessment (A > 0)
  if (realAP > 0) {
    return "Assessed";
  }

  // 9. Manual overrides from metadata if no progress is made
  if (meta.status === "Certification Pending") return "Certification Pending";
  if (meta.status === "Unsubmitted") return "Unsubmitted";

  // 10. Default: Not Started Yet / Pending Assignment
  if (hasWorker) {
    return "Not Started Yet";
  }
  return "Pending Assignment";
}
