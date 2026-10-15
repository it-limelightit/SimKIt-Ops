import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export function LogisticsResultsPortal({
  host,
  children,
}: {
  host?: HTMLElement | null;
  children: ReactNode;
}) {
  return host ? createPortal(children, host) : <>{children}</>;
}
