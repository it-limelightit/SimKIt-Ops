export function requestCalendarStyle(
  type: string | null | undefined,
  decision: string | null | undefined,
) {
  const kind =
    type === "late"
      ? "Late arrival"
      : type === "half_day"
        ? "Half day"
        : type === "wfh"
          ? "WFH"
          : "Leave";
  if (decision === "approved")
    return {
      label: `${kind} approved`,
      tone: "border-green-400 bg-green-100 text-green-800",
    };
  if (decision === "rejected")
    return { label: `${kind} rejected`, tone: "border-rose-300 bg-rose-50 text-rose-800" };
  if (decision === "pending")
    return { label: `${kind} pending`, tone: "border-amber-300 bg-amber-50 text-amber-800" };
  return null;
}

/** Short name of a calendar request type, e.g. "WFH", "Late arrival". */
export function requestKindLabel(type: string | null | undefined) {
  return type === "late"
    ? "Late arrival"
    : type === "half_day"
      ? "Half day"
      : type === "wfh"
        ? "WFH"
        : "Leave";
}
