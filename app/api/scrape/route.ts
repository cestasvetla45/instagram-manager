import { NextRequest, NextResponse } from "next/server";
import { saveReel } from "@/lib/save";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { urls: string[]  (or url: string), target: "inspiration" | "our" }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const target = body.target === "our" ? "our" : "inspiration";
    let urls: string[] = body.urls || (body.url ? [body.url] : []);
    urls = urls
      .map((u: string) => String(u).trim())
      .filter((u: string) => /instagram\.com/.test(u));

    if (!urls.length) {
      return NextResponse.json({ error: "No valid Instagram URLs provided." }, { status: 400 });
    }

    const results: any[] = [];
    for (const url of urls) {
      try {
        const { reel, created } = await saveReel(url, target);
        results.push({ url, ok: true, created, handle: reel.authorHandle, views: reel.views });
      } catch (e: any) {
        results.push({ url, ok: false, error: e?.message || String(e) });
      }
    }

    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
