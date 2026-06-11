import { createFileRoute } from "@tanstack/react-router";
import { Overview } from "@/components/staff/Overview";

export const Route = createFileRoute("/manager/")({
  ssr: false,
  component: Overview,
});
