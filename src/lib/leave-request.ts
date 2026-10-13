export type LeaveRequestInput = {
  requestType: "leave" | "wfh";
  from: string;
  to: string;
  category: string;
  description: string;
};

export function prepareLeaveSubmission(input: LeaveRequestInput, today: string) {
  const start = Date.parse(`${input.from}T00:00:00Z`);
  const end = Date.parse(`${input.to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw new Error("Choose a start date and an end date.");
  if (input.from < today) throw new Error("Choose today or a future start date.");
  if (end < start) throw new Error("The end date must be on or after the start date.");
  if ((end - start) / 86400000 > 90)
    throw new Error("Request up to 91 calendar days at a time.");
  if (input.requestType === "leave" && !input.category)
    throw new Error("Select a reason category for your leave.");
  const description = input.description.trim();
  if (description.length < 5 || description.length > 1800)
    throw new Error("Write a description between 5 and 1800 characters.");
  const args: Record<string, unknown> = {
    _start: input.from, _end: input.to, _description: description,
  };
  if (input.requestType === "leave") args._category = input.category;
  return {
    name: input.requestType === "wfh" ? "attendance_submit_my_wfh" : "attendance_submit_my_leave",
    args,
  };
}
