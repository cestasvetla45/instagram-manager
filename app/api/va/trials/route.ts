import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET ?account= → recent trial reels (newest first), for fatigue tracking
export async function GET(req: NextRequest) {
  try {
    const account = req.nextUrl.searchParams.get("account") || "";
    let q = db().from("va_trials").select("*").order("posted_at", { ascending: false, nullsFirst: false }).order("logged_at", { ascending: false }).limit(300);
    if (account && account !== "ALL") q = q.ilike("account_handle", account);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ trials: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), trials: [] }, { status: 500 });
  }
}

// POST { account_handle, concept, reel_link, views, posted_at, va_name }
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const row = {
      account_handle: (b.account_handle || "").trim() || null,
      concept: (b.concept || "").trim() || null,
      reel_link: (b.reel_link || "").trim() || null,
      views: b.views != null && b.views !== "" ? Number(b.views) : null,
      va_name: (b.va_name || "").trim() || null,
      posted_at: b.posted_at || new Date().toISOString(),
    };
    if (!row.reel_link && !row.concept) return NextResponse.json({ error: "Add a reel link or concept." }, { status: 400 });
    const { error } = await db().from("va_trials").insert(row);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await db().from("va_trials").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
