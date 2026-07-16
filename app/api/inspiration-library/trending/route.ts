import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";

export const runtime = "nodejs";
// Trends recompute slowly — cache 2 minutes
export const revalidate = 120;

// GET — trending reels and emerging trends
// Returns: reels with highest trend velocity, rising niches, viral content
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const tray = p.get("tray") || "";
    const niche = p.get("niche") || "";
    const hours = Number(p.get("hours") || 168); // last 7 days by default
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // 1. Viral / trending reels (highest viral_score, posted in last N hours)
    let vq = db()
      .from(TABLES.inspirationReels)
      .select("*")
      .gte("posted_at", cutoff)
      .order("viral_score", { ascending: false, nullsFirst: false })
      .limit(15);

    if (tray) vq = vq.eq("tray", tray);
    if (niche) vq = vq.ilike("niche", niche);

    const { data: viralReels, error: vErr } = await vq;
    if (vErr) throw vErr;

    // 2. Rising niches — niches where average views are growing fastest
    const { data: recentReels } = await db()
      .from(TABLES.inspirationReels)
      .select("niche, sub_category, views, posted_at, is_viral, inspiration_score")
      .gte("posted_at", cutoff)
      .limit(5000);

    const nicheVelocity: Record<string, { count: number; total_views: number; avg_views: number; viral_count: number; avg_score: number }> = {};
    const subCatVelocity: Record<string, { count: number; total_views: number; viral_count: number }> = {};

    for (const r of recentReels || []) {
      const n = r.niche || "untagged";
      if (!nicheVelocity[n]) nicheVelocity[n] = { count: 0, total_views: 0, avg_views: 0, viral_count: 0, avg_score: 0 };
      nicheVelocity[n].count++;
      nicheVelocity[n].total_views += Number(r.views || 0);
      if (r.is_viral) nicheVelocity[n].viral_count++;
      nicheVelocity[n].avg_score += Number(r.inspiration_score || 0);

      const sc = r.sub_category || "uncategorized";
      if (!subCatVelocity[sc]) subCatVelocity[sc] = { count: 0, total_views: 0, viral_count: 0 };
      subCatVelocity[sc].count++;
      subCatVelocity[sc].total_views += Number(r.views || 0);
      if (r.is_viral) subCatVelocity[sc].viral_count++;
    }

    // Calculate averages and sort
    const risingNiches = Object.entries(nicheVelocity)
      .map(([name, s]) => ({
        name,
        count: s.count,
        avg_views: s.count ? Math.round(s.total_views / s.count) : 0,
        total_views: s.total_views,
        viral_count: s.viral_count,
        avg_score: s.count ? Math.round((s.avg_score / s.count) * 10) / 10 : 0,
        viral_rate: s.count ? Math.round((s.viral_count / s.count) * 100) : 0,
      }))
      .filter((n) => n.count >= 3) // need at least 3 reels to call it a trend
      .sort((a, b) => b.avg_views - a.avg_views)
      .slice(0, 15);

    const risingSubCats = Object.entries(subCatVelocity)
      .map(([name, s]) => ({
        name,
        count: s.count,
        avg_views: s.count ? Math.round(s.total_views / s.count) : 0,
        total_views: s.total_views,
        viral_count: s.viral_count,
        viral_rate: s.count ? Math.round((s.viral_count / s.count) * 100) : 0,
      }))
      .filter((s) => s.count >= 3)
      .sort((a, b) => b.avg_views - a.avg_views)
      .slice(0, 15);

    // 3. Fresh viral (posted in last 24h, high velocity)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: freshViral } = await db()
      .from(TABLES.inspirationReels)
      .select("*")
      .gte("posted_at", yesterday)
      .eq("is_viral", true)
      .order("viral_score", { ascending: false, nullsFirst: false })
      .limit(15);

    // 4. Underperforming niches (where we should reduce focus)
    const underperforming = risingNiches
      .filter((n) => n.avg_score < 4)
      .slice(0, 5);

    // 5. Top opportunities (high avg_score + high viral_rate but low count = emerging)
    const opportunities = risingNiches
      .filter((n) => n.avg_score >= 5 && n.count < 20)
      .sort((a, b) => b.viral_rate - a.viral_rate)
      .slice(0, 5);

    return NextResponse.json({
      viral_reels: viralReels || [],
      fresh_viral: freshViral || [],
      rising_niches: risingNiches,
      rising_sub_categories: risingSubCats,
      underperforming_niches: underperforming,
      opportunities,
      window_hours: hours,
    }, { headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=240" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
