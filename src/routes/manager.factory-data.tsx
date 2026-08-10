import { createFileRoute } from "@tanstack/react-router";
import { FactoryDataPanel } from "@/components/staff/FactoryDataPanel";

export const Route = createFileRoute("/manager/factory-data")({
  ssr: false,
  component: FactoryDataPanel,
});
