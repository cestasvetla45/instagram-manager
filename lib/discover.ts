// Background enrichment: works through the backlog of inspiration accounts
// that don't have reels yet, a few per cycle, respecting the scraper's rate limit.
import { db, TABLES } from "./db";
import { scrapeUserReels, scrapeProfile, scrapeReel } from "./rocksolid";
import { storeVideo } from "./storage";
import { saveReel } from "./save";
import { inspirationScore } from "./score";
import { recordCoauthors } from "./discovery";
import { getDiscoverySettings } from "./settings";
import { assumedAccountNiche, thumbnailFormatPatch } from "./classify";

// Pull an account's TOP `count` reels (by views) into the library.
// Niche is assumed (inherited or AI-guessed) and each reel is classified
// single- vs multi-person from its thumbnail (both gated by settings).
//
// `heavy` gates the expensive tail — top-3 video downloads + Gemini
// auto-categorization. It defaults to OFF so the Railway worker cycle stays
// metadata-only (downloads/Gemini cause hangs); user-triggered API routes
// that genuinely want the video (e.g. approving a discovery candidate) pass
// { heavy: true }.
export async function importAccountTopReels(
  handle: string,
  count = 25,
  opts: { heavy?: boolean } = {}
) {
  const heavy = opts.heavy === true;
  const clean = handle.replace(/^@/, "").trim();
  const cfg = await getDiscoverySettings();
  const pool = await scrapeUserReels(clean, Math.max(count * 2, 24));
  if (!pool.length) return { handle: clean, imported: 0, empty: true };

  // Collab coauthors are strong new-creator leads — feed them to discovery.
  await recordCoauthors([...new Set(pool.flatMap((r) => r.coauthors || []))], clean);
  const top = [...pool].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, count);

  let followers = 0;
  let bio = "";
  try {
    const p = await scrapeProfile(clean);
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
    /* score stays neutral on the ratio axis */
  }

  // Assume the niche once for the whole account (inherit → AI guess).
  // Gemini disabled in worker cycle to prevent hangs — run via /api/inspiration-library/categorize instead.
  const niche = "";

  const now = new Date().toISOString();
  let imported = 0;

  // All reels: metadata only (no video download) to keep the cycle fast.
  // Videos get downloaded later for top performers via the categorize API.
  const extra: Record<string, any> = { tray: "regular" };
  if (niche) extra.niche = niche;
  for (const r of top) {
    const score = inspirationScore({ views: r.views, likes: r.likes, comments: r.comments, followers, postedAt: r.postedAtISO });
    // Skip Gemini thumbnail classification in worker — too slow, causes hangs.
    const { data: existing } = await db().from(TABLES.inspirationReels).select("id, niche, format").eq("reel_url", r.url).limit(1);
    const ex: any = existing?.[0];
    const row: Record<string, any> = {
      reel_url: r.url,
      shortcode: r.shortcode,
      author_handle: r.authorHandle || clean,
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
      content_type: "reel",
      status: "To Review",
      date_scraped: now.slice(0, 10),
      updated_at: now,
    };
    if (niche && !ex?.niche) row.niche = niche;
    // Format classification skipped in worker (would call Gemini).
    if (ex) await db().from(TABLES.inspirationReels).update(row).eq("id", ex.id);
    else {
      row.first_seen_at = now;
      row.refresh_count = 0;
      if (niche) row.niche = niche;
      await db().from(TABLES.inspirationReels).insert(row);
    }
    imported++;
  }

  // Metadata-only fast path (worker cycle): skip video downloads + Gemini.
  if (!heavy) {
    return { handle: clean, imported, followers, niche: niche || null, downloaded: 0, categorized: 0 };
  }

  // For the TOP 3 reels by views: download the video (scrapeReel = 2 calls each)
  // and store it durably, so it survives IG deletion and can be categorized.
  const top3 = top.slice(0, 3);
  let downloaded = 0;
  for (const r of top3) {
    try {
      const full = await scrapeReel(r.url);
      if (!full.videoUrl) continue;
      const stored = await storeVideo(full.shortcode, full.videoUrl);
      await db()
        .from(TABLES.inspirationReels)
        .update({
          video_url: stored?.publicUrl || full.videoUrl,
          video_path: stored?.path || null,
          updated_at: new Date().toISOString(),
        })
        .eq("reel_url", r.url);
      downloaded++;
    } catch {
      /* best effort — skip on failure */
    }
  }

  // Auto-categorize the freshly-downloaded videos (Gemini). Bounded so a slow
  // model can't stall enrichment; the worker cycle catches any stragglers.
  let categorized = 0;
  try {
    const { autoCategorizeNew } = await import("./categorize");
    const res = await autoCategorizeNew(3);
    categorized = Number(res?.categorized || 0);
  } catch {
    /* best effort */
  }

  return { handle: clean, imported, followers, niche: niche || null, downloaded, categorized };
}

// Process up to `perCycle` accounts that have NO reels yet (the backlog).
export async function enrichBacklog(perCycle?: number, count?: number) {
  const per = perCycle ?? Number(process.env.ENRICH_PER_CYCLE || 8);
  const n = count ?? Number(process.env.ENRICH_REELS_PER_ACCOUNT || 25);

  const { data: accts } = await db().from(TABLES.inspirationAccounts).select("handle").limit(5000);
  const { data: haveReels } = await db().from(TABLES.inspirationReels).select("author_handle").limit(20000);
  const have = new Set((haveReels || []).map((r: any) => (r.author_handle || "").toLowerCase()).filter(Boolean));
  const backlog = (accts || []).map((a: any) => a.handle).filter((h: string) => h && !have.has(h.toLowerCase()));

  const toProcess = backlog.slice(0, per);
  console.log(`[enrichBacklog] backlog=${backlog.length}, processing ${toProcess.length} accounts`);
  let processed = 0, imported = 0, failed = 0, empty = 0;
  for (const [i, h] of toProcess.entries()) {
    console.log(`[enrichBacklog] (${i + 1}/${toProcess.length}) processing @${h}`);
    try {
      const res = await importAccountTopReels(h, n);
      processed++;
      imported += res.imported;
      if (res.empty) empty++;
      console.log(`[enrichBacklog] (${i + 1}/${toProcess.length}) done @${h} — imported ${res.imported}`);
    } catch (e: any) {
      failed++;
      console.log(`[enrichBacklog] (${i + 1}/${toProcess.length}) failed @${h} — ${e?.message || e}`);
    }
  }
  return { backlogTotal: backlog.length, processed, imported, empty, failed, remaining: Math.max(0, backlog.length - processed) };
}
