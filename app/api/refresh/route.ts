import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { runRefreshCycle, refreshOurReels, refreshInspirationReels } from "@/lib/refresh";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { type?: "our" | "inspiration" | "all" | "cron" }
export async function POST(req: NextRequest) {
  try {
    let type = "cron";
    try {
      const body = await req.json();
      type = body?.type || "cron";
    } catch {
      /* empty body = cron */
    }

    let summary: any;
    if (type === "our") summary = { ourReels: await refreshOurReels() };
    else if (type === "inspiration") summary = { inspirationReels: await refreshInspirationReels() };
    else summary = await runRefreshCycle();

    return NextResponse.json({ ok: true, type, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// Cron / external trigger. If CRON_SECRET is set, require ?key=<secret>
// (Vercel's own cron is always allowed via its x-vercel-cron header).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const isVercelCron = req.headers.get("x-vercel-cron");
  const provided = req.nextUrl.searchParams.get("key");
  if (secret && !isVercelCron && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return POST(req);
}
