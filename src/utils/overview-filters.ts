export const toLocalDateKey = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

type OverviewFilterRow = {
  name: string;
  company_name: string | null;
  city: string | null;
  status: string;
  workerIds: string[];
  progress: { updated: string | null };
  assigned_at?: string | null;
  appt_date?: string | null;
  meta: { c1_name: string; c1_mobile: string };
};

type OverviewFilters = {
  city: string;
  associateId: string;
  dateRange: { start: string; end: string };
  search: string;
  myTasksUserId: string | null;
};

export function matchesOverviewFilters(
  row: OverviewFilterRow,
  filters: OverviewFilters,
  profileNames: ReadonlyMap<string, string>,
): boolean {
  if (filters.city && row.city !== filters.city) return false;
  if (filters.associateId && !row.workerIds.includes(filters.associateId)) return false;
  if (
    filters.myTasksUserId &&
    (!row.workerIds.includes(filters.myTasksUserId) || row.status === "Submitted")
  )
    return false;

  const { start, end } = filters.dateRange;
  // Choosing Custom Range does not apply a date constraint until a bound is entered.
  if (start || end) {
    const displayedDate = row.progress.updated || row.assigned_at || row.appt_date;
    const updatedDate = displayedDate ? toLocalDateKey(displayedDate) : null;
    if (!updatedDate || (start && updatedDate < start) || (end && updatedDate > end)) return false;
  }

  const query = filters.search.trim().toLowerCase();
  if (!query) return true;
  return [
    row.name,
    row.company_name,
    row.city,
    row.status,
    row.meta.c1_name,
    row.meta.c1_mobile,
    ...row.workerIds.map((id) => profileNames.get(id)),
  ].some((value) => (value || "").toLowerCase().includes(query));
}
