import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { getNicheByName, slugify, stampNicheRename, statsForHandles } from "@/lib/categories";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/categories/:name — category detail: profiles + header stats.
export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const name = decodeURIComponent(params.name || "");
    const cat = await getNicheByName(name);
    if (!cat) return NextResponse.json({ error: "category not found" }, { status: 404 });

    const { data: accounts, error } = await db()
      .from(TABLES.inspirationAccounts)
      .select("handle, full_name, followers, profile_pic_url, enriched_at, scrape_status, niche")
      .ilike("niche", cat.name)
      .order("followers", { ascending: false });
    if (error) throw error;

    const handles = (accounts || []).map((a) => a.handle);
    const reelStats = await statsForHandles(handles);

    return NextResponse.json({
      category: cat,
      accounts: accounts || [],
      stats: { profile_count: (accounts || []).length, ...reelStats },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// PATCH /api/categories/:name  { newName } — rename, cascades to accounts + reels.
export async function PATCH(req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const name = decodeURIComponent(params.name || "");
    const body = await req.json();
    const newName = String(body.newName || "").trim();
    if (!newName) return NextResponse.json({ error: "newName required" }, { status: 400 });

    const cat = await getNicheByName(name);
    if (!cat) return NextResponse.json({ error: "category not found" }, { status: 404 });

    if (normEq(newName, cat.name)) {
      return NextResponse.json({ ok: true, category: cat, unchanged: true });
    }

    const collision = await getNicheByName(newName);
    if (collision) {
      return NextResponse.json({ error: "A category with that name already exists." }, { status: 409 });
    }

    const slug = slugify(newName);
    const { error: renameErr } = await db().from("niches").update({ name: newName, slug }).eq("id", cat.id);
    if (renameErr) throw renameErr;

    await db().from(TABLES.inspirationAccounts).update({ niche: newName }).ilike("niche", cat.name);
    const reelsUpdated = await stampNicheRename(cat.name, newName);

    return NextResponse.json({ ok: true, category: { ...cat, name: newName, slug }, reels_updated: reelsUpdated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE /api/categories/:name — only allowed when the category has no profiles.
export async function DELETE(_req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const name = decodeURIComponent(params.name || "");
    const cat = await getNicheByName(name);
    if (!cat) return NextResponse.json({ error: "category not found" }, { status: 404 });

    const { count, error } = await db()
      .from(TABLES.inspirationAccounts)
      .select("id", { count: "exact", head: true })
      .ilike("niche", cat.name);
    if (error) throw error;
    if ((count || 0) > 0) {
      return NextResponse.json({ error: "This category still has profiles — reassign them first." }, { status: 409 });
    }

    const { error: delErr } = await db().from("niches").delete().eq("id", cat.id);
    if (delErr) throw delErr;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

function normEq(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
