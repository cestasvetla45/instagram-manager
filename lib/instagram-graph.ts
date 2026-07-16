// ─────────────────────────────────────────────────────────────
//  Instagram Graph API client — for OUR accounts only (Business/Creator).
//  Pulls deep insights: watch-time, reach, saves, shares, demographics.
//  Free (no RockSolidAPIs rate-limit cost). Falls back to the scraper
//  when INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_ACCOUNT_ID aren't set.
// ─────────────────────────────────────────────────────────────
import { db, TABLES } from "./db";

const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";
const ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID || "";
const BASE = "https://graph.facebook.com/v21.0";

export function graphConfigured(): boolean {
  return Boolean(ACCESS_TOKEN && ACCOUNT_ID);
}

// ── Raw API calls ─────────────────────────────────────────────

// Account info (username, followers, media count, avatar).
export async function getAccountInfo() {
  const url = `${BASE}/${ACCOUNT_ID}?fields=username,followers_count,media_count,profile_picture_url&access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url);
  return res.json();
}

// Media (reels/posts) for the account — basic stats, paginated one page.
export async function getMedia(limit = 50) {
  const fields =
    "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
  const url = `${BASE}/${ACCOUNT_ID}/media?fields=${fields}&limit=${limit}&access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url);
  return res.json();
}

// Deep insights for one media item. Graph is strict — an unknown metric
// fails the whole call — so we request a broad set and, on error, retry
// with a minimal set that every reel supports.
export async function getMediaInsights(mediaId: string): Promise<Record<string, number>> {
  const full =
    "reach,saved,shares,total_interactions,likes,comments,views,ig_reels_avg_watch_time,ig_reels_video_view_total_time";
  const minimal = "reach,saved,shares";
  let flat = await fetchInsights(`${BASE}/${mediaId}/insights?metric=${full}&access_token=${ACCESS_TOKEN}`);
  if (flat === null) {
    flat = await fetchInsights(`${BASE}/${mediaId}/insights?metric=${minimal}&access_token=${ACCESS_TOKEN}`);
  }
  return flat || {};
}

