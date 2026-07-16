import { NextRequest, NextResponse } from "next/server";
import { db, TABLES, snapshotToFields } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/snapshots?url=<reel url>  (or all)
export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl.searchParams.get("url");
    let q = db().from(TABLES.snapshots).select("*").order("snapshot_at", { ascending: true }).limit(5000);
    if (url) q = q.eq("reel_url", url);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ records: (data || []).map(snapshotToFields) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), records: [] }, { status: 500 });
  }
}
