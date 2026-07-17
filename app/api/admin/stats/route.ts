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

// The worker runs as a separate Railway service, so its in-memory API stats
// and cycle history are invisible here. It persists them to Postgres every
// batch (worker_api_stats / worker_cycles) — prefer those; fall back to this
// process's own in-memory stats when the worker hasn't reported recently.
async function workerApiStats(): Promise<any | null> {
  try {
    const { data, error } = await db().from("worker_api_stats").select("stats, updated_at").eq("id", 1).limit(1);
    if (error) console.error("worker_api_stats query error:", error.message);
    const row = data?.[0];
    if (!row?.stats) return null;
    // Stale after 10 min → worker is down; don't show frozen numbers as live.
    if (Date.now() - new Date(row.updated_at).getTime() > 10 * 60 * 1000) return null;
    return { ...row.stats, reportedAt: row.updated_at, source: "worker" };
  } catch {
    return null;
  }
}

async function workerCycles(): Promise<any[]> {
  try {
    const { data, error } = await db()
      .from("worker_cycles")
      .select("batch_no, started_at, duration_sec, accounts, refreshed, failed, extras")
      .order("id", { ascending: false })
      .limit(20);
    if (error) console.error("worker_cycles query error:", error.message);
    return (data || [])
      .reverse()
      .map((c: any) => ({
        batchNo: c.batch_no,
        startedAt: c.started_at,
        durationSec: Number(c.duration_sec || 0),
        accounts: c.accounts,
        refreshed: c.refreshed,
        failed: c.failed,
        ...(c.extras || {}),
      }));
  } catch {
    return [];
  }
}

export async function GET() {
  const [dbApi, dbCycles, database] = await Promise.all([workerApiStats(), workerCycles(), databaseStats()]);
  const api = dbApi || getApiStats();
  const cycles = dbCycles.length ? dbCycles : getCycleHistory();

  // Continuous worker: batches run back-to-back and take ~6 min each
  // (10 accounts, per-reel fallbacks). "Alive" = a cycle started in the
  // last 15 min — a 5 min window flags a healthy worker as dead mid-batch.
  const enrichPerCycle = Number(process.env.ENRICH_PER_CYCLE || 8);
  const last = cycles.length ? cycles[cycles.length - 1] : null;
  const lastCycleAt = last?.startedAt || null;
  const alive = lastCycleAt ? Date.now() - new Date(lastCycleAt).getTime() < 15 * 60 * 1000 : false;

  const configured = (v: any) => (v ? "configured" : "not configured");
  const env = {
    rocksolidKey1: configured(process.env.ROCKSOLID_API_KEY),
    rocksolidKey2: configured(process.env.ROCKSOLID_API_KEY_2 || process.env.ROCKSOLID_OLD_API_KEY),
    geminiKey: configured(process.env.GEMINI_API_KEY),
    telegramBot: configured(process.env.TELEGRAM_BOT_TOKEN),
    graphApi: configured(process.env.INSTAGRAM_ACCESS_TOKEN),
    metaAppId: configured(process.env.META_APP_ID),
  };

  return NextResponse.json(
    {
      api,
      cycles,
      database,
      worker: { lastCycleAt, alive, mode: "continuous", batchEverySec: 30, enrichPerCycle },
      env,
    },
    { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=5" } }
  );
}
