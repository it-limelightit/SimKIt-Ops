export type OfficeOffDay = { date: string; reason: string };
export type OfficeOffDayRange = { start: string; end: string; reason: string; days: number };

export function inclusiveDays(start: string, end: string) {
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end) || end < start) return 0;
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

export function groupOffDays(dates: OfficeOffDay[]): OfficeOffDayRange[] {
  const ranges: OfficeOffDayRange[] = [];
  for (const day of [...dates].sort((a, b) => a.date.localeCompare(b.date))) {
    const previous = ranges.at(-1);
    if (previous && previous.reason === day.reason && inclusiveDays(previous.end, day.date) === 2) {
      previous.end = day.date;
      previous.days += 1;
    } else {
      ranges.push({ start: day.date, end: day.date, reason: day.reason, days: 1 });
    }
  }
  return ranges;
}

export function offDayDateLabel(date: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