// Account-level daily metrics (reach, profile views, follower count…).
export async function getAccountInsights(since?: string) {
  const sinceDate = since || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const metrics = "reach,profile_views,follower_count,website_clicks";
  const url = `${BASE}/${ACCOUNT_ID}/insights?metric=${metrics}&period=day&since=${sinceDate}&access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url);
  return res.json();
}

// Audience demographics (age, gender, country). Account-level, lifetime.
export async function getAudienceDemographics(): Promise<any> {
  const metrics = "engaged_audience_demographics,reached_audience_demographics,follower_demographics";
  const url =
    `${BASE}/${ACCOUNT_ID}/insights?metric=${metrics}&period=lifetime` +
    `&metric_type=total_value&breakdown=country&access_token=${ACCESS_TOKEN}`;
  try {
    const res = await fetch(url);
    const j = await res.json();
    if (j?.error) return null;
    return j?.data || null;
  } catch {
    return null;
  }
}

// ── helpers ───────────────────────────────────────────────────

// Fetch an /insights URL and flatten data[] into { metricName: value }.
// Returns null when the call errors (so the caller can retry / skip).
async function fetchInsights(url: string): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(url);
    const j = await res.json();
    if (j?.error || !Array.isArray(j?.data)) return null;
    const out: Record<string, number> = {};
    for (const m of j.data) {
      const name = m?.name;
      // Simple metrics expose values[0].value; total_value metrics expose total_value.
      const v =
        m?.total_value?.value ??
        (Array.isArray(m?.values) ? m.values[m.values.length - 1]?.value : undefined);
      if (name != null && typeof v === "number") out[name] = v;
    }
    return out;
  } catch {
    return null;
  }
}

// Instagram shortcode from a permalink (…/reel/<code>/ or …/p/<code>/).
function shortcodeFromPermalink(permalink: string): string {
  const m = String(permalink || "").match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : "";
}

// Is this media item a reel/video (has watch-time / retention data)?
function isReel(media: any): boolean {
  const t = String(media?.media_type || "").toUpperCase();
  const p = String(media?.media_product_type || "").toUpperCase();
  return t === "VIDEO" || p === "REELS";
}

// Find-or-update our_reels by shortcode (preferred) then reel_url.
// accountHandle is known for OAuth-connected accounts; the global-token
// path leaves it undefined (unchanged behaviour).
async function upsertOurReel(media: any, insights: Record<string, number>, accountHandle?: string) {
  const permalink: string = media?.permalink || "";
  if (!permalink) return;
  const shortcode = shortcodeFromPermalink(permalink);
  const views = insights.views ?? insights.reach ?? 0;
  const likes = media?.like_count ?? insights.likes ?? 0;
  const comments = media?.comments_count ?? insights.comments ?? 0;

  const stats: Record<string, any> = {
    views: Number(views || 0),
    likes: Number(likes || 0),
    comments: Number(comments || 0),
    shares: Number(insights.shares || 0),
    saves: Number(insights.saved || 0),
    updated_at: new Date().toISOString(),
  };
  if (accountHandle) stats.account_handle = accountHandle;

  // Match an existing row by shortcode first (URL formats vary), then reel_url.
  let existingId: string | undefined;
  if (shortcode) {
    const { data } = await db().from(TABLES.ourReels).select("id").eq("shortcode", shortcode).limit(1);
    existingId = data?.[0]?.id;
  }
  if (!existingId) {
    const { data } = await db().from(TABLES.ourReels).select("id").eq("reel_url", permalink).limit(1);
    existingId = data?.[0]?.id;
  }

  if (existingId) {
    await db().from(TABLES.ourReels).update(stats).eq("id", existingId);
  } else {
    await db()
      .from(TABLES.ourReels)
      .upsert(
        {
          reel_url: permalink,
          shortcode: shortcode || null,
          caption: media?.caption || null,
          thumbnail_url: media?.thumbnail_url || media?.media_url || null,
          posted_at: media?.timestamp || null,
          inspiration_source: "graph-api",
          ...stats,
        },
        { onConflict: "reel_url" }
      );
  }
}

// Find-or-insert a reel_performance row for a reel and write its deep data.
async function upsertReelPerformance(
  media: any,
  insights: Record<string, number>,
  demographics: any,
  accountHandle: string
) {
  const permalink: string = media?.permalink || "";
  if (!permalink) return;
  const shortcode = shortcodeFromPermalink(permalink);

  const fields: any = {
    account_handle: accountHandle || "unknown",
    views_24h: Number(insights.views ?? insights.reach ?? 0),
    likes_24h: Number(media?.like_count ?? insights.likes ?? 0),
    comments_24h: Number(media?.comments_count ?? insights.comments ?? 0),
    shares_24h: Number(insights.shares || 0),
    saves_24h: Number(insights.saved || 0),
    posted_at: media?.timestamp || null,
    status: "analyzed",
    ai_analyzed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (demographics) fields.demographics = demographics;

  // Retention from average watch time (ms) when we can derive video length.
  const avgWatchMs = Number(insights.ig_reels_avg_watch_time || 0);
  const totalWatchMs = Number(insights.ig_reels_video_view_total_time || 0);
  const plays = Number(insights.views ?? insights.reach ?? 0);
  if (avgWatchMs > 0 && totalWatchMs > 0 && plays > 0) {
    // Best-effort: average watch time relative to the longest observed watch.
    const est = (avgWatchMs / (totalWatchMs / plays)) * 100;
    if (Number.isFinite(est) && est > 0) fields.avg_retention = Math.min(100, Number(est.toFixed(1)));
  }

  // Match an existing performance row by exact permalink, then by shortcode.
  let existingId: string | undefined;
  const { data: byUrl } = await db().from("reel_performance").select("id").eq("reel_url", permalink).limit(1);
  existingId = byUrl?.[0]?.id;
  if (!existingId && shortcode) {
    const { data: byCode } = await db()
      .from("reel_performance")
      .select("id")
      .ilike("reel_url", `%${shortcode}%`)
      .limit(1);
    existingId = byCode?.[0]?.id;
  }

  if (existingId) {
    await db().from("reel_performance").update(fields).eq("id", existingId);
  } else {
    await db().from("reel_performance").insert({ reel_url: permalink, ...fields });
  }
}

// ── Sync core ─────────────────────────────────────────────────
// Pulls all reels for the connected account and stores basic stats
// (our_reels) + deep insights (reel_performance). Shared by the API
// route and the worker refresh cycle.
export async function syncGraphInsights(limit = 50): Promise<{
  ok: boolean;
  account?: string;
  media: number;
  reels: number;
  updated: number;
  failed: number;
  error?: string;
}> {
  if (!graphConfigured()) {
    return { ok: false, media: 0, reels: 0, updated: 0, failed: 0, error: "Graph API not configured" };
  }

  const info = await getAccountInfo();
  if (info?.error) {
    return { ok: false, media: 0, reels: 0, updated: 0, failed: 0, error: info.error.message || "getAccountInfo failed" };
  }
  const handle = String(info?.username || "").toLowerCase();

  const mediaRes = await getMedia(limit);
  if (mediaRes?.error) {
    return { ok: false, account: handle, media: 0, reels: 0, updated: 0, failed: 0, error: mediaRes.error.message || "getMedia failed" };
  }
  const items: any[] = Array.isArray(mediaRes?.data) ? mediaRes.data : [];

  // Account-level demographics once (per-reel demographics aren't exposed).
  const demographics = await getAudienceDemographics();

  let reels = 0;
  let updated = 0;
  let failed = 0;
  for (const media of items) {
    try {
      const insights = await getMediaInsights(media.id);
      await upsertOurReel(media, insights);
      if (isReel(media)) {
        reels++;
        await upsertReelPerformance(media, insights, demographics, handle);
      }
      updated++;
    } catch (e) {
      failed++;
      console.error("graph sync item failed:", media?.id, (e as any)?.message || e);
    }
  }

  return { ok: true, account: handle, media: items.length, reels, updated, failed };
}

// ═══════════════════════════════════════════════════════════════
//  OAuth "Connect Instagram Account" flow — one Meta app, many users.
//  Each user logs in with their own Instagram; we store a long-lived
//  (~60-day) token per account in the instagram_tokens table and pull
//  insights on their behalf. This is separate from the single global
//  INSTAGRAM_ACCESS_TOKEN path above (which still works as a fallback).
// ═══════════════════════════════════════════════════════════════

const META_APP_ID = process.env.META_APP_ID || "";
const META_APP_SECRET = process.env.META_APP_SECRET || "";
const REDIRECT_URI = `${
  process.env.NEXT_PUBLIC_APP_URL || "https://instagram-tool-production-e4f2.up.railway.app"
}/api/instagram-graph/callback`;

export function oauthConfigured(): boolean {
  return Boolean(META_APP_ID && META_APP_SECRET);
}

// Generate the OAuth URL for the user to log in. Business/Creator IG
// accounts authenticate through Facebook Login (the account must be
// linked to a Facebook Page) — api.instagram.com only accepts Basic
// Display scopes and rejects these, so the dialog must be facebook.com.
export function getOAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: "instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement",
    response_type: "code",
    ...(state ? { state } : {}),
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

// Exchange the authorization code for a short-lived USER token.
// Response: { access_token, token_type, expires_in } | { error }.
export async function exchangeCodeForToken(code: string): Promise<any> {
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    redirect_uri: REDIRECT_URI,
    code,
  });
  const res = await fetch(`${BASE}/oauth/access_token?${params.toString()}`);
  return res.json();
}

// Exchange a short-lived user token for a long-lived one (~60 days).
export async function getLongLivedToken(shortToken: string): Promise<any> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${BASE}/oauth/access_token?${params.toString()}`);
  return res.json();
}

