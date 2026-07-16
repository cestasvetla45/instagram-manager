// Account-level snapshots + new-post detection for OUR accounts (Supabase).
import { db, TABLES } from "./db";
import { scrapeProfile, scrapeUserReels } from "./rocksolid";
import { saveReel } from "./save";

const nowISO = () => new Date().toISOString();

export async function detectAndAddNewPosts() {
  const { data: accounts } = await db().from(TABLES.ourAccounts).select("handle");
  const { data: reels } = await db().from(TABLES.ourReels).select("shortcode");
  const known = new Set((reels || []).map((r: any) => String(r.shortcode || "").toLowerCase()));
  const out: { handle: string; added: number }[] = [];

  for (const acc of accounts || []) {
    const handle = String(acc.handle || "");
    if (!handle) continue;
    let added = 0;
    try {
      const recent = await scrapeUserReels(handle, 500);
      for (const reel of recent) {
        const sc = (reel.shortcode || "").toLowerCase();
        if (!sc || known.has(sc)) continue;
        try {
          await saveReel(reel.url, "our");
          known.add(sc);
          added++;
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip account */
    }
    out.push({ handle, added });
  }
  return out;
}

export async function snapshotAccounts(): Promise<number> {
  const { data: accounts } = await db().from(TABLES.ourAccounts).select("id, handle, followers");
  const { data: reels } = await db().from(TABLES.ourReels).select("account_handle, views");
  const at = nowISO();
  let n = 0;

  for (const acc of accounts || []) {
    const handle = String(acc.handle || "");
    if (!handle) continue;
    const mine = (reels || []).filter(
      (r: any) => String(r.account_handle || "").toLowerCase() === handle.toLowerCase()
    );
    const totalViews = mine.reduce((s: number, r: any) => s + Number(r.views || 0), 0);

    let followers = Number(acc.followers || 0);
    try {
      const p = await scrapeProfile(handle);
      if (p.followers) {
        followers = p.followers;
        await db()
          .from(TABLES.ourAccounts)
          .update({ followers: p.followers, following: p.following, posts_count: p.postsCount, updated_at: at })
          .eq("id", acc.id);
      }
    } catch {
      /* keep stored */
    }

    await db().from(TABLES.accountSnapshots).insert({
      account_handle: handle,
      followers,
      total_views: totalViews,
      reel_count: mine.length,
      snapshot_at: at,
    });
    n++;
  }
  return n;
}
