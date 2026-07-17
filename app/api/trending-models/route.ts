import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/trending-models — leaderboard of creators with the most viral reels recently
// Query params: ?niche=&limit=20&window=7
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const niche = (p.get("niche") || "").trim();
    const limit = Math.max(1, Math.min(50, Number(p.get("limit") || 20)));
    const windowDays = Number(p.get("window") || 7) || 7;
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    // 1. Viral reels in window
    let vq = db()
      .from(TABLES.inspirationReels)
      .select("reel_url, author_handle, views, niche, is_viral, viral_score, trend_velocity, thumbnail_url, caption, posted_at, sub_category")
      .eq("is_viral", true)
      .gte("posted_at", cutoff)
      .limit(5000);
    if (niche) vq = vq.ilike("niche", niche);
    const { data: viralReels, error: vErr } = await vq;
    if (vErr) throw vErr;

    // 2. All recent reels per author (for viral_rate)
    let aq = db()
      .from(TABLES.inspirationReels)
      .select("author_handle")
      .gte("posted_at", cutoff)
      .limit(10000);
    if (niche) aq = aq.ilike("niche", niche);
    const { data: allRecent, error: aErr } = await aq;
    if (aErr) throw aErr;

    const totalCountByHandle: Record<string, number> = {};
    for (const r of allRecent || []) {
      const h = (r.author_handle || "").trim();
      if (!h) continue;
      totalCountByHandle[h] = (totalCountByHandle[h] || 0) + 1;
    }

    // 3. Group viral reels by author_handle
    type GroupedReel = {
      reel_url: string;
      views: number;
      viral_score: number | null;
      thumbnail_url: string | null;
      caption: string | null;
      posted_at: string | null;
      niche: string | null;
      sub_category: string | null;
      trend_velocity: number | null;
    };
    const byHandle: Record<string, GroupedReel[]> = {};
    for (const r of viralReels || []) {
      const h = (r.author_handle || "").trim();
      if (!h) continue;
      if (!byHandle[h]) byHandle[h] = [];
      byHandle[h].push({
        reel_url: r.reel_url,
        views: Number(r.views || 0),
        viral_score: r.viral_score != null ? Number(r.viral_score) : null,
        thumbnail_url: r.thumbnail_url || null,
        caption: r.caption || null,
        posted_at: r.posted_at || null,
        niche: r.niche || null,
        sub_category: r.sub_category || null,
        trend_velocity: r.trend_velocity != null ? Number(r.trend_velocity) : null,
      });
    }

    const handles = Object.keys(byHandle);

    // 4. Fetch matching inspiration_accounts rows for followers / full_name / niche / profile pic
    const { data: accounts } = handles.length
      ? await db()
          .from(TABLES.inspirationAccounts)
          .select("handle, full_name, followers, niche, profile_pic_url, is_rising, last_viral_at, date_added")
          .in("handle", handles)
      : { data: [] as any[] };

    const accountByHandle: Record<string, any> = {};
    const accountByHandleLower: Record<string, any> = {};
    for (const a of accounts || []) {
      if (!a.handle) continue;
      accountByHandle[a.handle] = a;
      accountByHandleLower[a.handle.toLowerCase()] = a;
    }

    function mostCommonNiche(reels: GroupedReel[]): string | null {
      const counts: Record<string, number> = {};
      for (const r of reels) {
        const n = (r.niche || "").trim();
        if (!n) continue;
        counts[n] = (counts[n] || 0) + 1;
      }
      let best: string | null = null;
      let bestCount = 0;
      for (const [n, c] of Object.entries(counts)) {
        if (c > bestCount) { best = n; bestCount = c; }
      }
      return best;
    }

    // 5. Build per-author model summaries
    const models = handles.map((handle) => {
      const reels = byHandle[handle];
      const account = accountByHandle[handle] || accountByHandleLower[handle.toLowerCase()] || null;

      const viralReelCount = reels.length;
      const totalViews = reels.reduce((s, r) => s + r.views, 0);
      const avgViews = viralReelCount ? Math.round(totalViews / viralReelCount) : 0;
      const scores = reels.map((r) => r.viral_score).filter((v): v is number => v != null);
      const avgViralScore = scores.length ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : null;
      const highestViews = reels.reduce((m, r) => Math.max(m, r.views), 0);
      const velocities = reels.map((r) => r.trend_velocity).filter((v): v is number => v != null);
      const trendVelocity = velocities.length ? Math.round((velocities.reduce((s, v) => s + v, 0) / velocities.length) * 10) / 10 : null;

      const topReels = [...reels]
        .sort((a, b) => b.views - a.views)
        .slice(0, 3)
        .map((r) => ({
          reel_url: r.reel_url,
          views: r.views,
          viral_score: r.viral_score,
          thumbnail_url: r.thumbnail_url,
          caption: r.caption,
          posted_at: r.posted_at,
          niche: r.niche,
          sub_category: r.sub_category,
        }));

      const reelCount = totalCountByHandle[handle] || viralReelCount;
      const viralRate = reelCount ? Math.round((viralReelCount / reelCount) * 1000) / 10 : 0;

      // "Rising" = the worker saw one of this creator's reels cross the viral
      // threshold in the last 72h — a newly-discovered viral creator.
      const RISING_MS = 72 * 60 * 60 * 1000;
      const lastViralAt = account?.last_viral_at || null;
      const rising = Boolean(
        account?.is_rising && lastViralAt && Date.now() - new Date(lastViralAt).getTime() < RISING_MS
      );

      return {
        rising,
        last_viral_at: lastViralAt,
        handle,
        full_name: account?.full_name || null,
        followers: account?.followers != null ? Number(account.followers) : null,
        niche: account?.niche || mostCommonNiche(reels),
        profile_pic: account?.profile_pic_url || null,
        viral_reel_count: viralReelCount,
        total_views: totalViews,
        avg_views: avgViews,
        avg_viral_score: avgViralScore,
        highest_views: highestViews,
        trend_velocity: trendVelocity,
        reel_count: reelCount,
        viral_rate: viralRate,
        top_reels: topReels,
      };
    });

    // 6. Sort by total_views desc (rising creators bubble to the top of equal
    // tiers via a secondary sort), slice to limit
    models.sort((a, b) => b.total_views - a.total_views || Number(b.rising) - Number(a.rising));
    const limited = models.slice(0, limit);
    const risingModels = models.filter((m) => m.rising).slice(0, 10);

    // 7. Summary
    const totalViralReels = limited.reduce((s, m) => s + m.viral_reel_count, 0);
    const totalViews = limited.reduce((s, m) => s + m.total_views, 0);

    const nicheViralCounts: Record<string, number> = {};
    const nicheVelocitySum: Record<string, { sum: number; count: number }> = {};
    for (const m of limited) {
      const n = m.niche || "untagged";
      nicheViralCounts[n] = (nicheViralCounts[n] || 0) + m.viral_reel_count;
      if (m.trend_velocity != null) {
        if (!nicheVelocitySum[n]) nicheVelocitySum[n] = { sum: 0, count: 0 };
        nicheVelocitySum[n].sum += m.trend_velocity;
        nicheVelocitySum[n].count += 1;
      }
    }
    let hottestNiche: string | null = null;
    let hottestCount = 0;
    for (const [n, c] of Object.entries(nicheViralCounts)) {
      if (c > hottestCount) { hottestNiche = n; hottestCount = c; }
    }
    let fastestRising: string | null = null;
    let fastestAvg = -Infinity;
    for (const [n, s] of Object.entries(nicheVelocitySum)) {
      const avg = s.sum / s.count;
      if (avg > fastestAvg) { fastestAvg = avg; fastestRising = n; }
    }

    return NextResponse.json(
      {
        models: limited,
        rising_models: risingModels,
        summary: {
          total_models: limited.length,
          total_viral_reels: totalViralReels,
          total_views: totalViews,
          hottest_niche: hottestNiche,
          fastest_rising: fastestRising,
          rising_count: risingModels.length,
        },
      },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=60" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
