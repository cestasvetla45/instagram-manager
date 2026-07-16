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
// Flow: code → short-lived user token → long-lived user token → the user's
// Pages → each Page's linked Instagram Business account. We store one
// instagram_tokens row per IG account, keyed by ig_account_id, with the
// PAGE access token (that's the token the IG Graph API accepts).
export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const back = (params: Record<string, string>) => {
    const u = new URL("/va-management", origin);
    u.searchParams.set("tab", "Instagram Connect");
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return NextResponse.redirect(u.toString());
  };

  const url = new URL(req.url);
  const err = url.searchParams.get("error") || url.searchParams.get("error_reason");
  if (err) return back({ ig_error: url.searchParams.get("error_description") || err });

  const code = url.searchParams.get("code");
  if (!code) return back({ ig_error: "Missing authorization code." });
  if (!oauthConfigured()) return back({ ig_error: "OAuth not configured (META_APP_ID/SECRET)." });

  try {
    // 1. code → short-lived user token
    const short = await exchangeCodeForToken(code);
    if (short?.error) return back({ ig_error: short.error.message || "Token exchange failed." });
    const shortToken = short?.access_token;
    if (!shortToken) return back({ ig_error: "No access token returned." });

    // 2. short → long-lived user token (~60 days)
    const long = await getLongLivedToken(shortToken);
    const userToken = long?.access_token || shortToken;
    const expiresIn = Number(long?.expires_in) || 5184000; // default 60 days
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 3. the user's Facebook Pages (each has its own page token)
    const pagesRes = await getUserPages(userToken);
    if (pagesRes?.error) return back({ ig_error: pagesRes.error.message || "Could not list Pages." });
    const pages: any[] = Array.isArray(pagesRes?.data) ? pagesRes.data : [];
    if (!pages.length) {
      return back({
        ig_error:
          "No Facebook Pages found. The Instagram account must be a Business/Creator account linked to a Facebook Page.",
      });
    }

    // 4. per Page: the linked IG Business account → upsert instagram_tokens
    const nowIso = new Date().toISOString();
    const connected: string[] = [];
    for (const page of pages) {
      const pageToken = page?.access_token;
      if (!page?.id || !pageToken) continue;

      const igRes = await getPageIGAccount(page.id, pageToken);
      const ig = igRes?.instagram_business_account;
      if (!ig?.id) continue; // page has no IG account linked

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
        await db()
          .from("instagram_tokens")
          .insert({ ...row, connected_at: nowIso, created_at: nowIso });
      }
      connected.push(igUsername || String(ig.id));
    }

    if (!connected.length) {
      return back({
        ig_error:
          "None of your Facebook Pages has an Instagram Business account linked. Link the IG account to a Page in Instagram settings, then retry.",
      });
    }
    return back({ ig_connected: connected.join(", ") });
  } catch (e: any) {
    return back({ ig_error: e?.message || String(e) });
  }
}
