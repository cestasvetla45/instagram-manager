// ─────────────────────────────────────────────────────────────
//  RockSolidAPIs adapter — Instagram Scraper Stable API
//  Docs: https://rocksolidapis.auto-poster.co.uk/instagram-scraper-stable-api-docs
//  Server: https://auto-poster.co.uk/yt_api
//  Auth:   header  AP_API_KEY: <key>
//
//  Reel flow (from a URL we only have the shortcode, so two calls):
//    1. media_data_id.php?media_code=<shortcode>   -> { media_id }
//    2. get_media_data_v2.php?media_id=<id>         -> full media object
//  Profile:
//    ig_get_fb_profile.php (POST username_or_url, data=basic)
// ─────────────────────────────────────────────────────────────

const BASE = (process.env.ROCKSOLID_BASE_URL || "https://auto-poster.co.uk/yt_api").replace(/\/$/, "");
const AUTH_HEADER = process.env.ROCKSOLID_AUTH_HEADER || "AP_API_KEY";

// Two API keys with round-robin rotation to maximize throughput:
//   KEY_1 (new, 350 calls/min) + KEY_2 (old, 50 calls/min) = 400 calls/min.
const KEY_1 = process.env.ROCKSOLID_API_KEY || "";
const KEY_2 = process.env.ROCKSOLID_API_KEY_2 || process.env.ROCKSOLID_OLD_API_KEY || "";
const KEYS = [KEY_1, KEY_2].filter(Boolean);
let keyIndex = 0;

function nextKey(): string {
  if (KEYS.length === 0) throw new Error("No RockSolidAPIs keys configured");
  const key = KEYS[keyIndex % KEYS.length];
  keyIndex++;
  return key;
}

export type NormalizedReel = {
  url: string;
  shortcode: string;
  mediaId: string;
  authorHandle: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  durationSec: number;
  postedDate: string | null; // YYYY-MM-DD
  postedAtISO: string | null; // full ISO timestamp
  thumbnailUrl: string | null;
  videoUrl: string | null;
  contentType: "reel" | "photo" | "carousel";
  raw: any;
};

export type NormalizedProfile = {
  username: string;
  fullName: string;
  bio: string;
  followers: number;
  following: number;
  postsCount: number;
  profilePicUrl: string | null;
  raw: any;
};

export function rockSolidConfigured(): boolean {
  return Boolean(BASE && KEYS.length);
}

// ─── In-memory API call tracking (resets on deploy — fine for dashboard) ───
const g = globalThis as any;
const stats = g.__apiStats || (g.__apiStats = {
  totalCalls: 0,
  successCalls: 0,
  failedCalls: 0,
  rateLimited: 0,
  callsPerMinute: [] as { ts: number; ok: boolean }[],
  byEndpoint: {} as Record<string, { total: number; success: number; fail: number }>,
  lastCallAt: 0,
  startedAt: Date.now(),
});

function recordCall(endpoint: string, ok: boolean, rateLimited: boolean = false) {
  stats.totalCalls++;
  if (ok) stats.successCalls++; else stats.failedCalls++;
  if (rateLimited) stats.rateLimited++;
  const now = Date.now();
  stats.callsPerMinute.push({ ts: now, ok });
  // Keep only last 5 minutes of data
  stats.callsPerMinute = stats.callsPerMinute.filter((c: any) => now - c.ts < 300000);
  if (!stats.byEndpoint[endpoint]) stats.byEndpoint[endpoint] = { total: 0, success: 0, fail: 0 };
  stats.byEndpoint[endpoint].total++;
  if (ok) stats.byEndpoint[endpoint].success++; else stats.byEndpoint[endpoint].fail++;
  stats.lastCallAt = now;
}

