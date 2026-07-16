// ─────────────────────────────────────────────────────────────
//  Automatic creator discovery.
//
//  Finds NEW trending creators to add to the inspiration library:
//    Harvest (cheap, mostly DB-only):
//      • caption @mentions on inspiration reels already in the DB
//      • collab coauthors surfaced while listing reels
//      • commenter usernames on top-scoring recent inspiration reels
//        (a few reels per cycle — each costs API calls)
//    Vet (budgeted API calls per cycle):
//      • profile check → public, has clips, follower range
//      • first page of their reels → discovery score (same 0–10 rubric)
//      • optional Gemini text pass → niche guess + fit (if GEMINI_API_KEY)
//    Review:
//      • suggested candidates appear on /discovery; Approve inserts the
//        account into inspiration_accounts, where the existing enrichment
//        backlog worker imports their top reels automatically.
// ─────────────────────────────────────────────────────────────
import { db, TABLES } from "./db";
import { scrapeProfile, scrapeUserReels, scrapeCommentUsers } from "./rocksolid";
import { inspirationScore } from "./score";
import { assessCreatorFit } from "./gemini";
import { getDiscoverySettings, DiscoverySettings } from "./settings";

export const CANDIDATES_TABLE = "discovery_candidates";

// Browser-sourced kinds come from the Chrome extension riding a logged-in
// discovery profile (related profiles, Explore, IG's own suggestions).
type Source =
  | "mention"
  | "coauthor"
  | "comment"
  | "related"
  | "suggested"
  | "explore"
  | "manual";

const SOURCES: Source[] = ["mention", "coauthor", "comment", "related", "suggested", "explore", "manual"];

export function isSource(s: string): s is Source {
  return (SOURCES as string[]).includes(s);
}

const nowISO = () => new Date().toISOString();

// Handles that are never creators.
const JUNK = new Set([
  "instagram", "meta", "reels", "explore", "p", "tv", "stories",
]);

function validHandle(h: string): boolean {
  const t = (h || "").toLowerCase().trim();
  return /^[a-z0-9._]{2,30}$/.test(t) && !JUNK.has(t) && !/^\d+$/.test(t);
}

export function extractMentions(caption: string): string[] {
  const out = new Set<string>();
  const re = /@([A-Za-z0-9._]{2,30})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(caption || ""))) {
    const h = m[1].toLowerCase().replace(/\.+$/, "");
    if (validHandle(h)) out.add(h);
  }
  return [...out];
}

// Every handle we already know (library, our accounts, existing candidates
// in a terminal state) — never re-suggest these.
async function knownHandles(): Promise<Set<string>> {
  const known = new Set<string>();
  const [insp, ours] = await Promise.all([
    db().from(TABLES.inspirationAccounts).select("handle").limit(10000),
    db().from(TABLES.ourAccounts).select("handle").limit(1000),
  ]);
  for (const r of insp.data || []) known.add(String(r.handle || "").toLowerCase());
  for (const r of ours.data || []) known.add(String(r.handle || "").toLowerCase());
  return known;
}

// Upsert a batch of sightings into discovery_candidates.
async function recordSightings(
  handles: string[],
  source: Source,
  sourceHandle: string,
  known: Set<string>
): Promise<number> {
  let added = 0;
  for (const h of handles) {
    const handle = h.toLowerCase();
    if (!validHandle(handle) || known.has(handle)) continue;
    const { data: rows } = await db()
      .from(CANDIDATES_TABLE)
      .select("id, status, sources, source_count, source_handles")
      .eq("handle", handle)
      .limit(1);
    const existing: any = rows?.[0];
    if (existing) {
      // Don't reopen decided candidates; just bump counters on live ones.
      if (["approved", "rejected", "rejected_auto"].includes(existing.status)) continue;
      const sources = { ...(existing.sources || {}) };
      sources[source] = (Number(sources[source]) || 0) + 1;
      const sh: string[] = Array.isArray(existing.source_handles) ? existing.source_handles : [];
      if (sourceHandle && !sh.includes(sourceHandle)) sh.push(sourceHandle);
      await db()
        .from(CANDIDATES_TABLE)
        .update({
          sources,
          source_count: Number(existing.source_count || 0) + 1,
          source_handles: sh.slice(0, 50),
          updated_at: nowISO(),
        })
        .eq("id", existing.id);
    } else {
      await db().from(CANDIDATES_TABLE).insert({
        handle,
        status: "pending",
        sources: { [source]: 1 },
        source_count: 1,
        source_handles: sourceHandle ? [sourceHandle] : [],
      });
      added++;
    }
  }
  return added;
}