// Refresh a long-lived token (fb_exchange_token also accepts a still-valid
// long-lived token and returns a fresh 60-day one).
export async function refreshLongLivedToken(token: string): Promise<any> {
  return getLongLivedToken(token);
}

// The user's Facebook Pages — each carries its own page access_token.
export async function getUserPages(userToken: string): Promise<any> {
  const url = `${BASE}/me/accounts?fields=id,name,access_token&limit=100&access_token=${userToken}`;
  const res = await fetch(url);
  return res.json();
}

// The Instagram Business/Creator account linked to a Page (if any).
export async function getPageIGAccount(pageId: string, pageToken: string): Promise<any> {
  const url =
    `${BASE}/${pageId}?fields=instagram_business_account{id,username,followers_count,media_count}` +
    `&access_token=${pageToken}`;
  const res = await fetch(url);
  return res.json();
}

// Get the Instagram account profile (username, follower count).
export async function getIGProfile(token: string, igAccountId: string): Promise<any> {
  const url = `${BASE}/${igAccountId}?fields=username,media_count,followers_count,profile_picture_url&access_token=${token}`;
  const res = await fetch(url);
  return res.json();
}

// Get media (reels/posts) for the connected account.
export async function getIGMedia(token: string, igAccountId: string, limit = 50): Promise<any> {
  const fields =
    "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
  const url = `${BASE}/${igAccountId}/media?fields=${fields}&limit=${limit}&access_token=${token}`;
  const res = await fetch(url);
  return res.json();
}

