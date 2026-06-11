import { createFileRoute } from "@tanstack/react-router";
import { Overview } from "@/components/staff/Overview";
export const Route = createFileRoute("/owner/")({ ssr: false, component: Overview });
