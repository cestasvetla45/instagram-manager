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
const KEY = process.env.ROCKSOLID_API_KEY || "";
const AUTH_HEADER = process.env.ROCKSOLID_AUTH_HEADER || "AP_API_KEY";

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
  thumbnailUrl: string | null;
  videoUrl: string | null;
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
  return Boolean(BASE && KEY);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { [AUTH_HEADER]: KEY, ...extra };
}

async function getJson(endpoint: string, params: Record<string, string>): Promise<any> {
  if (!rockSolidConfigured()) {
    throw new Error("RockSolidAPIs not configured. Set ROCKSOLID_API_KEY (and ROCKSOLID_BASE_URL).");
  }
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/${endpoint}?${qs}`, { headers: headers(), cache: "no-store" });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`RockSolidAPIs ${endpoint} returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (json && json.error) throw new Error(`RockSolidAPIs ${endpoint}: ${json.error}`);
  return json;
}

async function postJson(endpoint: string, body: Record<string, string>): Promise<any> {
  if (!rockSolidConfigured()) {
    throw new Error("RockSolidAPIs not configured. Set ROCKSOLID_API_KEY (and ROCKSOLID_BASE_URL).");
  }
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/x-www-form-urlencoded" }),
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`RockSolidAPIs ${endpoint} returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (json && json.error) throw new Error(`RockSolidAPIs ${endpoint}: ${json.error}`);
  return json;
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
  const mediaId = await shortcodeToId(shortcode);
  const d = await getJson("get_media_data_v2.php", { media_id: mediaId });

  const caption =
    d?.edge_media_to_caption?.edges?.[0]?.node?.text ??
    (typeof d?.caption === "object" ? d?.caption?.text : d?.caption) ??
    d?.title ??
    "";

  return {
    url: `https://www.instagram.com/reel/${str(d.shortcode || shortcode)}/`,
    shortcode: str(d.shortcode || shortcode),
    mediaId,
    authorHandle: str(d?.owner?.username || "").replace(/^@/, ""),
    caption: str(caption),
    // Instagram surfaces play_count as "views" for reels.
    views: num(d.video_play_count || d.video_view_count || d.play_count || d.view_count),
    likes: num(d?.edge_media_preview_like?.count ?? d?.like_count),
    comments: num(
      d?.edge_media_to_parent_comment?.count ??
        d?.edge_media_preview_comment?.count ??
        d?.comment_count
    ),
    shares: num(d?.reshare_count ?? d?.share_count),
    saves: num(d?.save_count),
    durationSec: Math.round(num(d.video_duration)),
    postedDate: tsToDate(d.taken_at_timestamp || d.taken_at),
    thumbnailUrl: str(d.display_url || d.thumbnail_src || d.thumbnail_url) || null,
    videoUrl: str(d.video_url) || null,
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
};

export async function scrapeUserReels(username: string, limit = 24): Promise<ReelStub[]> {
  const clean = username.replace(/^@/, "").trim();
  const data = await postJson("get_ig_user_reels.php", { username_or_url: clean });
  const items: any[] = data?.reels || data?.items || [];
  const out: ReelStub[] = [];
  for (const it of items.slice(0, limit)) {
    const m = it?.node?.media || it?.media || it?.node || it;
    if (!m) continue;
    const code = str(m.code || m.shortcode);
    out.push({
      url: `https://www.instagram.com/reel/${code}/`,
      shortcode: code,
      mediaId: str(m.pk || m.id),
      authorHandle: str(m?.user?.username || clean),
      caption: str(m?.caption?.text || ""),
      views: num(m.play_count || m.view_count || m.ig_play_count),
      likes: num(m.like_count),
      comments: num(m.comment_count),
      thumbnailUrl: str(m?.image_versions2?.candidates?.[0]?.url) || null,
      postedDate: tsToDate(m.taken_at),
    });
  }
  return out;
}
