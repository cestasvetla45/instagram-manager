import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { geminiConfigured } from "@/lib/gemini";
import { categorizeReelRow } from "@/lib/categorize";

export const runtime = "nodejs";
export const maxDuration = 300;

const GEMINI_GAP_MS = 2000; // pause between Gemini calls — avoids rate limits
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function categorizeRows(rows: any[]) {
  let categorized = 0;
  let lowConfidence = 0;
  const failed: any[] = [];
  const results: any[] = [];
  for (const reel of rows) {
    try {
      if (categorized + failed.length > 0) await sleep(GEMINI_GAP_MS);
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
  return { categorized, low_confidence: lowConfidence, failed, results };
}

// POST { reel_url?, limit?, force?, background? }
// - reel_url given → categorize just that reel
// - otherwise → categorize reels with sub_category IS NULL, viral first
//   (force=true re-does all). background=true (or limit>3) returns
//   immediately and finishes server-side — no request timeout.
export async function POST(req: NextRequest) {
  try {
    if (!geminiConfigured()) {
      return NextResponse.json({ error: "Gemini not configured — set GEMINI_API_KEY." }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const reelUrl = body.reel_url ? String(body.reel_url) : "";
    const force = body.force === true;
    const limit = Math.min(Math.max(Number(body.limit) || 3, 1), 25);

    let rows: any[] = [];
    if (reelUrl) {
      const { data } = await db().from(TABLES.inspirationReels).select("*").eq("reel_url", reelUrl).limit(1);
      rows = data || [];
      if (!rows.length) return NextResponse.json({ error: "Reel not found." }, { status: 404 });
    } else {
      let q = db()
        .from(TABLES.inspirationReels)
        .select("*")
        .not("video_url", "is", null)
        .order("is_viral", { ascending: false })
        .order("viral_score", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (!force) q = q.is("sub_category", null);
      const { data } = await q;
      rows = data || [];
    }

    const background = body.background === true || (!reelUrl && rows.length > 3);
    if (background) {
      categorizeRows(rows)
        .then((r) => console.log(`categorize (background): ${r.categorized} done, ${r.failed.length} failed`))
        .catch((e) => console.error("categorize (background) error:", e?.message || e));
      return NextResponse.json({ started: true, queued: rows.length, background: true });
    }

    const result = await categorizeRows(rows);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
