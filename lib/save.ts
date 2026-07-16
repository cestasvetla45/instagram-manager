// Save/refresh a reel into Supabase (with durable video storage).
import { db, TABLES } from "./db";
import { storeVideo } from "./storage";
import { scrapeReel, scrapeProfile, NormalizedReel } from "./rocksolid";
import { inspirationScore } from "./score";
import { getDiscoverySettings } from "./settings";
import { thumbnailFormatPatch } from "./classify";

function today() {
  return new Date().toISOString().slice(0, 10);
}
function nowISO() {
  return new Date().toISOString();
}
function engagementRate(r: NormalizedReel): number {
  if (!r.views) return 0;
  return Math.min((r.likes + r.comments + r.shares + r.saves) / r.views, 9.9999);
}
function viewFollowRatio(views: number, followers: number): number {
  return followers ? Math.round((views / followers) * 100) / 100 : 0;
}

// ---- caches (per warm process) ----
const followerCache = new Map<string, { value: number; t: number }>();
async function getFollowers(handle: string): Promise<number> {
  const key = (handle || "").toLowerCase().trim();
  if (!key) return 0;
  const hit = followerCache.get(key);
  if (hit && Date.now() - hit.t < 30 * 60 * 1000) return hit.value;
  try {
    const p = await scrapeProfile(key);
    followerCache.set(key, { value: p.followers, t: Date.now() });
    return p.followers;
  } catch {
    return hit?.value ?? 0;
  }
}

const nicheCache = new Map<string, { value: string; t: number }>();
async function getAccountNiche(handle: string, isOur: boolean): Promise<string> {
  const key = `${isOur ? "our" : "insp"}:${(handle || "").toLowerCase().trim()}`;
  if (!handle) return "";
  const hit = nicheCache.get(key);
  if (hit && Date.now() - hit.t < 30 * 60 * 1000) return hit.value;
  const table = isOur ? TABLES.ourAccounts : TABLES.inspirationAccounts;
  const { data } = await db().from(table).select("niche").ilike("handle", handle).limit(1);
  const niche = data?.[0]?.niche ? String(data[0].niche) : "";
  nicheCache.set(key, { value: niche, t: Date.now() });
  return niche;
}

export async function saveReel(
  url: string,
  target: "inspiration" | "our",
  opts: { extra?: Record<string, any> } = {}
): Promise<{ reel: NormalizedReel; created: boolean }> {
  const isOur = target === "our";
  const table = isOur ? TABLES.ourReels : TABLES.inspirationReels;
  const r = await scrapeReel(url);
  const followers = await getFollowers(r.authorHandle);

  const { data: existingRows } = await db()
    .from(table)
    .select(isOur ? "id, niche, video_url, format" : "id, niche, video_url, downloaded_at, format")
    .eq("reel_url", r.url)
    .limit(1);
  const existing: any = existingRows?.[0] || null;

  const row: Record<string, any> = {
    reel_url: r.url,
    shortcode: r.shortcode,
    caption: r.caption,
    views: r.views,
    likes: r.likes,
    comments: r.comments,
    shares: r.shares,
    saves: r.saves,
    engagement_rate: engagementRate(r),
    followers_at_scrape: followers,
    view_follow_ratio: viewFollowRatio(r.views, followers),
    duration_sec: r.durationSec,
    posted_date: r.postedDate,
    posted_at: r.postedAtISO,
    thumbnail_url: r.thumbnailUrl,
    date_scraped: today(),
    updated_at: nowISO(),
  };
  row[isOur ? "account_handle" : "author_handle"] = r.authorHandle;

  // Durable video: store to Supabase bucket on first capture / when missing.
  let storedNow = false;
  if (r.videoUrl && !existing?.video_url) {
    const stored = await storeVideo(r.shortcode, r.videoUrl);
    row.video_url = stored?.publicUrl || r.videoUrl;
    if (stored?.path) row.video_path = stored.path;
    storedNow = Boolean(stored?.path);
  }

  // Inspiration-only: live 0–10 score, and a stats snapshot locked at download time.
  if (!isOur) {
    row.content_type = r.contentType;
    row.inspiration_score = inspirationScore({
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      followers,
      postedAt: r.postedAtISO,
    });
    // Lock in the "at download" snapshot the first time we capture the video
    // (or the first time we ever see the reel), since IG often deletes it later.
    if (!existing?.downloaded_at && (storedNow || !existing)) {
      row.downloaded_at = nowISO();
      row.views_at_download = r.views;
      row.likes_at_download = r.likes;
      row.comments_at_download = r.comments;
      row.followers_at_download = followers;
    }
  }

  // Niche inheritance (override-aware).
  if (!existing || !existing.niche) {
    const niche = await getAccountNiche(r.authorHandle, isOur);
    if (niche) row.niche = niche;
  }

  // Single vs multi-person: quick thumbnail guess when we don't have one yet
  // (video-based classification upgrades this later via AI categorize).
  if (existing?.format == null && r.thumbnailUrl) {
    try {
      const cfg = await getDiscoverySettings();
      const fmt = await thumbnailFormatPatch(r.thumbnailUrl, r.caption, cfg);
      if (fmt.format) Object.assign(row, fmt);
    } catch {
      /* best effort */
    }
  }

  if (opts.extra) Object.assign(row, opts.extra);

  let created = false;
  if (existing) {
    await db().from(table).update(row).eq("id", existing.id);
  } else {
    if (!isOur) {
      row.status = "To Review";
      row.refresh_count = 0;
    }
    row.first_seen_at = nowISO();
    await db().from(table).insert(row);
    created = true;
  }

  // time-series snapshot
  await db()
    .from(TABLES.snapshots)
    .insert({
      reel_url: r.url,
      source: isOur ? "Our" : "Inspiration",
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      saves: r.saves,
      followers,
      engagement_rate: engagementRate(r),
      view_follow_ratio: viewFollowRatio(r.views, followers),
      snapshot_at: nowISO(),
    });

  return { reel: r, created };
}
