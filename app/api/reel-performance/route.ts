import { NextRequest, NextResponse } from "next/server";
import { getPerformanceRecords, getPerformanceStats } from "@/lib/reel-performance";

export const runtime = "nodejs";
export const maxDuration = 300;
// Cache 30 seconds
export const revalidate = 30;

// GET ?account_handle=&limit=&status=&winners_only=&since=&until=
//  Returns reel_performance records (all fields) plus summary stats.
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const account_handle = p.get("account_handle") || undefined;
    const status = p.get("status") || undefined;
    const winners_only = ["1", "true", "yes"].includes((p.get("winners_only") || "").toLowerCase());
    const since = p.get("since") || undefined;
    const until = p.get("until") || undefined;
    const limit = Math.min(Number(p.get("limit") || 50), 200);

    const [records, stats] = await Promise.all([
      getPerformanceRecords({ account_handle, status, winners_only, since, until, limit }),
      getPerformanceStats({ account_handle }),
    ]);

    return NextResponse.json({ records, count: records.length, stats }, {
      headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
