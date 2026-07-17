import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  exchangeCodeForToken,
  getLongLivedToken,
  getUserPages,
  getPageIGAccount,
  oauthConfigured,
} from "@/lib/instagram-graph";

export const runtime = "nodejs";

// GET — the OAuth redirect target. Facebook sends ?code=… (or ?error=…).
// Flow: code → short-lived user token → long-lived user token → pages → IG account.
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
    // 1. code → short-lived user token
    const short = await exchangeCodeForToken(code);
    if (short?.error) return back({ error: short.error.message || "Token exchange failed." });
    const shortToken = short?.access_token;
    if (!shortToken) return back({ error: "No access token returned." });

    // 2. short → long-lived user token (~60 days)
    const long = await getLongLivedToken(shortToken);
    const userToken = long?.access_token || shortToken;
    const expiresIn = Number(long?.expires_in) || 5184000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 3. Get user's Facebook Pages
    const pagesRes = await getUserPages(userToken);
    if (pagesRes?.error) return back({ error: pagesRes.error.message || "Could not list Pages." });
    const pages: any[] = Array.isArray(pagesRes?.data) ? pagesRes.data : [];
    if (!pages.length) {
      return back({ error: "No Facebook Pages found. Link your Instagram to a Facebook Page first." });
    }

    // 4. Per Page: get the linked IG Business account → store
    const nowIso = new Date().toISOString();
    const connected: string[] = [];
    for (const page of pages) {
      const pageToken = page?.access_token;
      if (!page?.id || !pageToken) continue;

      const igRes = await getPageIGAccount(page.id, pageToken);
      const ig = igRes?.instagram_business_account;
      if (!ig?.id) continue;

      const igUsername = ig.username || null;
      const handle = igUsername ? String(igUsername).toLowerCase() : null;
      const row = {
        account_handle: handle,
        ig_account_id: String(ig.id),
        ig_username: igUsername,
        access_token: pageToken,
        token_expires_at: expiresAt,
        follower_count: Number(ig.followers_count || 0),
        is_active: true,
        updated_at: nowIso,
      };

      const { data: existing } = await db()
        .from("instagram_tokens")
        .select("id")
        .eq("ig_account_id", row.ig_account_id)
        .limit(1);

      if (existing?.[0]?.id) {
        await db().from("instagram_tokens").update(row).eq("id", existing[0].id);
      } else {
        await db().from("instagram_tokens").insert({ ...row, connected_at: nowIso, created_at: nowIso });
      }
      connected.push(igUsername || String(ig.id));
    }

    if (!connected.length) {
      return back({ error: "No Instagram Business account linked to your Facebook Page." });
    }
    return back({ success: "true" });
  } catch (e: any) {
    return back({ error: e?.message || String(e) });
  }
}
