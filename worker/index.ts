// Railway background worker — one-account-per-beat staggered scheduler.
//
// Every 30s beat processes EXACTLY ONE account (never a batch), chosen by
// priority: an overdue OUR account (P1) > an overdue inspiration account that
// already has reels (P2) > one inspiration-backlog account to enrich (P3).
// With ~4 active OUR accounts and a 55min cooldown, each lands roughly
// hourly, one API burst per 30s max — no more back-to-back batches of up to
// 10 accounts spiking the 2 API keys' RPM.
//
// enrichBacklog used to run every 5 batches and BLOCK the loop for ~20 min
// processing 40 accounts serially inline, starving every stat refresh behind
// it. Now it's folded into the same one-account-per-beat rotation (P3) — at
// most one backlog account per beat, same as everything else.
//
// Periodic (non-scrape) jobs — viral calc, snapshots, Gemini categorization —
// are time-based off lastRun timestamps rather than batch-counter modulo, so
// they can't be starved indefinitely and never block the per-beat scrape for
// long.
import { db, TABLES } from "../lib/db";
import { scrapeUserReels, scrapeReel, getApiStats } from "../lib/rocksolid";
import { calcViralBatch } from "../lib/viral";
import { autoCategorizeNew } from "../lib/categorize";
import { enrichOneBacklogAccount, looksLikeMissingAccountError } from "../lib/discover";
import { detectAndAddNewPostsForAccount, snapshotAccounts } from "../lib/accounts";
import { inspirationScore } from "../lib/score";

const OUR_COOLDOWN_MIN = 55; // P1: our accounts — hourly-ish, slightly under 60 so a slow beat doesn't push it past the hour.
const INSPO_COOLDOWN_MIN = 60; // P2: inspiration accounts.
const EXCLUDED_SCRAPE_STATUSES = ["inaccessible", "archived"];

const VIRAL_INTERVAL_MS = 10 * 60 * 1000; // every ~10 min
const SNAPSHOT_INTERVAL_MS = 30 * 60 * 1000; // every ~30 min
const CATEGORIZE_INTERVAL_MS = 2 * 60 * 1000; // kick every ~2 min (fire-and-forget)

let beatCount = 0;
let running = false;
let categorizing = false; // only one Gemini categorization run at a time
let lastViralAt = 0;
let lastSnapshotAt = 0;
let lastCategorizeAt = 0;

type ProcessResult = { refreshed: number; failed: number; ingested: number };
type Lane = "our" | "inspo" | "enrich" | "idle";

// Bulk-scrape one account and update its reels. For inspiration accounts,
// reels we've never seen before are ingested so viral content is discovered
// automatically. Falls back to per-reel scraping when bulk returns nothing.
// On any successful scrape, scrape_status is stamped 'ok'; on a scrape that
// resolves to "this account doesn't exist", scrape_status is stamped
// 'inaccessible' so it's excluded from every future selection query.
async function processAccount(handle: string, isOur: boolean): Promise<ProcessResult> {
  const table = isOur ? TABLES.ourReels : TABLES.inspirationReels;
  const acctTable = isOur ? TABLES.ourAccounts : TABLES.inspirationAccounts;
  const handleCol = isOur ? "account_handle" : "author_handle";
  let refreshed = 0;
  let failed = 0;
  let ingested = 0;

  const markOk = async () => {
    try {
      await db().from(acctTable).update({ scrape_status: "ok" }).eq("handle", handle);
    } catch {}
  };
  const markInaccessible = async () => {
    try {
      await db().from(acctTable).update({ scrape_status: "inaccessible", updated_at: new Date().toISOString() }).eq("handle", handle);
      console.log(`⚠ ${handle} flagged as inaccessible — API can't scrape it`);
    } catch {}
  };

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
        await markInaccessible();
        return { refreshed: 0, failed: perReelFailed, ingested: 0 };
      }
      failed += perReelFailed;
      if (refreshed > 0) await markOk();
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
          // New reel discovered. Our accounts are ingested by
          // detectAndAddNewPostsForAccount (full per-reel scrape); inspiration
          // reels are ingested straight from the bulk payload — no extra API calls.
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

      await markOk();

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
  } catch (e: any) {
    failed++;
    if (looksLikeMissingAccountError(e?.message || e)) {
      await markInaccessible();
    }
  }

  // Stamp the cooldown clock whether or not the scrape succeeded — a failing
  // account shouldn't be retried every 30 seconds.
  try {
    await db()
      .from(acctTable)
      .update({ last_scraped_at: new Date().toISOString() })
      .eq("handle", handle);
  } catch {}

  return { refreshed, failed, ingested };
}

// ── P1: an OUR account (active, not excluded) overdue for a refresh. ──
async function pickOurAccount(): Promise<string | null> {
  const cutoff = new Date(Date.now() - OUR_COOLDOWN_MIN * 60 * 1000).toISOString();
  try {
    const { data } = await db()
      .from(TABLES.ourAccounts)
      .select("handle, active, scrape_status, last_scraped_at")
      .eq("active", true)
      .or(`scrape_status.is.null,scrape_status.not.in.(${EXCLUDED_SCRAPE_STATUSES.join(",")})`)
      .or(`last_scraped_at.is.null,last_scraped_at.lt.${cutoff}`)
      .order("last_scraped_at", { ascending: true, nullsFirst: true })
      .limit(1);
    return data?.[0]?.handle || null;
  } catch {
    return null;
  }
}

