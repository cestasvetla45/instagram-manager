import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  exchangeCodeForToken,
  getLongLivedToken,
  oauthConfigured,
} from "@/lib/instagram-graph";

export const runtime = "nodejs";

// GET — the OAuth redirect target. Instagram sends ?code=… (or ?error=…).
// Instagram Login flow: code → short-lived token → long-lived token → profile.
// No Facebook Page needed — the token IS the Instagram token.
export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const back = (params: Record<string, string>) => {
    const u = new URL("/connect", origin);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return NextResponse.redirect(u.toString());
  };

  const url = new URL(req.url);
  const err = url.searchParams.get("error") || url.searchParams.get("error_reason");
  if (err) return back({ error: url.searchParams.get("error_description") || err });

  const code = url.searchParams.get("code");
  if (!code) return back({ error: "Missing authorization code." });
  if (!oauthConfigured()) return back({ error: "OAuth not configured (META_APP_ID/SECRET)." });

  try {
    // 1. code → short-lived access token (Instagram)
    const short = await exchangeCodeForToken(code);
    if (short?.error) return back({ error: short.error.message || "Token exchange failed." });
    const shortToken = short?.access_token;
    const igUserId = short?.user_id;
    if (!shortToken) return back({ error: "No access token returned." });

    // 2. short → long-lived token (~60 days)
    const long = await getLongLivedToken(shortToken);
    if (long?.error) return back({ error: long.error.message || "Long-lived token exchange failed." });
    const token = long?.access_token || shortToken;
    const expiresIn = Number(long?.expires_in) || 5184000; // default 60 days
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 3. Get the IG profile (username, followers)
    const profileRes = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=username,followers_count,media_count,account_type&access_token=${token}`
    );
    const profile = await profileRes.json();
    if (profile?.error) return back({ error: profile.error.message || "Profile fetch failed." });

    const igUsername = profile?.username || "";
    const handle = igUsername ? String(igUsername).toLowerCase() : null;
    const nowIso = new Date().toISOString();

    const row = {
      account_handle: handle,
      ig_account_id: String(igUserId || ""),
      ig_username: igUsername,
      access_token: token,
      token_expires_at: expiresAt,
      follower_count: Number(profile?.followers_count || 0),
      is_active: true,
      updated_at: nowIso,
    };

    // Upsert by ig_account_id
    const { data: existing } = await db()
      .from("instagram_tokens")
      .select("id")
      .eq("ig_account_id", row.ig_account_id)
      .limit(1);

    if (existing?.[0]?.id) {
      await db().from("instagram_tokens").update(row).eq("id", existing[0].id);
    } else {
      await db()
        .from("instagram_tokens")
        .insert({ ...row, connected_at: nowIso, created_at: nowIso });
    }

    return back({ success: "true" });
  } catch (e: any) {
    return back({ error: e?.message || String(e) });
  }
}
