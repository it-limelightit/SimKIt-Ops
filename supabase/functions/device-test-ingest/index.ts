import { createClient } from "npm:@supabase/supabase-js@2";
import { handleDeviceTest } from "../_shared/device-test-ingest.mjs";

Deno.serve((request) =>
  handleDeviceTest(request, Deno.env.get("DEVICE_TEST_INGEST_SECRET"), async (report: object) => {
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await client.rpc("ingest_device_test", { _report: report });
    if (error || !data) {
      console.error("Failed to store device test", error?.code);
      throw new Error("Device test storage failed");
    }
    return data;
  }),
);
