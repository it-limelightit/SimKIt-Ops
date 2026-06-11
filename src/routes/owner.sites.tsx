import { createFileRoute } from "@tanstack/react-router";
import { SitesPanel } from "@/components/staff/SitesPanel";
export const Route = createFileRoute("/owner/sites")({ ssr: false, component: SitesPanel });
