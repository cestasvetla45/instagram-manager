import { NextRequest, NextResponse } from "next/server";
import { db, TABLES, reelToFields } from "@/lib/db";

export const runtime = "nodejs";

const norm = (h: string) => String(h || "").replace(/^@/, "").trim();

// GET /api/inspiration-reels/manage?page=1&limit=50&handle=&niche=&tray=&viral=&sort=views|recent|score|viral&search=
//   &winners=true  &minViews=  &from=YYYY-MM-DD  &to=YYYY-MM-DD
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get("page") || 1));
    const limit = Math.min(200, Math.max(1, Number(sp.get("limit") || 50)));
    const handle = norm(sp.get("handle") || "");
    const niche = sp.get("niche") || "";
    const tray = sp.get("tray") || "";
    const viral = sp.get("viral");
    const winners = sp.get("winners");
    const minViews = Number(sp.get("minViews") || 0);
    const from = sp.get("from") || "";
    const to = sp.get("to") || "";
    const sort = sp.get("sort") || "views";
    const search = String(sp.get("search") || "").trim();

    let q = db().from(TABLES.inspirationReels).select("*", { count: "exact" });

    if (handle) q = q.ilike("author_handle", handle);
    if (niche && niche !== "ALL") {
      if (niche === "UNTAGGED") q = q.or("niche.is.null,niche.eq.");
      else q = q.ilike("niche", niche);
    }
    if (tray && tray !== "ALL") q = q.eq("tray", tray);
    if (viral === "true") q = q.eq("is_viral", true);
    if (winners === "true") q = q.eq("is_winner", true);
    if (minViews > 0) q = q.gte("views", minViews);
    if (from) q = q.gte("posted_at", from);
    if (to) q = q.lte("posted_at", `${to}T23:59:59`);
    // Strip PostgREST filter meta-chars (`,` `(` `)`) and ilike wildcards so a
    // term like "a,b" or "(x)" can't break the .or() expression → 500.
    const safeSearch = search.replace(/[,()%\\]/g, " ").trim();
    if (safeSearch) q = q.or(`caption.ilike.%${safeSearch}%,author_handle.ilike.%${safeSearch}%`);

    if (sort === "recent") q = q.order("date_scraped", { ascending: false, nullsFirst: false });
    else if (sort === "score") q = q.order("inspiration_score", { ascending: false, nullsFirst: false });
    else if (sort === "viral") q = q.order("viral_score", { ascending: false, nullsFirst: false });
    else q = q.order("views", { ascending: false, nullsFirst: false });

    const start = (page - 1) * limit;
    q = q.range(start, start + limit - 1);

    const { data, error, count } = await q;
    if (error) throw error;

    return NextResponse.json({
      reels: (data || []).map((r) => reelToFields(r, false)),
      total: count || 0,
      page,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), reels: [], total: 0 }, { status: 500 });
  }
}

// PATCH /api/inspiration-reels/manage
//   { reel_url, is_winner?, note? }             — single reel
//   { reel_urls: [...], is_winner?, note? }      — bulk (star toggle / note not typical bulk, but supported)
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.is_winner !== undefined) patch.is_winner = Boolean(body.is_winner);
    if (body.note !== undefined) patch.note = body.note == null ? null : String(body.note);
    if (Object.keys(patch).length <= 1) {
      return NextResponse.json({ error: "is_winner or note required" }, { status: 400 });
    }

    if (Array.isArray(body.reel_urls) && body.reel_urls.length) {
      let updated = 0;
      const CHUNK = 200;
      const urls: string[] = body.reel_urls.filter(Boolean);
      for (let i = 0; i < urls.length; i += CHUNK) {
        const chunk = urls.slice(i, i + CHUNK);
        const { data, error } = await db().from(TABLES.inspirationReels).update(patch).in("reel_url", chunk).select("id");
        if (error) throw error;
        updated += data?.length || 0;
      }
      return NextResponse.json({ updated });
    }

    const url = String(body.reel_url || "").trim();
    if (!url) return NextResponse.json({ error: "reel_url or reel_urls required" }, { status: 400 });
    const { data, error } = await db().from(TABLES.inspirationReels).update(patch).eq("reel_url", url).select("id");
    if (error) throw error;
    return NextResponse.json({ updated: data?.length || 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE /api/inspiration-reels/manage  { reel_urls: [...] }
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const urls: string[] = Array.isArray(body.reel_urls) ? body.reel_urls.filter(Boolean) : [];
    if (!urls.length) return NextResponse.json({ error: "reel_urls required" }, { status: 400 });

    let deleted = 0;
    const CHUNK = 200;
    for (let i = 0; i < urls.length; i += CHUNK) {
      const chunk = urls.slice(i, i + CHUNK);
      const { data, error } = await db()
        .from(TABLES.inspirationReels)
        .delete()
        .in("reel_url", chunk)
        .select("id");
      if (error) throw error;
      deleted += data?.length || 0;
    }
    return NextResponse.json({ deleted });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// POST /api/inspiration-reels/manage  { reel_urls: [...], tray: "spam" }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const urls: string[] = Array.isArray(body.reel_urls) ? body.reel_urls.filter(Boolean) : [];
    const tray = String(body.tray || "").trim();
    if (!urls.length) return NextResponse.json({ error: "reel_urls required" }, { status: 400 });
    if (!tray) return NextResponse.json({ error: "tray required" }, { status: 400 });

    let updated = 0;
    const CHUNK = 200;
    for (let i = 0; i < urls.length; i += CHUNK) {
      const chunk = urls.slice(i, i + CHUNK);
      const { data, error } = await db()
        .from(TABLES.inspirationReels)
        .update({ tray })
        .in("reel_url", chunk)
        .select("id");
      if (error) throw error;
      updated += data?.length || 0;
    }
    return NextResponse.json({ updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
