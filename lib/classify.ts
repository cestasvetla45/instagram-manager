// ─────────────────────────────────────────────────────────────
//  Scrape-time enrichment shared by every import path:
//    • assumeNiche — inherit the account's niche, else AI-guess one
//    • classifyFormat — single- vs multi-person from the thumbnail
//  Both are best-effort and gated by live discovery settings, so a
//  rate-limited or unconfigured Gemini never blocks a scrape.
// ─────────────────────────────────────────────────────────────
import { db, TABLES } from "./db";
import { classifyFormatFromThumbnail, assessCreatorFit, geminiConfigured } from "./gemini";
import { DiscoverySettings } from "./settings";

// Row patch: { format, format_source } from the cover thumbnail, or {}.
export async function thumbnailFormatPatch(
  thumbnailUrl: string | null | undefined,
  caption: string,
  cfg: DiscoverySettings
): Promise<Record<string, string>> {
  if (!cfg.classifyFormat || !geminiConfigured() || !thumbnailUrl) return {};
  const g = await classifyFormatFromThumbnail(thumbnailUrl, caption);
  if (!g || g.format === "unknown") return {};
  return { format: g.format, format_source: "thumbnail" };
}

// The niche to apply to an account's reels while scraping.
// 1) inherit the account's existing niche; else 2) AI-guess from bio+captions
// (persisted onto the account + registered in the niches list) if enabled.
export async function assumedAccountNiche(
  handle: string,
  bio: string,
  captions: string[],
  cfg: DiscoverySettings
): Promise<string> {
  const clean = (handle || "").replace(/^@/, "").trim();
  try {
    const { data } = await db()
      .from(TABLES.inspirationAccounts)
      .select("niche")
      .ilike("handle", clean)
      .limit(1);
    const existing = data?.[0]?.niche ? String(data[0].niche).trim() : "";
    if (existing) return existing;
  } catch {
    /* fall through to guess */
  }

  if (!cfg.assumeNiche || !geminiConfigured()) return "";

  let niches: string[] = [];
  try {
    const { data } = await db().from("niches").select("name").limit(200);
    niches = (data || []).map((n: any) => String(n.name)).filter(Boolean);
  } catch {
    /* empty list is fine */
  }

  try {
    const fit = await assessCreatorFit(clean, bio, captions.slice(0, 5), niches);
    const niche = fit?.niche?.trim();
    if (!niche) return "";
    // Register a brand-new niche so it shows up in filters, and pin it on the account.
    const exists = niches.some((n) => n.toLowerCase() === niche.toLowerCase());
    if (!exists) {
      try {
        await db().from("niches").upsert(
          { name: niche, slug: niche.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") },
          { onConflict: "name" }
        );
      } catch {
        /* best effort */
      }
    }
    try {
      await db()
        .from(TABLES.inspirationAccounts)
        .update({ niche, updated_at: new Date().toISOString() })
        .ilike("handle", clean);
    } catch {
      /* best effort */
    }
    return niche;
  } catch {
    return "";
  }
}
