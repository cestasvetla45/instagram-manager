import { NextResponse } from "next/server";
import { db, TABLES, accountSnapshotToFields } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/account-snapshots -> per-account totals for the live dashboard
export async function GET() {
  try {
    const { data, error } = await db()
      .from(TABLES.accountSnapshots)
      .select("*")
      .order("snapshot_at", { ascending: true })
      .limit(10000);
    if (error) throw error;
    return NextResponse.json({ records: (data || []).map(accountSnapshotToFields) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), records: [] }, { status: 500 });
  }
}
