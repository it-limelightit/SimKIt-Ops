import { createFileRoute } from "@tanstack/react-router";
import { MyIncentives } from "@/components/finance/MyIncentives";

/** Own field incentives for dual-role staff (e.g. Hitesh bhai). The server only
 *  returns the caller's own earnings, and only if incentives are enabled for them. */
export const Route = createFileRoute("/manager/my-incentives")({
  ssr: false,
  head: () => ({ meta: [{ title: "My incentives — SIM-Kit Ops" }] }),
  component: () => (
    <main className="w-full p-4 sm:p-5">
      <MyIncentives />
    </main>
  ),
});
