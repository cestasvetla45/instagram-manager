// Railway background worker — continuous processing with per-account cooldown.
// Instead of one big batch every 60 min, it runs constantly:
// - Picks the next accounts that haven't been refreshed in the last hour
// - Scrapes their reels, updates stats, ingests newly-discovered reels
// - Flags reels crossing the viral threshold as they're ingested
// - Never hits the same account more than once per hour (last_scraped_at)
// - 150ms rate limit between API calls (built into rocksolid.ts)
// - Persists cycle + API stats to Postgres so the admin dashboard
//   (a separate Railway service) can see them.
import { db, TABLES } from "../lib/db";
import { scrapeUserReels, scrapeReel, getApiStats } from "../lib/rocksolid";
import { calcViralBatch } from "../lib/viral";
import { autoCategorizeNew } from "../lib/categorize";
import { enrichBacklog } from "../lib/discover";
import { detectAndAddNewPosts, snapshotAccounts } from "../lib/accounts";
import { inspirationScore } from "../lib/score";

const COOLDOWN_MIN = 60; // Don't refresh the same account more than once per hour
const BATCH_SIZE = 5; // Process 5 accounts, then do other tasks, then repeat
const VIRAL_INTERVAL = 10; // Run virality calc every 10 batches
const BACKLOG_INTERVAL = 5; // Run backlog enrichment every 5 batches
const SNAPSHOT_INTERVAL = 20; // Run account snapshots every 20 batches
const CATEGORIZE_INTERVAL = 2; // Kick Gemini categorization every 2 batches (non-blocking)

let batchCount = 0;
let running = false;
let categorizing = false; // only one Gemini categorization run at a time

type ProcessResult = { refreshed: number; failed: number; ingested: number };

// Bulk-scrape one account and update its reels. For inspiration accounts,
// reels we've never seen before are ingested so viral content is discovered
// automatically. Falls back to per-reel scraping when bulk returns nothing.
async function processAccount(handle: string, isOur: boolean): Promise<ProcessResult> {
  const table = isOur ? TABLES.ourReels : TABLES.inspirationReels;
  const handleCol = isOur ? "account_handle" : "author_handle";
  let refreshed = 0;
  let failed = 0;
  let ingested = 0;

  try {
    // Try bulk scrape first (1 API call for all reels)
    const reels = await scrapeUserReels(handle, 50);

    if (reels.length === 0) {
      // Bulk scrape returned nothing — fall back to per-reel scraping
      const { data: existing } = await db()
        .from(table)
        .select("reel_url")
        .eq(handleCol, handle)
        .order("posted_at", { ascending: false, nullsFirst: false })
        .limit(25);

      if (!existing || existing.length === 0) {
        // No reels to refresh — skip silently
        return { refreshed: 0, failed: 0, ingested: 0 };
      }

      // Try per-reel scraping
      let perReelFailed = 0;
      for (const r of existing) {
        try {
          const fresh = await scrapeReel(r.reel_url);
          await db()
            .from(table)
            .update({
              views: fresh.views,
              likes: fresh.likes,
              comments: fresh.comments,
              shares: fresh.shares,
              saves: fresh.saves,
              [handleCol]: fresh.authorHandle || handle,
              updated_at: new Date().toISOString(),
            })
            .eq("reel_url", r.reel_url);
          refreshed++;
        } catch {
          perReelFailed++;
        }
      }

      // If ALL per-reel calls failed, flag the account as inaccessible
      if (perReelFailed > 0 && refreshed === 0) {
        try {
          await db()
            .from(isOur ? TABLES.ourAccounts : TABLES.inspirationAccounts)
            .update({ scrape_status: "inaccessible", updated_at: new Date().toISOString() })
            .eq("handle", handle);
          console.log(`⚠ ${handle} flagged as inaccessible — API can't scrape it`);
        } catch {
          // ignore — column might not exist yet
        }
        return { refreshed: 0, failed: perReelFailed, ingested: 0 };
      }
      failed += perReelFailed;
    } else {
      // Bulk scrape worked — update known reels, ingest unknown ones.
      const codes = reels.map((r) => r.shortcode).filter(Boolean);
      const { data: existingRows } = await db()
        .from(table)
        .select("shortcode")
        .eq(handleCol, handle)
        .in("shortcode", codes);
      const known = new Set((existingRows || []).map((r: any) => r.shortcode).filter(Boolean));

      // Account followers → view/follow ratio for newly ingested reels.
      // Fetched lazily — most cycles discover nothing new.
      let followers = 0;
      let followersFetched = false;
      const getFollowers = async () => {
        if (followersFetched || isOur) return followers;
        followersFetched = true;
        try {
          const { data: acct } = await db()
            .from(TABLES.inspirationAccounts)
            .select("followers")
            .eq("handle", handle)
            .limit(1);
          followers = Number(acct?.[0]?.followers || 0);
        } catch {}
        return followers;
      };

      const newUrls: string[] = [];
      for (const r of reels) {
        if (r.shortcode && !known.has(r.shortcode)) {
          // New reel discovered. Our accounts are ingested by detectAndAddNewPosts
          // (full per-reel scrape); inspiration reels are ingested straight from
          // the bulk payload — no extra API calls.
          if (isOur) continue;
          // Same row shape as lib/discover.ts importAccountTopReels, so
          // worker-ingested reels aren't second-class in the library.
          await getFollowers();
          const now = new Date().toISOString();
          const { error } = await db()
            .from(table)
            .insert({
              reel_url: r.url,
              shortcode: r.shortcode,
              author_handle: r.authorHandle || handle,
              caption: r.caption || null,
              views: r.views,
              likes: r.likes,
              comments: r.comments,
              posted_date: r.postedDate,
              posted_at: r.postedAtISO,
              thumbnail_url: r.thumbnailUrl,
              followers_at_scrape: followers,
              view_follow_ratio: followers ? Math.round((r.views / followers) * 100) / 100 : 0,
              inspiration_score: inspirationScore({ views: r.views, likes: r.likes, comments: r.comments, followers, postedAt: r.postedAtISO }),
              content_type: "reel",
              tray: "regular",
              status: "To Review",
              refresh_count: 0,
              date_scraped: now.slice(0, 10),
              first_seen_at: now,
              updated_at: now,
            });
          if (!error) {
            ingested++;
            newUrls.push(r.url);
          }
          continue;
        }
        await db()
          .from(table)
          .update({
            views: r.views,
            likes: r.likes,
            comments: r.comments,
            updated_at: new Date().toISOString(),
          })
          .eq("reel_url", r.url);
        refreshed++;
      }

      // Viral check right away on freshly ingested reels so trending
      // content surfaces within one worker cycle, not hours later.
      if (newUrls.length) {
        try {
          await calcViralBatch({ reelUrls: newUrls });
        } catch (e: any) {
          console.error(`viral check for new ${handle} reels:`, e?.message || e);
        }
      }
    }
  } catch {
    failed++;
  }

  // Stamp the cooldown clock whether or not the scrape succeeded — a failing
  // account shouldn't be retried every 30 seconds.
  try {
    await db()
      .from(isOur ? TABLES.ourAccounts : TABLES.inspirationAccounts)
      .update({ last_scraped_at: new Date().toISOString() })
      .eq("handle", handle);
  } catch {}

  return { refreshed, failed, ingested };
}

