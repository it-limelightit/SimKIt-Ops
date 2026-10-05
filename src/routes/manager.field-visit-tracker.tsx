import { createFileRoute } from "@tanstack/react-router";
import { ManagerFieldOperations } from "@/components/field-operations/FieldOperations";
export const Route = createFileRoute("/manager/field-visit-tracker")({
  ssr: false,
  component: ManagerFieldOperations,
});
