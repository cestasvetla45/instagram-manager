import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { CANDIDATES_TABLE } from "@/lib/discovery";
import { importAccountTopReels } from "@/lib/discover";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { id, decision: "approve" | "reject", niche?, whySaved?, importNow? }
// Approve → account joins inspiration_accounts; the enrichment worker pulls
// its top reels next cycle (or immediately with importNow).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body.id || "");
    const decision = String(body.decision || "");
    if (!id || !["approve", "reject"].includes(decision))
      return NextResponse.json({ error: "id and decision (approve|reject) required" }, { status: 400 });

    const { data: rows } = await db().from(CANDIDATES_TABLE).select("*").eq("id", id).limit(1);
    const c: any = rows?.[0];
    if (!c) return NextResponse.json({ error: "candidate not found" }, { status: 404 });

    const now = new Date().toISOString();

    if (decision === "reject") {
      await db()
        .from(CANDIDATES_TABLE)
        .update({ status: "rejected", reject_reason: body.reason || "rejected in review", decided_at: now, updated_at: now })
        .eq("id", id);
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    const niche = String(body.niche || c.ai_niche || "").trim();
    await db().from(TABLES.inspirationAccounts).upsert(
      {
        handle: c.handle,
        profile_url: `https://www.instagram.com/${c.handle}/`,
        full_name: c.full_name,
        niche: niche || null,
        followers: c.followers || 0,
        following: c.following || 0,
        posts_count: c.posts_count || 0,
        bio: c.bio,
        why_saved:
          body.whySaved ||
          `Auto-discovered (score ${c.discovery_score ?? "?"}) via ${Object.keys(c.sources || {}).join("+") || "discovery"}`,
        profile_pic_url: c.profile_pic_url,
        updated_at: now,
      },
      { onConflict: "handle" }
    );
    await db()
      .from(CANDIDATES_TABLE)
      .update({ status: "approved", decided_at: now, updated_at: now })
      .eq("id", id);

    let imported: any = null;
    if (body.importNow) {
      try {
        imported = await importAccountTopReels(c.handle, 25, { heavy: true });
      } catch (e: any) {
        imported = { error: e?.message || String(e) }; // backlog worker will retry
      }
    }
    return NextResponse.json({ ok: true, status: "approved", handle: c.handle, imported });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
