// ─────────────────────────────────────────────────────────────
//  Shared reel categorization — used by the categorize API route
//  AND the Railway worker (autoCategorizeNew). Fetches a reel's
//  stored video, runs the Gemini full categorizer, applies a
//  niche-aware sanity check, and writes the result back.
// ─────────────────────────────────────────────────────────────
import { db, TABLES } from "./db";
import { categorizeVideoFull, geminiConfigured, FullCategory } from "./gemini";

const CONF_THRESHOLD = 0.85;

export type CategorizeResult = {
  ok: boolean;
  reel_url: string;
  sub_category?: string | null;
  sub_category_confidence?: number | null;
  low_confidence: boolean;
  notes?: string | null;
  error?: string;
};

// Download the stored MP4 bytes from its public URL.
async function fetchVideoBytes(url: string): Promise<{ bytes: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0] || "video/mp4";
    return { bytes: Buffer.from(await res.arrayBuffer()), mime };
  } catch {
    return null;
  }
}

// Most common non-null value in an array ("" when empty).
function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = "";
  let n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
}

// Niche/sub-category combos that are almost always a mis-classification.
const UNLIKELY_SUBCATS: Record<string, string[]> = {
  "tall girl": ["cooking"],
  "tall": ["cooking"],
  "gaze": ["cooking", "gym"],
};

// STEP 8 — niche-aware sanity check. Returns any flags to store in
// categorization_notes; a non-empty result means "verify manually".
function sanityNotes(reel: any, result: FullCategory, accountSub: string): string {
  const flags: string[] = [];
  const niche = String(reel.niche || "").toLowerCase();
  const sub = result.sub_category;
  const conf = result.sub_category_confidence;

  // 1) implausible niche → sub-category pairing
  for (const [nk, bad] of Object.entries(UNLIKELY_SUBCATS)) {
    if (sub && niche.includes(nk) && bad.includes(sub)) {
      flags.push(`niche "${reel.niche}" rarely produces "${sub}" — likely wrong`);
    }
  }

  // 2) drift from the account's established sub-category at low confidence
  if (accountSub && sub && accountSub !== sub && conf < 0.9) {
    flags.push(`account usually "${accountSub}" but this got "${sub}" (${conf.toFixed(2)}) — review`);
  }

  // 3) spam tray can't be multi-person
  if (reel.tray === "spam" && result.format === "multi") {
    flags.push(`spam tray but multi-person video — reassigned to regular`);
  }

  return flags.join("; ");
}

// Categorize a single inspiration_reels row (already fetched) and persist.
export async function categorizeReelRow(reel: any): Promise<CategorizeResult> {
  const url = reel.reel_url;
  const fail = (error: string): CategorizeResult => ({ ok: false, reel_url: url, low_confidence: false, error });

  if (!geminiConfigured()) return fail("gemini_not_configured");
  if (!reel.video_url) return fail("no_video");

  const v = await fetchVideoBytes(reel.video_url);
  if (!v) return fail("video_fetch_failed");

  let niches: string[] = [];
  try {
    const { data } = await db().from("niches").select("name").limit(200);
    niches = (data || []).map((n: any) => String(n.name)).filter(Boolean);
  } catch {
    /* niche context is optional */
  }

  const result = await categorizeVideoFull(v.bytes, v.mime, niches, reel.caption || "");

  // The account's dominant sub-category (for drift detection).
  let accountSub = "";
  try {
    const handle = reel.author_handle;
    if (handle) {
      const { data } = await db()
        .from(TABLES.inspirationReels)
        .select("sub_category")
        .ilike("author_handle", handle)
        .not("sub_category", "is", null)
        .neq("reel_url", url)
        .limit(200);
      accountSub = mode((data || []).map((r: any) => String(r.sub_category)).filter(Boolean));
    }
  } catch {
    /* best effort */
  }

  const notes = sanityNotes(reel, result, accountSub);
  const conf = result.sub_category_confidence;
  const lowConf = conf < CONF_THRESHOLD || !result.sub_category;

  // Policy: only commit a sub-category we're confident about. When uncertain,
  // keep any existing (manual) value rather than erasing it → review queue.
  const subToStore = result.sub_category && !lowConf ? result.sub_category : (reel.sub_category || null);

  const now = new Date().toISOString();
  const patch: Record<string, any> = {
    sub_category: subToStore,
    sub_category_confidence: conf,
    sub_category_reason: result.sub_category_reason || null,
    ai_categorized_at: now,
    categorization_notes: notes || null,
    updated_at: now,
  };

  // Video-based person-count is more reliable than the thumbnail guess.
  if (result.format && result.format !== "unknown") {
    patch.format = result.format;
    patch.format_source = "video";
  }
  // Fill an empty niche from the AI guess (never overwrite a set niche).
  if (!reel.niche && result.niche) patch.niche = result.niche;

  // Spam tray can't be multi-person → auto-reassign to regular (STEP 3).
  if (reel.tray === "spam" && result.format === "multi") patch.tray = "regular";

  await db().from(TABLES.inspirationReels).update(patch).eq("reel_url", url);

  return {
    ok: true,
    reel_url: url,
    sub_category: subToStore,
    sub_category_confidence: conf,
    low_confidence: lowConf || Boolean(notes),
    notes: notes || null,
  };
}

// Worker entry point — categorize a batch of freshly-discovered reels.
export async function autoCategorizeNew(limit = 8): Promise<any> {
  if (!geminiConfigured()) return { categorized: 0, skipped: "gemini_not_configured" };

  const { data } = await db()
    .from(TABLES.inspirationReels)
    .select("*")
    .is("sub_category", null)
    .is("ai_categorized_at", null)
    .not("video_url", "is", null)
    .limit(Math.min(Math.max(limit, 1), 8));
  const rows = data || [];

  let categorized = 0;
  let low = 0;
  const failed: any[] = [];
  for (const reel of rows) {
    try {
      const r = await categorizeReelRow(reel);
      if (r.ok) {
        categorized++;
        if (r.low_confidence) low++;
      } else {
        failed.push({ reel_url: reel.reel_url, error: r.error });
      }
    } catch (e: any) {
      failed.push({ reel_url: reel.reel_url, error: e?.message || String(e) });
    }
  }
  return { scanned: rows.length, categorized, low_confidence: low, failed };
}
