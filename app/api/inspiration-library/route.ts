import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { saveReel } from "@/lib/save";
import { scrapeProfile, scrapeUserReels } from "@/lib/rocksolid";
import { inspirationScore } from "@/lib/score";
import { getDiscoverySettings } from "@/lib/settings";
import { assumedAccountNiche, thumbnailFormatPatch } from "@/lib/classify";

export const runtime = "nodejs";
export const maxDuration = 300;
// Sub-categories + trays change rarely — cache 5 minutes
export const revalidate = 300;

// Parse reel URLs from pasted text
function parseReelUrls(text: string): string[] {
  const re = /https?:\/\/(?:www\.)?instagram\.com\/(?:[^/\s]+\/)?(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/gi;
  const found = String(text || "").match(re) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of found) {
    const m = u.match(/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    if (!m) continue;
    const norm = `https://www.instagram.com/reel/${m[2]}/`;
    if (!seen.has(norm)) { seen.add(norm); out.push(norm); }
  }
  return out;
}

// Parse account handles from pasted text
const RESERVED = new Set(["p","reel","reels","tv","explore","stories","accounts","direct","about","legal","privacy","developer","s"]);
function parseHandles(text: string): string[] {
  const out = new Set<string>();
  const urlRe = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/gi;
  let m;
  while ((m = urlRe.exec(text))) {
    const u = m[1].toLowerCase();
    if (!RESERVED.has(u)) out.add(u);
  }
  const stripped = text.replace(urlRe, " ");
  for (const tok of stripped.split(/[\s,]+/)) {
    const t = tok.replace(/^@/, "").trim().toLowerCase();
    if (/^[a-z0-9._]{2,30}$/.test(t) && !RESERVED.has(t)) out.add(t);
  }
  return [...out];
}

// POST — bulk import reels and/or accounts
// { text, niche?, sub_category?, tray?, import_accounts?: boolean, account_count?: number }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = String(body.text || "");
    const niche = String(body.niche || "").trim();
    const subCategory = String(body.sub_category || "").trim();
    const tray = String(body.tray || "regular").trim();
    const importAccounts = body.import_accounts !== false;
    const accountCount = Math.min(Math.max(Number(body.account_count) || 25, 1), 50);

    const reelUrls = parseReelUrls(text);
    const handles = importAccounts ? parseHandles(text) : [];

    if (!reelUrls.length && !handles.length) {
      return NextResponse.json({ error: "No Instagram reel links or account handles found in that text." }, { status: 400 });
    }

    // Ensure niche exists if provided
    if (niche) {
      await db().from("niches").upsert(
        { name: niche, slug: niche.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "") },
        { onConflict: "name" }
      );
    }

    const results: any[] = [];
    const failed: any[] = [];

    // 1. Import individual reel links
    for (const url of reelUrls) {
      try {
        const { reel, created } = await saveReel(url, "inspiration", {
          extra: {
            niche: niche || null,
            sub_category: subCategory || null,
            tray,
          },
        });
        results.push({ type: "reel", url: reel.url, handle: reel.authorHandle, views: reel.views, created });
      } catch (e: any) {
        failed.push({ url, error: e?.message || String(e) });
      }
    }

    // 2. Import accounts (top N reels each) — NO 12-account limit
    let accountsAdded = 0;
    let accountReelsAdded = 0;
    for (const handle of handles) {
      try {
        const result = await importAccountReels(handle, accountCount, niche, subCategory, tray);
        accountsAdded++;
        accountReelsAdded += result.imported;
        if (result.error) {
          results.push({ type: "account", handle, imported: result.imported, niche: result.niche, error: result.error });
        } else {
          results.push({ type: "account", handle, imported: result.imported, niche: result.niche });
        }
      } catch (e: any) {
        failed.push({ handle, error: e?.message || String(e) });
      }
    }

    return NextResponse.json({
      ok: true,
      reels_added: results.filter((r) => r.type === "reel").length,
      accounts_processed: accountsAdded,
      account_reels_added: accountReelsAdded,
      total_reels: results.filter((r) => r.type === "reel").length + accountReelsAdded,
      niche: niche || null,
      sub_category: subCategory || null,
      tray,
      results,
      failed,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// Import an account's top reels with sub-category + tray tagging
async function importAccountReels(handle: string, count: number, niche: string | null, subCategory: string | null, tray: string) {
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
        niche: niche || undefined,
        sub_category: subCategory || undefined,
        tray,
        followers: p.followers,
        following: p.following,
        posts_count: p.postsCount,
        bio: p.bio,
        profile_pic_url: p.profilePicUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "handle" }
    );
  } catch { /* non-fatal */ }

  const inferredNiche = niche || await assumedAccountNiche(handle, bio, pool.map((r) => r.caption), cfg);
  const now = new Date().toISOString();
  let imported = 0;

  for (const r of top) {
    const score = inspirationScore({ views: r.views, likes: r.likes, comments: r.comments, followers, postedAt: r.postedAtISO });
    const fmt = await thumbnailFormatPatch(r.thumbnailUrl, r.caption, cfg);
    const { data: existing } = await db().from(TABLES.inspirationReels).select("id, niche, format, tray").eq("reel_url", r.url).limit(1);
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
      tray,
    };
    if (inferredNiche && !ex?.niche) row.niche = inferredNiche;
    if (niche) row.niche = niche;
    if (subCategory) row.sub_category = subCategory;
    if (fmt.format && ex?.format == null) Object.assign(row, fmt);
    if (ex) {
      // Don't override tray if already set
      if (ex.tray) delete row.tray;
      await db().from(TABLES.inspirationReels).update(row).eq("id", ex.id);
    } else {
      row.first_seen_at = now;
      row.refresh_count = 0;
      Object.assign(row, fmt);
      await db().from(TABLES.inspirationReels).insert(row);
    }
    imported++;
  }
  return { handle, imported, niche: inferredNiche || null };
}

// GET — list sub-categories and trays
export async function GET() {
  try {
    const { data: subs } = await db().from("sub_categories").select("*").order("sort_order");
    const { data: trays } = await db().from("inspiration_trays").select("*").order("sort_order");

    // Stats per tray
    const { data: trayStats } = await db()
      .from(TABLES.inspirationReels)
      .select("tray, is_viral")
      .limit(10000);

    const statsByTray: Record<string, { total: number; viral: number }> = {};
    for (const r of trayStats || []) {
      const t = r.tray || "regular";
      if (!statsByTray[t]) statsByTray[t] = { total: 0, viral: 0 };
      statsByTray[t].total++;
      if (r.is_viral) statsByTray[t].viral++;
    }

    return NextResponse.json(
      {
        sub_categories: subs || [],
        trays: (trays || []).map((t: any) => ({
          ...t,
          stats: statsByTray[t.name] || { total: 0, viral: 0 },
        })),
      },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
