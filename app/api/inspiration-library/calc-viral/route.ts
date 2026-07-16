import { NextRequest, NextResponse } from "next/server";
import { calcViralBatch } from "@/lib/viral";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { limit? } — recompute virality for reels not checked in the last 6h.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
    const out = await calcViralBatch({ limit });
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
