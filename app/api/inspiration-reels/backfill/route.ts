import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { scrapeReel } from "@/lib/rocksolid";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// The bulk user-reels endpoint stopped returning captions, so account imports
// write caption = ''. This endpoint backfills captions (plus exact posted_at
// and duration) via the per-reel endpoint — 2 API calls per reel — working
// through the highest-view reels first. Bounded per call; invoke repeatedly
// until `remaining` hits 0.
//
// Caption convention: '' = never fetched, NULL = fetched and the reel
// genuinely has no caption (so we don't re-fetch it forever).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(100, Math.max(1, Number(body.limit || 40)));

    const { count: remainingBefore } = await db()
      .from(TABLES.inspirationReels)
      .select("id", { count: "exact", head: true })
      .eq("caption", "");

    const { data: reels, error } = await db()
      .from(TABLES.inspirationReels)
      .select("id, reel_url, views, author_handle")
      .eq("caption", "")
      .order("views", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw error;

    let updated = 0;
    let noCaption = 0;
    let deleted = 0;
    let failed = 0;
    for (const r of reels || []) {
      try {
        const full = await scrapeReel(r.reel_url);
        const row: Record<string, any> = {
          caption: full.caption || null,
          updated_at: new Date().toISOString(),
        };
        if (full.durationSec) row.duration_sec = full.durationSec;
        if (full.postedAtISO) {
          row.posted_at = full.postedAtISO;
          row.posted_date = full.postedDate;
        }
        if (!r.author_handle && full.authorHandle) row.author_handle = full.authorHandle.toLowerCase();
        const { error: upErr } = await db()
          .from(TABLES.inspirationReels)
          .update(row)
          .eq("id", r.id);
        if (upErr) failed++;
        else if (full.caption) updated++;
        else noCaption++;
      } catch (e: any) {
        // Reel deleted/private on IG — mark fetched (caption NULL) so the
        // highest-view slots aren't retried forever.
        if (/not found/i.test(e?.message || "")) {
          await db()
            .from(TABLES.inspirationReels)
            .update({ caption: null, updated_at: new Date().toISOString() })
            .eq("id", r.id);
          deleted++;
        } else {
          failed++;
        }
      }
    }

    const remaining = Math.max(0, (remainingBefore || 0) - updated - noCaption - deleted);
    return NextResponse.json({
      ok: true,
      processed: (reels || []).length,
      captions_added: updated,
      no_caption_on_ig: noCaption,
      deleted_on_ig: deleted,
      failed,
      remaining,
      done: remaining === 0,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// GET → how many reels still have an unfetched caption.
export async function GET() {
  try {
    const { count } = await db()
      .from(TABLES.inspirationReels)
      .select("id", { count: "exact", head: true })
      .eq("caption", "");
    const { count: total } = await db()
      .from(TABLES.inspirationReels)
      .select("id", { count: "exact", head: true });
    return NextResponse.json({ remaining: count || 0, total: total || 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), remaining: 0 }, { status: 500 });
  }
}
