import { createFileRoute } from "@tanstack/react-router";
import { BusinessConsultantsPanel } from "@/components/staff/BusinessConsultantsPanel";
export const Route = createFileRoute("/manager/business-consultants")({ ssr: false, component: BusinessConsultantsPanel });
