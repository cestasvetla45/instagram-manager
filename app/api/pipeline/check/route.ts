import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const COOLDOWN_DAYS = 14;

// GET ?account_handle=
// Returns what this account can post today:
//  - available briefs (not on cooldown, concept not already posted to this account)
//  - recent assignments (history)
//  - cooldown info
export async function GET(req: NextRequest) {
  try {
    const accountHandle = String(req.nextUrl.searchParams.get("account_handle") || "").trim();
    if (!accountHandle) {
      return NextResponse.json({ error: "account_handle required" }, { status: 400 });
    }

    const now = new Date();
    const cooldownCutoff = new Date(now.getTime() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);

    // 1. All assignments for this account
    const { data: assignments, error: aErr } = await db()
      .from("content_assignments")
      .select("*, content_briefs(id, title, variant_label, concept_id, generation_prompt, reference_thumbnail, reference_reel_url)")
      .eq("account_handle", accountHandle)
      .order("assigned_at", { ascending: false })
      .limit(500);
    if (aErr) throw aErr;

    // 2. Concepts already posted to this account (the "no same concept" rule)
    const postedConceptIds = new Set<string>();
    for (const a of assignments || []) {
      if (a.status === "posted" && a.concept_id) {
        postedConceptIds.add(a.concept_id);
      }
    }

    // 3. Briefs currently on cooldown for this account (the "no video repeat 14 days" rule)
    const onCooldownBriefIds = new Set<string>();
    for (const a of assignments || []) {
      if (a.status === "posted" && a.cooldown_expires_at && new Date(a.cooldown_expires_at) > now) {
        onCooldownBriefIds.add(a.brief_id);
      }
    }

    // 4. Available briefs = assigned to this account, status "assigned", not yet posted
    //    (these are the ones the VA should post)
    const available = (assignments || []).filter((a: any) =>
      a.status === "assigned" &&
      !onCooldownBriefIds.has(a.brief_id)
    );

    // 5. Recently posted (for the history view)
    const recentlyPosted = (assignments || [])
      .filter((a: any) => a.status === "posted")
      .slice(0, 30);

    // 6. Count what's on cooldown
    const onCooldown = (assignments || []).filter((a: any) =>
      a.status === "posted" && a.cooldown_expires_at && new Date(a.cooldown_expires_at) > now
    );

    return NextResponse.json({
      account: accountHandle,
      available: available.map((a: any) => ({
        assignment_id: a.id,
        brief_id: a.brief_id,
        brief: a.content_briefs,
        assigned_at: a.assigned_at,
        va_name: a.va_name,
        notes: a.notes,
      })),
      recently_posted: recentlyPosted.map((a: any) => ({
        assignment_id: a.id,
        brief_id: a.brief_id,
        brief: a.content_briefs,
        posted_at: a.posted_at,
        cooldown_expires: a.cooldown_expires_at,
        on_cooldown: a.cooldown_expires_at ? new Date(a.cooldown_expires_at) > now : false,
        reel_url: a.reel_url,
      })),
      on_cooldown: onCooldown.map((a: any) => ({
        brief_id: a.brief_id,
        cooldown_expires: a.cooldown_expires_at,
        days_left: a.cooldown_expires_at ? Math.ceil((new Date(a.cooldown_expires_at).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : 0,
      })),
      stats: {
        total_assigned: (assignments || []).filter((a: any) => a.status === "assigned").length,
        total_posted: (assignments || []).filter((a: any) => a.status === "posted").length,
        on_cooldown_count: onCooldown.length,
        posted_concepts_count: postedConceptIds.size,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
