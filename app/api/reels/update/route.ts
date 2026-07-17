import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";

export const runtime = "nodejs";

// PATCH — manually update reel stats
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { reel_url, views, likes, comments, shares, saves } = body;

  if (!reel_url) {
    return NextResponse.json({ error: "reel_url is required" }, { status: 400 });
  }

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (views !== undefined) patch.views = Number(views) || 0;
  if (likes !== undefined) patch.likes = Number(likes) || 0;
  if (comments !== undefined) patch.comments = Number(comments) || 0;
  if (shares !== undefined) patch.shares = Number(shares) || 0;
  if (saves !== undefined) patch.saves = Number(saves) || 0;

  // Recalculate engagement rate
  const total = (patch.views ?? 0) + (patch.likes ?? 0) + (patch.comments ?? 0) + (patch.shares ?? 0) + (patch.saves ?? 0);
  if (patch.views !== undefined && patch.views > 0) {
    patch.engagement_rate = ((patch.likes ?? 0) + (patch.comments ?? 0) + (patch.shares ?? 0) + (patch.saves ?? 0)) / patch.views;
  }

  const { data, error } = await db()
    .from(TABLES.ourReels)
    .update(patch)
    .eq("reel_url", reel_url)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Reel not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, updated: data.length });
}
