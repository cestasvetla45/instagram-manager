import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { scrapeUserReels, scrapeProfile } from "@/lib/rocksolid";
import { inspirationScore } from "@/lib/score";
import { getDiscoverySettings } from "@/lib/settings";
import { assumedAccountNiche, thumbnailFormatPatch } from "@/lib/classify";

export const runtime = "nodejs";
export const maxDuration = 300;

const RESERVED = new Set([
  "p", "reel", "reels", "tv", "explore", "stories", "accounts", "direct",
  "about", "legal", "privacy", "developer", "explore", "s",
]);

// Pull account handles out of a blob of profile links and/or bare usernames.
function parseHandles(text: string): string[] {
  const out = new Set<string>();
  const urlRe = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text))) {
    const u = m[1].toLowerCase();
    if (!RESERVED.has(u)) out.add(u);
  }
  // leftover bare tokens (e.g. "@user1, user2")
  const stripped = text.replace(urlRe, " ");
  for (const tok of stripped.split(/[\s,]+/)) {
    const t = tok.replace(/^@/, "").trim().toLowerCase();
    if (/^[a-z0-9._]{2,30}$/.test(t) && !RESERVED.has(t)) out.add(t);
  }
  return [...out];
}

// Import one account's TOP `count` reels (by views). Niche assumed
// (inherited or AI-guessed); each reel classified single/multi-person.
async function importAccount(handle: string, count: number) {
  const cfg = await getDiscoverySettings();
  const pool = await scrapeUserReels(handle, Math.max(count * 2, 40));
  if (!pool.length) return { handle, imported: 0, error: "no reels (private/suspended/rate-limited)" };
  const top = [...pool].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, count);

  let followers = 0;
  let bio = "";
  try {
    const p = await scrapeProfile(handle);
    followers = p.followers;
    bio = p.bio;
    await db().from(TABLES.inspirationAccounts).upsert(
      {
        handle: p.username,
        profile_url: `https://www.instagram.com/${p.username}/`,
        full_name: p.fullName,
        followers: p.followers,
        following: p.following,
        posts_count: p.postsCount,
        bio: p.bio,
        profile_pic_url: p.profilePicUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "handle" }
    );
  } catch {
    /* score stays neutral on ratio axis */
  }

  const niche = await assumedAccountNiche(handle, bio, pool.map((r) => r.caption), cfg);

  const now = new Date().toISOString();
  let imported = 0;
  for (const r of top) {
    const score = inspirationScore({ views: r.views, likes: r.likes, comments: r.comments, followers, postedAt: r.postedAtISO });
    const fmt = await thumbnailFormatPatch(r.thumbnailUrl, r.caption, cfg);
    const { data: existing } = await db().from(TABLES.inspirationReels).select("id, niche, format").eq("reel_url", r.url).limit(1);
    const ex: any = existing?.[0];
    const row: Record<string, any> = {
      reel_url: r.url,
      shortcode: r.shortcode,
      author_handle: r.authorHandle || handle,
      caption: r.caption,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      followers_at_scrape: followers,
      view_follow_ratio: followers ? Math.round((r.views / followers) * 100) / 100 : 0,
      posted_date: r.postedDate,
      posted_at: r.postedAtISO,
      thumbnail_url: r.thumbnailUrl,
      inspiration_score: score,
      status: "To Review",
      date_scraped: now.slice(0, 10),
      updated_at: now,
    };
    if (niche && !ex?.niche) row.niche = niche;
    if (fmt.format && ex?.format == null) Object.assign(row, fmt);
    if (ex) {
      await db().from(TABLES.inspirationReels).update(row).eq("id", ex.id);
    } else {
      row.first_seen_at = now;
      row.refresh_count = 0;
      if (niche) row.niche = niche;
      Object.assign(row, fmt);
      await db().from(TABLES.inspirationReels).insert(row);
    }
    imported++;
  }
  return { handle, imported, niche: niche || null };
}

// POST { text?: string, handles?: string[], handle?: string, count?: number }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const count = Math.min(Math.max(Number(body.count) || 25, 1), 100);

    let handles: string[] = [];
    if (Array.isArray(body.handles)) handles = body.handles.flatMap((h: string) => parseHandles(String(h)));
    if (body.text) handles = handles.concat(parseHandles(String(body.text)));
    if (body.handle) handles = handles.concat(parseHandles(String(body.handle)));
    handles = [...new Set(handles.map((h) => h.toLowerCase()))];

    if (!handles.length) return NextResponse.json({ error: "No account handles or profile links found." }, { status: 400 });
    const MAX = 12;
    const capped = handles.slice(0, MAX);

    const results: any[] = [];
    for (const h of capped) {
      try {
        results.push(await importAccount(h, count));
      } catch (e: any) {
        results.push({ handle: h, imported: 0, error: e?.message || String(e) });
      }
    }
    const totalReels = results.reduce((s, r) => s + (r.imported || 0), 0);
    return NextResponse.json({
      ok: true,
      accounts: results.length,
      total_reels: totalReels,
      skipped: handles.length > MAX ? handles.slice(MAX) : [],
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
