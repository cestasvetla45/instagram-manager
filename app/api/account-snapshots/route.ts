import { NextRequest, NextResponse } from "next/server";
import { db, TABLES, accountSnapshotToFields } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/account-snapshots?limit= -> per-account totals for the live dashboard
export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 500), 10000);
    // PostgREST silently caps any single request at ~1000 rows regardless of
    // the .limit() requested, so a plain .limit(5000) call would quietly come
    // back truncated. Page through with .range() in 1000-row chunks (desc, so
    // the most recent snapshots are prioritized) until we've gathered `limit`
    // rows or run out of data, then re-sort ascending for the chart.
    const PAGE = 1000;
    const rows: any[] = [];
    let from = 0;
    while (rows.length < limit) {
      const to = Math.min(from + PAGE, limit) - 1;
      const { data, error } = await db()
        .from(TABLES.accountSnapshots)
        .select("*")
        .order("snapshot_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < to - from + 1) break; // exhausted the table
      from += PAGE;
    }
    rows.reverse();
    return NextResponse.json({ records: rows.map(accountSnapshotToFields) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), records: [] }, { status: 500 });
  }
}
