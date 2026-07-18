// ─────────────────────────────────────────────────────────────
//  Supabase data layer.
//  Columns are snake_case in Postgres; the *toFields() mappers
//  return the same Airtable-style shape the frontend already uses
//  ({ id, fields: { "Reel URL": ... } }) so the UI is unchanged.
// ─────────────────────────────────────────────────────────────
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function dbConfigured(): boolean {
  return Boolean(URL && KEY);
}

let _client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!dbConfigured()) {
    throw new Error("Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (!_client) {
    _client = createClient(URL, KEY, {
      auth: { persistSession: false },
      global: { headers: { "x-connection-pooler": "true" } },
    });
  }
  return _client;
}

export const TABLES = {
  inspirationReels: "inspiration_reels",
  inspirationAccounts: "inspiration_accounts",
  ourAccounts: "our_accounts",
  ourReels: "our_reels",
  snapshots: "metric_snapshots",
  accountSnapshots: "account_snapshots",
};
export const REELS_BUCKET = "reels";

// ---------- row → fields (Airtable-style) mappers ----------
const att = (url: string | null) => url || undefined;

export function reelToFields(r: any, isOur: boolean) {
  return {
    id: r.id,
    fields: {
      "Reel URL": r.reel_url,
      Shortcode: r.shortcode,
      [isOur ? "Account Handle" : "Author Handle"]: isOur ? r.account_handle : r.author_handle,
      Caption: r.caption,
      Views: Number(r.views || 0),
      Likes: Number(r.likes || 0),
      Comments: Number(r.comments || 0),
      Shares: Number(r.shares || 0),
      Saves: Number(r.saves || 0),
      "Engagement Rate": Number(r.engagement_rate || 0),
      "Followers At Scrape": Number(r.followers_at_scrape || 0),
      "View/Follow Ratio": Number(r.view_follow_ratio || 0),
      "Duration (s)": Number(r.duration_sec || 0),
      "Posted Date": r.posted_date,
      "Posted At": r.posted_at,
      Thumbnail: att(r.thumbnail_url),
      Video: att(r.video_url),
      Niche: r.niche,
      Status: r.status,
      Tags: r.tags || [],
      "Refresh Count": Number(r.refresh_count || 0),
      "Date Scraped": r.date_scraped,
      "First Seen At": r.first_seen_at,
      Score: r.inspiration_score != null ? Number(r.inspiration_score) : null,
      "Downloaded At": r.downloaded_at,
      "Views At Download": r.views_at_download != null ? Number(r.views_at_download) : null,
      "Likes At Download": r.likes_at_download != null ? Number(r.likes_at_download) : null,
      "Comments At Download": r.comments_at_download != null ? Number(r.comments_at_download) : null,
      "Followers At Download": r.followers_at_download != null ? Number(r.followers_at_download) : null,
      "AI Suggested Niche": r.ai_suggested_niche || null,
      "AI Confidence": r.ai_confidence != null ? Number(r.ai_confidence) : null,
      "AI Reason": r.ai_reason || null,
      "AI Is New": r.ai_is_new ?? null,
      "Content Type": r.content_type || "reel",
      Format: r.format || null,
      "Format Source": r.format_source || null,
      "Sub Category": r.sub_category,
      "Sub Category Confidence": r.sub_category_confidence != null ? Number(r.sub_category_confidence) : null,
      "Categorization Notes": r.categorization_notes || null,
      "Tray": r.tray,
      "Is Viral": r.is_viral,
      "Viral Score": r.viral_score != null ? Number(r.viral_score) : null,
      "Trend Velocity": r.trend_velocity != null ? Number(r.trend_velocity) : null,
      "Is Winner": r.is_winner ?? false,
      "Note": r.note || null,
    },
  };
}

export function accountToFields(r: any) {
  return {
    id: r.id,
    fields: {
      Handle: r.handle,
      "Profile URL": r.profile_url,
      "Full Name": r.full_name,
      Niche: r.niche,
      Followers: Number(r.followers || 0),
      Following: Number(r.following || 0),
      "Posts Count": Number(r.posts_count || 0),
      Bio: r.bio,
      "Why Saved": r.why_saved,
      "Profile Pic": att(r.profile_pic_url),
      Notes: r.notes,
      "Date Added": r.date_added,
      // Archived accounts still come back from this endpoint — consumers that
      // build "active roster" views (dashboard, growth, top-reels, overview)
      // should filter on this. our_accounts uses `active`, inspiration_accounts
      // uses `is_active`; fall back to true (not archived) if neither is set.
      Active: r.active !== undefined ? r.active !== false : r.is_active !== false,
    },
  };
}

export function snapshotToFields(r: any) {
  return {
    id: r.id,
    fields: {
      "Reel URL": r.reel_url,
      Source: r.source,
      Views: Number(r.views || 0),
      Likes: Number(r.likes || 0),
      Comments: Number(r.comments || 0),
      Followers: Number(r.followers || 0),
      "Engagement Rate": Number(r.engagement_rate || 0),
      "View/Follow Ratio": Number(r.view_follow_ratio || 0),
      "Snapshot At": r.snapshot_at,
      "Snapshot Date": r.snapshot_at ? String(r.snapshot_at).slice(0, 10) : null,
    },
  };
}

export function accountSnapshotToFields(r: any) {
  return {
    id: r.id,
    fields: {
      "Account Handle": r.account_handle,
      Followers: Number(r.followers || 0),
      "Total Views": Number(r.total_views || 0),
      "Reel Count": Number(r.reel_count || 0),
      "Snapshot At": r.snapshot_at,
    },
  };
}
