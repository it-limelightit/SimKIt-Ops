// Use noon in India to keep the chosen work day stable in charts and exports.
export function commissioningWorkTimestamp(date: string | undefined, fallback: string | null) {
  return date ? `${date}T12:00:00+05:30` : fallback;
}
