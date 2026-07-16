import { NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { getApiStats } from "@/lib/rocksolid";
import { getCycleHistory } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// count(*) helper — head-only query, applies optional filters via a callback.
async function count(table: string, filter?: (q: any) => any): Promise<number> {
  try {
    let q = db().from(table).select("*", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count: c } = await q;
    return c || 0;
  } catch {
    return 0;
  }
}

async function databaseStats() {
  // Backlog = inspiration accounts that have no reels imported yet.
  let totalAccounts = 0;
  let accountsWithReels = 0;
  let accountsInBacklog = 0;
  try {
    const { data: accts } = await db().from(TABLES.inspirationAccounts).select("handle").limit(20000);
    const { data: haveReels } = await db().from(TABLES.inspirationReels).select("author_handle").limit(50000);
    const have = new Set((haveReels || []).map((r: any) => (r.author_handle || "").toLowerCase()).filter(Boolean));
    const handles = (accts || []).map((a: any) => (a.handle || "").toLowerCase()).filter(Boolean);
    totalAccounts = handles.length;
    accountsWithReels = handles.filter((h: string) => have.has(h)).length;
    accountsInBacklog = totalAccounts - accountsWithReels;
  } catch {
    /* leave zeros */
  }

  const [
    totalReels,
    reelsWithThumbnails,
    reelsWithVideo,
    reelsWithNiche,
    reelsCategorized,
    viralReels,
  ] = await Promise.all([
    count(TABLES.inspirationReels),
    count(TABLES.inspirationReels, (q) => q.not("thumbnail_url", "is", null)),
    count(TABLES.inspirationReels, (q) => q.not("video_url", "is", null)),
    count(TABLES.inspirationReels, (q) => q.not("niche", "is", null).neq("niche", "")),
    count(TABLES.inspirationReels, (q) => q.not("sub_category", "is", null)),
    count(TABLES.inspirationReels, (q) => q.eq("is_viral", true)),
  ]);

  return {
    totalAccounts,
    accountsWithReels,
    accountsInBacklog,
    totalReels,
    reelsWithThumbnails,
    reelsWithVideo,
    reelsWithNiche,
    reelsCategorized,
    viralReels,
  };
}

export async function GET() {
  const api = getApiStats();
  const cycles = getCycleHistory();
  const database = await databaseStats();

  const intervalMinutes = Number(process.env.WORKER_INTERVAL_MINUTES || 120);
  const enrichPerCycle = Number(process.env.ENRICH_PER_CYCLE || 8);
  const last = cycles.length ? cycles[cycles.length - 1] : null;
  const lastCycleAt = last?.startedAt || null;
  let nextCycleIn: number | null = null;
  if (lastCycleAt) {
    const elapsedMin = (Date.now() - new Date(lastCycleAt).getTime()) / 60000;
    nextCycleIn = Math.max(0, Math.round(intervalMinutes - elapsedMin));
  }

  const configured = (v: any) => (v ? "configured" : "not configured");
  const env = {
    rocksolidKey1: configured(process.env.ROCKSOLID_API_KEY),
    rocksolidKey2: configured(process.env.ROCKSOLID_API_KEY_2 || process.env.ROCKSOLID_OLD_API_KEY),
    geminiKey: configured(process.env.GEMINI_API_KEY),
    telegramBot: configured(process.env.TELEGRAM_BOT_TOKEN),
    graphApi: configured(process.env.INSTAGRAM_ACCESS_TOKEN),
    metaAppId: configured(process.env.META_APP_ID),
  };

  return NextResponse.json({
    api,
    cycles,
    database,
    worker: { lastCycleAt, nextCycleIn, intervalMinutes, enrichPerCycle },
    env,
  });
}
