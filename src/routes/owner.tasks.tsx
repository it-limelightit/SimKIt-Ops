import { createFileRoute } from "@tanstack/react-router";
import { TasksPanel } from "@/components/staff/TasksPanel";
export const Route = createFileRoute("/owner/tasks")({ ssr: false, component: TasksPanel });
