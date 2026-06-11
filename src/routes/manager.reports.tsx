import { createFileRoute } from "@tanstack/react-router";
import { ReportsPanel } from "@/components/staff/ReportsPanel";
export const Route = createFileRoute("/manager/reports")({ ssr: false, component: ReportsPanel });
