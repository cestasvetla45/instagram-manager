// ─────────────────────────────────────────────────────────────
//  Category (niche) helpers shared by app/api/categories/*.
//
//  A "category" IS a row in the `niches` table. Profiles (inspiration_accounts)
//  belong to a category via their `niche` column; reels belong to a category
//  transitively through their author's account — NOT through reel.niche
//  directly (that column is only a cache we keep in sync for the rest of the
//  app). Whenever an account's niche changes we stamp the same value onto its
//  existing reels so everything downstream (filters, exports, etc.) agrees.
// ─────────────────────────────────────────────────────────────
import { db, TABLES } from "./db";

export const norm = (h: string) => String(h || "").replace(/^@/, "").trim().toLowerCase();
export const normCat = (n: string) => String(n || "").trim().toLowerCase();

export function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
}

// Accepts a plain handle, "@handle", or a full instagram.com/handle URL.
export function extractHandle(input: string): string {
  let s = String(input || "").trim();
  if (!s) return "";
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, "");
  s = s.split("?")[0].split("/")[0];
  return s.trim().toLowerCase();
}

export type NicheRow = { id: string; name: string; slug: string; created_at?: string };

export async function listNiches(): Promise<NicheRow[]> {
  const { data, error } = await db().from("niches").select("*").order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getNicheByName(name: string): Promise<NicheRow | null> {
  const { data, error } = await db().from("niches").select("*").ilike("name", name).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

// ---------- paginated readers (PostgREST caps a single response at ~1000 rows) ----------

async function fetchAllPaged<T>(
  build: (from: number, to: number) => any
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows: T[] = data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

type LiteAccount = { handle: string; niche: string | null };

async function fetchAllAccountsLite(): Promise<LiteAccount[]> {
  return fetchAllPaged<LiteAccount>((from, to) =>
    db().from(TABLES.inspirationAccounts).select("handle, niche").range(from, to)
  );
}

type LiteReel = { author_handle: string; views: number | null; is_winner: boolean | null; thumbnail_url: string | null; reel_url: string };

async function fetchAllReelsLite(): Promise<LiteReel[]> {
  return fetchAllPaged<LiteReel>((from, to) =>
    db()
      .from(TABLES.inspirationReels)
      .select("author_handle, views, is_winner, thumbnail_url, reel_url")
      .range(from, to)
  );
}

// ---------- cascade updates ----------

// Stamp `niche` onto every existing reel by this handle. Paginates the read
// past the 1000-row cap, then updates in 200-id chunks (matches the pattern
// used elsewhere in this codebase for bulk writes).
export async function stampNicheForHandle(handle: string, niche: string | null): Promise<number> {
  const ids = await fetchAllPaged<{ id: string }>((from, to) =>
    db().from(TABLES.inspirationReels).select("id").ilike("author_handle", handle).range(from, to)
  );
  let updated = 0;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK).map((r) => r.id);
    const { data, error } = await db().from(TABLES.inspirationReels).update({ niche }).in("id", chunk).select("id");
    if (error) throw error;
    updated += data?.length || 0;
  }
  return updated;
}

// Used on category rename: re-point every reel tagged with the old niche
// name to the new one (accounts are updated separately, directly by name).
export async function stampNicheRename(oldName: string, newName: string): Promise<number> {
  const ids = await fetchAllPaged<{ id: string }>((from, to) =>
    db().from(TABLES.inspirationReels).select("id").ilike("niche", oldName).range(from, to)
  );
  let updated = 0;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK).map((r) => r.id);
    const { data, error } = await db().from(TABLES.inspirationReels).update({ niche: newName }).in("id", chunk).select("id");
    if (error) throw error;
    updated += data?.length || 0;
  }
  return updated;
}

// ---------- aggregation ----------

export type CategoryAgg = {
  id: string;
  name: string;
  slug: string;
  profile_count: number;
  reel_count: number;
  total_views: number;
  avg_views: number;
  picked_count: number;
  preview: { thumbnail_url: string | null; reel_url: string }[];
};

// One pass over all accounts + all reels, bucketed by category — far cheaper
// than N per-category queries when there are several categories. Counts are
// derived from accounts-in-category, never trusted from reel.niche directly.
export async function aggregateCategories(niches: NicheRow[]): Promise<CategoryAgg[]> {
  const accounts = await fetchAllAccountsLite();
  const handleToNiche = new Map<string, string>();
  const profileCounts = new Map<string, number>();
  for (const a of accounts) {
    if (!a.niche) continue;
    const key = normCat(a.niche);
    handleToNiche.set(norm(a.handle), key);
    profileCounts.set(key, (profileCounts.get(key) || 0) + 1);
  }

  type Bucket = { reel_count: number; total_views: number; picked_count: number; preview: LiteReel[] };
  const buckets = new Map<string, Bucket>();
  for (const n of niches) buckets.set(normCat(n.name), { reel_count: 0, total_views: 0, picked_count: 0, preview: [] });

  const reels = await fetchAllReelsLite();
  for (const r of reels) {
    const key = handleToNiche.get(norm(r.author_handle));
    if (!key) continue;
    const b = buckets.get(key);
    if (!b) continue;
    b.reel_count++;
    b.total_views += Number(r.views || 0);
    if (r.is_winner) b.picked_count++;
    b.preview.push(r);
  }

  return niches.map((n) => {
    const key = normCat(n.name);
    const b = buckets.get(key) || { reel_count: 0, total_views: 0, picked_count: 0, preview: [] };
    const preview = b.preview
      .sort((x, y) => Number(y.views || 0) - Number(x.views || 0))
      .slice(0, 4)
      .map((r) => ({ thumbnail_url: r.thumbnail_url || null, reel_url: r.reel_url }));
    return {
      id: n.id,
      name: n.name,
      slug: n.slug,
      profile_count: profileCounts.get(key) || 0,
      reel_count: b.reel_count,
      total_views: b.total_views,
      avg_views: b.reel_count ? Math.round(b.total_views / b.reel_count) : 0,
      picked_count: b.picked_count,
      preview,
    };
  });
}

// Reel stats for a specific set of handles (used by the category detail page
// header). Paginates past the 1000-row cap since a popular category could
// exceed it.
export async function statsForHandles(handles: string[]): Promise<{ reel_count: number; total_views: number; avg_views: number; picked_count: number }> {
  if (!handles.length) return { reel_count: 0, total_views: 0, avg_views: 0, picked_count: 0 };
  const normed = handles.map(norm);
  const rows = await fetchAllPaged<{ views: number | null; is_winner: boolean | null }>((from, to) =>
    db().from(TABLES.inspirationReels).select("views, is_winner").in("author_handle", normed).range(from, to)
  );
  let total_views = 0;
  let picked_count = 0;
  for (const r of rows) {
    total_views += Number(r.views || 0);
    if (r.is_winner) picked_count++;
  }
  return { reel_count: rows.length, total_views, avg_views: rows.length ? Math.round(total_views / rows.length) : 0, picked_count };
}