// Get insights for a specific media item. Graph is strict — an unknown
// metric fails the whole call — so we try a broad reel set and fall back
// to a minimal set every media type supports.
export async function getIGMediaInsights(token: string, mediaId: string): Promise<any> {
  const full = "reach,likes,comments,saved,shares,total_interactions,views,ig_reels_avg_watch_time,ig_reels_video_view_total_time";
  const minimal = "reach,saved,shares";
  let res = await fetch(`${BASE}/${mediaId}/insights?metric=${full}&access_token=${token}`);
  let j = await res.json();
  if (j?.error) {
    res = await fetch(`${BASE}/${mediaId}/insights?metric=${minimal}&access_token=${token}`);
    j = await res.json();
  }
  return j;
}

// Get account-level insights (daily reach, profile views, follower count).
export async function getIGAccountInsights(token: string, igAccountId: string, since?: string): Promise<any> {
  const sinceDate = since || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const metrics = "reach,profile_views,follower_count";
  const url = `${BASE}/${igAccountId}/insights?metric=${metrics}&period=day&since=${sinceDate}&access_token=${token}`;
  const res = await fetch(url);
  return res.json();
}

// Get audience demographics (country/city/age/gender), lifetime.
export async function getIGAudienceDemographics(token: string, igAccountId: string): Promise<any> {
  const metrics = "engaged_audience_demographics,follower_demographics";
  const url =
    `${BASE}/${igAccountId}/insights?metric=${metrics}&period=lifetime` +
    `&metric_type=total_value&breakdown=country&access_token=${token}`;
  try {
    const res = await fetch(url);
    const j = await res.json();
    if (j?.error) return null;
    return j?.data || null;
  } catch {
    return null;
  }
}

// ── Connected-account sync ────────────────────────────────────
// Flatten an /insights response and normalise the Instagram-Login metric
// names to the keys upsertOurReel / upsertReelPerformance already expect.
function normalizeIGInsights(raw: any): Record<string, number> {
  const flat: Record<string, number> = {};
  const data = Array.isArray(raw?.data) ? raw.data : [];
  for (const m of data) {
    const name = m?.name;
    const v =
      m?.total_value?.value ??
      (Array.isArray(m?.values) ? m.values[m.values.length - 1]?.value : undefined);
    if (name != null && typeof v === "number") flat[name] = v;
  }
  return {
    ...flat,
    views: flat.views ?? flat.total_views ?? flat.video_views ?? flat.reach ?? 0,
    reach: flat.reach ?? flat.views ?? 0,
    likes: flat.likes ?? 0,
    comments: flat.comments ?? 0,
    shares: flat.shares ?? 0,
    saved: flat.saved ?? flat.saves ?? 0,
    ig_reels_avg_watch_time: flat.ig_reels_avg_watch_time ?? flat.avg_watch_time ?? 0,
  };
}

// A token is "expiring soon" (and worth refreshing) inside `days` of expiry.
export function tokenExpiringSoon(expiresAt: string | null | undefined, days = 7): boolean {
  if (!expiresAt) return false;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return ms < days * 86400000;
}