// Called from reel-listing flows (enrichment/scrape) with coauthors we saw.
export async function recordCoauthors(coauthors: string[], sourceHandle: string) {
  if (!coauthors.length) return;
  try {
    const known = await knownHandles();
    await recordSightings(coauthors, "coauthor", sourceHandle, known);
  } catch {
    /* discovery is best-effort — never break the caller */
  }
}

// External ingest (Chrome extension / manual paste) → candidate queue.
export async function ingestHandles(
  handles: string[],
  source: Source,
  sourceHandle = ""
): Promise<{ received: number; added: number }> {
  const clean = [...new Set(handles.map((h) => String(h || "").toLowerCase().replace(/^@/, "").trim()))].filter(
    validHandle
  );
  if (!clean.length) return { received: handles.length, added: 0 };
  const known = await knownHandles();
  const added = await recordSightings(clean, source, sourceHandle, known);
  return { received: handles.length, added };
}

// ── Phase A: harvest ─────────────────────────────────────────

// Caption @mentions from inspiration reels not yet scanned. DB-only.
async function harvestMentions(known: Set<string>, limit = 300) {
  const { data } = await db()
    .from(TABLES.inspirationReels)
    .select("id, caption, author_handle")
    .is("discovery_scanned_at", null)
    .not("caption", "is", null)
    .limit(limit);
  let found = 0;
  const scannedIds: string[] = [];
  for (const r of data || []) {
    const mentions = extractMentions(r.caption || "").filter(
      (h) => h !== String(r.author_handle || "").toLowerCase()
    );
    found += await recordSightings(mentions, "mention", r.author_handle || "", known);
    // Mention scanning is complete for this reel. Comment mining marks the
    // same flag, so only flag reels that DON'T qualify for comment mining
    // here — comment-worthy ones get flagged when their comments are pulled.
    scannedIds.push(r.id);
  }
  return { scanned: scannedIds.length, found, scannedIds };
}

// Commenters on top-scoring, comment-rich inspiration reels (API calls).
async function harvestCommenters(known: Set<string>, reelBudget: number) {
  if (reelBudget <= 0) return { reels: 0, found: 0 };
  const { data } = await db()
    .from(TABLES.inspirationReels)
    .select("id, shortcode, author_handle, comments, inspiration_score")
    .is("discovery_scanned_at", null)
    .gte("comments", 50)
    .gte("inspiration_score", 6)
    .order("inspiration_score", { ascending: false })
    .limit(reelBudget);
  let found = 0,
    reels = 0;
  for (const r of data || []) {
    if (!r.shortcode) continue;
    try {
      const users = await scrapeCommentUsers(r.shortcode, 3);
      const handles = users
        .map((u) => u.username)
        .filter((h) => h !== String(r.author_handle || "").toLowerCase());
      found += await recordSightings(handles, "comment", r.author_handle || "", known);
      reels++;
    } catch {
      /* rate-limited — try again next cycle */
    }
    await db()
      .from(TABLES.inspirationReels)
      .update({ discovery_scanned_at: nowISO() })
      .eq("id", r.id);
  }
  return { reels, found };
}

// ── Phase B: vet ─────────────────────────────────────────────

