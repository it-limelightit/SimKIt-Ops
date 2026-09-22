import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { CompanyTracker } from "@/components/company-tracker/CompanyTracker";
import { useAuth } from "@/lib/auth-store";

export const Route = createFileRoute("/company-tracker")({
  ssr: false,
  head: () => ({ meta: [{ title: "Company Tracker — SIM-Kit Ops" }] }),
  component: CompanyTrackerRoute,
});

function CompanyTrackerRoute() {
  const navigate = useNavigate();
  const { ready, userId } = useAuth();
  useEffect(() => {
    if (ready && !userId) navigate({ to: "/auth" });
  }, [ready, userId, navigate]);
  if (!ready || !userId) return null;
  return (
    <main className="min-h-screen bg-background px-5 py-8 text-text-primary md:px-10">
      <div className="mx-auto max-w-[1500px]">
        <CompanyTracker />
      </div>
    </main>
  );
}
