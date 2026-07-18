import { NextRequest, NextResponse } from "next/server";
import { db, TABLES, accountToFields } from "@/lib/db";
import { scrapeProfile } from "@/lib/rocksolid";
import { refreshOneOurAccount } from "./_refresh-one";

export const runtime = "nodejs";
export const maxDuration = 60;

const norm = (h: string) => String(h || "").replace(/^@/, "").trim().toLowerCase();

// GET /api/accounts?type=inspiration|our
//   ?type=our&view=manage[&status=all|active|archived&search=&sort=handle|followers|reels|last_scraped]
//     → richer, flat rows for the Our Accounts management hub.
export async function GET(req: NextRequest) {
  try {
    const isOur = req.nextUrl.searchParams.get("type") === "our";
    const view = req.nextUrl.searchParams.get("view");
    if (isOur && view === "manage") return manageOurAccounts(req);

    const table = isOur ? TABLES.ourAccounts : TABLES.inspirationAccounts;
    const { data, error } = await db()
      .from(table)
      .select("*")
      .order("followers", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return NextResponse.json({ records: (data || []).map(accountToFields) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), records: [] }, { status: 500 });
  }
}

// Paginate our_reels down to a per-handle { reel_count, total_views } map
// (PostgREST caps a single response at ~1000 rows, so we page past it).
async function ourReelStatsByHandle() {
  const map = new Map<string, { reel_count: number; total_views: number }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from(TABLES.ourReels).select("account_handle, views").range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      const key = norm(r.account_handle);
      if (!key) continue;
      const cur = map.get(key) || { reel_count: 0, total_views: 0 };
      cur.reel_count += 1;
      cur.total_views += Number(r.views || 0);
      map.set(key, cur);
    }
    if (rows.length < PAGE) break;
  }
  return map;
}

// Best-effort "followers ~7 days ago" per handle — picks the account_snapshots
// row closest to exactly 7 days back within a +/-2 day window. No window match
// → no delta shown for that account (better than a misleading number).
async function followersAt7dByHandle() {
  const now = Date.now();
  const lo = new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString();
  const hi = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
  const target = now - 7 * 24 * 60 * 60 * 1000;
  const { data, error } = await db()
    .from(TABLES.accountSnapshots)
    .select("account_handle, followers, snapshot_at")
    .gte("snapshot_at", lo)
    .lte("snapshot_at", hi)
    .order("snapshot_at", { ascending: true })
    .limit(5000);
  if (error) throw error;
  const best = new Map<string, { followers: number; dist: number }>();
  for (const r of data || []) {
    const key = norm(r.account_handle);
    if (!key) continue;
    const dist = Math.abs(new Date(r.snapshot_at).getTime() - target);
    const cur = best.get(key);
    if (!cur || dist < cur.dist) best.set(key, { followers: Number(r.followers || 0), dist });
  }
  const out = new Map<string, number>();
  for (const [k, v] of best) out.set(k, v.followers);
  return out;
}