async function vetOne(handle: string, cfg: DiscoverySettings): Promise<Record<string, any>> {
  const p = await scrapeProfile(handle);
  const raw: any = p.raw || {};
  const clips = Number(raw.total_clips_count || 0);
  const base: Record<string, any> = {
    full_name: p.fullName,
    bio: p.bio,
    followers: p.followers,
    following: p.following,
    posts_count: p.postsCount,
    clips_count: clips,
    is_private: Boolean(raw.is_private),
    is_verified: Boolean(raw.is_verified),
    profile_pic_url: p.profilePicUrl,
    vetted_at: nowISO(),
    updated_at: nowISO(),
  };

  // Hard filters — auto-reject with a reason (kept for transparency).
  if (raw.is_private) return { ...base, status: "rejected_auto", reject_reason: "private account" };
  if (p.followers < cfg.minFollowers)
    return { ...base, status: "rejected_auto", reject_reason: `only ${p.followers} followers (min ${cfg.minFollowers})` };
  if (p.followers > cfg.maxFollowers)
    return { ...base, status: "rejected_auto", reject_reason: `too big (${p.followers} followers) — likely celebrity/brand` };
  if (clips === 0 && p.postsCount < 5)
    return { ...base, status: "rejected_auto", reject_reason: "no reels / barely posts" };

  // Sample their recent reels (first page, ~12) → trend stats + score.
  const reels = await scrapeUserReels(handle, 12);
  if (!reels.length)
    return { ...base, status: "rejected_auto", reject_reason: "no reels returned (private/empty/rate-limited)" };

  const views = reels.map((r) => r.views || 0);
  const avg = Math.round(views.reduce((s, v) => s + v, 0) / views.length);
  const best = [...reels].sort((a, b) => (b.views || 0) - (a.views || 0))[0];
  const lastPosted = reels
    .map((r) => r.postedAtISO)
    .filter(Boolean)
    .sort()
    .pop() as string | undefined;

  // Score their BEST recent reel with the library rubric — "how hot is this
  // account's ceiling right now" — then nudge by consistency (avg/best).
  const bestScore = inspirationScore({
    views: best.views,
    likes: best.likes,
    comments: best.comments,
    followers: p.followers,
    postedAt: best.postedAtISO,
  });
  const consistency = best.views ? avg / best.views : 0; // 0..1
  const score = Math.round(Math.min(10, bestScore * (0.8 + 0.4 * consistency)) * 10) / 10;

  const out: Record<string, any> = {
    ...base,
    discovery_score: score,
    avg_views: avg,
    max_views: best.views || 0,
    view_follow_ratio: p.followers ? Math.round(((best.views || 0) / p.followers) * 100) / 100 : 0,
    reels_sampled: reels.length,
    last_posted_at: lastPosted || null,
    top_reels: [...reels]
      .sort((a, b) => (b.views || 0) - (a.views || 0))
      .slice(0, 3)
      .map((r) => ({
        url: r.url,
        views: r.views,
        likes: r.likes,
        thumbnail_url: r.thumbnailUrl,
        posted_at: r.postedAtISO,
      })),
  };

  // Stale accounts aren't "trending".
  if (lastPosted && Date.now() - Date.parse(lastPosted) > cfg.maxAgeDays * 86_400_000)
    return { ...out, status: "rejected_auto", reject_reason: `inactive — no post in ${cfg.maxAgeDays}+ days` };
  if (score < cfg.minScore)
    return { ...out, status: "rejected_auto", reject_reason: `discovery score ${score} below ${cfg.minScore}` };

  // Optional AI niche-fit (text-only, cheap).
  if (cfg.useAi) try {
    const { data: nicheRows } = await db().from("niches").select("name").limit(100);
    const niches = (nicheRows || []).map((n: any) => String(n.name)).filter(Boolean);
    const fit = await assessCreatorFit(handle, p.bio, reels.map((r) => r.caption).slice(0, 5), niches);
    if (fit) {
      out.ai_niche = fit.niche;
      out.ai_fit = fit.fit;
      out.ai_reason = fit.reason;
    }
  } catch {
    /* Gemini optional */
  }

  out.status = "suggested";
  return out;
}

async function vetPending(cfg: DiscoverySettings) {
  const budget = cfg.vetBudget;
  if (budget <= 0) return { vetted: 0, suggested: 0, autoRejected: 0, failed: 0 };
  const { data } = await db()
    .from(CANDIDATES_TABLE)
    .select("id, handle")
    .eq("status", "pending")
    .order("source_count", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(budget);
  let vetted = 0,
    suggested = 0,
    autoRejected = 0,
    failed = 0;
  for (const c of data || []) {
    try {
      const patch = await vetOne(c.handle, cfg);
      await db().from(CANDIDATES_TABLE).update(patch).eq("id", c.id);
      vetted++;
      if (patch.status === "suggested") suggested++;
      else autoRejected++;
    } catch {
      failed++; // stays pending; retried next cycle
    }
  }
  return { vetted, suggested, autoRejected, failed };
}

// ── Orchestrator (worker + on-demand API) ────────────────────

export async function runDiscovery(opts: { commentReels?: number; vetBudget?: number } = {}) {
  const cfg = await getDiscoverySettings();
  // Per-call overrides (e.g. the "Run now" button) beat the saved settings.
  if (opts.commentReels != null) cfg.commentReels = opts.commentReels;
  if (opts.vetBudget != null) cfg.vetBudget = opts.vetBudget;

  const known = await knownHandles();
  const mentions = await harvestMentions(known);
  const commenters = await harvestCommenters(known, cfg.commentReels);

  // Reels scanned for mentions but not comment-mined this cycle still count
  // as scanned — comment mining only targets top reels, the rest would
  // otherwise be re-scanned forever.
  if (mentions.scannedIds.length) {
    for (let i = 0; i < mentions.scannedIds.length; i += 100) {
      await db()
        .from(TABLES.inspirationReels)
        .update({ discovery_scanned_at: nowISO() })
        .in("id", mentions.scannedIds.slice(i, i + 100));
    }
  }

  const vetting = await vetPending(cfg);

  const { count: pendingCount } = await db()
    .from(CANDIDATES_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  const { count: suggestedCount } = await db()
    .from(CANDIDATES_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("status", "suggested");

  return {
    mentions: { scanned: mentions.scanned, newCandidates: mentions.found },
    commenters,
    vetting,
    queue: { pending: pendingCount || 0, suggested: suggestedCount || 0 },
  };
}
