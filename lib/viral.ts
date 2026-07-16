// ─────────────────────────────────────────────────────────────
//  Virality calculator — used by the calc-viral API route AND the
//  worker. Calculates trend_velocity + viral_score and flags is_viral
//  directly in Postgres (no SQL function needed — avoids the
//  column-reference ambiguity bug in mark_reel_viral()).
// ─────────────────────────────────────────────────────────────
import { db, TABLES } from "./db";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function calcViralScore(views: number, viewFollowRatio: number, velocity: number): { score: number; isViral: boolean } {
  let score = 0;

  // Base score from views
  if (views > 1_000_000) score += 40;
  else if (views > 500_000) score += 30;
  else if (views > 100_000) score += 20;
  else if (views > 50_000) score += 10;

  // Boost from view/follow ratio (reach beyond audience = viral)
  if (viewFollowRatio > 10) score += 30;
  else if (viewFollowRatio > 5) score += 20;
  else if (viewFollowRatio > 2) score += 10;

  // Boost from trend velocity (views per hour since posting)
  if (velocity > 5000) score += 30;
  else if (velocity > 1000) score += 20;
  else if (velocity > 500) score += 10;

  return { score, isViral: score >= 50 };
}

export async function calcViralBatch(
  opts: { limit?: number; reelUrls?: string[] } = {}
): Promise<{ checked: number; viral_found: number; failed: any[]; top_viral: any[] }> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);

  // Fetch reels that need checking
  let reels: any[] = [];
  if (opts.reelUrls?.length) {
    const { data } = await db()
      .from(TABLES.inspirationReels)
      .select("reel_url, views, view_follow_ratio, posted_at, followers_at_scrape")
      .in("reel_url", opts.reelUrls.filter(Boolean))
      .limit(limit);
    reels = data || [];
  } else {
    const cutoff = new Date(Date.now() - SIX_HOURS_MS).toISOString();
    const { data } = await db()
      .from(TABLES.inspirationReels)
      .select("reel_url, views, view_follow_ratio, posted_at, followers_at_scrape")
      .or(`last_trend_check.is.null,last_trend_check.lt.${cutoff}`)
      .limit(limit);
    reels = data || [];
  }

  const now = new Date();
  let checked = 0;
  let viralFound = 0;
  const failed: any[] = [];

  for (const reel of reels) {
    try {
      const views = Number(reel.views || 0);
      const ratio = Number(reel.view_follow_ratio || 0);
      const followers = Number(reel.followers_at_scrape || 0);

      // Calculate trend velocity: views per hour since posting
      let velocity = 0;
      if (reel.posted_at) {
        const postedAt = new Date(reel.posted_at);
        const hoursSince = Math.max((now.getTime() - postedAt.getTime()) / (1000 * 60 * 60), 1);
        velocity = Math.round((views / hoursSince) * 100) / 100;
      }

      const { score, isViral } = calcViralScore(views, ratio, velocity);

      await db()
        .from(TABLES.inspirationReels)
        .update({
          is_viral: isViral,
          viral_score: score,
          trend_velocity: velocity,
          last_trend_check: now.toISOString(),
        })
        .eq("reel_url", reel.reel_url);

      checked++;
      if (isViral) viralFound++;
    } catch (e: any) {
      failed.push({ reel_url: reel.reel_url, error: e?.message || String(e) });
    }
  }

  // Fetch top viral reels for the response
  const { data: top } = await db()
    .from(TABLES.inspirationReels)
    .select("reel_url, author_handle, niche, sub_category, views, viral_score, trend_velocity, is_viral")
    .eq("is_viral", true)
    .order("viral_score", { ascending: false, nullsFirst: false })
    .limit(10);

  return { checked, viral_found: viralFound, failed, top_viral: top || [] };
}
