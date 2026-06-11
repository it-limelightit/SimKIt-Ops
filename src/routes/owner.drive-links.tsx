import { createFileRoute } from "@tanstack/react-router";
import { DriveLinksPanel } from "@/components/staff/DriveLinksPanel";
export const Route = createFileRoute("/owner/drive-links")({ ssr: false, component: DriveLinksPanel });
