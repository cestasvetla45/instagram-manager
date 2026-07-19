import { NextRequest, NextResponse } from "next/server";
import { db, TABLES, snapshotToFields } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/snapshots?url=<reel url>  (or all)
export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl.searchParams.get("url");
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 5000), 20000);

    if (url) {
      const { data, error } = await db().from(TABLES.snapshots).select("*").eq("reel_url", url).order("snapshot_at", { ascending: true }).limit(1000);
      if (error) throw error;
      return NextResponse.json({ records: (data || []).map(snapshotToFields) });
    }

    // PostgREST silently caps any single request at ~1000 rows regardless of
    // the .limit() requested, so a plain .limit(5000) call quietly truncates
    // the trend charts. Page through with .range() in 1000-row chunks until
    // we've gathered `limit` rows or run out of data.
    const PAGE = 1000;
    const rows: any[] = [];
    let from = 0;
    while (rows.length < limit) {
      const to = Math.min(from + PAGE, limit) - 1;
      const { data, error } = await db()
        .from(TABLES.snapshots)
        .select("*")
        .order("snapshot_at", { ascending: true })
        .range(from, to);
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < to - from + 1) break; // exhausted the table
      from += PAGE;
    }

    // Snapshots don't carry an account handle directly (only reel_url) — join
    // through our_reels to drop rows belonging to archived accounts so their
    // stale history doesn't skew the "Our" trend lines.
    const ourUrls = rows.filter((r) => r.source === "Our").map((r) => r.reel_url);
    let archivedUrls = new Set<string>();
    if (ourUrls.length) {
      const { data: archivedAccounts } = await db().from(TABLES.ourAccounts).select("handle").eq("active", false);
      const archivedHandles = new Set((archivedAccounts || []).map((a: any) => String(a.handle || "").toLowerCase()));
      if (archivedHandles.size) {
        const urlToHandle = new Map<string, string>();
        const PAGE2 = 1000;
        for (let from2 = 0; ; from2 += PAGE2) {
          const { data: reelRows, error: reelErr } = await db()
            .from(TABLES.ourReels)
            .select("reel_url, account_handle")
            .range(from2, from2 + PAGE2 - 1);
          if (reelErr) break;
          if (!reelRows || reelRows.length === 0) break;
          for (const rr of reelRows) urlToHandle.set(rr.reel_url, String(rr.account_handle || "").toLowerCase());
          if (reelRows.length < PAGE2) break;
        }
        for (const u of ourUrls) {
          const h = urlToHandle.get(u);
          if (h && archivedHandles.has(h)) archivedUrls.add(u);
        }
      }
    }

    const filtered = archivedUrls.size ? rows.filter((r) => !archivedUrls.has(r.reel_url)) : rows;
    return NextResponse.json({ records: filtered.map(snapshotToFields) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), records: [] }, { status: 500 });
  }
}
