import { NextRequest, NextResponse } from "next/server";
import { refreshOneOurAccount } from "../_refresh-one";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/accounts/refresh  { handle }  — force-refresh one our_account:
// re-scrape its reel stats, pick up brand-new posts, refresh followers, and
// stamp scrape_status/last_scraped_at. Narrow, single-account version of the
// per-account path lib/refresh.ts's scraper fallback uses for the whole fleet.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const handle = String(body?.handle || "").trim();
    if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });
    const result = await refreshOneOurAccount(handle);
    if (!result.ok) return NextResponse.json(result, { status: 502 });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
