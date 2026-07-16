import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;
const BUCKET = "story-assets"; // shared media bucket for the content vault

// GET ?kind=story|carousel|reel|post|all & used=true|false|all
export async function GET(req: NextRequest) {
  try {
    const kind = req.nextUrl.searchParams.get("kind") || "all";
    const used = req.nextUrl.searchParams.get("used") || "all";
    const niche = req.nextUrl.searchParams.get("niche") || "all";
    let q = db().from("story_assets").select("*").order("uploaded_at", { ascending: false }).limit(2000);
    if (kind !== "all") q = q.eq("kind", kind);
    if (niche !== "all") q = q.ilike("niche", niche);
    if (used === "true") q = q.eq("used", true);
    else if (used === "false") q = q.eq("used", false);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ assets: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), assets: [] }, { status: 500 });
  }
}

// POST (multipart) → upload one or more files with a kind, caption, set name
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form.getAll("file");
    const kind = String(form.get("kind") || "story").trim();
    const caption = String(form.get("caption") || "").trim();
    const setName = String(form.get("set_name") || "").trim();
    const niche = String(form.get("niche") || "").trim();
    if (!files.length) return NextResponse.json({ error: "No files." }, { status: 400 });

    let added = 0;
    for (const f of files) {
      if (!(f instanceof File)) continue;
      const buf = Buffer.from(await f.arrayBuffer());
      const isVideo = (f.type || "").startsWith("video");
      const ext = (f.name.split(".").pop() || (isVideo ? "mp4" : "jpg")).replace(/[^\w]/g, "").slice(0, 5);
      const path = `${kind}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await db().storage.from(BUCKET).upload(path, buf, {
        contentType: f.type || (isVideo ? "video/mp4" : "image/jpeg"),
        upsert: false,
      });
      if (upErr) continue;
      const { data } = db().storage.from(BUCKET).getPublicUrl(path);
      await db().from("story_assets").insert({
        image_url: data.publicUrl,
        path,
        kind,
        media_type: isVideo ? "video" : "image",
        caption: caption || null,
        set_name: setName || null,
        niche: niche || null,
      });
      added++;
    }
    return NextResponse.json({ ok: true, added });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// PATCH { id, used?, caption? } → mark used / edit caption
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const patch: Record<string, any> = {};
    if (typeof b.used === "boolean") {
      patch.used = b.used;
      patch.used_at = b.used ? new Date().toISOString() : null;
      patch.used_by = b.used ? (b.used_by || null) : null;
    }
    if (typeof b.caption === "string") patch.caption = b.caption;
    const { error } = await db().from("story_assets").update(patch).eq("id", b.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { data } = await db().from("story_assets").select("path").eq("id", id).limit(1);
    const path = data?.[0]?.path;
    if (path) await db().storage.from(BUCKET).remove([path]);
    await db().from("story_assets").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
