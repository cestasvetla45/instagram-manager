import { NextRequest, NextResponse } from "next/server";
import { analyzeOne, analyzeDueReels } from "@/lib/reel-performance";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { reel_url?, id?, limit? }
//  - id or reel_url  → analyze that one reel
//  - neither         → batch: reels posted 24h+ ago that aren't analyzed yet
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));

    if (b.id || b.reel_url) {
      const result = await analyzeOne({ id: b.id, reel_url: b.reel_url });
      return NextResponse.json({ analyzed: 1, failed: [], result });
    }

    const { analyzed, winners, failed } = await analyzeDueReels({ limit: b.limit });
    return NextResponse.json({ analyzed, winners, failed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
