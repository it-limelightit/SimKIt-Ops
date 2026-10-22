import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-store";
import { canAccessManagerPath, isRestrictedManager, managerHomePath } from "@/lib/manager-access";
import { canAccessLeave, canManageAttendance, canReviewLeave } from "@/lib/attendance-access";
import { canManageFinance } from "@/lib/finance";
import { canManageHr } from "@/lib/hr-access";
import { StaffShell } from "@/components/staff/StaffShell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getFactoryFormState } from "@/lib/factory-form-state";

export const Route = createFileRoute("/manager")({
  ssr: false,
  head: () => ({ meta: [{ title: "Manager — SIM-Kit Ops" }] }),
  component: ManagerLayout,
});

function ManagerLayout() {
  const navigate = useNavigate();
  const { ready, userId, role, email } = useAuth();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const moduleAllowed = canAccessManagerPath(email, path);
  const scopedAccess = isRestrictedManager(email) && moduleAllowed;
  const factoryDataAllowed = canAccessManagerPath(email, "/manager/factory-data");
  const attendanceRoute = path === "/manager/attendance" || path.startsWith("/manager/attendance/");
  const attendanceAllowed = canManageAttendance(email);
  const financeRoute = path === "/manager/salary-expense" || path.startsWith("/manager/salary-expense/");
  const financeAllowed = canManageFinance(email);
  const hrRoute = path === "/manager/hr-hiring" || path.startsWith("/manager/hr-hiring/");
  const hrAllowed = canManageHr(email);
  const leaveRoute = path === "/manager/leave" || path.startsWith("/manager/leave/");
  const leaveAllowed = canAccessLeave(email) && (scopedAccess || role === "supervisor" || canReviewLeave(email));
  const knownFactorySubmissionKeys = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!ready) return;
    if (!userId) navigate({ to: "/auth" });
    else if (!moduleAllowed) navigate({ to: managerHomePath(email) });
    else if (financeRoute && !financeAllowed) navigate({ to: managerHomePath(email) });
    else if (hrRoute && !hrAllowed) navigate({ to: managerHomePath(email) });
    else if (attendanceRoute && !attendanceAllowed)
      navigate({ to: role === "supervisor" ? "/manager" : role === "employee" ? "/employee" : "/business-consultant" });
    else if (leaveRoute && !leaveAllowed)
      navigate({ to: role === "employee" ? "/employee" : role === "supervisor" ? "/manager" : "/business-consultant" });
    else if (role && role !== "supervisor" && !scopedAccess && !(attendanceRoute && attendanceAllowed) && !(leaveRoute && leaveAllowed) && !(financeRoute && financeAllowed))
      navigate({ to: role === "employee" ? "/employee" : "/business-consultant" });
  }, [ready, userId, role, email, navigate, moduleAllowed, scopedAccess, attendanceRoute, attendanceAllowed, leaveRoute, leaveAllowed, financeRoute, financeAllowed, hrRoute, hrAllowed]);

  useEffect(() => {
    if (!ready || !userId || role !== "supervisor" || !factoryDataAllowed) return;
    if (typeof window === "undefined") return;

    const requestBrowserNotificationPermission = async () => {
      if (!("Notification" in window) || Notification.permission !== "default") return;

      toast("Enable browser notifications for new factory forms.", {
        action: {
          label: "Enable",
          onClick: () => {
            void Notification.requestPermission().then((permission) => {
              if (permission === "granted") {
                toast.success("Browser notifications enabled.");
              } else if (permission === "denied") {
                toast.error("Browser notifications are blocked in this browser.");
              }
            });
          },
        },
        duration: 12000,
      });
    };

    const showFactoryFormNotification = (
      companyName: string,
      assessmentData: Record<string, any>,
    ) => {
      const state = getFactoryFormState(assessmentData);
      const title = state.title;
      const body = state.completed
        ? `${companyName} submitted factory form data.`
        : `${companyName} submitted an assessment. Factory form details are pending.`;

      toast.success(body, {
        action: {
          label: "Open",
          onClick: () => navigate({ to: "/manager/factory-data" }),
        },
        duration: 10000,
      });

      if (!("Notification" in window) || Notification.permission !== "granted") return;

      const notification = new Notification(title, {
        body,
        icon: "/favicon.svg",
        tag: `factory-form-${companyName || "new"}`,
      });
      notification.onclick = () => {
        window.focus();
        navigate({ to: "/manager/factory-data" });
        notification.close();
      };
    };

    const getCompanyName = async (siteId: string) => {
      const { data } = await supabase
        .from("sites")
        .select("name, company_name")
        .eq("id", siteId)
        .maybeSingle();
      return data?.company_name || data?.name || "Unknown company";
    };

    const initializeKnownSubmittedForms = async () => {
      const { data } = await supabase
        .from("assessment")
        .select("site_id, data")
        .eq("data->>assessment_phase_submitted", "true");

      knownFactorySubmissionKeys.current = new Map(
        (data ?? [])
          .filter((row: any) => row.site_id && getFactoryFormState(row.data).completed)
          .map((row: any) => [row.site_id, getFactoryFormState(row.data).submissionKey]),
      );
    };

    void requestBrowserNotificationPermission();
    void initializeKnownSubmittedForms();

    const channel = supabase
      .channel("manager-factory-form-browser-notifications")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assessment" },
        async (payload) => {
          const next = payload.new as { site_id?: string; data?: Record<string, any> } | null;
          const siteId = next?.site_id;
          const state = getFactoryFormState(next?.data);
          const submissionKey = state.submissionKey;
          const previousSubmissionKey = siteId
            ? knownFactorySubmissionKeys.current.get(siteId)
            : undefined;

          if (!siteId) return;
          if (!state.completed) {
            knownFactorySubmissionKeys.current.delete(siteId);
            return;
          }
          if (previousSubmissionKey === submissionKey) return;

          knownFactorySubmissionKeys.current.set(siteId, submissionKey);
          const companyName = await getCompanyName(siteId);
          showFactoryFormNotification(companyName, next?.data || {});
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready, userId, role, navigate, factoryDataAllowed]);

  if (
    !ready ||
    !userId ||
    !moduleAllowed ||
    (attendanceRoute && !attendanceAllowed) ||
    (financeRoute && !financeAllowed) ||
    (hrRoute && !hrAllowed) ||
    (leaveRoute && !leaveAllowed) ||
    (role !== "supervisor" && !scopedAccess && !(attendanceRoute && attendanceAllowed) && !(leaveRoute && leaveAllowed) && !(financeRoute && financeAllowed))
  )
    return null;
  return (
    <StaffShell role="supervisor">
      <Outlet />
    </StaffShell>
  );
}
