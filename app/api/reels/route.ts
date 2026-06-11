import { NextRequest, NextResponse } from "next/server";
import { TABLES, listRecords } from "@/lib/airtable";

export const runtime = "nodejs";

// GET /api/reels?type=inspiration|our
export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get("type") === "our" ? "our" : "inspiration";
    const table = type === "our" ? TABLES.ourReels : TABLES.inspirationReels;
    const records = await listRecords(table, {
      sort: [{ field: "Views", direction: "desc" }],
      maxRecords: 500,
    });
    return NextResponse.json({ records });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), records: [] }, { status: 500 });
  }
}
