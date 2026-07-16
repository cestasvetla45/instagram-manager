import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { geminiConfigured } from "@/lib/gemini";
import { categorizeReelRow } from "@/lib/categorize";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { reel_url?, limit?, force? }
// - reel_url given → categorize just that reel
// - otherwise → categorize reels with sub_category IS NULL (force=true re-does all)
export async function POST(req: NextRequest) {
  try {
    if (!geminiConfigured()) {
      return NextResponse.json({ error: "Gemini not configured — set GEMINI_API_KEY." }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const reelUrl = body.reel_url ? String(body.reel_url) : "";
    const force = body.force === true;
    const limit = Math.min(Math.max(Number(body.limit) || 8, 1), 8);

    let rows: any[] = [];
    if (reelUrl) {
      const { data } = await db().from(TABLES.inspirationReels).select("*").eq("reel_url", reelUrl).limit(1);
      rows = data || [];
      if (!rows.length) return NextResponse.json({ error: "Reel not found." }, { status: 404 });
    } else {
      let q = db().from(TABLES.inspirationReels).select("*").not("video_url", "is", null).limit(limit);
      if (!force) q = q.is("sub_category", null);
      const { data } = await q;
      rows = data || [];
    }

    let categorized = 0;
    let lowConfidence = 0;
    const failed: any[] = [];
    const results: any[] = [];
    for (const reel of rows) {
      try {
        const r = await categorizeReelRow(reel);
        if (r.ok) {
          categorized++;
          if (r.low_confidence) lowConfidence++;
          results.push(r);
        } else {
          failed.push({ reel_url: reel.reel_url, error: r.error });
        }
      } catch (e: any) {
        failed.push({ reel_url: reel.reel_url, error: e?.message || String(e) });
      }
    }

    return NextResponse.json({ categorized, low_confidence: lowConfidence, failed, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
