import { createFileRoute } from "@tanstack/react-router";
import { FieldVisitScheduler } from "@/components/field-visit-scheduler/FieldVisitScheduler";
export const Route = createFileRoute("/manager/field-visit-tracker")({ ssr: false, component: FieldVisitScheduler });
