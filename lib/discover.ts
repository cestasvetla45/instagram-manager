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

// ── Backlog selection ───────────────────────────────────────────
// PREVIOUSLY: backlog membership was computed by pulling EVERY inspiration_reels
// row (`.select("author_handle").limit(20000)`) into memory and checking which
// accounts had zero matching rows. That looked safe (20000 >> table size) but
// PostgREST enforces its own server-side `db-max-rows` cap (default 1000) that
// silently truncates any response past that, regardless of the client-side
// `.limit()` you asked for — no error, no warning, just a partial page. Once
// inspiration_reels grew past ~1000 rows, the "have reels" set only ever saw
// the first page (in undefined/physical order), so hundreds of accounts that
// already had reels imported kept reading as "no reels yet" forever — the
// exact 373-account plateau this was stuck at, reprocessing the same handles
// (welcometomellyland, jumybear, ...) every pass and re-importing 25 reels
// each time without the backlog ever shrinking.
//
// FIX: stop inferring "already enriched" from a reel-existence join at all.
// Track it directly on inspiration_accounts.enriched_at, stamped after each
// processing attempt. Selection is then a plain indexed filter on a handful
// of accounts — never a table-wide join — so it can't be truncated by a row
// cap. Accounts are retried only once enriched_at is more than
// ENRICH_RETRY_DAYS old, which also naturally throttles repeat attempts on
// accounts that error without being permanently "inaccessible".
const ENRICH_RETRY_DAYS = 7;
const EXCLUDED_SCRAPE_STATUSES = ["inaccessible", "archived"];

// Rough classifier for "this handle doesn't resolve on Instagram (deleted /
// renamed / never existed)" vs. a transient scraper failure. Matches get
// scrape_status='inaccessible' so they leave the backlog (and every other
// selection query) permanently instead of being retried every 7 days forever.
export function looksLikeMissingAccountError(msg: string): boolean {
  return /does not exist|doesn't exist|not found|no longer exists|user_not_found|cannot be found|invalid user|account.*(suspended|deactivated|deleted)/i.test(
    String(msg || "")
  );
}

async function markInaccessibleIfMissing(handle: string, table: string, err: any): Promise<boolean> {
  if (!looksLikeMissingAccountError(err?.message || err)) return false;
  try {
    await db().from(table).update({ scrape_status: "inaccessible", updated_at: new Date().toISOString() }).eq("handle", handle);
    console.log(`⚠ ${handle} flagged as inaccessible — account does not resolve`);
  } catch {}
  return true;
}

// Up to `limit` inspiration accounts due for (re-)enrichment, oldest
// enriched_at first (nulls — never enriched — come first). Excludes
// permanently-excluded accounts. A single small indexed query, no join.
async function pickBacklogAccounts(limit: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - ENRICH_RETRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db()
    .from(TABLES.inspirationAccounts)
    .select("handle, scrape_status, enriched_at")
    .or(`enriched_at.is.null,enriched_at.lt.${cutoff}`)
    .or(`scrape_status.is.null,scrape_status.not.in.(${EXCLUDED_SCRAPE_STATUSES.join(",")})`)
    .order("enriched_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  return (data || []).map((a: any) => a.handle).filter(Boolean);
}

type BacklogAccountResult = {
  handle: string;
  imported: number;
  empty: boolean;
  failed: boolean;
  inaccessible?: boolean;
  error?: string;
};

// Process one backlog account end-to-end: import, then stamp enriched_at
// (success OR failure — a persistently-erroring-but-not-"missing" account
// should back off for ENRICH_RETRY_DAYS, not be hammered every beat) and
// scrape_status='ok' on success so it also satisfies the "successful scrape
// sets scrape_status='ok'" rule everywhere else in the worker.
async function enrichBacklogAccount(handle: string, n: number): Promise<BacklogAccountResult> {
  const now = new Date().toISOString();
  try {
    const res = await importAccountTopReels(handle, n);
    await db()
      .from(TABLES.inspirationAccounts)
      .update({ enriched_at: now, scrape_status: "ok" })
      .eq("handle", handle);
    return { handle, imported: res.imported, empty: !!res.empty, failed: false };
  } catch (e: any) {
    const inaccessible = await markInaccessibleIfMissing(handle, TABLES.inspirationAccounts, e);
    try {
      await db().from(TABLES.inspirationAccounts).update({ enriched_at: now }).eq("handle", handle);
    } catch {}
    return { handle, imported: 0, empty: false, failed: true, inaccessible, error: e?.message || String(e) };
  }
}

// Worker scheduler entry point: pick and process EXACTLY ONE backlog
// account per call (the P3 lane of the one-account-per-beat scheduler).
export async function enrichOneBacklogAccount(count?: number): Promise<{
  handle: string | null;
  processed: number;
  imported: number;
  skipped: boolean;
  failed?: boolean;
  inaccessible?: boolean;
  error?: string;
}> {
  const n = count ?? Number(process.env.ENRICH_REELS_PER_ACCOUNT || 25);
  const [handle] = await pickBacklogAccounts(1);
  if (!handle) return { handle: null, processed: 0, imported: 0, skipped: true };
  const r = await enrichBacklogAccount(handle, n);
  return {
    handle: r.handle,
    processed: 1,
    imported: r.imported,
    skipped: false,
    failed: r.failed,
    inaccessible: r.inaccessible,
    error: r.error,
  };
}

// Batch variant — kept for the /api/enrich route and the legacy full-cycle
// refresh in lib/refresh.ts. Same fixed selection as enrichOneBacklogAccount,
// just looped `perCycle` times per call.
export async function enrichBacklog(perCycle?: number, count?: number) {
  const per = perCycle ?? Number(process.env.ENRICH_PER_CYCLE || 8);
  const n = count ?? Number(process.env.ENRICH_REELS_PER_ACCOUNT || 25);

  const toProcess = await pickBacklogAccounts(per);
  console.log(`[enrichBacklog] processing ${toProcess.length} accounts (enriched_at-driven selection)`);
  let processed = 0, imported = 0, failed = 0, empty = 0;
  for (const [i, h] of toProcess.entries()) {
    console.log(`[enrichBacklog] (${i + 1}/${toProcess.length}) processing @${h}`);
    const r = await enrichBacklogAccount(h, n);
    processed++;
    imported += r.imported;
    if (r.empty) empty++;
    if (r.failed) failed++;
    console.log(
      `[enrichBacklog] (${i + 1}/${toProcess.length}) ${r.failed ? "failed" : "done"} @${h} — imported ${r.imported}${
        r.error ? ` (${r.error})` : ""
      }`
    );
  }
  return { processed, imported, empty, failed };
}
