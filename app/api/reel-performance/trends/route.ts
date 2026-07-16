import { NextResponse } from "next/server";
import { identifyTrends } from "@/lib/reel-performance";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET — analyze all analyzed reels, identify trends, and
// generate/update winner templates.
export async function GET() {
  try {
    const result = await identifyTrends();
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
