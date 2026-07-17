import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { scrapeProfile } from "@/lib/rocksolid";

export const runtime = "nodejs";
export const maxDuration = 60;

const norm = (h: string) => String(h || "").replace(/^@/, "").trim().toLowerCase();

// Fetch every reel's stat columns (author_handle, views, is_viral, date_scraped),
// paginating past Supabase's 1000-row cap, then reduce into a per-handle map.
async function reelStatsByHandle() {
  const map = new Map<
    string,
    { reel_count: number; total_views: number; viral: number; last_scraped: string | null }
  >();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from(TABLES.inspirationReels)
      .select("author_handle, views, is_viral, date_scraped")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      const key = norm(r.author_handle);
      if (!key) continue;
      const cur = map.get(key) || { reel_count: 0, total_views: 0, viral: 0, last_scraped: null };
      cur.reel_count += 1;
      cur.total_views += Number(r.views || 0);
      if (r.is_viral) cur.viral += 1;
      if (r.date_scraped && (!cur.last_scraped || r.date_scraped > cur.last_scraped)) {
        cur.last_scraped = r.date_scraped;
      }
      map.set(key, cur);
    }
    if (rows.length < PAGE) break;
  }
  return map;
}

// GET /api/inspiration-accounts?search=&niche=&sort=reels|views|followers|recent&page=1&limit=50
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const search = norm(sp.get("search") || "");
    const searchRaw = String(sp.get("search") || "").trim().toLowerCase();
    const niche = sp.get("niche") || "";
    const sort = sp.get("sort") || "reels";
    const page = Math.max(1, Number(sp.get("page") || 1));
    const limit = Math.min(200, Math.max(1, Number(sp.get("limit") || 50)));

    let q = db().from(TABLES.inspirationAccounts).select("*").limit(2000);
    if (niche && niche !== "ALL") {
      if (niche === "UNTAGGED") q = q.or("niche.is.null,niche.eq.");
      else q = q.ilike("niche", niche);
    }
    const { data: accounts, error } = await q;
    if (error) throw error;

    const stats = await reelStatsByHandle();

    let rows = (accounts || []).map((a) => {
      const s = stats.get(norm(a.handle)) || { reel_count: 0, total_views: 0, viral: 0, last_scraped: null };
      return {
        id: a.id,
        handle: a.handle,
        full_name: a.full_name || "",
        followers: Number(a.followers || 0),
        niche: a.niche || "",
        reel_count: s.reel_count,
        total_views: s.total_views,
        avg_views: s.reel_count ? Math.round(s.total_views / s.reel_count) : 0,
        viral_count: s.viral,
        is_viral: s.viral > 0,
        last_scraped: s.last_scraped || a.updated_at || a.date_added || null,
      };
    });

    if (searchRaw) {
      rows = rows.filter(
        (r) => norm(r.handle).includes(search) || (r.full_name || "").toLowerCase().includes(searchRaw)
      );
    }

    const total = rows.length;
    rows.sort((a, b) => {
      if (sort === "views") return b.total_views - a.total_views;
      if (sort === "followers") return b.followers - a.followers;
      if (sort === "recent") return String(b.last_scraped || "").localeCompare(String(a.last_scraped || ""));
      return b.reel_count - a.reel_count; // default: reels
    });

    const start = (page - 1) * limit;
    const pageRows = rows.slice(start, start + limit);

    return NextResponse.json(
      { accounts: pageRows, total, page },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=15" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), accounts: [], total: 0 }, { status: 500 });
  }
}

// POST /api/inspiration-accounts  { handle: "@username", niche?, why? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = norm(body.handle || body.username || "");
    if (!username) return NextResponse.json({ error: "handle required" }, { status: 400 });

    const p = await scrapeProfile(username);
    const row: Record<string, any> = {
      handle: p.username,
      profile_url: `https://www.instagram.com/${p.username}/`,
      full_name: p.fullName,
      bio: p.bio,
      niche: body.niche || "",
      followers: p.followers,
      following: p.following,
      posts_count: p.postsCount,
      profile_pic_url: p.profilePicUrl,
      why_saved: body.why || "",
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await db()
      .from(TABLES.inspirationAccounts)
      .select("id")
      .ilike("handle", username)
      .limit(1);
    if (existing && existing[0]) {
      await db().from(TABLES.inspirationAccounts).update(row).eq("id", existing[0].id);
      return NextResponse.json({ ok: true, created: false, account: row });
    }
    await db().from(TABLES.inspirationAccounts).insert(row);
    return NextResponse.json({ ok: true, created: true, account: row });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE /api/inspiration-accounts  { handles: ["@user1", ...] }
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const handles: string[] = Array.isArray(body.handles) ? body.handles.map(norm).filter(Boolean) : [];
    if (!handles.length) return NextResponse.json({ error: "handles required" }, { status: 400 });

    let deleted = 0;
    let reelsDeleted = 0;
    for (const h of handles) {
      // reels first
      const { data: reels } = await db()
        .from(TABLES.inspirationReels)
        .select("id")
        .ilike("author_handle", h);
      const rc = reels?.length || 0;
      if (rc) {
        await db().from(TABLES.inspirationReels).delete().ilike("author_handle", h);
        reelsDeleted += rc;
      }
      const { data: accts } = await db()
        .from(TABLES.inspirationAccounts)
        .select("id")
        .ilike("handle", h);
      if (accts?.length) {
        await db().from(TABLES.inspirationAccounts).delete().ilike("handle", h);
        deleted += accts.length;
      }
    }
    return NextResponse.json({ deleted, reels_deleted: reelsDeleted });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
