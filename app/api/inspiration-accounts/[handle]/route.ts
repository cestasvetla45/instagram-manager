import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";

export const runtime = "nodejs";

const norm = (h: string) => String(h || "").replace(/^@/, "").trim().toLowerCase();

// DELETE /api/inspiration-accounts/:handle — remove one account + all its reels
export async function DELETE(_req: NextRequest, { params }: { params: { handle: string } }) {
  try {
    const handle = norm(decodeURIComponent(params.handle || ""));
    if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

    const { data: reels } = await db()
      .from(TABLES.inspirationReels)
      .select("id")
      .ilike("author_handle", handle);
    const reelsDeleted = reels?.length || 0;
    if (reelsDeleted) {
      await db().from(TABLES.inspirationReels).delete().ilike("author_handle", handle);
    }
    await db().from(TABLES.inspirationAccounts).delete().ilike("handle", handle);

    return NextResponse.json({ ok: true, reels_deleted: reelsDeleted });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
