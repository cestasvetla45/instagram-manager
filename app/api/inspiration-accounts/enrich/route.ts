import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { importAccountTopReels, looksLikeMissingAccountError } from "@/lib/discover";

export const runtime = "nodejs";
export const maxDuration = 120;

const norm = (h: string) => String(h || "").replace(/^@/, "").trim().toLowerCase();

// POST /api/inspiration-accounts/enrich  { handle, count? }
// Manual, single-account version of the worker's backlog enrichment (P3 lane)
// — pulls top reels (+ top-3 video downloads + AI categorize, since this is a
// user-triggered action, not the metadata-only worker cycle) and stamps
// enriched_at/scrape_status the same way lib/discover.ts's internal
// enrichBacklogAccount() does.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const handle = norm(body.handle || "");
    if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });
    const count = Number(body.count || 25);
    const now = new Date().toISOString();

    try {
      const res = await importAccountTopReels(handle, count, { heavy: true });
      await db().from(TABLES.inspirationAccounts).update({ enriched_at: now, scrape_status: "ok" }).ilike("handle", handle);
      return NextResponse.json({ ok: true, ...res });
    } catch (e: any) {
      const inaccessible = looksLikeMissingAccountError(e?.message || e);
      try {
        await db()
          .from(TABLES.inspirationAccounts)
          .update(inaccessible ? { enriched_at: now, scrape_status: "inaccessible" } : { enriched_at: now })
          .ilike("handle", handle);
      } catch {
        /* best effort */
      }
      return NextResponse.json({ ok: false, error: e?.message || String(e), inaccessible }, { status: 502 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
