import { NextRequest, NextResponse } from "next/server";
import { scrapeProfile } from "@/lib/rocksolid";
import { TABLES, createRecords, updateRecord, findByHandle } from "@/lib/airtable";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { username: string, target: "inspiration" | "our", why?: string, niche?: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const target = body.target === "our" ? "our" : "inspiration";
    const username = String(body.username || "").replace(/^@/, "").trim();
    if (!username) {
      return NextResponse.json({ error: "username required" }, { status: 400 });
    }

    const p = await scrapeProfile(username);
    const table = target === "our" ? TABLES.ourAccounts : TABLES.inspirationAccounts;

    const fields: Record<string, any> = {
      Handle: p.username,
      "Profile URL": `https://www.instagram.com/${p.username}/`,
      Niche: body.niche || "",
      Followers: p.followers,
      Following: p.following,
      "Posts Count": p.postsCount,
    };
    if (p.profilePicUrl) fields["Profile Pic"] = [{ url: p.profilePicUrl }];
    if (target === "inspiration") {
      fields["Full Name"] = p.fullName;
      fields["Bio"] = p.bio;
      fields["Why Saved"] = body.why || "";
      fields["Date Added"] = new Date().toISOString().slice(0, 10);
    } else {
      fields["Notes"] = body.why || "";
    }

    const existing = await findByHandle(table, "Handle", username);
    if (existing) {
      await updateRecord(table, existing.id, fields);
      return NextResponse.json({ ok: true, created: false, profile: p });
    }
    await createRecords(table, [{ fields }]);
    return NextResponse.json({ ok: true, created: true, profile: p });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