export function getApiStats() {
  const now = Date.now();
  const last5min = stats.callsPerMinute.filter((c: any) => now - c.ts < 300000);
  const last1min = last5min.filter((c: any) => now - c.ts < 60000);
  return {
    totalCalls: stats.totalCalls,
    successCalls: stats.successCalls,
    failedCalls: stats.failedCalls,
    rateLimited: stats.rateLimited,
    callsLastMinute: last1min.length,
    callsLast5Min: last5min.length,
    successRate: stats.totalCalls ? ((stats.successCalls / stats.totalCalls) * 100).toFixed(1) + "%" : "—",
    byEndpoint: stats.byEndpoint,
    lastCallSecondsAgo: stats.lastCallAt ? Math.floor((now - stats.lastCallAt) / 1000) : null,
    uptimeMinutes: Math.floor((now - stats.startedAt) / 60000),
  };
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { [AUTH_HEADER]: nextKey(), ...extra };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_RETRIES = Number(process.env.ROCKSOLID_MAX_RETRIES || 4);

// Hard per-request timeout: a hung/slow provider fetch would otherwise stall
// the entire worker cycle indefinitely.
const FETCH_TIMEOUT_MS = Number(process.env.ROCKSOLID_FETCH_TIMEOUT_MS || 30000);

// Global rate limiter: space calls ~150ms apart = ~400/min = 24k/hour.
// Shared across every request in the process so bursts don't trip 429s.
const RATE_LIMIT_MS = Number(process.env.ROCKSOLID_RATE_LIMIT_MS || 150);
let lastRequestTime = 0;
let rateChain: Promise<void> = Promise.resolve();

// Serialize the throttle so concurrent callers each get their own slot
// (otherwise they'd all read the same lastRequestTime and fire together).
function rateLimit(): Promise<void> {
  rateChain = rateChain.then(async () => {
    const elapsed = Date.now() - lastRequestTime;
    if (elapsed < RATE_LIMIT_MS) await sleep(RATE_LIMIT_MS - elapsed);
    lastRequestTime = Date.now();
  });
  return rateChain;
}

// The provider rate-limits aggressively and returns 429 either as an HTTP
// status or as a 200 body like {"error":"... 429 Too Many Requests"}. Retry
// both with exponential backoff + jitter so bulk pastes & refreshes don't drop reels.
function isRateLimited(status: number, json: any): boolean {
  if (status === 429) return true;
  const e = json && json.error ? String(json.error) : "";
  return /429|too many requests|rate/i.test(e);
}

async function request(
  endpoint: string,
  init: RequestInit,
  qs = ""
): Promise<any> {
  if (!rockSolidConfigured()) {
    throw new Error("RockSolidAPIs not configured. Set ROCKSOLID_API_KEY (and ROCKSOLID_BASE_URL).");
  }
  const url = `${BASE}/${endpoint}${qs}`;
  let lastErr = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let status = 0;
    let json: any = null;
    await rateLimit();
    // Per-request timeout: without this a hung/slow provider fetch would stall
    // the entire worker cycle indefinitely.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
      status = res.status;
      const text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        lastErr = `returned non-JSON: ${text.slice(0, 160)}`;
        json = null;
      }
    } catch (e: any) {
      lastErr = e?.name === "AbortError" ? `request timed out after ${FETCH_TIMEOUT_MS}ms` : e?.message || String(e);
    } finally {
      clearTimeout(timeout);
    }

    const rl = isRateLimited(status, json);
    if (json && !rl && !json.error) {
      recordCall(endpoint, true);
      return json;
    }
    if (json && json.error && !rl) {
      recordCall(endpoint, false);
      throw new Error(`RockSolidAPIs ${endpoint}: ${json.error}`);
    }
    if (json && json.error) lastErr = String(json.error);

    // rate-limited or transient failure → count it, back off and retry
    recordCall(endpoint, false, rl);
    if (attempt < MAX_RETRIES) {
      const wait = Math.min(1500 * 2 ** attempt, 12000) + Math.floor(Math.random() * 600);
      await sleep(wait);
    }
  }
  throw new Error(`RockSolidAPIs ${endpoint}: ${lastErr || "failed after retries"}`);
}

async function getJson(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = "?" + new URLSearchParams(params).toString();
  return request(endpoint, { headers: headers() }, qs);
}

async function postJson(endpoint: string, body: Record<string, string>): Promise<any> {
  return request(endpoint, {
    method: "POST",
    headers: headers({ "Content-Type": "application/x-www-form-urlencoded" }),
    body: new URLSearchParams(body).toString(),
  });
}

