import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET ?concept_id=&status=&account_handle=
// List briefs, optionally filtered by concept or status
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const conceptId = p.get("concept_id") || "";
    const status = p.get("status") || "";
    const accountHandle = p.get("account_handle") || "";

    let q = db().from("content_briefs").select("*").order("created_at", { ascending: false }).limit(500);
    if (conceptId) q = q.eq("concept_id", conceptId);
    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) throw error;

    // If account_handle given, annotate each brief with availability + cooldown
    let briefs = data || [];
    if (accountHandle && briefs.length) {
      const briefIds = briefs.map((b: any) => b.id);
      const { data: assigns } = await db()
        .from("content_assignments")
        .select("brief_id, status, posted_at, cooldown_expires_at, account_handle")
        .in("brief_id", briefIds)
        .eq("account_handle", accountHandle);
      const assignMap: Record<string, any> = {};
      for (const a of assigns || []) {
        assignMap[a.brief_id] = a;
      }
      const now = new Date();
      briefs = briefs.map((b: any) => {
        const a = assignMap[b.id];
        const onCooldown = a?.status === "posted" && a.cooldown_expires_at && new Date(a.cooldown_expires_at) > now;
        return {
          ...b,
          assigned_to_account: !!a,
          assignment_status: a?.status || null,
          on_cooldown: !!onCooldown,
          cooldown_expires: a?.cooldown_expires_at || null,
        };
      });
    }

    return NextResponse.json({ briefs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), briefs: [] }, { status: 500 });
  }
}

// POST — create a new brief (one variant of a concept)
// { concept_id, title, variant_label?, generation_prompt?, reference_reel_url?, reference_thumbnail?, notes? }
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.concept_id) return NextResponse.json({ error: "concept_id required" }, { status: 400 });
    if (!b.title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });

    const row: Record<string, any> = {
      concept_id: b.concept_id,
      title: String(b.title).trim(),
      variant_label: b.variant_label?.trim() || null,
      generation_prompt: b.generation_prompt?.trim() || null,
      reference_reel_url: b.reference_reel_url?.trim() || null,
      reference_thumbnail: b.reference_thumbnail?.trim() || null,
      notes: b.notes?.trim() || null,
      status: "draft",
      created_by: b.created_by?.trim() || null,
    };

    const { data, error } = await db().from("content_briefs").insert(row).select().single();
    if (error) throw error;

    return NextResponse.json({ brief: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// PATCH — update brief status, notes, or airtable sync
// { id, status?, notes?, airtable_record_id?, airtable_synced_at? }
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of ["title", "variant_label", "generation_prompt", "reference_reel_url", "reference_thumbnail", "notes", "status", "airtable_record_id", "airtable_synced_at"]) {
      if (b[key] !== undefined) patch[key] = b[key];
    }

    const { data, error } = await db().from("content_briefs").update(patch).eq("id", b.id).select().single();
    if (error) throw error;

    return NextResponse.json({ brief: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await db().from("content_briefs").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
