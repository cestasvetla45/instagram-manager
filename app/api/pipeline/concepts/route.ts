import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
// Cache 30 seconds
export const revalidate = 30;

// GET ?content_type=&subniche=&niche=&status=
// List concepts with their brief counts and assignment stats
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const contentType = p.get("content_type") || "";
    const subniche = p.get("subniche") || "";
    const niche = p.get("niche") || "";
    const status = p.get("status") || "active";

    let q = db().from("content_concepts").select("*").order("created_at", { ascending: false }).limit(500);
    if (contentType) q = q.eq("content_type", contentType);
    if (subniche) q = q.eq("subniche", subniche);
    if (niche) q = q.eq("niche", niche);
    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) throw error;

    // Enrich with brief counts
    const conceptIds = (data || []).map((c: any) => c.id);
    let briefCounts: Record<string, number> = {};
    if (conceptIds.length) {
      const { data: briefs } = await db()
        .from("content_briefs")
        .select("concept_id")
        .in("concept_id", conceptIds);
      for (const b of briefs || []) {
        briefCounts[b.concept_id] = (briefCounts[b.concept_id] || 0) + 1;
      }
    }

    const concepts = (data || []).map((c: any) => ({
      ...c,
      brief_count: briefCounts[c.id] || 0,
    }));

    return NextResponse.json({ concepts }, { headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), concepts: [] }, { status: 500 });
  }
}

// POST — create a new concept
// { name, content_type, subniche?, niche?, description?, inspiration_reel_url?,
//   inspiration_thumbnail?, inspiration_account?, visual_prompt?, hook_text? }
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });

    const row: Record<string, any> = {
      name: String(b.name).trim(),
      content_type: String(b.content_type || "dance").trim(),
      subniche: b.subniche?.trim() || null,
      niche: b.niche?.trim() || null,
      description: b.description?.trim() || null,
      inspiration_reel_url: b.inspiration_reel_url?.trim() || null,
      inspiration_thumbnail: b.inspiration_thumbnail?.trim() || null,
      inspiration_account: b.inspiration_account?.trim() || null,
      visual_prompt: b.visual_prompt?.trim() || null,
      hook_text: b.hook_text?.trim() || null,
      status: "active",
    };

    const { data, error } = await db().from("content_concepts").insert(row).select().single();
    if (error) throw error;

    return NextResponse.json({ concept: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// PATCH — update a concept (e.g. retire it, edit prompt)
// { id, ...fields }
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of ["name", "description", "visual_prompt", "hook_text", "content_type", "subniche", "niche", "status"]) {
      if (b[key] !== undefined) patch[key] = b[key];
    }

    const { data, error } = await db().from("content_concepts").update(patch).eq("id", b.id).select().single();
    if (error) throw error;

    return NextResponse.json({ concept: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await db().from("content_concepts").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
