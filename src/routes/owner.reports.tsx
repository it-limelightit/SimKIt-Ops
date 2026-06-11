import { createFileRoute } from "@tanstack/react-router";
import { ReportsPanel } from "@/components/staff/ReportsPanel";
export const Route = createFileRoute("/owner/reports")({ ssr: false, component: ReportsPanel });
