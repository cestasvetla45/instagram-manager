import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";

export const runtime = "nodejs";

// Returns our accounts with active status + today's progress.
// GET ?day=YYYY-MM-DD (ET date)
export async function GET(req: NextRequest) {
  try {
    const day = req.nextUrl.searchParams.get("day") || "";
    const { data: accts } = await db().from(TABLES.ourAccounts).select("handle, active").order("handle");
    const accounts = (accts || []).filter((a: any) => a.handle);

    // checklist done counts for the day
    const doneByAcct: Record<string, number> = {};
    if (day) {
      const { data: cl } = await db().from("va_checklist").select("account_handle").eq("day", day).limit(5000);
      for (const r of cl || []) doneByAcct[(r as any).account_handle] = (doneByAcct[(r as any).account_handle] || 0) + 1;
    }

    // reels logged "today" (ET) per account
    const reelsByAcct: Record<string, number> = {};
    const { data: posts } = await db().from("va_posts").select("account_handle, post_type, posted_at, logged_at").eq("post_type", "reel").order("logged_at", { ascending: false }).limit(500);
    for (const p of posts || []) {
      const t = (p as any).posted_at || (p as any).logged_at;
      const etDay = new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      if (etDay === day) reelsByAcct[(p as any).account_handle] = (reelsByAcct[(p as any).account_handle] || 0) + 1;
    }

    return NextResponse.json({
      accounts: accounts.map((a: any) => ({
        handle: a.handle,
        active: a.active !== false,
        done_today: doneByAcct[a.handle] || 0,
        reels_today: reelsByAcct[a.handle] || 0,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), accounts: [] }, { status: 500 });
  }
}

// PATCH { handle, active } → set active / paused
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    const handle = String(b.handle || "").trim();
    if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });
    await db().from(TABLES.ourAccounts).update({ active: !!b.active }).ilike("handle", handle);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
