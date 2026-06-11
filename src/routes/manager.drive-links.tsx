import { createFileRoute } from "@tanstack/react-router";
import { DriveLinksPanel } from "@/components/staff/DriveLinksPanel";
export const Route = createFileRoute("/manager/drive-links")({ ssr: false, component: DriveLinksPanel });
