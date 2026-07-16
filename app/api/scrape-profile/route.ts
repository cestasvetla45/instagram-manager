import { NextRequest, NextResponse } from "next/server";
import { scrapeProfile } from "@/lib/rocksolid";
import { db, TABLES } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { username, target: "inspiration" | "our", why?, niche? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const isOur = body.target === "our";
    const username = String(body.username || "").replace(/^@/, "").trim();
    if (!username) return NextResponse.json({ error: "username required" }, { status: 400 });

    const p = await scrapeProfile(username);
    const table = isOur ? TABLES.ourAccounts : TABLES.inspirationAccounts;

    const row: Record<string, any> = {
      handle: p.username,
      profile_url: `https://www.instagram.com/${p.username}/`,
      niche: body.niche || "",
      followers: p.followers,
      following: p.following,
      posts_count: p.postsCount,
      profile_pic_url: p.profilePicUrl,
      updated_at: new Date().toISOString(),
    };
    if (isOur) {
      row.notes = body.why || "";
    } else {
      row.full_name = p.fullName;
      row.bio = p.bio;
      row.why_saved = body.why || "";
    }

    const { data: existing } = await db().from(table).select("id").ilike("handle", username).limit(1);
    if (existing && existing[0]) {
      await db().from(table).update(row).eq("id", existing[0].id);
      return NextResponse.json({ ok: true, created: false, profile: p });
    }
    await db().from(table).insert(row);
    return NextResponse.json({ ok: true, created: true, profile: p });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
