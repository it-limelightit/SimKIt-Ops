const HR_MANAGER_EMAILS = ["admin@limelightit.io", "tarun@limelightit.io"];

export function canManageHr(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase();
  return !!normalized && HR_MANAGER_EMAILS.includes(normalized);
}
