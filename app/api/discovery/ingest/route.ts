import { NextRequest, NextResponse } from "next/server";
import { ingestHandles, isSource } from "@/lib/discovery";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { handles: string[], source?: "related"|"suggested"|"explore"|"manual", sourceHandle?: string }
// Header: x-ingest-secret: <INGEST_SECRET>
//
// Machine endpoint for the Chrome extension (exempt from cookie auth in
// middleware — it authenticates with its own secret instead).
// Fail-safe: when app auth is ON, an unset INGEST_SECRET rejects everything.
export async function POST(req: NextRequest) {
  const secret = process.env.INGEST_SECRET || process.env.CRON_SECRET || "";
  const provided = req.headers.get("x-ingest-secret") || "";
  if (secret) {
    if (provided !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  } else if (process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "INGEST_SECRET not configured" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const handles: string[] = Array.isArray(body.handles) ? body.handles.map(String) : [];
    if (!handles.length) return NextResponse.json({ error: "handles[] required" }, { status: 400 });
    if (handles.length > 500) return NextResponse.json({ error: "max 500 handles per batch" }, { status: 400 });
    const source = isSource(String(body.source || "")) ? body.source : "suggested";
    const res = await ingestHandles(handles.slice(0, 500), source, String(body.sourceHandle || "").slice(0, 60));
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// GET → lets the extension verify its connection/secret ("test connection").
export async function GET(req: NextRequest) {
  const secret = process.env.INGEST_SECRET || process.env.CRON_SECRET || "";
  const provided = req.headers.get("x-ingest-secret") || "";
  if (secret && provided !== secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!secret && process.env.AUTH_SECRET)
    return NextResponse.json({ ok: false, error: "INGEST_SECRET not configured" }, { status: 401 });
  return NextResponse.json({ ok: true });
}
