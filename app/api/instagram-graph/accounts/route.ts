import { NextResponse } from "next/server";
import { db, dbConfigured } from "@/lib/db";

export const runtime = "nodejs";

// GET — list all connected accounts with their token status.
export async function GET() {
  if (!dbConfigured()) {
    return NextResponse.json({ ok: false, accounts: [], error: "Supabase not configured." }, { status: 400 });
  }
  const { data, error } = await db()
    .from("instagram_tokens")
    .select(
      "id, account_handle, ig_username, ig_account_id, follower_count, connected_at, last_synced_at, token_expires_at, is_active"
    )
    .order("connected_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, accounts: [], error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, accounts: data || [] });
}
