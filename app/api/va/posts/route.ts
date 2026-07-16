import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET → recent logged posts/stories
export async function GET() {
  try {
    const { data, error } = await db()
      .from("va_posts")
      .select("*")
      .order("logged_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    return NextResponse.json({ posts: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), posts: [] }, { status: 500 });
  }
}

// POST { account_handle, post_type, link, note?, va_name?, posted_at? }
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const row = {
      account_handle: b.account_handle || null,
      post_type: b.post_type || "reel",
      link: (b.link || "").trim() || null,
      note: (b.note || "").trim() || null,
      va_name: (b.va_name || "").trim() || null,
      posted_at: b.posted_at || new Date().toISOString(),
    };
    if (!row.link && !row.note) return NextResponse.json({ error: "Add a link or a note." }, { status: 400 });
    const { error } = await db().from("va_posts").insert(row);
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
    await db().from("va_posts").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
