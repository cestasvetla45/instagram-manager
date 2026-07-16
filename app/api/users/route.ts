import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/passwords";
import { verifyToken, COOKIE } from "@/lib/session";

export const runtime = "nodejs";

// Only admins may manage users. When auth is disabled (no AUTH_SECRET) we allow
// it so the owner can set things up; once enabled, an admin session is required.
async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.AUTH_SECRET || "";
  if (!secret) return null;
  const s = await verifyToken(req.cookies.get(COOKIE)?.value || "", secret);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (s.r !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest) {
  const block = await requireAdmin(req);
  if (block) return block;
  const { data } = await db().from("app_users").select("id, username, role, label, created_at").order("created_at");
  return NextResponse.json({ users: data || [] });
}

// POST { username, password, role, label? }
export async function POST(req: NextRequest) {
  const block = await requireAdmin(req);
  if (block) return block;
  try {
    const b = await req.json();
    const username = String(b.username || "").trim();
    const password = String(b.password || "");
    const role = b.role === "admin" ? "admin" : "va";
    if (!username || password.length < 6) return NextResponse.json({ error: "Username and a 6+ char password required." }, { status: 400 });
    const { error } = await db().from("app_users").upsert(
      { username, password_hash: hashPassword(password), role, label: (b.label || "").trim() || null },
      { onConflict: "username" }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const block = await requireAdmin(req);
  if (block) return block;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db().from("app_users").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
