import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-store";
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
  const { ready, userId, role } = useAuth();
  const knownFactorySubmissionKeys = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!ready) return;
    if (!userId) navigate({ to: "/auth" });
    else if (role && role !== "supervisor") navigate({ to: "/business-consultant" });
  }, [ready, userId, role, navigate]);

  useEffect(() => {
    if (!ready || !userId || role !== "supervisor") return;
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

    const showFactoryFormNotification = (companyName: string, assessmentData: Record<string, any>) => {
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
          .filter((row: any) => row.site_id)
          .map((row: any) => [
            row.site_id,
            getFactoryFormState(row.data).submissionKey,
          ]),
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
          const isSubmitted = state.submitted;
          const submissionKey = state.submissionKey;
          const previousSubmissionKey = siteId ? knownFactorySubmissionKeys.current.get(siteId) : undefined;

          if (!siteId || !isSubmitted || previousSubmissionKey === submissionKey) return;

          knownFactorySubmissionKeys.current.set(siteId, submissionKey);
          const companyName = await getCompanyName(siteId);
          showFactoryFormNotification(companyName, next?.data || {});
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready, userId, role, navigate]);

  if (!ready || !userId || role !== "supervisor") return null;
  return (
    <StaffShell role="supervisor">
      <Outlet />
    </StaffShell>
  );
}
