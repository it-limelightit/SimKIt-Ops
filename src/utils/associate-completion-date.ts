type CompletionDates = {
  workDate?: string | null;
  submittedAt?: string | null;
  recordUpdatedAt?: string | null;
  activityLogs?: Array<{ type: string; to_status: string; at: string }>;
};

// Keep corrected work dates authoritative. Older completed forms may only have
// a saved record timestamp; label that fallback instead of inventing a submission date.
export function associateCompletionDate(input: CompletionDates) {
  const valid = (value?: string | null): value is string =>
    !!value && !Number.isNaN(Date.parse(value));
  const latest = (statuses: string[]) =>
    (input.activityLogs ?? [])
      .filter(
        (log) => log.type === "status_change" && statuses.includes(log.to_status) && valid(log.at),
      )
      .map((log) => log.at)
      .sort()
      .at(-1);
  const candidates = [
    [input.workDate, "Commissioning work date"],
    [input.submittedAt, "Submission date"],
    [latest(["Commissioned"]), "Commissioning date"],
    [latest(["Submitted", "Certification Pending"]), "Status date"],
    [input.recordUpdatedAt, "Legacy record date"],
  ] as const;
  for (const [timestamp, source] of candidates) {
    if (!valid(timestamp)) continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(timestamp)
      ? timestamp
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(timestamp));
    return { date, source };
  }
  return null;
}
