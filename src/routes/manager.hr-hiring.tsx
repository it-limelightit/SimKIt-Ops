import { createFileRoute } from "@tanstack/react-router";
import { HrWorkspace } from "@/components/hr/HrWorkspace";

export const Route = createFileRoute("/manager/hr-hiring")({
  ssr: false,
  head: () => ({ meta: [{ title: "HR / Hiring — SIM-Kit Ops" }] }),
  component: HrWorkspace,
});
