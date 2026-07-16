import { NextResponse } from "next/server";
import { getWebhookInfo, getMe, telegramConfigured } from "@/lib/telegram";
import { db, dbConfigured } from "@/lib/db";

export const runtime = "nodejs";

// Count of active authorized Telegram users (best-effort).
async function authorizedUserCount(): Promise<number | null> {
  if (!dbConfigured()) return null;
  try {
    const { count } = await db()
      .from("telegram_users")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    return count ?? 0;
  } catch {
    return null;
  }
}

// GET — read-only bot + webhook status for the dashboard page.
export async function GET() {
  if (!telegramConfigured()) {
    return NextResponse.json({ configured: false });
  }
  try {
    const [info, me, authorizedUsers] = await Promise.all([getWebhookInfo(), getMe(), authorizedUserCount()]);
    return NextResponse.json({
      configured: true,
      bot: me?.result ? { username: me.result.username, name: me.result.first_name } : null,
      webhook: info?.result || null,
      online: Boolean(info?.result?.url),
      authorized_users: authorizedUsers,
    });
  } catch (e: any) {
    return NextResponse.json({ configured: true, error: e?.message || String(e) }, { status: 200 });
  }
}
