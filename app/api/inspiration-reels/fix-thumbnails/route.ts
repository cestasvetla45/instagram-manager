import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { scrapeUserReels, extractShortcode } from "@/lib/rocksolid";
import { storeThumbnail } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;
// DB-backed progress reads must never be statically cached at build time,
// otherwise the GET progress endpoint returns stale 0/0 counts.
export const dynamic = "force-dynamic";

// Instagram CDN thumbnails (scontent.cdninstagram.com) expire after a few days
// via their `oe` signature, so most older reels render blank. This endpoint
// re-scrapes each account's recent reels for fresh thumbnail URLs and — by
// default — re-hosts them in our public Storage bucket so they never expire
// again. Bounded per call (a few accounts) so it never times out; call it
// repeatedly until `remaining` hits 0.
//
// A thumbnail "needs fixing" when it is null/empty OR still points at an
// Instagram CDN host (i.e. not already re-hosted in our durable bucket).
const NEEDS_FIX_OR =
  "thumbnail_url.is.null,thumbnail_url.eq.,thumbnail_url.ilike.%cdninstagram%,thumbnail_url.ilike.%fbcdn%";

function needsFix(url: string | null | undefined): boolean {
  if (!url) return true;
  if (url.includes("/storage/v1/object/")) return false; // already durable
  return /cdninstagram|fbcdn/i.test(url);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const accountLimit = Math.min(20, Math.max(1, Number(body.accounts || 4)));
    const store = body.store !== false; // default: re-host durably
    const perAccount = Math.min(50, Math.max(12, Number(body.per_account || 25)));

    // How many reels still need a fix (drives the client's progress bar).
    const { count: remainingBefore } = await db()
      .from(TABLES.inspirationReels)
      .select("id", { count: "exact", head: true })
      .or(NEEDS_FIX_OR);

    // Distinct author handles that still have at least one broken thumbnail.
    // Pull a bounded window and dedupe in-process (Supabase has no DISTINCT).
    const { data: broken, error } = await db()
      .from(TABLES.inspirationReels)
      .select("author_handle")
      .or(NEEDS_FIX_OR)
      .not("author_handle", "is", null)
      .limit(4000);
    if (error) throw error;

    const handles: string[] = [];
    const seen = new Set<string>();
    for (const r of broken || []) {
      const h = String(r.author_handle || "").replace(/^@/, "").trim().toLowerCase();
      if (h && !seen.has(h)) {
        seen.add(h);
        handles.push(h);
        if (handles.length >= accountLimit) break;
      }
    }

    let accountsProcessed = 0;
    let fixed = 0;
    let stored = 0;
    let failed = 0;
    const perHandle: { handle: string; fixed: number; matched: number }[] = [];

    for (const handle of handles) {
      accountsProcessed++;
      let hFixed = 0;
      let hMatched = 0;
      try {
        const fresh = await scrapeUserReels(handle, perAccount);
        // shortcode -> fresh thumbnail url
        const byCode = new Map<string, string>();
        for (const r of fresh) {
          if (r.shortcode && r.thumbnailUrl) byCode.set(r.shortcode, r.thumbnailUrl);
        }
        if (!byCode.size) {
          perHandle.push({ handle, fixed: 0, matched: 0 });
          continue;
        }

        // This account's reels that still need a thumbnail.
        const { data: reels } = await db()
          .from(TABLES.inspirationReels)
          .select("id, reel_url, shortcode, thumbnail_url")
          .ilike("author_handle", handle);

        for (const reel of reels || []) {
          if (!needsFix(reel.thumbnail_url)) continue;
          const code = reel.shortcode || extractShortcode(reel.reel_url || "");
          const freshUrl = code ? byCode.get(code) : undefined;
          if (!freshUrl) continue;
          hMatched++;

          let finalUrl = freshUrl;
          if (store) {
            const durable = await storeThumbnail(code, freshUrl);
            if (durable) {
              finalUrl = durable;
              stored++;
            }
            // if re-hosting failed, still save the fresh CDN url (better than blank)
          }
          const { error: upErr } = await db()
            .from(TABLES.inspirationReels)
            .update({ thumbnail_url: finalUrl, updated_at: new Date().toISOString() })
            .eq("id", reel.id);
          if (upErr) failed++;
          else {
            hFixed++;
            fixed++;
          }
        }
      } catch (e: any) {
        failed++;
      }
      perHandle.push({ handle, fixed: hFixed, matched: hMatched });
    }

    const remaining = Math.max(0, (remainingBefore || 0) - fixed);
    return NextResponse.json({
      ok: true,
      accounts_processed: accountsProcessed,
      fixed,
      stored,
      failed,
      remaining,
      done: remaining === 0,
      per_handle: perHandle,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// GET → how many reels still have a broken/expiring thumbnail.
export async function GET() {
  try {
    const { count } = await db()
      .from(TABLES.inspirationReels)
      .select("id", { count: "exact", head: true })
      .or(NEEDS_FIX_OR);
    const { count: total } = await db()
      .from(TABLES.inspirationReels)
      .select("id", { count: "exact", head: true });
    return NextResponse.json({ remaining: count || 0, total: total || 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), remaining: 0 }, { status: 500 });
  }
}
