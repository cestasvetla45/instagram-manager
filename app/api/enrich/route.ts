import { NextRequest, NextResponse } from "next/server";
import { enrichBacklog } from "@/lib/discover";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { perCycle?, count? } → process a batch of the inspiration-account backlog now.
export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* empty */ }
    const res = await enrichBacklog(
      body.perCycle ? Number(body.perCycle) : undefined,
      body.count ? Number(body.count) : undefined
    );
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// GET ?key=<CRON_SECRET>&perCycle= → for an external scheduler (e.g. cron-job.org)
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.nextUrl.searchParams.get("key");
  if (secret && provided !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const perCycle = req.nextUrl.searchParams.get("perCycle");
  const res = await enrichBacklog(perCycle ? Number(perCycle) : undefined);
  return NextResponse.json({ ok: true, ...res });
}
