import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET → all active account assignments.
export async function GET() {
  try {
    const { data, error } = await db()
      .from("account_assignments")
      .select("*")
      .eq("is_active", true)
      .order("assigned_at", { ascending: false })
      .limit(2000);
    if (error) throw error;
    return NextResponse.json({ assignments: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), assignments: [] }, { status: 500 });
  }
}

// POST { account_handle, va_name, notes? } → assign an account to a VA.
// Re-assigning an account first retires any existing active assignment for it.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const account_handle = (b.account_handle || "").trim();
    const va_name = (b.va_name || "").trim();
    if (!account_handle || !va_name) {
      return NextResponse.json({ error: "account_handle and va_name are required" }, { status: 400 });
    }

    // Retire any existing active assignment(s) for this account.
    await db()
      .from("account_assignments")
      .update({ is_active: false, unassigned_at: new Date().toISOString() })
      .eq("account_handle", account_handle)
      .eq("is_active", true);

    const { error } = await db().from("account_assignments").insert({
      account_handle,
      va_name,
      notes: (b.notes || "").trim() || null,
      is_active: true,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE ?id=  or  ?account_handle=  → unassign (soft).
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const handle = req.nextUrl.searchParams.get("account_handle");
    if (!id && !handle) return NextResponse.json({ error: "id or account_handle required" }, { status: 400 });
    let q = db()
      .from("account_assignments")
      .update({ is_active: false, unassigned_at: new Date().toISOString() })
      .eq("is_active", true);
    q = id ? q.eq("id", id) : q.eq("account_handle", handle as string);
    const { error } = await q;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
