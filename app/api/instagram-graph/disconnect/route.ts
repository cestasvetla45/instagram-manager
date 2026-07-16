import { NextRequest, NextResponse } from "next/server";
import { db, dbConfigured } from "@/lib/db";

export const runtime = "nodejs";

// POST { account_handle | id } — deactivate a connected account.
export async function POST(req: NextRequest) {
  if (!dbConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase not configured." }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const { account_handle, id } = body || {};
  if (!account_handle && !id) {
    return NextResponse.json({ ok: false, error: "Provide account_handle or id." }, { status: 400 });
  }

  let q = db().from("instagram_tokens").update({ is_active: false, updated_at: new Date().toISOString() });
  q = id ? q.eq("id", id) : q.eq("account_handle", account_handle);
  const { error } = await q;

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
