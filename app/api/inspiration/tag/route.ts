import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { saveReel } from "@/lib/save";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST { reel_url: string, niche: string }
// Tags a single library reel with a niche. Setting a (non-empty) niche also
// triggers the durable video download + at-download stat snapshot.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const reelUrl = String(body.reel_url || "").trim();
    const niche = String(body.niche ?? "").trim();
    if (!reelUrl) return NextResponse.json({ error: "reel_url required" }, { status: 400 });

    // 1) Set the niche immediately so the tag sticks even if the scrape is slow.
    await db().from(TABLES.inspirationReels).update({ niche: niche || null, updated_at: new Date().toISOString() }).eq("reel_url", reelUrl);

    if (niche) {
      // keep the managed niche list in sync
      await db().from("niches").upsert(
        { name: niche, slug: niche.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "") },
        { onConflict: "name" }
      );
      // 2) Download the video + lock the at-download snapshot + refresh score.
      try {
        await saveReel(reelUrl, "inspiration", { extra: { niche } });
        return NextResponse.json({ ok: true, niche, video: true });
      } catch (e: any) {
        // Tag is saved; video can be retried later (rate limit, etc.)
        return NextResponse.json({ ok: true, niche, video: false, note: "Tagged; video will retry on next refresh.", warn: e?.message });
      }
    }
    return NextResponse.json({ ok: true, niche: null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
