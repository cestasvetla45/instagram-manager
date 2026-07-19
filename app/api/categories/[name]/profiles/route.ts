import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { scrapeProfile } from "@/lib/rocksolid";
import { extractHandle, getNicheByName, norm, stampNicheForHandle } from "@/lib/categories";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/categories/:name/profiles  { handle }
// Adds a profile to this category. If the handle already exists in
// inspiration_accounts, its niche is switched (and its existing reels are
// re-stamped). If it's brand new, a minimal account row is inserted — the
// enrichment worker will pull its reels in automatically since enriched_at
// is left null.
export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const name = decodeURIComponent(params.name || "");
    const cat = await getNicheByName(name);
    if (!cat) return NextResponse.json({ error: "category not found" }, { status: 404 });

    const body = await req.json();
    const handle = extractHandle(body.handle || "");
    if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

    const { data: existing, error: findErr } = await db()
      .from(TABLES.inspirationAccounts)
      .select("id, handle, niche")
      .ilike("handle", handle)
      .limit(1);
    if (findErr) throw findErr;

    if (existing && existing[0]) {
      const acct = existing[0];
      if (norm(acct.niche || "") === norm(cat.name)) {
        return NextResponse.json({ ok: true, created: false, importing: false, handle: acct.handle });
      }
      const { error: updErr } = await db()
        .from(TABLES.inspirationAccounts)
        .update({ niche: cat.name, updated_at: new Date().toISOString() })
        .eq("id", acct.id);
      if (updErr) throw updErr;
      const reelsUpdated = await stampNicheForHandle(acct.handle, cat.name);
      return NextResponse.json({ ok: true, created: false, importing: false, handle: acct.handle, reels_updated: reelsUpdated });
    }

    // New account — scrape its basic profile, insert with this niche, let the
    // worker enrich reels automatically (enriched_at stays null).
    let profile;
    try {
      profile = await scrapeProfile(handle);
    } catch (e: any) {
      return NextResponse.json({ error: `Couldn't find @${handle} on Instagram: ${e?.message || e}` }, { status: 502 });
    }

    const row: Record<string, any> = {
      handle: profile.username || handle,
      profile_url: `https://www.instagram.com/${profile.username || handle}/`,
      full_name: profile.fullName,
      bio: profile.bio,
      niche: cat.name,
      followers: profile.followers,
      following: profile.following,
      posts_count: profile.postsCount,
      profile_pic_url: profile.profilePicUrl,
      updated_at: new Date().toISOString(),
    };
    const { error: insErr } = await db().from(TABLES.inspirationAccounts).insert(row);
    if (insErr) throw insErr;

    return NextResponse.json({ ok: true, created: true, importing: true, handle: row.handle });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE /api/categories/:name/profiles  { handle } — remove from category
// (sets the account's niche to null; does NOT delete the account or its reels).
export async function DELETE(req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const name = decodeURIComponent(params.name || "");
    const cat = await getNicheByName(name);
    if (!cat) return NextResponse.json({ error: "category not found" }, { status: 404 });

    const body = await req.json();
    const handle = extractHandle(body.handle || "");
    if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

    const { data, error } = await db()
      .from(TABLES.inspirationAccounts)
      .update({ niche: null, updated_at: new Date().toISOString() })
      .ilike("handle", handle)
      .ilike("niche", cat.name)
      .select("id");
    if (error) throw error;

    return NextResponse.json({ ok: true, updated: data?.length || 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// PATCH /api/categories/:name/profiles  { handle, to } — move to another category.
export async function PATCH(req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const name = decodeURIComponent(params.name || "");
    const cat = await getNicheByName(name);
    if (!cat) return NextResponse.json({ error: "category not found" }, { status: 404 });

    const body = await req.json();
    const handle = extractHandle(body.handle || "");
    const to = String(body.to || "").trim();
    if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });
    if (!to) return NextResponse.json({ error: "to (target category) required" }, { status: 400 });

    const target = await getNicheByName(to);
    if (!target) return NextResponse.json({ error: "target category not found" }, { status: 404 });

    const { data, error } = await db()
      .from(TABLES.inspirationAccounts)
      .update({ niche: target.name, updated_at: new Date().toISOString() })
      .ilike("handle", handle)
      .ilike("niche", cat.name)
      .select("id, handle");
    if (error) throw error;
    if (!data || !data.length) {
      return NextResponse.json({ error: "profile not found in this category" }, { status: 404 });
    }

    const reelsUpdated = await stampNicheForHandle(data[0].handle, target.name);
    return NextResponse.json({ ok: true, moved_to: target.name, reels_updated: reelsUpdated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