// ── P2: an inspiration account past cooldown that already has reels. ──
// Checked one small existence query per candidate (never a table-wide join)
// so it can't fall into the same "silently truncated by PostgREST's row cap"
// trap that stalled enrichBacklog (see lib/discover.ts).
async function pickInspoAccount(): Promise<string | null> {
  const cutoff = new Date(Date.now() - INSPO_COOLDOWN_MIN * 60 * 1000).toISOString();
  try {
    const { data } = await db()
      .from(TABLES.inspirationAccounts)
      .select("handle, scrape_status, last_scraped_at")
      .or(`last_scraped_at.is.null,last_scraped_at.lt.${cutoff}`)
      .or(`scrape_status.is.null,scrape_status.not.in.(${EXCLUDED_SCRAPE_STATUSES.join(",")})`)
      .order("last_scraped_at", { ascending: true, nullsFirst: true })
      .limit(25);

    for (const a of data || []) {
      if (!a.handle) continue;
      try {
        const { data: existing } = await db()
          .from(TABLES.inspirationReels)
          .select("id")
          .ilike("author_handle", a.handle)
          .limit(1);
        if (existing && existing.length) return a.handle;
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
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
    // Trim to the most recent ~500 cycles, occasionally (not every beat).
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
// Fire-and-forget: kicked off, never awaited by the beat loop.
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

async function runBeat() {
  if (running) return;
  running = true;
  beatCount++;
  const startedAt = new Date().toISOString();
  const start = Date.now();

  let lane: Lane = "idle";
  let handle: string | null = null;
  let refreshed = 0;
  let failed = 0;
  let ingested = 0;

  try {
    // ── Priority pick: exactly one account this beat. ──
    const ourHandle = await pickOurAccount();
    if (ourHandle) {
      lane = "our";
      handle = ourHandle;
      const r = await processAccount(ourHandle, true);
      refreshed = r.refreshed;
      failed = r.failed;
      ingested = r.ingested;

      // New-post detection for THIS account only — folded into the same beat
      // so freshly posted reels show up without waiting on a separate sweep.
      try {
        const np = await detectAndAddNewPostsForAccount(ourHandle);
        ingested += np.added;
      } catch (e: any) {
        console.error(`detectAndAddNewPosts(${ourHandle}) error:`, e?.message || e);
      }
    } else {
      const inspoHandle = await pickInspoAccount();
      if (inspoHandle) {
        lane = "inspo";
        handle = inspoHandle;
        const r = await processAccount(inspoHandle, false);
        refreshed = r.refreshed;
        failed = r.failed;
        ingested = r.ingested;
      } else {
        try {
          const enr = await enrichOneBacklogAccount();
          if (enr.handle) {
            lane = "enrich";
            handle = enr.handle;
            ingested = enr.imported;
            if (enr.failed) failed = 1;
          }
        } catch (e: any) {
          console.error("enrichOneBacklogAccount error:", e?.message || e);
        }
      }
    }

    // ── Periodic jobs — time-based off lastRun, never batch-counter modulo,
    //    so a slow stretch can't starve them indefinitely, and they never
    //    swallow more than one beat's worth of the loop's time budget. ──
    const now = Date.now();
    if (now - lastViralAt >= VIRAL_INTERVAL_MS) {
      lastViralAt = now;
      try {
        await calcViralBatch({ limit: 100 });
      } catch (e: any) {
        console.error("virality error:", e?.message || e);
      }
    }

    if (now - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
      lastSnapshotAt = now;
      try {
        await snapshotAccounts();
      } catch (e: any) {
        console.error("snapshotAccounts error:", e?.message || e);
      }
    }

    if (now - lastCategorizeAt >= CATEGORIZE_INTERVAL_MS) {
      lastCategorizeAt = now;
      kickCategorization(); // fire-and-forget
    }

    const durationSec = (Date.now() - start) / 1000;
    console.log(
      new Date().toISOString(),
      `beat #${beatCount} [${lane}]${handle ? ` @${handle}` : ""} — ${durationSec.toFixed(1)}s, refreshed: ${refreshed}, ingested: ${ingested}, failed: ${failed}`
    );

    await reportStats({
      batch_no: beatCount,
      started_at: startedAt,
      duration_sec: Math.round(durationSec * 10) / 10,
      accounts: handle ? 1 : 0,
      refreshed,
      failed,
      extras: { lane, handle, ingested },
    });
  } catch (e: any) {
    console.error("beat error:", e?.message || e);
  } finally {
    running = false;
  }
}

// ── Main loop ─────────────────────────────────────────────────
if (!process.env.SUPABASE_URL || !process.env.ROCKSOLID_API_KEY) {
  console.warn("⚠ Worker missing SUPABASE_URL / ROCKSOLID_API_KEY — set them in Railway variables.");
}

console.log(
  `▶ worker started — one-account-per-beat mode, our cooldown = ${OUR_COOLDOWN_MIN}min, inspo cooldown = ${INSPO_COOLDOWN_MIN}min`
);

// Run immediately, then every 30 seconds
console.log("▶ starting first beat...");
runBeat().catch((e) => console.error("FATAL beat error:", e?.message || e, e?.stack || ""));
setInterval(() => {
  runBeat().catch((e) => console.error("beat error:", e?.message || e));
}, 30_000); // One account every 30 seconds
