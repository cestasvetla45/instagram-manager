import { NextRequest, NextResponse } from "next/server";
import { db, TABLES, reelToFields } from "@/lib/db";

export const runtime = "nodejs";
// Cache for 30 seconds — prevents re-querying on rapid page loads
export const revalidate = 30;

// GET /api/reels?type=inspiration|our&niche=...&limit=
export async function GET(req: NextRequest) {
  try {
    const isOur = req.nextUrl.searchParams.get("type") === "our";
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 200), 500);
    const niche = req.nextUrl.searchParams.get("niche");
    const contentType = req.nextUrl.searchParams.get("contentType");
    const format = req.nextUrl.searchParams.get("format");
    const table = isOur ? TABLES.ourReels : TABLES.inspirationReels;
    let query = db()
      .from(table)
      .select("*")
      .order(isOur ? "views" : "inspiration_score", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (niche === "UNTAGGED") query = query.or("niche.is.null,niche.eq.");
    else if (niche && niche !== "ALL") query = query.ilike("niche", niche);
    if (!isOur && contentType && contentType !== "all") query = query.eq("content_type", contentType);
    if (!isOur && format && format !== "all") {
      query = format === "unclassified" ? query.is("format", null) : query.eq("format", format);
    }
    const subCat = req.nextUrl.searchParams.get("sub_category");
    const tray = req.nextUrl.searchParams.get("tray");
    const viralOnly = req.nextUrl.searchParams.get("viral");
    const needsReview = req.nextUrl.searchParams.get("needs_review");
    if (!isOur && subCat) query = query.eq("sub_category", subCat);
    if (!isOur && tray) query = query.eq("tray", tray);
    if (!isOur && viralOnly === "true") query = query.eq("is_viral", true);
    // ⚠️ Needs review — never categorized, or below the confidence bar.
    if (!isOur && needsReview === "true") {
      query = query.or("sub_category.is.null,sub_category_confidence.lt.0.85");
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(
      { records: (data || []).map((r) => reelToFields(r, isOur)) },
      { headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), records: [] }, { status: 500 });
  }
}