// Refresh a stored token when it's within 7 days of expiry, persisting the
// new token + expiry. Returns the token to use (fresh or existing).
async function ensureFreshToken(row: any): Promise<string> {
  let token = row.access_token as string;
  if (!tokenExpiringSoon(row.token_expires_at, 7)) return token;
  try {
    const refreshed = await refreshLongLivedToken(token);
    if (refreshed?.access_token) {
      token = refreshed.access_token;
      const expires = new Date(Date.now() + (Number(refreshed.expires_in) || 5184000) * 1000).toISOString();
      await db()
        .from("instagram_tokens")
        .update({ access_token: token, token_expires_at: expires, updated_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  } catch (e) {
    console.error("token refresh failed:", row.account_handle, (e as any)?.message || e);
  }
  return token;
}

// Sync one connected account: refresh token if needed, pull media + insights,
// write our_reels + reel_performance, and stamp last_synced_at.
export async function syncConnectedAccount(row: any, limit = 50): Promise<{
  ok: boolean;
  account: string;
  media: number;
  reels: number;
  updated: number;
  failed: number;
  error?: string;
}> {
  const token = await ensureFreshToken(row);
  const igAccountId = String(row.ig_account_id || "");
  if (!igAccountId) {
    return {
      ok: false,
      account: String(row.account_handle || row.ig_username || ""),
      media: 0, reels: 0, updated: 0, failed: 0,
      error: "No ig_account_id stored — reconnect the account.",
    };
  }

  // Refresh follower count / username from the live profile.
  const profile = await getIGProfile(token, igAccountId).catch(() => null);
  const handle = String(row.account_handle || profile?.username || row.ig_username || "").toLowerCase();
  const followers = Number(profile?.followers_count ?? row.follower_count ?? 0);

  const mediaRes = await getIGMedia(token, igAccountId, limit);
  if (mediaRes?.error) {
    // Stamp the attempt so the UI shows we tried; surface the error.
    await db()
      .from("instagram_tokens")
      .update({
        ig_username: profile?.username || row.ig_username,
        follower_count: followers,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return { ok: false, account: handle, media: 0, reels: 0, updated: 0, failed: 0, error: mediaRes.error.message || "getIGMedia failed" };
  }
  const items: any[] = Array.isArray(mediaRes?.data) ? mediaRes.data : [];
  const demographics = await getIGAudienceDemographics(token, igAccountId);

  let reels = 0;
  let updated = 0;
  let failed = 0;
  for (const media of items) {
    try {
      const insights = normalizeIGInsights(await getIGMediaInsights(token, media.id));
      await upsertOurReel(media, insights, handle);
      if (isReel(media)) {
        reels++;
        await upsertReelPerformance(media, insights, demographics, handle);
      }
      updated++;
    } catch (e) {
      failed++;
      console.error("connected sync item failed:", media?.id, (e as any)?.message || e);
    }
  }

  await db()
    .from("instagram_tokens")
    .update({
      ig_username: profile?.username || row.ig_username,
      follower_count: followers,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  return { ok: true, account: handle, media: items.length, reels, updated, failed };
}

// Sync ALL active connected accounts. Used by the sync API route and worker.
export async function syncConnectedAccounts(limit = 50): Promise<{
  ok: boolean;
  accounts: number;
  reels: number;
  updated: number;
  failed: number;
  results: any[];
}> {
  const { data: tokens } = await db().from("instagram_tokens").select("*").eq("is_active", true);
  const rows = tokens || [];
  let reels = 0;
  let updated = 0;
  let failed = 0;
  const results: any[] = [];
  for (const row of rows) {
    try {
      const r = await syncConnectedAccount(row, limit);
      results.push(r);
      reels += r.reels;
      updated += r.updated;
      failed += r.failed;
    } catch (e: any) {
      failed++;
      results.push({ ok: false, account: row.account_handle, error: e?.message || String(e) });
    }
  }
  return { ok: true, accounts: rows.length, reels, updated, failed, results };
}

// Count of active connected accounts — used to decide Graph-vs-scraper path.
export async function hasConnectedAccounts(): Promise<boolean> {
  try {
    const { count } = await db()
      .from("instagram_tokens")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    return (count || 0) > 0;
  } catch {
    return false;
  }
}
