import { createFileRoute } from "@tanstack/react-router";
import { BusinessConsultantsPanel } from "@/components/staff/BusinessConsultantsPanel";
export const Route = createFileRoute("/owner/business-consultants")({ ssr: false, component: BusinessConsultantsPanel });
