import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET ?account=&from=&to= → plan rows in range
export async function GET(req: NextRequest) {
  try {
    const account = req.nextUrl.searchParams.get("account") || "";
    const from = req.nextUrl.searchParams.get("from") || "";
    const to = req.nextUrl.searchParams.get("to") || "";
    if (!account) return NextResponse.json({ plan: {} });
    let q = db().from("va_plan").select("day, content").eq("account_handle", account);
    if (from) q = q.gte("day", from);
    if (to) q = q.lte("day", to);
    const { data, error } = await q;
    if (error) throw error;
    const plan: Record<string, string> = {};
    for (const r of data || []) plan[(r as any).day] = (r as any).content || "";
    return NextResponse.json({ plan });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), plan: {} }, { status: 500 });
  }
}

// POST { account, day, content } → upsert (delete when empty)
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const account = String(b.account || "").trim();
    const day = String(b.day || "").trim();
    const content = String(b.content ?? "");
    if (!account || !day) return NextResponse.json({ error: "account, day required" }, { status: 400 });
    if (!content.trim()) {
      await db().from("va_plan").delete().eq("account_handle", account).eq("day", day);
    } else {
      await db().from("va_plan").upsert(
        { account_handle: account, day, content, updated_at: new Date().toISOString() },
        { onConflict: "account_handle,day" }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
