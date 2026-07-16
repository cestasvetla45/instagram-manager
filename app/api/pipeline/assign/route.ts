import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const COOLDOWN_DAYS = 14;

// GET ?account_handle=&status=&concept_id=
// List assignments
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const accountHandle = p.get("account_handle") || "";
    const status = p.get("status") || "";
    const conceptId = p.get("concept_id") || "";

    let q = db().from("content_assignments").select("*").order("assigned_at", { ascending: false }).limit(1000);
    if (accountHandle) q = q.eq("account_handle", accountHandle);
    if (status) q = q.eq("status", status);
    if (conceptId) q = q.eq("concept_id", conceptId);

    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ assignments: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), assignments: [] }, { status: 500 });
  }
}

// POST — assign a brief to an account
// { brief_id, concept_id?, account_handle, va_name?, notes? }
// Enforces: no same concept on same account (already posted)
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const briefId = String(b.brief_id || "").trim();
    const accountHandle = String(b.account_handle || "").trim();
    if (!briefId || !accountHandle) {
      return NextResponse.json({ error: "brief_id and account_handle required" }, { status: 400 });
    }

    // Fetch the brief to get concept_id
    const { data: brief } = await db().from("content_briefs").select("id, concept_id, title").eq("id", briefId).limit(1);
    if (!brief?.length) return NextResponse.json({ error: "Brief not found" }, { status: 404 });
    const conceptId = b.concept_id || brief[0].concept_id;

    // RULE: no same concept on same account (if already posted)
    if (conceptId) {
      const { data: existing } = await db()
        .from("content_assignments")
        .select("id, status")
        .eq("concept_id", conceptId)
        .eq("account_handle", accountHandle)
        .eq("status", "posted")
        .limit(1);
      if (existing?.length) {
        return NextResponse.json({
          error: "This concept has already been posted to this account. Same concept cannot repeat on the same account.",
          blocked: "concept_repeat",
        }, { status: 409 });
      }
    }

    // RULE: no video repeat within 14 days (check if this exact brief was posted to this account)
    const { data: existingBrief } = await db()
      .from("content_assignments")
      .select("id, status, cooldown_expires_at")
      .eq("brief_id", briefId)
      .eq("account_handle", accountHandle)
      .eq("status", "posted")
      .limit(1);
    if (existingBrief?.length) {
      const cd = existingBrief[0].cooldown_expires_at;
      if (cd && new Date(cd) > new Date()) {
        return NextResponse.json({
          error: `This video is on cooldown for @${accountHandle} until ${new Date(cd).toLocaleDateString()}. (14-day no-repeat rule)`,
          blocked: "video_cooldown",
          cooldown_expires: cd,
        }, { status: 409 });
      }
    }

    const row: Record<string, any> = {
      brief_id: briefId,
      concept_id: conceptId || null,
      account_handle: accountHandle,
      status: "assigned",
      assigned_at: new Date().toISOString(),
      va_name: b.va_name?.trim() || null,
      notes: b.notes?.trim() || null,
    };

    const { data, error } = await db().from("content_assignments").insert(row).select().single();
    if (error) throw error;

    // Update brief status to "assigned"
    await db().from("content_briefs").update({ status: "assigned", updated_at: new Date().toISOString() }).eq("id", briefId);

    return NextResponse.json({ assignment: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// PATCH — mark assignment as posted (sets cooldown) or change status
// { id, status, reel_url?, va_name? }
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const patch: Record<string, any> = {};
    if (b.status) patch.status = b.status;
    if (b.reel_url !== undefined) patch.reel_url = b.reel_url?.trim() || null;
    if (b.va_name !== undefined) patch.va_name = b.va_name?.trim() || null;
    if (b.notes !== undefined) patch.notes = b.notes?.trim() || null;

    // If marking as posted, set posted_at + cooldown
    if (b.status === "posted") {
      const now = new Date();
      const cooldown = new Date(now.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      patch.posted_at = now.toISOString();
      patch.cooldown_expires_at = cooldown.toISOString();
    }

    const { data, error } = await db().from("content_assignments").update(patch).eq("id", b.id).select().single();
    if (error) throw error;

    // If posted, also log to va_posts for the VA daily tracker
    if (b.status === "posted" && data) {
      try {
        await db().from("va_posts").insert({
          account_handle: data.account_handle,
          post_type: "reel",
          link: data.reel_url || null,
          note: `Pipeline: ${data.brief_id}`,
          va_name: data.va_name || null,
          posted_at: data.posted_at,
        });
      } catch { /* best effort */ }
    }

    return NextResponse.json({ assignment: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await db().from("content_assignments").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
