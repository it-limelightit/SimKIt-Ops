export type LeaveRequestInput = {
  requestType: "leave" | "wfh" | "late" | "site_visit";
  from: string;
  to: string;
  category: string;
  description: string;
  expectedArrival?: string;
  halfDay?: boolean;
};

export const lateArrivalReasons = [
  "Transport delay",
  "Medical appointment",
  "Family emergency",
  "Personal work",
  "Other",
] as const;

export function lateArrivalDeadline(date: string) {
  return new Date(`${date}T08:00:00+05:30`);
}

export function lateArrivalClosed(date: string, now = new Date()) {
  return Boolean(date) && now.getTime() > lateArrivalDeadline(date).getTime();
}

/** Reason tags an employee can pick when justifying a late arrival after the fact. */
export const lateJustificationTags = [
  "Traffic",
  "Transport delay",
  "Site / client work",
  "Medical",
  "Family emergency",
  "Weather",
  "Personal work",
  "Other",
] as const;

/** Reason tags for justifying an absent working day. */
export const absenceJustificationTags = [
  "Sick / unwell",
  "Family emergency",
  "Medical",
  "Site / client work",
  "Forgot to scan",
  "Scan device problem",
  "Transport delay",
  "Weather",
  "Personal work",
  "Other",
] as const;

export function requestTypeLabel(type?: string, halfDay = false, kind?: string) {
  if (type === "late" && kind === "justification") return "Late justification";
  if (type === "late" && kind === "absence_justification") return "Absence justification";
  return type === "late"
    ? halfDay
      ? "Half-day arrival"
      : "Late arrival"
    : type === "wfh"
      ? "WFH"
      : type === "site_visit"
        ? "Site visit"
        : "Leave";
}

/** Badge colours per request type; readable in light and dark mode. */
export function requestTypeTone(type?: string, kind?: string) {
  if (type === "late" && kind === "absence_justification")
    return "border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (type === "late" && kind === "justification")
    return "border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (type === "site_visit")
    return "border border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300";
  if (type === "wfh")
    return "border border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300";
  if (type === "late")
    return "border border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300";
  return "border border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300";
}

export function arrivalTimeLabel(time?: string) {
  if (!time) return "";
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"} IST`;
}

export function prepareLeaveSubmission(input: LeaveRequestInput, today: string, now = new Date()) {
  if (input.requestType === "late") {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.from) ||
      !Number.isFinite(Date.parse(`${input.from}T00:00:00Z`)) ||
      new Date(`${input.from}T00:00:00Z`).toISOString().slice(0, 10) !== input.from
    )
      throw new Error("Choose your arrival date.");
    if (input.from < today || (Date.parse(input.from) - Date.parse(today)) / 86400000 > 90)
      throw new Error("Choose today or a date within the next 90 days.");
    if (lateArrivalClosed(input.from, now))
      throw new Error(
        "The deadline is 8:00 AM IST on the requested day, two hours before the 10:00 AM office start. This request cannot be submitted.",
      );
    if (
      !input.expectedArrival ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.expectedArrival) ||
      input.expectedArrival <= "10:00"
    )
      throw new Error("Choose an expected arrival time after 10:00 AM.");
    if (!lateArrivalReasons.some((reason) => reason === input.category))
      throw new Error("Select a late-arrival reason.");
    const description =
      input.description.trim() || (input.category === "Other" ? "" : input.category);
    if (description.length < 5 || description.length > 1800)
      throw new Error("Write a reason between 5 and 1800 characters.");
    return {
      name: "attendance_submit_my_late_request",
      args: {
        _date: input.from,
        _expected_arrival: input.expectedArrival,
        _category: input.category,
        _description: description,
        _half_day: Boolean(input.halfDay),
      },
    };
  }
  const start = Date.parse(`${input.from}T00:00:00Z`);
  const end = Date.parse(`${input.to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw new Error("Choose a start date and an end date.");
  if (input.from < today) throw new Error("Choose today or a future start date.");
  if (end < start) throw new Error("The end date must be on or after the start date.");
  if ((end - start) / 86400000 > 90) throw new Error("Request up to 91 calendar days at a time.");
  if (input.requestType === "leave" && !input.category)
    throw new Error("Select a reason category for your leave.");
  const description = input.description.trim();
  if (description.length < 5 || description.length > 1800)
    throw new Error("Write a description between 5 and 1800 characters.");
  const args: Record<string, unknown> = {
    _start: input.from,
    _end: input.to,
    _description: description,
  };
  if (input.requestType === "leave") args._category = input.category;
  return {
    name:
      input.requestType === "wfh"
        ? "attendance_submit_my_wfh"
        : input.requestType === "site_visit"
          ? "attendance_submit_my_site_visit"
          : "attendance_submit_my_leave",
    args,
  };
}
