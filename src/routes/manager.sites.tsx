import { createFileRoute } from "@tanstack/react-router";
import { SitesPanel } from "@/components/staff/SitesPanel";
export const Route = createFileRoute("/manager/sites")({ ssr: false, component: SitesPanel });
