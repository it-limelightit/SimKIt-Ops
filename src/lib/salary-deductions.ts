import type { DayOverrides, FinanceDay } from "./finance";

export function salaryDeductionGroups(days: FinanceDay[]) {
  const groups = new Map<string, FinanceDay[]>();
  for (const day of days) {
    if (
      !day.working_day ||
      ["scheduled", "not_employed"].includes(day.status) ||
      day.automatic_units === null ||
      day.automatic_units >= 1
    )
      continue;
    const group = groups.get(day.status) ?? [];
    group.push(day);
    groups.set(day.status, group);
  }
  return Array.from(groups, ([status, dates]) => ({
    status,
    days: dates.sort((a, b) => a.date.localeCompare(b.date)),
  })).sort((a, b) =>
    a.status === "late" ? -1 : b.status === "late" ? 1 : a.status.localeCompare(b.status),
  );
}

export function waiveSalaryDays(
  days: FinanceDay[],
  overrides: DayOverrides,
  count: number,
): DayOverrides {
  if (!Number.isInteger(count) || count < 0 || count > days.length) {
    throw new Error("Choose a whole number between zero and the number of eligible days.");
  }
  // Retain dates already waived, then use the earliest remaining dates in the month.
  const ordered = [...days].sort(
    (a, b) =>
      Number(overrides[b.date]?.units === 1) - Number(overrides[a.date]?.units === 1) ||
      a.date.localeCompare(b.date),
  );
  const next = { ...overrides };
  ordered.forEach((day, index) => {
    if (index < count) {
      if (next[day.date]?.units !== 1) {
        next[day.date] = {
          units: 1,
          reason: `Monthly ${day.status.replaceAll("_", " ")} allowance: ${count} of ${days.length} days without deduction.`,
        };
      }
    } else if (next[day.date]?.units === 1) {
      delete next[day.date];
    }
  });
  return next;
}
