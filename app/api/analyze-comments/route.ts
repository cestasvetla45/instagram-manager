import { NextRequest, NextResponse } from "next/server";
import { analyzeAccount } from "@/lib/comments";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { handle?: string, reelLimit?: number, pages?: number, minComments?: number }
// Scrapes + classifies comments for an account's reels (heavy). Re-run to cover more.
export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* empty */
    }
    const handle = body.handle && body.handle !== "ALL" ? String(body.handle) : null;
    const summary = await analyzeAccount(handle, {
      reelLimit: Math.min(Number(body.reelLimit) || 25, 80),
      pages: Math.min(Number(body.pages) || 8, 20),
      minComments: Number(body.minComments) || 1,
    });
    return NextResponse.json({ ok: true, handle: handle || "ALL", summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // allow trigger via GET (e.g. external cron) with ?handle=&key=
  const secret = process.env.CRON_SECRET;
  const provided = req.nextUrl.searchParams.get("key");
  if (secret && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const handle = req.nextUrl.searchParams.get("handle");
  const summary = await analyzeAccount(handle && handle !== "ALL" ? handle : null, {});
  return NextResponse.json({ ok: true, summary });
}
