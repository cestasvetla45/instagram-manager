import { NextRequest, NextResponse } from "next/server";
import {
  graphConfigured,
  syncGraphInsights,
  syncConnectedAccounts,
  hasConnectedAccounts,
} from "@/lib/instagram-graph";
import { db, dbConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST — pull insights for every OAuth-connected account (instagram_tokens).
// If none are connected, fall back to the single global-token account
// (INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_ACCOUNT_ID). Body: { limit?: number }.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Number(body?.limit) > 0 ? Math.min(200, Number(body.limit)) : 50;

    if (await hasConnectedAccounts()) {
      const summary = await syncConnectedAccounts(limit);
      return NextResponse.json({ source: "connected", ...summary });
    }

    if (graphConfigured()) {
      const summary = await syncGraphInsights(limit);
      return NextResponse.json({ source: "global", ...summary }, { status: summary.ok ? 200 : 500 });
    }

    return NextResponse.json(
      { ok: false, error: "No connected accounts, and global Graph API not configured." },
      { status: 400 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

// GET — status: how many accounts connected, when last synced.
export async function GET() {
  let connected = 0;
  let lastSynced: string | null = null;
  if (dbConfigured()) {
    const { data } = await db()
      .from("instagram_tokens")
      .select("last_synced_at")
      .eq("is_active", true)
      .order("last_synced_at", { ascending: false, nullsFirst: false });
    connected = (data || []).length;
    lastSynced = data?.[0]?.last_synced_at || null;
  }
  return NextResponse.json({
    ok: true,
    connected,
    last_synced_at: lastSynced,
    global_configured: graphConfigured(),
  });
}
