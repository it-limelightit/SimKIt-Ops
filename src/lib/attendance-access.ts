export const attendanceAccessEmails = [
  "nitsanghani1@gmail.com",
  "admin@limelightit.io",
  "tarun@limelightit.io",
  "tarun@limelight.io",
] as const;

export const leaveReviewEmails = [
  "tarun@limelightit.io",
  "tarun@limelight.io",
  "associatelimelight@gmail.com",
  "info@limelightit.io",
  "kuldeepshrimali.limelight@gmail.com",
  "nitsanghani1@gmail.com",
] as const;

export function canAccessLeave(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "admin@limelightit.io";
}

export function isTarunLeaveReviewer(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase();
  return normalized === "tarun@limelightit.io" || normalized === "tarun@limelight.io";
}

export function canManageAttendance(email: string | null | undefined) {
  return attendanceAccessEmails.some((allowed) => allowed === email?.trim().toLowerCase());
}

export function canReviewLeave(email: string | null | undefined) {
  return (
    canAccessLeave(email) &&
    leaveReviewEmails.some((allowed) => allowed === email?.trim().toLowerCase())
  );
}