async function getNextAccounts(): Promise<{ handle: string; isOur: boolean }[]> {
  const cutoff = new Date(Date.now() - COOLDOWN_MIN * 60 * 1000).toISOString();
  const accounts: { handle: string; isOur: boolean }[] = [];

  // Our accounts (only ~7): include the ones past cooldown, skip inaccessible.
  try {
    const { data: ourAccounts } = await db()
      .from(TABLES.ourAccounts)
      .select("handle, scrape_status, last_scraped_at")
      .limit(20);
    for (const a of ourAccounts || []) {
      if (!a.handle) continue;
      if (a.scrape_status === "inaccessible") continue;
      if (a.last_scraped_at && a.last_scraped_at > cutoff) continue; // cooldown
      accounts.push({ handle: a.handle, isOur: true });
    }
  } catch {}

  // Inspiration accounts: least recently scraped first, past cooldown,
  // skip inaccessible, and only ones that already have reels imported
  // (the backlog is enrichBacklog's job).
  try {
    const { data } = await db()
      .from(TABLES.inspirationAccounts)
      .select("handle, scrape_status, last_scraped_at")
      .or(`last_scraped_at.is.null,last_scraped_at.lt.${cutoff}`)
      .or("scrape_status.is.null,scrape_status.neq.inaccessible")
      .order("last_scraped_at", { ascending: true, nullsFirst: true })
      .limit(30);

    const candidates = (data || []).map((a: any) => a.handle).filter(Boolean);
    if (candidates.length) {
      const { data: withReels } = await db()
        .from(TABLES.inspirationReels)
        .select("author_handle")
        .in("author_handle", candidates)
        .limit(2000);
      const have = new Set((withReels || []).map((r: any) => r.author_handle));
      for (const h of candidates) {
        if (!have.has(h)) continue;
        if (accounts.length >= BATCH_SIZE + 5) break;
        accounts.push({ handle: h, isOur: false });
      }
    }
  } catch {}

  return accounts.slice(0, BATCH_SIZE + 5);
}

