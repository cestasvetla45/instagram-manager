import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE } from "./lib/session";

const SECRET = process.env.AUTH_SECRET || "";

// VAs may only touch these paths; everything else is admin-only.
function vaAllowed(p: string): boolean {
  return (
    p === "/va" ||
    p.startsWith("/api/va/") ||
    p.startsWith("/api/accounts") ||
    p.startsWith("/api/auth/")
  );
}

export async function middleware(req: NextRequest) {
  // Auth disabled until configured — keeps the app usable before env is set.
  if (!SECRET) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();

  // Machine endpoints that authenticate with their own secret
  // (Chrome-extension ingest, external cron) — not with a session cookie.
  if (
    pathname === "/api/discovery/ingest" ||
    ((pathname === "/api/enrich" || pathname === "/api/discovery/run") && req.method === "GET")
  ) {
    return NextResponse.next();
  }

  // Telegram bot routes: the webhook validates its own path/header secret,
  // and setup/status are safe to reach without a session cookie.
  if (pathname.startsWith("/api/telegram/")) return NextResponse.next();

  // Internal server-to-server calls from the Telegram webhook carry a
  // shared secret header instead of a session cookie.
  const internal = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (internal && req.headers.get("x-internal-secret") === internal) return NextResponse.next();

  const session = await verifyToken(req.cookies.get(COOKIE)?.value || "", SECRET);
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (session.r === "va" && !vaAllowed(pathname)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = "/va";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
