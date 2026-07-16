import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET ?account=&day= → { done: [task_key,...] }
export async function GET(req: NextRequest) {
  try {
    const account = req.nextUrl.searchParams.get("account") || "";
    const day = req.nextUrl.searchParams.get("day") || "";
    if (!account || !day) return NextResponse.json({ done: [] });
    const { data, error } = await db()
      .from("va_checklist")
      .select("task_key")
      .eq("account_handle", account)
      .eq("day", day);
    if (error) throw error;
    return NextResponse.json({ done: (data || []).map((r: any) => r.task_key) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), done: [] }, { status: 500 });
  }
}

// POST { account, day, task_key, done, va_name } → tick / untick
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const account = String(b.account || "").trim();
    const day = String(b.day || "").trim();
    const task_key = String(b.task_key || "").trim();
    if (!account || !day || !task_key) return NextResponse.json({ error: "account, day, task_key required" }, { status: 400 });
    if (b.done) {
      await db().from("va_checklist").upsert(
        { account_handle: account, day, task_key, done_by: (b.va_name || "").trim() || null, done_at: new Date().toISOString() },
        { onConflict: "account_handle,day,task_key" }
      );
    } else {
      await db().from("va_checklist").delete().eq("account_handle", account).eq("day", day).eq("task_key", task_key);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