// ---- small helpers ----
function num(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return Math.round(v);
  const n = parseInt(String(v).replace(/[^\d.-]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}
function str(v: any): string {
  return v == null ? "" : String(v);
}
function tsToDate(ts: any): string | null {
  if (!ts) return null;
  const n = Number(ts);
  if (!n) return null;
  const d = new Date(n > 1e12 ? n : n * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function tsToISO(ts: any): string | null {
  if (!ts) return null;
  const n = Number(ts);
  if (!n) return null;
  const d = new Date(n > 1e12 ? n : n * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function extractShortcode(urlOrCode: string): string {
  const m = String(urlOrCode).match(/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  // already a bare shortcode?
  if (/^[A-Za-z0-9_-]{5,}$/.test(urlOrCode) && !urlOrCode.includes("/")) return urlOrCode;
  return "";
}

// ---- public API ----

async function shortcodeToId(shortcode: string): Promise<string> {
  const data = await getJson("media_data_id.php", { media_code: shortcode });
  const id = str(data.media_id || data.id || data.pk);
  if (!id) throw new Error(`Could not resolve media_id for shortcode ${shortcode}`);
  return id;
}

export async function scrapeReel(reelUrl: string): Promise<NormalizedReel> {
  const shortcode = extractShortcode(reelUrl);
  if (!shortcode) throw new Error(`Could not parse a shortcode from: ${reelUrl}`);

  // Primary: get_media_data_v2.php (has view_count). Fallback: get_media_data.php
  // (the "Detailed Media Data" endpoint — used when v2 is under maintenance).
  let d: any = null;
  let usedFallback = false;
  try {
    const mediaId = await shortcodeToId(shortcode);
    d = await getJson("get_media_data_v2.php", { media_id: mediaId });
  } catch (e: any) {
    // v2 failed (maintenance?) — use the detailed endpoint instead
    const msg = String(e?.message || e || "");
    if (msg.includes("maintenance") || msg.includes("Endpoint") || msg.includes("failed after retries")) {
      d = await getJson("get_media_data.php", {
        reel_post_code_or_url: `https://www.instagram.com/reel/${shortcode}/`,
        type: "reel",
      });
      usedFallback = true;
    } else {
      throw e;
    }
  }

  const caption =
    d?.edge_media_to_caption?.edges?.[0]?.node?.text ??
    (typeof d?.caption === "object" ? d?.caption?.text : d?.caption) ??
    d?.title ??
    "";

  // View count: v2 has video_play_count/video_view_count/play_count.
  // The fallback (get_media_data.php) doesn't have view_count — set to 0.
  const views = usedFallback
    ? 0  // fallback endpoint doesn't return view count
    : num(d.video_play_count || d.video_view_count || d.play_count || d.view_count);

  // Thumbnail: v2 uses display_url/thumbnail_src; fallback uses image_versions2
  const thumbnailUrl = usedFallback
    ? str(d?.image_versions2?.candidates?.[0]?.url) || null
    : str(d.display_url || d.thumbnail_src || d.thumbnail_url) || null;

  // Video URL: v2 uses video_url; fallback uses video_versions[0].url
  const videoUrl = usedFallback
    ? str(d?.video_versions?.[0]?.url) || null
    : str(d.video_url) || null;

  // Owner: v2 uses d.owner.username; fallback uses d.user.username
  const authorHandle = usedFallback
    ? str(d?.user?.username || "").replace(/^@/, "")
    : str(d?.owner?.username || "").replace(/^@/, "");

  // Shares: v2 uses reshare_count; fallback uses media_repost_count
  const shares = usedFallback
    ? num(d?.media_repost_count)
    : num(d?.reshare_count ?? d?.share_count);

  return {
    url: `https://www.instagram.com/reel/${str(d.shortcode || d.code || shortcode)}/`,
    shortcode: str(d.shortcode || d.code || shortcode),
    mediaId: str(d.pk || d.id || ""),
    authorHandle,
    caption: str(caption),
    views,
    likes: num(d?.edge_media_preview_like?.count ?? d?.like_count),
    comments: num(
      d?.edge_media_to_parent_comment?.count ??
        d?.edge_media_preview_comment?.count ??
        d?.comment_count
    ),
    shares,
    saves: num(d?.save_count),
    durationSec: Math.round(num(d.video_duration)),
    postedDate: tsToDate(d.taken_at_timestamp || d.taken_at),
    postedAtISO: tsToISO(d.taken_at_timestamp || d.taken_at),
    thumbnailUrl,
    videoUrl,
    contentType: (() => {
      const isCarousel = d.__typename === "GraphSidecar" || d.media_type === 8 || Array.isArray(d.carousel_media) || Array.isArray(d?.edge_sidecar_to_children?.edges);
      const isVideo = Boolean(d.is_video ?? (d.media_type === 2) ?? d.video_url ?? d.video_versions) || d.product_type === "clips";
      return isCarousel ? "carousel" : isVideo ? "reel" : "photo";
    })(),
    raw: d,
  };
}

export async function scrapeProfile(username: string): Promise<NormalizedProfile> {
  const clean = username.replace(/^@/, "").trim();
  const d = await postJson("ig_get_fb_profile.php", { username_or_url: clean, data: "basic" });
  return {
    username: str(d.username || clean),
    fullName: str(d.full_name),
    bio: str(d.biography),
    followers: num(d.follower_count ?? d?.edge_followed_by?.count),
    following: num(d.following_count ?? d?.edge_follow?.count),
    postsCount: num(d.media_count ?? d?.edge_owner_to_timeline_media?.count),
    profilePicUrl: str(d.profile_pic_url_hd || d.profile_pic_url) || null,
    raw: d,
  };
}

// Pull a user's recent reels (used for bulk-importing an account's reels).
export type ReelStub = {
  url: string;
  shortcode: string;
  mediaId: string;
  authorHandle: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  thumbnailUrl: string | null;
  postedDate: string | null;
  postedAtISO: string | null;
  coauthors: string[]; // collab co-author usernames (discovery signal)
};

export async function scrapeUserReels(username: string, limit = 500): Promise<ReelStub[]> {
  const clean = username.replace(/^@/, "").trim();
  const out: ReelStub[] = [];
  let token = "";
  let pages = 0;
  // Page through all reels (12 per page) until exhausted, limit, or safety cap.
  while (out.length < limit && pages < 60) {
    pages++;
    const body: Record<string, string> = { username_or_url: clean };
    if (token) body.pagination_token = token;
    const data = await postJson("get_ig_user_reels.php", body);
    const items: any[] = data?.reels || data?.items || [];
    if (!items.length) break;
    pushReels(items, clean, out);
    token = str(data?.pagination_token || data?.next_max_id || "");
    if (!token) break;
  }
  return out.slice(0, limit);
}

// Instagram media pks encode the post time in their upper bits:
// timestamp_ms = (pk >> 23) + 1314220021721 (IG epoch). Accurate to ~2 min.
// The user-reels endpoint stopped returning taken_at, so this is the only
// way to get posted dates from the bulk feed.
const IG_EPOCH_MS = 1314220021721n;
function pkToMs(pk: string): number | null {
  const digits = String(pk || "").split("_")[0];
  if (!/^\d{10,}$/.test(digits)) return null;
  const ms = Number((BigInt(digits) >> 23n) + IG_EPOCH_MS);
  // sanity: between 2010 and tomorrow
  if (ms < 1262304000000 || ms > Date.now() + 86400000) return null;
  return ms;
}

function pushReels(items: any[], clean: string, out: ReelStub[]) {
  for (const it of items) {
    const m = it?.node?.media || it?.media || it?.node || it;
    if (!m) continue;
    const code = str(m.code || m.shortcode);
    const takenMs = pkToMs(str(m.pk || m.id));
    out.push({
      url: `https://www.instagram.com/reel/${code}/`,
      shortcode: code,
      mediaId: str(m.pk || m.id),
      authorHandle: str(m?.user?.username || clean),
      caption: str(m?.caption?.text ?? m?.caption_text ?? (typeof m?.caption === "string" ? m.caption : "")),
      views: num(m.play_count || m.view_count || m.ig_play_count),
      likes: num(m.like_count),
      comments: num(m.comment_count),
      thumbnailUrl: str(m?.image_versions2?.candidates?.[0]?.url) || null,
      postedDate: tsToDate(m.taken_at) ?? (takenMs ? new Date(takenMs).toISOString().slice(0, 10) : null),
      postedAtISO: tsToISO(m.taken_at) ?? (takenMs ? new Date(takenMs).toISOString() : null),
      coauthors: (Array.isArray(m?.coauthor_producers) ? m.coauthor_producers : [])
        .map((u: any) => str(u?.username).toLowerCase())
        .filter(Boolean),
    });
  }
  return out;
}

// ---- comments ----
// get_post_comments.php?media_code=<shortcode>&pagination_token=...
export async function scrapeComments(shortcode: string, maxPages = 12): Promise<string[]> {
  const out: string[] = [];
  let token = "";
  let pages = 0;
  while (pages < maxPages) {
    pages++;
    const params: Record<string, string> = { media_code: shortcode };
    if (token) params.pagination_token = token;
    let data: any;
    try {
      data = await getJson("get_post_comments.php", params);
    } catch {
      break;
    }
    const items: any[] = data?.comments || data?.data || [];
    if (!items.length) break;
    for (const c of items) {
      const t = str(c?.text || c?.comment || c?.content).replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
    token = str(data?.pagination_token || data?.next_min_id || "");
    if (!token) break;
  }
  return out;
}

// Commenter usernames on a post (creator-discovery signal — peers comment
// on peers). Same endpoint as scrapeComments but keeps the owner object.
export async function scrapeCommentUsers(
  shortcode: string,
  maxPages = 3
): Promise<{ username: string; id: string }[]> {
  const out: { username: string; id: string }[] = [];
  const seen = new Set<string>();
  let token = "";
  let pages = 0;
  while (pages < maxPages) {
    pages++;
    const params: Record<string, string> = { media_code: shortcode };
    if (token) params.pagination_token = token;
    let data: any;
    try {
      data = await getJson("get_post_comments.php", params);
    } catch {
      break;
    }
    const items: any[] = data?.comments || data?.data || [];
    if (!items.length) break;
    for (const c of items) {
      const o = c?.owner || c?.user || {};
      const u = str(o.username).toLowerCase();
      if (u && !seen.has(u)) {
        seen.add(u);
        out.push({ username: u, id: str(o.id || o.pk) });
      }
    }
    token = str(data?.pagination_token || data?.next_min_id || "");
    if (!token) break;
  }
  return out;
}
