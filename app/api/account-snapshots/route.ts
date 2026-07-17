import { NextRequest, NextResponse } from "next/server";
import { db, TABLES, accountSnapshotToFields } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/account-snapshots?limit= -> per-account totals for the live dashboard
export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 500), 10000);
    // Fetch the most recent `limit` snapshots (desc), then re-sort ascending —
    // truncating an ascending-ordered query would instead keep the oldest rows.
    const { data, error } = await db()
      .from(TABLES.accountSnapshots)
      .select("*")
      .order("snapshot_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows = (data || []).slice().reverse();
    return NextResponse.json({ records: rows.map(accountSnapshotToFields) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), records: [] }, { status: 500 });
  }
}
