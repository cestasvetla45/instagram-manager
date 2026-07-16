import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CANDIDATES_TABLE } from "@/lib/discovery";

export const runtime = "nodejs";

// GET ?status=suggested|pending|rejected_auto|approved|rejected
// → candidate list (suggested sorted by score) + queue counts.
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status") || "suggested";
    let q = db().from(CANDIDATES_TABLE).select("*").eq("status", status).limit(200);
    q =
      status === "suggested"
        ? q.order("discovery_score", { ascending: false, nullsFirst: false })
        : status === "pending"
        ? q.order("source_count", { ascending: false })
        : q.order("updated_at", { ascending: false });
    const { data, error } = await q;
    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const s of ["pending", "suggested", "approved", "rejected", "rejected_auto"]) {
      const { count } = await db()
        .from(CANDIDATES_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("status", s);
      counts[s] = count || 0;
    }
    return NextResponse.json({ candidates: data || [], counts });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
