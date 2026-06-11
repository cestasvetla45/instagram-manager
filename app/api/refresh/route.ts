import { NextRequest, NextResponse } from "next/server";
import { TABLES, listRecords } from "@/lib/airtable";
import { saveReel } from "@/lib/save";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { type?: "inspiration" | "our" | "all" }
// Re-scrapes tracked reels, updates current metrics, and logs a snapshot for each.
// Also runnable on a schedule (e.g. Vercel Cron) — see README.
export async function POST(req: NextRequest) {
  try {
    let type: string = "all";
    try {
      const body = await req.json();
      type = body?.type || "all";
    } catch {
      /* allow empty body (cron) */
    }

    const targets: ("inspiration" | "our")[] =
      type === "inspiration" ? ["inspiration"] : type === "our" ? ["our"] : ["inspiration", "our"];

    const summary: any[] = [];
    for (const target of targets) {
      const table = target === "our" ? TABLES.ourReels : TABLES.inspirationReels;
      const records = await listRecords(table, { maxRecords: 500 });
      let ok = 0;
      let failed = 0;
      for (const rec of records) {
        const url = rec.fields["Reel URL"];
        if (!url) continue;
        try {
          await saveReel(url, target, { attachVideo: false });
          ok++;
        } catch {
          failed++;
        }
      }
      summary.push({ target, total: records.length, refreshed: ok, failed });
    }

    return NextResponse.json({ ok: true, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// Allow GET so it can be triggered by a simple cron hit.
export async function GET(req: NextRequest) {
  return POST(req);
}
