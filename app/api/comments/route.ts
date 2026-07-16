import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/comments?handle=<optional> -> per-reel comment insights
export async function GET(req: NextRequest) {
  try {
    const handle = req.nextUrl.searchParams.get("handle");
    let q = db().from("comment_insights").select("*").order("ai_pct", { ascending: false }).limit(2000);
    if (handle && handle !== "ALL") q = q.ilike("account_handle", handle);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ rows: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), rows: [] }, { status: 500 });
  }
}