async function manageOurAccounts(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") || "all"; // all | active | archived
    const search = norm(sp.get("search") || "");
    const sort = sp.get("sort") || "handle";

    let q = db().from(TABLES.ourAccounts).select("*").limit(2000);
    if (status === "active") q = q.eq("active", true);
    else if (status === "archived") q = q.eq("active", false);
    const { data: accounts, error } = await q;
    if (error) throw error;

    const [stats, assignRes, delta7d] = await Promise.all([
      ourReelStatsByHandle(),
      db().from("account_assignments").select("account_handle, va_name").eq("is_active", true),
      followersAt7dByHandle(),
    ]);
    if (assignRes.error) throw assignRes.error;
    const vaMap = new Map((assignRes.data || []).map((a: any) => [norm(a.account_handle), a.va_name]));

    let rows = (accounts || []).map((a: any) => {
      const key = norm(a.handle);
      const s = stats.get(key) || { reel_count: 0, total_views: 0 };
      const followers = Number(a.followers || 0);
      const at7d = delta7d.get(key);
      return {
        id: a.id,
        handle: a.handle,
        profile_url: a.profile_url || `https://www.instagram.com/${a.handle}/`,
        active: a.active !== false,
        scrape_status: a.scrape_status || null,
        last_scraped_at: a.last_scraped_at || null,
        followers,
        followers_delta_7d: at7d != null ? followers - at7d : null,
        niche: a.niche || "",
        content_type: a.content_type || "",
        subniche: a.subniche || "",
        va_group: a.va_group || "",
        notes: a.notes || "",
        reel_count: s.reel_count,
        avg_views: s.reel_count ? Math.round(s.total_views / s.reel_count) : 0,
        assigned_va: vaMap.get(key) || null,
      };
    });

    if (search) rows = rows.filter((r) => norm(r.handle).includes(search));

    rows.sort((a, b) => {
      if (sort === "followers") return b.followers - a.followers;
      if (sort === "reels") return b.reel_count - a.reel_count;
      if (sort === "last_scraped") return String(b.last_scraped_at || "").localeCompare(String(a.last_scraped_at || ""));
      return a.handle.localeCompare(b.handle);
    });

    return NextResponse.json({ accounts: rows, total: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), accounts: [], total: 0 }, { status: 500 });
  }
}

// POST /api/accounts  { handle, niche?, content_type? }
// Creates an our_accounts row (best-effort profile scrape) and fires its
// first refresh (reel stats + new-post pickup) via the shared helper.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const handle = norm(body.handle || "");
    if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

    const { data: existing } = await db().from(TABLES.ourAccounts).select("id").ilike("handle", handle).limit(1);
    if (existing && existing[0]) {
      return NextResponse.json({ error: `@${handle} already exists in Our Accounts` }, { status: 409 });
    }

    let profile: any = null;
    try {
      profile = await scrapeProfile(handle);
    } catch {
      /* still create the row — refresh below will retry / flag it */
    }

    const row: Record<string, any> = {
      handle: profile?.username || handle,
      profile_url: `https://www.instagram.com/${profile?.username || handle}/`,
      followers: profile?.followers || 0,
      following: profile?.following || 0,
      posts_count: profile?.postsCount || 0,
      profile_pic_url: profile?.profilePicUrl || null,
      niche: body.niche || null,
      content_type: body.content_type || "dance",
      active: true,
      scrape_status: null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await db().from(TABLES.ourAccounts).insert(row);
    if (error) throw error;

    let refresh: any = null;
    try {
      refresh = await refreshOneOurAccount(row.handle);
    } catch (e: any) {
      refresh = { ok: false, error: e?.message || String(e) };
    }

    return NextResponse.json({ ok: true, created: true, account: row, refresh });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// PATCH /api/accounts
//   { handle | handles: [...], action: "archive" | "unarchive" }
//   { handle | handles: [...], field: "niche"|"content_type"|"subniche"|"va_group"|"notes", value }
const EDITABLE_FIELDS = new Set(["niche", "content_type", "subniche", "va_group", "notes"]);

export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    const handles: string[] = Array.isArray(b.handles)
      ? b.handles.map(norm).filter(Boolean)
      : b.handle
      ? [norm(b.handle)]
      : [];
    if (!handles.length) return NextResponse.json({ error: "handle or handles required" }, { status: 400 });

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (b.action === "archive") {
      patch.active = false;
      patch.scrape_status = "archived";
    } else if (b.action === "unarchive") {
      patch.active = true;
      patch.scrape_status = null;
    } else if (b.field) {
      if (!EDITABLE_FIELDS.has(b.field)) {
        return NextResponse.json({ error: `field not editable: ${b.field}` }, { status: 400 });
      }
      patch[b.field] = b.value != null && String(b.value).trim() !== "" ? String(b.value).trim() : null;
    } else {
      return NextResponse.json({ error: "action or field required" }, { status: 400 });
    }

    let updated = 0;
    for (const h of handles) {
      const { data, error } = await db().from(TABLES.ourAccounts).update(patch).ilike("handle", h).select("id");
      if (error) throw error;
      updated += data?.length || 0;
    }
    return NextResponse.json({ ok: true, updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
