export function requestCalendarStyle(
  type: string | null | undefined,
  decision: string | null | undefined,
) {
  const kind = type === "late" ? "Late arrival" : type === "wfh" ? "WFH" : "Leave";
  if (decision === "approved")
    return {
      label: `${kind} approved`,
      tone:
        type === "wfh"
          ? "border-indigo-300 bg-indigo-50 text-indigo-800"
          : "border-violet-300 bg-violet-50 text-violet-800",
    };
  if (decision === "rejected")
    return { label: `${kind} rejected`, tone: "border-rose-300 bg-rose-50 text-rose-800" };
  if (decision === "pending")
    return { label: `${kind} pending`, tone: "border-amber-300 bg-amber-50 text-amber-800" };
  return null;
}
