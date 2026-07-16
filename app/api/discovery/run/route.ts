import { NextRequest, NextResponse } from "next/server";
import { runDiscovery } from "@/lib/discovery";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { commentReels?, vetBudget? } → run a discovery batch now.
export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* empty */ }
    const res = await runDiscovery({
      commentReels: body.commentReels ? Number(body.commentReels) : undefined,
      vetBudget: body.vetBudget ? Number(body.vetBudget) : undefined,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// GET ?key=<CRON_SECRET> → for an external scheduler.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.nextUrl.searchParams.get("key");
  if (secret && provided !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await runDiscovery();
  return NextResponse.json({ ok: true, ...res });
}
