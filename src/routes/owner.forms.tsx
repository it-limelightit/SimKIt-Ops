import { createFileRoute } from "@tanstack/react-router";
import { FormsBuilder } from "@/components/staff/FormsBuilder";
export const Route = createFileRoute("/owner/forms")({ ssr: false, component: FormsBuilder });
