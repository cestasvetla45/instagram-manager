import { NextResponse } from "next/server";
import { setWebhook, getWebhookInfo, getMe, telegramConfigured, appBaseUrl } from "@/lib/telegram";

export const runtime = "nodejs";

// GET — registers the webhook with Telegram and verifies it.
// The webhook URL includes the secret as a path segment (if set),
// and we also pass it as Telegram's secret_token header.
export async function GET() {
  if (!telegramConfigured()) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 500 });
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const webhookUrl = `${appBaseUrl()}/api/telegram/webhook${secret ? "/" + secret : ""}`;

  try {
    const set = await setWebhook(webhookUrl, secret || undefined);
    const info = await getWebhookInfo();
    const me = await getMe();
    return NextResponse.json({
      ok: true,
      webhook_url: webhookUrl,
      bot: me?.result ? { username: me.result.username, name: me.result.first_name } : null,
      set_result: set,
      webhook_info: info?.result || info,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
