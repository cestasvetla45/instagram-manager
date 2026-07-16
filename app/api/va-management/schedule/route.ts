import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET ?account_handle= → posting schedule for one account (or all active slots).
export async function GET(req: NextRequest) {
  try {
    const handle = req.nextUrl.searchParams.get("account_handle");
    let q = db()
      .from("posting_schedule")
      .select("*")
      .eq("is_active", true)
      .order("account_handle", { ascending: true })
      .order("post_time", { ascending: true });
    if (handle) q = q.eq("account_handle", handle);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ slots: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), slots: [] }, { status: 500 });
  }
}

// POST { account_handle, slot_name?, post_time, post_type? } → add a slot.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const account_handle = (b.account_handle || "").trim();
    const post_time = (b.post_time || "").trim();
    if (!account_handle || !post_time) {
      return NextResponse.json({ error: "account_handle and post_time are required" }, { status: 400 });
    }
    const { data, error } = await db()
      .from("posting_schedule")
      .insert({
        account_handle,
        slot_name: (b.slot_name || "").trim() || null,
        post_time,
        post_type: (b.post_type || "reel").trim(),
        is_active: true,
      })
      .select("*")
      .limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true, slot: data?.[0] || null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// PATCH { id, ...fields } → update a slot.
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const patch: any = {};
    if (b.slot_name !== undefined) patch.slot_name = (b.slot_name || "").trim() || null;
    if (b.post_time != null) patch.post_time = String(b.post_time).trim();
    if (b.post_type != null) patch.post_type = String(b.post_type).trim();
    if (b.is_active != null) patch.is_active = Boolean(b.is_active);
    const { error } = await db().from("posting_schedule").update(patch).eq("id", b.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE ?id= → remove a slot (hard delete — schedule slots are cheap).
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { error } = await db().from("posting_schedule").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
