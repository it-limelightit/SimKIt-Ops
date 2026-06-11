import { createFileRoute } from "@tanstack/react-router";
import { TasksPanel } from "@/components/staff/TasksPanel";
export const Route = createFileRoute("/manager/tasks")({ ssr: false, component: TasksPanel });
