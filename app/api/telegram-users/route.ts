import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyToken, COOKIE } from "@/lib/session";

export const runtime = "nodejs";

// Only admins may manage Telegram users. When auth is disabled (no
// AUTH_SECRET) we allow it so the owner can set things up; once enabled,
// an admin session is required.
async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.AUTH_SECRET || "";
  if (!secret) return null;
  const s = await verifyToken(req.cookies.get(COOKIE)?.value || "", secret);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (s.r !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

const ROLES = ["admin", "content", "va"];

export async function GET(req: NextRequest) {
  const block = await requireAdmin(req);
  if (block) return block;
  const { data } = await db()
    .from("telegram_users")
    .select("id, telegram_id, username, first_name, last_name, role, is_active, added_at, added_by")
    .order("added_at");
  return NextResponse.json({ users: data || [] });
}

// POST { telegram_id, role } — add / re-authorize a Telegram user.
export async function POST(req: NextRequest) {
  const block = await requireAdmin(req);
  if (block) return block;
  try {
    const b = await req.json();
    const telegramId = Number(b.telegram_id);
    const role = ROLES.includes(b.role) ? b.role : "va";
    if (!telegramId || !Number.isFinite(telegramId)) {
      return NextResponse.json({ error: "A numeric telegram_id is required." }, { status: 400 });
    }
    const { error } = await db().from("telegram_users").upsert(
      {
        telegram_id: telegramId,
        role,
        is_active: true,
        username: (b.username || "").trim() || null,
        added_by: "dashboard",
      },
      { onConflict: "telegram_id" }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE ?telegram_id=... (or ?id=...) — deactivate a user.
export async function DELETE(req: NextRequest) {
  const block = await requireAdmin(req);
  if (block) return block;
  const telegramId = req.nextUrl.searchParams.get("telegram_id");
  const id = req.nextUrl.searchParams.get("id");
  if (!telegramId && !id) return NextResponse.json({ error: "telegram_id or id required" }, { status: 400 });
  const q = db().from("telegram_users").update({ is_active: false });
  const { error } = telegramId ? await q.eq("telegram_id", Number(telegramId)) : await q.eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
