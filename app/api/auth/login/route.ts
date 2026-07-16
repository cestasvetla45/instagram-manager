import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/passwords";
import { signToken, COOKIE, Role } from "@/lib/session";

export const runtime = "nodejs";

const SECRET = process.env.AUTH_SECRET || "";
const DAYS = 14;

export async function POST(req: NextRequest) {
  try {
    if (!SECRET) return NextResponse.json({ error: "Auth not configured. Set AUTH_SECRET in Railway." }, { status: 500 });
    const { username, password } = await req.json();
    const u = String(username || "").trim();
    const p = String(password || "");
    if (!u || !p) return NextResponse.json({ error: "Username and password required." }, { status: 400 });

    let role: Role | null = null;

    // Root admin from env (owner-controlled; bootstraps the first login).
    if (process.env.ADMIN_USERNAME && u.toLowerCase() === process.env.ADMIN_USERNAME.toLowerCase() && p === process.env.ADMIN_PASSWORD) {
      role = "admin";
    } else {
      const { data } = await db().from("app_users").select("*").ilike("username", u).limit(1);
      const row = data?.[0];
      if (row && verifyPassword(p, row.password_hash)) role = row.role === "admin" ? "admin" : "va";
    }

    if (!role) return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });

    const token = await signToken({ u, r: role, exp: Date.now() + DAYS * 86400000 }, SECRET);
    const res = NextResponse.json({ ok: true, role });
    res.cookies.set(COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: DAYS * 86400 });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
