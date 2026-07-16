import { NextRequest, NextResponse } from "next/server";
import { scrapeReel } from "@/lib/rocksolid";
import { db, TABLES } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET /api/download?url=<reel url>  -> streams the stored MP4 (or live CDN) as a download
export async function GET(req: NextRequest) {
  try {
    const reelUrl = req.nextUrl.searchParams.get("url");
    let src = req.nextUrl.searchParams.get("src");
    let name = req.nextUrl.searchParams.get("name") || "reel.mp4";

    // Prefer the durable copy stored in Supabase Storage.
    if (!src && reelUrl) {
      for (const table of [TABLES.inspirationReels, TABLES.ourReels]) {
        const { data } = await db()
          .from(table)
          .select("video_url, shortcode, author_handle, account_handle")
          .eq("reel_url", reelUrl)
          .limit(1);
        if (data && data[0]?.video_url) {
          src = data[0].video_url;
          name = `${data[0].author_handle || data[0].account_handle || "reel"}-${data[0].shortcode || "video"}.mp4`;
          break;
        }
      }
    }
    // Fall back to a live scrape for a fresh CDN link.
    if (!src && reelUrl) {
      const r = await scrapeReel(reelUrl);
      src = r.videoUrl;
      name = `${r.authorHandle || "reel"}-${r.shortcode || "video"}.mp4`;
    }
    if (!src) return NextResponse.json({ error: "No downloadable video found." }, { status: 404 });

    const upstream = await fetch(src);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: 502 });
    }
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "video/mp4",
        "Content-Disposition": `attachment; filename="${name.replace(/[^\w.\-]/g, "_")}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
