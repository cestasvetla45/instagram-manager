import { NextRequest, NextResponse } from "next/server";
import { scrapeReel } from "@/lib/rocksolid";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET /api/download?url=<reel url>   -> streams the MP4 as an attachment
// GET /api/download?src=<direct cdn url>&name=foo.mp4 -> streams a known url
export async function GET(req: NextRequest) {
  try {
    const reelUrl = req.nextUrl.searchParams.get("url");
    let src = req.nextUrl.searchParams.get("src");
    let name = req.nextUrl.searchParams.get("name") || "reel.mp4";

    if (!src && reelUrl) {
      const r = await scrapeReel(reelUrl);
      src = r.videoUrl;
      name = `${r.authorHandle || "reel"}-${r.shortcode || "video"}.mp4`;
    }
    if (!src) {
      return NextResponse.json({ error: "No downloadable video URL found." }, { status: 404 });
    }

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
