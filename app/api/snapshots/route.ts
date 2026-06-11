import { NextRequest, NextResponse } from "next/server";
import { TABLES, listRecords } from "@/lib/airtable";

export const runtime = "nodejs";

// GET /api/snapshots?url=<reel url>   -> time series for one reel
// GET /api/snapshots                  -> recent snapshots (for trend charts)
export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl.searchParams.get("url");
    const opts: any = { sort: [{ field: "Snapshot Date", direction: "asc" }], maxRecords: 1000 };
    if (url) {
      const safe = url.replace(/"/g, '\\"');
      opts.filterByFormula = `{Reel URL} = "${safe}"`;
    }
    const records = await listRecords(TABLES.snapshots, opts);
    return NextResponse.json({ records });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), records: [] }, { status: 500 });
  }
}
