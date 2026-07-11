// Shared refresh logic — imported by the API route AND the Railway worker.
//
// Stats refresh is done BY ACCOUNT, not by reel: one scrapeUserReels() call
// returns every reel for a handle with fresh view/like/comment counts, so we
// update N reels for the cost of 1 API call instead of ~2 calls per reel.
import { db, TABLES } from "./db";
import { scrapeUserReels } from "./rocksolid";
import { detectAndAddNewPosts, snapshotAccounts } from "./accounts";
import { enrichBacklog } from "./discover";
import { calcViralBatch } from "./viral";
import {
  graphConfigured,
  syncGraphInsights,
  hasConnectedAccounts,
  syncConnectedAccounts,
} from "./instagram-graph";

// ─── In-memory worker cycle history (resets on deploy — fine for dashboard) ───
const g = globalThis as any;
const cycleHistory: any[] = g.__cycleHistory || (g.__cycleHistory = []);

export function getCycleHistory() {
  return cycleHistory;
}

// Our reels — preference order: OAuth-connected accounts (per-account
// long-lived tokens) → single global-token account → RockSolidAPIs scraper.
// Each tier is free-er / deeper than the next; any failure falls through.
export async function refreshOurReels() {
  // 1. OAuth-connected accounts (Connect Instagram Account flow).
  try {
    if (await hasConnectedAccounts()) {
      const s = await syncConnectedAccounts(50);
      return { source: "connected", accounts: s.accounts, refreshed: s.updated, failed: s.failed, reels: s.reels };
    }
  } catch (e: any) {
    console.error("Connected-account refresh failed, falling through:", e?.message || e);
  }

  // 2. Single global-token account.
  if (graphConfigured()) {
    try {
      return await refreshOurReelsViaGraph();
    } catch (e: any) {
      // Never let a Graph hiccup stall the cycle — fall back to the scraper.
      console.error("Graph refresh failed, falling back to scraper:", e?.message || e);
    }
  }

  // 3. Scraper.
  return await refreshOurReelsViaScraper();
}

// Graph API version — one getMedia call + one insights call per reel.
// Writes basic stats to our_reels and deep insights to reel_performance.
async function refreshOurReelsViaGraph() {
  const summary = await syncGraphInsights(50);
  return {
    source: "graph",
    accounts: 1,
    refreshed: summary.updated,
    failed: summary.failed,
    reels: summary.reels,
    error: summary.error,
  };
}

// Scraper version — refresh stats one account at a time (1 call per account).
async function refreshOurReelsViaScraper() {
  const { data: accounts } = await db().from(TABLES.ourAccounts).select("handle").limit(100);
  let refreshed = 0,
    failed = 0;

  for (const acct of accounts || []) {
    if (!acct.handle) continue;
    try {
      // One call gets ALL reels for this account with updated stats.
      const reels = await scrapeUserReels(acct.handle, 50);
      for (const r of reels) {
        await db()
          .from(TABLES.ourReels)
          .update({
            views: r.views,
            likes: r.likes,
            comments: r.comments,
            updated_at: new Date().toISOString(),
          })
          .eq("reel_url", r.url);
        refreshed++;
      }
    } catch {
      failed++;
    }
  }
  return { accounts: (accounts || []).length, refreshed, failed };
}

// Inspiration reels — refresh stats by account. Gather every distinct author
// handle in the library, then scrape each account once and update all its reels.
export async function refreshInspirationReels() {
  const { data } = await db()
    .from(TABLES.inspirationReels)
    .select("author_handle")
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(5000);

  // Unique handles (most-recent first), capped so a slow cycle can't stall.
  const handles = [...new Set((data || []).map((r: any) => r.author_handle).filter(Boolean))].slice(0, 200);

  let refreshed = 0,
    failed = 0;
  for (const handle of handles) {
    try {
      const reels = await scrapeUserReels(handle, 25);
      for (const r of reels) {
        await db()
          .from(TABLES.inspirationReels)
          .update({
            views: r.views,
            likes: r.likes,
            comments: r.comments,
            updated_at: new Date().toISOString(),
          })
          .eq("reel_url", r.url);
        refreshed++;
      }
    } catch {
      failed++;
    }
  }
  return { accounts: handles.length, refreshed, failed };
}

// Full cycle. Enrich new accounts (scrape + download top videos + categorize),
// detect new posts, refresh stats by account, snapshot, recompute virality,
// and auto-categorize any freshly-downloaded videos.
export async function runRefreshCycle() {
  const cycleStart = new Date();
  const step = (label: string) =>
    console.log(`[refresh] ${label} @ ${Math.floor((Date.now() - cycleStart.getTime()) / 1000)}s`);

  step("cycle start");
  // 1. Enrich backlog — scrape new accounts, download videos, auto-categorize.
  step("enrichBacklog start");
  let inspirationBacklog: any = null;
  try {
    inspirationBacklog = await enrichBacklog();
  } catch (e: any) {
    inspirationBacklog = { error: e?.message || String(e) };
  }
  step("enrichBacklog done");

  // 2. New posts from tracked accounts.
  step("detectAndAddNewPosts start");
  const newPosts = await detectAndAddNewPosts();
  step("detectAndAddNewPosts done");

  // 3. Our reels — by account (fast).
  step("refreshOurReels start");
  const ourReels = await refreshOurReels();
  step("refreshOurReels done");

  // 4. Account snapshots.
  step("snapshotAccounts start");
  const accountSnapshots = await snapshotAccounts();
  step("snapshotAccounts done");

  // 5. Inspiration reels — by account (fast).
  step("refreshInspirationReels start");
  const inspirationReels = await refreshInspirationReels();
  step("refreshInspirationReels done");

  // 6. Virality calc — for ALL reels (pure DB, no API calls).
  step("calcViralBatch start");
  let virality: any = null;
  try {
    virality = await calcViralBatch({ limit: 500 });
  } catch (e: any) {
    virality = { error: e?.message || String(e) };
  }
  step("calcViralBatch done");

  // 7. Auto-categorize is intentionally NOT run here: it calls Gemini and can
  // hang the worker cycle. Run it out-of-band via /api/inspiration-library/categorize.
  const autoCategorize: any = { skipped: "gemini disabled in worker cycle" };

  const summary = { inspirationBacklog, newPosts, ourReels, accountSnapshots, inspirationReels, virality, autoCategorize };

  // Record a compact snapshot of this cycle for the admin dashboard.
  const cycleResult = {
    accounts: (inspirationReels?.accounts || 0) + (ourReels?.accounts || 0),
    reelsImported: inspirationBacklog?.imported || 0,
    ourReels: ourReels?.refreshed || 0,
    newPosts: Array.isArray(newPosts) ? newPosts.reduce((s: number, p: any) => s + (p.added || 0), 0) : 0,
    viralFound: virality?.viral_found || 0,
    error: inspirationBacklog?.error || virality?.error || (ourReels as any)?.error || null,
  };
  cycleHistory.push({
    startedAt: cycleStart.toISOString(),
    durationSec: Math.floor((Date.now() - cycleStart.getTime()) / 1000),
    result: { ...cycleResult },
  });
  // Keep last 10 cycles
  if (cycleHistory.length > 10) cycleHistory.shift();

  step("cycle complete");
  return summary;
}
