import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import { Button, Card } from "@/components/ui-kit";
import { EmployeeAttendance } from "@/components/attendance/EmployeeAttendance";
import { useDeviceAttendance } from "@/hooks/use-device-attendance";
import { indiaDate } from "@/lib/device-attendance";
import { Route } from "@/routes/manager.attendance.history.$employeeId";

export function EmployeeAttendancePage() {
  const { employeeId } = Route.useParams();
  const { date: requestedDate } = Route.useSearch();
  const date =
    requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate <= indiaDate()
      ? requestedDate
      : indiaDate();
  const navigate = useNavigate();
  const { board, error, loading, reload } = useDeviceAttendance(date);
  const employee = board?.employees.find((item) => item.id === employeeId);
  const goBack = () => void navigate({ to: "/manager/attendance", search: { date } });

  if (loading && !board)
    return (
      <div className="attendance-page mx-auto max-w-[1440px] p-4 sm:p-6" role="status">
        <Card className="flex items-center gap-3 rounded-xl p-6 text-sm text-text-secondary">
          <LoaderCircle className="animate-spin" size={18} />
          Loading employee attendance…
        </Card>
      </div>
    );
  if (error && !board)
    return (
      <div className="attendance-page mx-auto max-w-[1440px] space-y-4 p-4 sm:p-6">
        <Button size="sm" variant="ghost" onClick={goBack}>
          <ArrowLeft size={15} />
          Back to attendance
        </Button>
        <Card role="alert" className="space-y-3 rounded-xl p-5">
          <p className="text-sm text-coral">{error}</p>
          <Button size="sm" variant="secondary" onClick={() => void reload()}>
            <RefreshCw size={14} />
            Retry
          </Button>
        </Card>
      </div>
    );
  if (!employee)
    return (
      <div className="attendance-page mx-auto max-w-[1440px] space-y-4 p-4 sm:p-6">
        <Button size="sm" variant="ghost" onClick={goBack}>
          <ArrowLeft size={15} />
          Back to attendance
        </Button>
        <Card className="rounded-xl p-6">
          <h1 className="font-semibold">Employee unavailable</h1>
          <p className="mt-2 text-sm text-text-secondary">
            This employee is not available in the current attendance data. Their attendance history
            has not been removed.
          </p>
        </Card>
      </div>
    );

  return <EmployeeAttendance employee={employee} board={board} boardDate={date} onBack={goBack} />;
}
