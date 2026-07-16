import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";

export const runtime = "nodejs";

const norm = (h: string) => String(h || "").replace(/^@/, "").trim().toLowerCase();

// GET /api/inspiration-accounts/stats — overview for the Stats tab
export async function GET(_req: NextRequest) {
  try {
    const { data: accounts, error } = await db()
      .from(TABLES.inspirationAccounts)
      .select("handle, full_name, niche, followers")
      .limit(2000);
    if (error) throw error;

    // aggregate reels per handle (paginate past the 1000-row cap)
    const stat = new Map<string, { reel_count: number; total_views: number; viral: number }>();
    let totalReels = 0;
    let totalViral = 0;
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error: e2 } = await db()
        .from(TABLES.inspirationReels)
        .select("author_handle, views, is_viral")
        .range(from, from + PAGE - 1);
      if (e2) throw e2;
      const rows = data || [];
      for (const r of rows) {
        totalReels += 1;
        if (r.is_viral) totalViral += 1;
        const key = norm(r.author_handle);
        if (!key) continue;
        const cur = stat.get(key) || { reel_count: 0, total_views: 0, viral: 0 };
        cur.reel_count += 1;
        cur.total_views += Number(r.views || 0);
        if (r.is_viral) cur.viral += 1;
        stat.set(key, cur);
      }
      if (rows.length < PAGE) break;
    }

    const enriched = (accounts || []).map((a) => {
      const s = stat.get(norm(a.handle)) || { reel_count: 0, total_views: 0, viral: 0 };
      return {
        handle: a.handle,
        full_name: a.full_name || "",
        niche: a.niche || "",
        reel_count: s.reel_count,
        total_views: s.total_views,
      };
    });

    const byViews = [...enriched].sort((a, b) => b.total_views - a.total_views).slice(0, 10);
    const byReels = [...enriched].sort((a, b) => b.reel_count - a.reel_count).slice(0, 10);
    const noReels = enriched.filter((a) => a.reel_count === 0).map((a) => a.handle);
    const noNiche = enriched.filter((a) => !a.niche).map((a) => a.handle);

    const nicheCounts: Record<string, number> = {};
    for (const a of enriched) {
      const n = a.niche || "(none)";
      nicheCounts[n] = (nicheCounts[n] || 0) + 1;
    }
    const niches = Object.entries(nicheCounts)
      .map(([niche, count]) => ({ niche, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      total_accounts: enriched.length,
      total_reels: totalReels,
      total_viral: totalViral,
      top_by_views: byViews,
      top_by_reels: byReels,
      accounts_no_reels: noReels,
      accounts_no_niche: noNiche,
      niches,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
