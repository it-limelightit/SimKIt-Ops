export function canManageHr(email: string | null | undefined) {
  return email?.trim().toLowerCase() === "admin@limelightit.io";
}
