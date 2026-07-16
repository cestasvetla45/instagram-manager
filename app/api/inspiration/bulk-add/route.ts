import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import { saveReel } from "@/lib/save";
import { scrapeProfile } from "@/lib/rocksolid";

export const runtime = "nodejs";
export const maxDuration = 300;

// Pull every Instagram reel/post URL out of a pasted blob of text.
function parseUrls(text: string): string[] {
  const re = /https?:\/\/(?:www\.)?instagram\.com\/(?:[^/\s]+\/)?(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/gi;
  const found = String(text || "").match(re) || [];
  // de-dupe, normalise to /reel/CODE/
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of found) {
    const m = u.match(/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    if (!m) continue;
    const norm = `https://www.instagram.com/reel/${m[2]}/`;
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

// POST { text?: string, urls?: string[], niche: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const niche = String(body.niche || "").trim();
    const urls = body.urls && Array.isArray(body.urls)
      ? parseUrls(body.urls.join("\n"))
      : parseUrls(body.text || "");

    if (!niche) return NextResponse.json({ error: "Pick a niche first." }, { status: 400 });
    if (!urls.length) return NextResponse.json({ error: "No Instagram reel links found in that text." }, { status: 400 });

    // Make sure the niche exists in the managed list.
    await db().from("niches").upsert(
      { name: niche, slug: niche.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "") },
      { onConflict: "name" }
    );

    const added: any[] = [];
    const failed: { url: string; error: string }[] = [];
    const handles = new Set<string>();

    for (const url of urls) {
      try {
        // saveReel scrapes, downloads the video to Supabase, snapshots stats at
        // download time, computes the 0–10 score and tags the niche.
        const { reel, created } = await saveReel(url, "inspiration", { extra: { niche } });
        if (reel.authorHandle) handles.add(reel.authorHandle.toLowerCase());
        added.push({ url: reel.url, handle: reel.authorHandle, views: reel.views, created });
      } catch (e: any) {
        failed.push({ url, error: e?.message || String(e) });
      }
    }

    // Add each unique account to the inspiration accounts list under this niche.
    let accountsAdded = 0;
    for (const h of handles) {
      try {
        const p = await scrapeProfile(h);
        const { data: existing } = await db()
          .from(TABLES.inspirationAccounts)
          .select("id")
          .ilike("handle", h)
          .limit(1);
        const row = {
          handle: p.username,
          profile_url: `https://www.instagram.com/${p.username}/`,
          full_name: p.fullName,
          niche,
          followers: p.followers,
          following: p.following,
          posts_count: p.postsCount,
          bio: p.bio,
          profile_pic_url: p.profilePicUrl,
          updated_at: new Date().toISOString(),
        };
        if (existing && existing[0]) {
          await db().from(TABLES.inspirationAccounts).update(row).eq("id", existing[0].id);
        } else {
          await db().from(TABLES.inspirationAccounts).insert(row);
        }
        accountsAdded++;
      } catch {
        /* non-fatal — the reel is already saved */
      }
    }

    return NextResponse.json({
      ok: true,
      niche,
      reels_added: added.length,
      accounts_added: accountsAdded,
      failed,
      added,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
