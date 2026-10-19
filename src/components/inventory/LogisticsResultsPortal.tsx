import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export function LogisticsResultsPortal({
  host,
  children,
}: {
  host?: HTMLElement | null;
  children: ReactNode;
}) {
  // An explicit null host means the shared results section is still mounting.
  // Keep results out of the KTA section until that destination is available.
  if (host === null) return null;
  return host ? createPortal(children, host) : <>{children}</>;
}
