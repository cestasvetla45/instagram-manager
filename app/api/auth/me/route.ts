import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE } from "@/lib/session";

export const runtime = "nodejs";

// Returns the current user, or { authEnabled:false } when auth isn't configured.
export async function GET(req: NextRequest) {
  const secret = process.env.AUTH_SECRET || "";
  if (!secret) return NextResponse.json({ authEnabled: false, role: "admin", username: null });
  const session = await verifyToken(req.cookies.get(COOKIE)?.value || "", secret);
  if (!session) return NextResponse.json({ authEnabled: true, role: null, username: null });
  return NextResponse.json({ authEnabled: true, role: session.r, username: session.u });
}
