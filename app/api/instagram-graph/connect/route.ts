import { NextResponse } from "next/server";
import { getOAuthUrl, oauthConfigured } from "@/lib/instagram-graph";

export const runtime = "nodejs";

// GET — returns the Instagram OAuth login URL for the user to click.
export async function GET() {
  if (!oauthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "OAuth not configured. Set META_APP_ID and META_APP_SECRET." },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, url: getOAuthUrl() });
}
