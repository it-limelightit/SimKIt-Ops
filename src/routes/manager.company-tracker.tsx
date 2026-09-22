import { createFileRoute } from "@tanstack/react-router";
import { CompanyTracker } from "@/components/company-tracker/CompanyTracker";

export const Route = createFileRoute("/manager/company-tracker")({
  ssr: false,
  head: () => ({ meta: [{ title: "Company Tracker — SIM-Kit Ops" }] }),
  component: CompanyTracker,
});
