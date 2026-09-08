import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type SiteNameData = {
  name?: string | null;
  company_name?: string | null;
};

function formatSubmittedAt(value?: string) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function getSiteNameData(siteId: string): Promise<SiteNameData | null> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[Telegram] Supabase service role is not configured; sending notification without site lookup.");
    return null;
  }

  try {
    const { data: site, error } = await supabaseAdmin
      .from("sites")
      .select("name, company_name")
      .eq("id", siteId)
      .maybeSingle();

    if (error) {
      console.warn("[Telegram] Site lookup failed; sending notification without site lookup.", error);
      return null;
    }

    return site;
  } catch (error) {
    console.warn("[Telegram] Site lookup failed; sending notification without site lookup.", error);
    return null;
  }
}

export const notifyFactoryFormSubmittedFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as {
    siteId: string;
    assessmentData: Record<string, any>;
  })
  .handler(async ({ data }) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) {
      console.warn("[Telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured.");
      return { success: false, skipped: true, error: "Telegram credentials are not configured" };
    }

    const site = await getSiteNameData(data.siteId);

    const companyName = data.assessmentData.factory_op_name || site?.company_name || site?.name || "Unknown Company";
    const simkitOpsLink = process.env.SIMKIT_OPS_LINK || "https://sim-k-it-ops.vercel.app/";
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: [
          "New factory form submitted",
          "",
          `Company: ${companyName}`,
          `Date & Time: ${formatSubmittedAt(data.assessmentData.factory_form_submitted_at)}`,
          `SIMKit Ops: ${simkitOpsLink}`,
        ].join("\n"),
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Telegram API error: ${await response.text()}`);
    }
    return { success: true, skipped: false };
  });

export async function notifyAfterNewFactoryFormSubmission(
  siteId: string,
  previousData: Record<string, any> | null | undefined,
  assessmentData: Record<string, any>,
) {
  if (previousData?.assessment_phase_submitted === true || assessmentData.assessment_phase_submitted !== true) return;
  try {
    await notifyFactoryFormSubmittedFn({ data: { siteId, assessmentData } });
  } catch (error) {
    console.error("Factory form saved, but Telegram notification failed:", error);
  }
}
