/** Short name of a calendar request type, e.g. "WFH", "Late arrival". */
export function requestKindLabel(type: string | null | undefined) {
  switch (type) {
    case "late":
      return "Late arrival";
    case "late_justified":
      return "Late justified";
    case "half_day":
      return "Half day";
    case "wfh":
      return "WFH";
    case "site_visit":
      return "Site visit";
    default:
      return "Leave";
  }
}

export function requestCalendarStyle(
  type: string | null | undefined,
  decision: string | null | undefined,
) {
  const kind = requestKindLabel(type);
  if (decision === "approved")
    return {
      label: type === "late_justified" ? kind : `${kind} approved`,
      tone:
        type === "site_visit"
          ? "border-teal-400 bg-teal-100 text-teal-800"
          : "border-green-400 bg-green-100 text-green-800",
    };
  if (decision === "rejected")
    return { label: `${kind} rejected`, tone: "border-rose-300 bg-rose-50 text-rose-800" };
  if (decision === "pending")
    return { label: `${kind} pending`, tone: "border-amber-300 bg-amber-50 text-amber-800" };
  return null;
}

/** Short label + tone for a late-arrival justification status (shown on calendar days). */
export function lateJustificationStyle(status: string | null | undefined) {
  if (status === "approved")
    return { label: "Late justified ✓", tone: "border-green-400 bg-green-100 text-green-800" };
  if (status === "pending")
    return { label: "Justification pending", tone: "border-amber-300 bg-amber-50 text-amber-800" };
  if (status === "rejected")
    return { label: "Justification rejected", tone: "border-rose-300 bg-rose-50 text-rose-800" };
  return null;
}
