export const restrictedManagerEmail = "admin@limelightit.io";
export const restrictedEmployeeEmail = "aryankadiya2005@gmail.com";

export const operationsManagerPaths = [
  "/manager/salary-expense",
] as const;

export function isRestrictedManager(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase();
  return normalized === restrictedManagerEmail || normalized === restrictedEmployeeEmail;
}

export function canAccessManagerPath(email: string | null | undefined, path: string) {
  const paths = email?.trim().toLowerCase() === restrictedEmployeeEmail
    ? ["/manager/leave", "/manager/logistic", "/manager/inventory"]
    : operationsManagerPaths;
  return !isRestrictedManager(email) || paths.some(
    (allowed) => path === allowed || path.startsWith(`${allowed}/`),
  );
}

export function managerHomePath(email: string | null | undefined) {
  if (email?.trim().toLowerCase() === restrictedEmployeeEmail) return "/manager/leave";
  return isRestrictedManager(email) ? "/manager/salary-expense" : "/manager";
}
