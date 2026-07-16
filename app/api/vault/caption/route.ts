import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateCaption, geminiConfigured } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { id, example } → watch the vault video, write a caption in that format, save it.
export async function POST(req: NextRequest) {
  try {
    if (!geminiConfigured()) return NextResponse.json({ error: "Gemini not configured. Add GEMINI_API_KEY in Railway." }, { status: 400 });
    const b = await req.json();
    const id = String(b.id || "");
    const example = String(b.example || "").trim();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    if (!example) return NextResponse.json({ error: "Provide an example caption / format to follow." }, { status: 400 });

    const { data } = await db().from("story_assets").select("image_url, media_type, niche").eq("id", id).limit(1);
    const asset = data?.[0] as any;
    if (!asset) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    if (asset.media_type !== "video") return NextResponse.json({ error: "Caption generation needs a video (reel)." }, { status: 400 });

    const vid = await fetch(asset.image_url);
    if (!vid.ok) return NextResponse.json({ error: `Could not fetch the video (${vid.status}).` }, { status: 502 });
    const bytes = Buffer.from(await vid.arrayBuffer());

    const caption = await generateCaption(bytes, "video/mp4", example, asset.niche || "");
    await db().from("story_assets").update({ caption }).eq("id", id);
    return NextResponse.json({ ok: true, caption });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
