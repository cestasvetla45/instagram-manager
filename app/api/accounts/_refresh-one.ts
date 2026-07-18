// Shared helper for a single our_accounts refresh — used by both
// POST /api/accounts (create → fire first scrape) and POST /api/accounts/refresh
// (row "force refresh" action). NOT a route file (no HTTP verb exports), so
// Next.js won't treat it as an API route — just a colocated module.
//
// Mirrors the per-account scrape path worker/index.ts's processAccount() /
// lib/refresh.ts's refreshOurReelsViaScraper() use, narrowed to exactly one
// handle: bulk-scrape reel stats, detect brand-new posts, refresh follower
// count, stamp scrape_status/last_scraped_at, and drop an account_snapshots
// row so the "7d follower delta" the UI shows has fresh data to compare against.
import { db, TABLES } from "@/lib/db";
import { scrapeUserReels, scrapeReel, scrapeProfile } from "@/lib/rocksolid";
import { detectAndAddNewPostsForAccount } from "@/lib/accounts";
import { looksLikeMissingAccountError } from "@/lib/discover";

export type RefreshOneResult = {
  handle: string;
  ok: boolean;
  refreshed: number;
  failed: number;
  ingested: number;
  followers?: number;
  error?: string;
};

export async function refreshOneOurAccount(handleRaw: string): Promise<RefreshOneResult> {
  const handle = String(handleRaw || "").replace(/^@/, "").trim();
  if (!handle) throw new Error("handle required");

  let refreshed = 0;
  let failed = 0;
  let ingested = 0;

  try {
    // 1. Bulk-scrape and update stats on reels we already know about.
    const reels = await scrapeUserReels(handle, 50);
    if (reels.length === 0) {
      const { data: existing } = await db()
        .from(TABLES.ourReels)
        .select("reel_url")
        .eq("account_handle", handle)
        .order("posted_at", { ascending: false, nullsFirst: false })
        .limit(25);
      for (const r of existing || []) {
        try {
          const fresh = await scrapeReel(r.reel_url);
          await db()
            .from(TABLES.ourReels)
            .update({
              views: fresh.views,
              likes: fresh.likes,
              comments: fresh.comments,
              shares: fresh.shares,
              saves: fresh.saves,
              updated_at: new Date().toISOString(),
            })
            .eq("reel_url", r.reel_url);
          refreshed++;
        } catch {
          failed++;
        }
      }
    } else {
      for (const r of reels) {
        await db()
          .from(TABLES.ourReels)
          .update({ views: r.views, likes: r.likes, comments: r.comments, updated_at: new Date().toISOString() })
          .eq("reel_url", r.url);
        refreshed++;
      }
    }

    // 2. New posts — imported, not reimplemented (lib/accounts.ts is off-limits to edit).
    try {
      const np = await detectAndAddNewPostsForAccount(handle);
      ingested = np.added;
    } catch {
      /* best effort */
    }

    // 3. Follower count refresh.
    let followers: number | undefined;
    try {
      const p = await scrapeProfile(handle);
      followers = p.followers;
      await db()
        .from(TABLES.ourAccounts)
        .update({ followers: p.followers, following: p.following, posts_count: p.postsCount })
        .eq("handle", handle);
    } catch {
      /* keep stored followers */
    }

    await db()
      .from(TABLES.ourAccounts)
      .update({ scrape_status: "ok", last_scraped_at: new Date().toISOString() })
      .eq("handle", handle);

    // 4. Snapshot — gives the "7d delta" column fresh history to diff against.
    try {
      const { data: reelRows } = await db().from(TABLES.ourReels).select("views").eq("account_handle", handle);
      const totalViews = (reelRows || []).reduce((s: number, r: any) => s + Number(r.views || 0), 0);
      await db()
        .from(TABLES.accountSnapshots)
        .insert({
          account_handle: handle,
          followers: followers ?? 0,
          total_views: totalViews,
          reel_count: (reelRows || []).length,
          snapshot_at: new Date().toISOString(),
        });
    } catch {
      /* best effort */
    }

    return { handle, ok: true, refreshed, failed, ingested, followers };
  } catch (e: any) {
    failed++;
    const inaccessible = looksLikeMissingAccountError(e?.message || e);
    try {
      await db()
        .from(TABLES.ourAccounts)
        .update({
          scrape_status: inaccessible ? "inaccessible" : undefined,
          last_scraped_at: new Date().toISOString(),
        } as any)
        .eq("handle", handle);
    } catch {
      /* best effort */
    }
    return { handle, ok: false, refreshed, failed, ingested, error: e?.message || String(e) };
  }
}
