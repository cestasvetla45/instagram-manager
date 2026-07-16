import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { scrapeReel } from "@/lib/rocksolid";
import { categorizeVideo, geminiConfigured } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 300;

async function nicheNames(): Promise<string[]> {
  const { data } = await db().from("niches").select("name").order("name");
  return (data || []).map((n: any) => String(n.name)).filter(Boolean);
}

async function categorizeOne(reelUrl: string, niches: string[]) {
  const reel = await scrapeReel(reelUrl);
  if (!reel.videoUrl) throw new Error("No downloadable video for this reel");
  const vid = await fetch(reel.videoUrl);
  if (!vid.ok) throw new Error(`Could not fetch video (${vid.status})`);
  const bytes = Buffer.from(await vid.arrayBuffer());
  const s = await categorizeVideo(bytes, "video/mp4", niches, reel.caption);
  const patch: Record<string, any> = {
    ai_suggested_niche: s.niche,
    ai_confidence: s.confidence,
    ai_reason: s.reason,
    ai_is_new: s.isNew,
    ai_categorized_at: new Date().toISOString(),
  };
  // Accurate video-based format overrides any earlier thumbnail guess.
  if (s.format && s.format !== "unknown") {
    patch.format = s.format;
    patch.format_source = "video";
  }
  await db().from(TABLES.inspirationReels).update(patch).eq("reel_url", reelUrl);
  return { reel_url: reelUrl, ...s };
}

// POST { reel_url?: string, handle?: string, limit?: number }
//  - reel_url  → categorize that one reel
//  - otherwise → categorize a batch of UNTAGGED reels (optionally for one handle)
export async function POST(req: NextRequest) {
  try {
    if (!geminiConfigured()) {
      return NextResponse.json({ error: "Gemini not configured. Add GEMINI_API_KEY in Railway." }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const niches = await nicheNames();

    if (body.reel_url) {
      const r = await categorizeOne(String(body.reel_url), niches);
      return NextResponse.json({ ok: true, suggestions: [r] });
    }

    // batch of untagged
    const limit = Math.min(Math.max(Number(body.limit) || 6, 1), 12);
    let q = db()
      .from(TABLES.inspirationReels)
      .select("reel_url, author_handle")
      .or("niche.is.null,niche.eq.")
      .is("ai_categorized_at", null)
      .order("views", { ascending: false })
      .limit(limit);
    if (body.handle) q = q.ilike("author_handle", String(body.handle).replace(/^@/, ""));
    const { data } = await q;

    const suggestions: any[] = [];
    const failed: any[] = [];
    for (const row of data || []) {
      try {
        suggestions.push(await categorizeOne(row.reel_url, niches));
      } catch (e: any) {
        failed.push({ reel_url: row.reel_url, error: e?.message || String(e) });
      }
    }
    return NextResponse.json({ ok: true, categorized: suggestions.length, suggestions, failed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