// Persist cycle + API-call stats so the admin dashboard (separate service)
// can show real numbers. Best-effort: stats never block scraping.
async function reportStats(cycle: {
  batch_no: number;
  started_at: string;
  duration_sec: number;
  accounts: number;
  refreshed: number;
  failed: number;
  extras?: Record<string, any>;
}) {
  try {
    await db().from("worker_cycles").insert(cycle);
    await db()
      .from("worker_api_stats")
      .upsert({ id: 1, stats: getApiStats(), updated_at: new Date().toISOString() });
    // Trim to the most recent ~500 cycles, occasionally (not every 30s batch).
    if (cycle.batch_no % 50 === 0) {
      const { data: old } = await db()
        .from("worker_cycles")
        .select("id")
        .order("id", { ascending: false })
        .range(500, 500);
      if (old?.length) await db().from("worker_cycles").delete().lt("id", old[0].id);
    }
  } catch (e: any) {
    console.error("reportStats error:", e?.message || e);
  }
}

// Gemini categorization — runs alongside scraping (different API), guarded so
// only one run is in flight. Viral reels are prioritized inside
// autoCategorizeNew; 3 reels per run with a 2s gap keeps rate limits happy.
function kickCategorization() {
  if (categorizing) return;
  categorizing = true;
  autoCategorizeNew(3)
    .then((r: any) => {
      if (r?.categorized || r?.failed?.length) {
        console.log(
          `🤖 categorize: ${r.categorized || 0} done, ${r.low_confidence || 0} low-conf, ${r.failed?.length || 0} failed`
        );
      }
    })
    .catch((e: any) => console.error("categorize error:", e?.message || e))
    .finally(() => {
      categorizing = false;
    });
}

async function runBatch() {
  if (running) return;
  running = true;
  batchCount++;
  const startedAt = new Date().toISOString();
  const start = Date.now();

  try {
    // 1. Get accounts that need refreshing (haven't been touched in 60 min)
    const accounts = await getNextAccounts();

    let totalRefreshed = 0;
    let totalFailed = 0;
    let totalIngested = 0;

    for (const acct of accounts) {
      const result = await processAccount(acct.handle, acct.isOur);
      totalRefreshed += result.refreshed;
      totalFailed += result.failed;
      totalIngested += result.ingested;
    }

    // 2. Periodic tasks
    if (batchCount % BACKLOG_INTERVAL === 0) {
      try {
        await enrichBacklog();
      } catch (e: any) {
        console.error("enrichBacklog error:", e?.message || e);
      }
    }

    if (batchCount % SNAPSHOT_INTERVAL === 0) {
      try {
        await snapshotAccounts();
      } catch (e: any) {
        console.error("snapshotAccounts error:", e?.message || e);
      }
    }

    if (batchCount % VIRAL_INTERVAL === 0) {
      try {
        await calcViralBatch({ limit: 100 });
      } catch (e: any) {
        console.error("virality error:", e?.message || e);
      }
    }

    // 3. Check for new posts from our accounts
    if (batchCount % BACKLOG_INTERVAL === 0) {
      try {
        await detectAndAddNewPosts();
      } catch (e: any) {
        console.error("detectNewPosts error:", e?.message || e);
      }
    }

    // 4. Gemini categorization — fire-and-forget so the scrape loop stays fast.
    if (batchCount % CATEGORIZE_INTERVAL === 0) {
      kickCategorization();
    }

    const durationSec = (Date.now() - start) / 1000;
    console.log(
      new Date().toISOString(),
      `batch #${batchCount} done in ${durationSec.toFixed(1)}s — accounts: ${accounts.length}, refreshed: ${totalRefreshed}, ingested: ${totalIngested}, failed: ${totalFailed}`
    );

    await reportStats({
      batch_no: batchCount,
      started_at: startedAt,
      duration_sec: Math.round(durationSec * 10) / 10,
      accounts: accounts.length,
      refreshed: totalRefreshed,
      failed: totalFailed,
      extras: totalIngested ? { ingested: totalIngested } : undefined,
    });
  } catch (e: any) {
    console.error("batch error:", e?.message || e);
  } finally {
    running = false;
  }
}

// ── Main loop ─────────────────────────────────────────────────
if (!process.env.SUPABASE_URL || !process.env.ROCKSOLID_API_KEY) {
  console.warn("⚠ Worker missing SUPABASE_URL / ROCKSOLID_API_KEY — set them in Railway variables.");
}

console.log(`▶ worker started — continuous mode, cooldown = ${COOLDOWN_MIN} min, batch = ${BATCH_SIZE} accounts`);

// Run immediately, then every 30 seconds
console.log("▶ starting first batch...");
runBatch().catch(e => console.error("FATAL batch error:", e?.message || e, e?.stack || ""));
setInterval(() => {
  runBatch().catch(e => console.error("batch error:", e?.message || e));
}, 30_000); // Check for work every 30 seconds
