import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;
const BUCKET = "story-assets";

// GET ?used=true|false → list story images
export async function GET(req: NextRequest) {
  try {
    const used = req.nextUrl.searchParams.get("used");
    let q = db().from("story_assets").select("*").eq("kind", "story").order("uploaded_at", { ascending: false }).limit(1000);
    if (used === "true") q = q.eq("used", true);
    else if (used === "false") q = q.eq("used", false);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ assets: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), assets: [] }, { status: 500 });
  }
}

// POST (multipart) → upload one or more images to the vault
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form.getAll("file");
    const niche = String(form.get("niche") || "").trim();
    const label = String(form.get("label") || "").trim();
    if (!files.length) return NextResponse.json({ error: "No files." }, { status: 400 });

    let added = 0;
    for (const f of files) {
      if (!(f instanceof File)) continue;
      const buf = Buffer.from(await f.arrayBuffer());
      const ext = (f.name.split(".").pop() || "jpg").replace(/[^\w]/g, "").slice(0, 5) || "jpg";
      const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await db().storage.from(BUCKET).upload(path, buf, {
        contentType: f.type || "image/jpeg",
        upsert: false,
      });
      if (upErr) continue;
      const { data } = db().storage.from(BUCKET).getPublicUrl(path);
      await db().from("story_assets").insert({ image_url: data.publicUrl, path, kind: "story", media_type: "image", niche: niche || null, label: label || null });
      added++;
    }
    return NextResponse.json({ ok: true, added });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// PATCH { id, used, used_by? } → mark used / unused (self-tagging)
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const used = !!b.used;
    const { error } = await db()
      .from("story_assets")
      .update({ used, used_at: used ? new Date().toISOString() : null, used_by: used ? (b.used_by || null) : null })
      .eq("id", b.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
