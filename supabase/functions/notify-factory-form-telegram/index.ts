import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: {
    site_id?: string;
    data?: Record<string, any>;
    updated_at?: string;
  };
  old_record?: {
    data?: Record<string, any>;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-factory-webhook-secret",
};

function isFactoryFormSubmitted(payload: WebhookPayload) {
  return payload.record?.data?.assessment_phase_submitted === true;
}

function wasAlreadySubmitted(payload: WebhookPayload) {
  return payload.old_record?.data?.assessment_phase_submitted === true;
}

function formatSubmittedAt(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const expectedSecret = Deno.env.get("FACTORY_WEBHOOK_SECRET");
    const receivedSecret = req.headers.get("x-factory-webhook-secret");

    if (expectedSecret && receivedSecret !== expectedSecret) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    const payload = (await req.json()) as WebhookPayload;

    if (payload.table !== "assessment") {
      return Response.json({ skipped: true, reason: "Not assessment table" }, { headers: corsHeaders });
    }

    if (!isFactoryFormSubmitted(payload)) {
      return Response.json({ skipped: true, reason: "Factory form not submitted" }, { headers: corsHeaders });
    }

    if (payload.type === "UPDATE" && wasAlreadySubmitted(payload)) {
      return Response.json({ skipped: true, reason: "Already submitted before update" }, { headers: corsHeaders });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
    const simkitOpsLink = Deno.env.get("SIMKIT_OPS_LINK") || "https://sim-k-it-ops.vercel.app/";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!botToken || !chatId || !supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Telegram or Supabase environment variables");
    }

    const siteId = payload.record.site_id;
    const formData = payload.record.data || {};
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let companyName = formData.factory_op_name || "Unknown Company";

    if (siteId) {
      const { data: site, error } = await supabase
        .from("sites")
        .select("name, company_name")
        .eq("id", siteId)
        .maybeSingle();

      if (!error && site) {
        companyName = formData.factory_op_name || site.company_name || site.name || companyName;
      }
    }

    const message = [
      "New factory form submitted",
      "",
      `Company: ${companyName}`,
      `Date & Time: ${formatSubmittedAt(payload.record.updated_at)}`,
      `SIMKit Ops: ${simkitOpsLink}`,
    ].join("\n");

    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    });

    if (!telegramResponse.ok) {
      const errorText = await telegramResponse.text();
      throw new Error(`Telegram API error: ${errorText}`);
    }

    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
});
