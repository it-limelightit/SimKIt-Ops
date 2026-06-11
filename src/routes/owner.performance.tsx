import { createFileRoute } from "@tanstack/react-router";
import { PerformancePanel } from "@/components/staff/PerformancePanel";
export const Route = createFileRoute("/owner/performance")({ ssr: false, component: PerformancePanel });
