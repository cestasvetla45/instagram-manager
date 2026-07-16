import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const STATUSES = ["scheduled", "posted", "missed", "failed"];

// GET → posting log (va_posts) with optional filters.
// ?va=&account=&status=&day=YYYY-MM-DD (day matched in ET)
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    let q = db().from("va_posts").select("*").order("logged_at", { ascending: false }).limit(1000);
    if (sp.get("va")) q = q.eq("va_name", sp.get("va"));
    if (sp.get("account")) q = q.eq("account_handle", sp.get("account"));
    if (sp.get("status")) q = q.eq("status", sp.get("status"));
    const { data, error } = await q;
    if (error) throw error;
    let posts = data || [];
    const day = sp.get("day");
    if (day) {
      posts = posts.filter((p: any) => {
        const t = p.posted_at || p.logged_at;
        return t && new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === day;
      });
    }
    return NextResponse.json({ posts });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), posts: [] }, { status: 500 });
  }
}

// PATCH { id, status?, va_name? } → update a logged post (e.g. mark missed).
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const patch: any = {};
    if (b.status != null) {
      if (!STATUSES.includes(b.status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
      patch.status = b.status;
    }
    if (b.va_name !== undefined) patch.va_name = (b.va_name || "").trim() || null;
    if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    const { error } = await db().from("va_posts").update(patch).eq("id", b.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
