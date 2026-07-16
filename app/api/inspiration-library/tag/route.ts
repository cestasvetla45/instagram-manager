import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";

export const runtime = "nodejs";
// Dashboard stats — cache 2 minutes
export const revalidate = 120;

// POST — bulk tag reels or accounts
// { reel_urls?: string[], handles?: string[], niche?, sub_category?, tray? }
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const reelUrls: string[] = b.reel_urls || [];
    const handles: string[] = b.handles || [];
    const patch: Record<string, any> = {};

    if (b.niche !== undefined) patch.niche = b.niche || null;
    if (b.sub_category !== undefined) patch.sub_category = b.sub_category || null;
    if (b.tray !== undefined) patch.tray = b.tray || "regular";

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Provide at least one of: niche, sub_category, tray" }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    // Keep the managed niche list in sync when a (new) niche is applied in bulk.
    if (patch.niche) {
      const name = String(patch.niche);
      await db().from("niches").upsert(
        { name, slug: name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "") },
        { onConflict: "name" }
      );
    }

    let reelCount = 0;
    let accountCount = 0;

    // Tag reels
    if (reelUrls.length) {
      const { data, error } = await db()
        .from(TABLES.inspirationReels)
        .update(patch)
        .in("reel_url", reelUrls)
        .select("id");
      if (error) throw error;
      reelCount = data?.length || 0;
    }

    // Tag accounts (and their reels if requested)
    if (handles.length) {
      // Normalize handles
      const clean = handles.map((h) => h.replace(/^@/, "").trim().toLowerCase());
      const { data, error } = await db()
        .from(TABLES.inspirationAccounts)
        .update(patch)
        .in("handle", clean)
        .select("id");
      if (error) throw error;
      accountCount = data?.length || 0;

      // Also tag all reels from these accounts
      if (b.tag_account_reels) {
        const { data: reelData } = await db()
          .from(TABLES.inspirationReels)
          .update(patch)
          .in("author_handle", clean)
          .select("id");
      }
    }

    return NextResponse.json({
      ok: true,
      reels_tagged: reelCount,
      accounts_tagged: accountCount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// GET — stats for the library dashboard
// ?tray=regular&niche=&sub_category=
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const tray = p.get("tray") || "";
    const niche = p.get("niche") || "";
    const subCat = p.get("sub_category") || "";

    let q = db()
      .from(TABLES.inspirationReels)
      .select("tray, niche, sub_category, is_viral, views, likes, comments, inspiration_score, posted_at")
      .limit(10000);

    if (tray) q = q.eq("tray", tray);
    if (niche) q = q.ilike("niche", niche);
    if (subCat) q = q.eq("sub_category", subCat);

    const { data, error } = await q;
    if (error) throw error;

    // Aggregate stats
    const reels = data || [];
    const total = reels.length;
    const viral = reels.filter((r: any) => r.is_viral).length;
    const totalViews = reels.reduce((s: number, r: any) => s + Number(r.views || 0), 0);
    const avgScore = total ? reels.reduce((s: number, r: any) => s + Number(r.inspiration_score || 0), 0) / total : 0;

    // Niche breakdown
    const nicheStats: Record<string, { count: number; views: number; avg_score: number; viral: number }> = {};
    for (const r of reels) {
      const n = r.niche || "untagged";
      if (!nicheStats[n]) nicheStats[n] = { count: 0, views: 0, avg_score: 0, viral: 0 };
      nicheStats[n].count++;
      nicheStats[n].views += Number(r.views || 0);
      nicheStats[n].avg_score += Number(r.inspiration_score || 0);
      if (r.is_viral) nicheStats[n].viral++;
    }
    for (const n of Object.keys(nicheStats)) {
      nicheStats[n].avg_score = nicheStats[n].count ? nicheStats[n].avg_score / nicheStats[n].count : 0;
    }

    // Sub-category breakdown
    const subCatStats: Record<string, { count: number; views: number; viral: number }> = {};
    for (const r of reels) {
      const sc = r.sub_category || "uncategorized";
      if (!subCatStats[sc]) subCatStats[sc] = { count: 0, views: 0, viral: 0 };
      subCatStats[sc].count++;
      subCatStats[sc].views += Number(r.views || 0);
      if (r.is_viral) subCatStats[sc].viral++;
    }

    // Top niches by views
    const topNiches = Object.entries(nicheStats)
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 15);

    return NextResponse.json({
      total,
      viral,
      total_views: totalViews,
      avg_score: Math.round(avgScore * 10) / 10,
      niche_stats: topNiches,
      sub_category_stats: Object.entries(subCatStats)
        .map(([name, s]) => ({ name, ...s }))
        .sort((a, b) => b.count - a.count),
    }, { headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=240" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
