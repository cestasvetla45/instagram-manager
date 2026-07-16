// ─────────────────────────────────────────────────────────────
//  Inspiration scoring rubric → a 0–10 score (decimals allowed).
//
//  Weights (views & views/follower ratio carry the most):
//    • Reach ratio  (views ÷ followers)  — 35%   "how viral relative to size"
//    • Raw reach    (views)              — 30%
//    • Velocity     (views ÷ day live)   — 20%   "more views, faster = better"
//    • Engagement   (likes+comments/view)— 15%   (comments weighted 3× likes)
//
//  Heavy-tailed metrics are log-scaled then normalised to 0..1 against a
//  "this is excellent" ceiling, so a 10 means truly elite on every axis.
// ─────────────────────────────────────────────────────────────

export type ScoreInput = {
  views: number;
  likes: number;
  comments: number;
  followers: number;
  postedAt?: string | null; // ISO
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const log = (x: number) => Math.log10(Math.max(x, 0) + 1);

function ageDays(postedAt?: string | null): number {
  if (!postedAt) return 14; // unknown → assume two weeks old (neutral)
  const t = Date.parse(postedAt);
  if (isNaN(t)) return 14;
  return Math.max((Date.now() - t) / 86_400_000, 0.5);
}

export function inspirationScore(i: ScoreInput): number {
  const views = Math.max(0, i.views || 0);
  const followers = Math.max(0, i.followers || 0);
  const likes = Math.max(0, i.likes || 0);
  const comments = Math.max(0, i.comments || 0);
  const days = ageDays(i.postedAt);

  // Reach ratio: views per follower. 1× = on par, 20×+ = elite/viral.
  // If followers are unknown (0 = scrape failed), stay NEUTRAL rather than
  // assuming virality — otherwise a failed follower lookup fakes a top score.
  const ratioScore =
    followers > 0 ? clamp01(log(views / followers) / log(20)) : 0.5;

  // Raw reach: 3M views → 1.0 (log-scaled).
  const viewsScore = clamp01(log(views) / log(3_000_000));

  // Velocity: views/day. 300k/day → 1.0.
  const vpd = views / days;
  const velocityScore = clamp01(log(vpd) / log(300_000));

  // Engagement: comments weighted 3× likes, per view. ~5% weighted → 1.0.
  const weighted = likes + comments * 3;
  const engRate = views > 0 ? weighted / views : 0;
  const engScore = clamp01(engRate / 0.05);

  const raw =
    0.35 * ratioScore +
    0.30 * viewsScore +
    0.20 * velocityScore +
    0.15 * engScore;

  return Math.round(raw * 10 * 10) / 10; // 0–10, one decimal
}

// Color band for the UI badge.
export function scoreColor(score: number | null | undefined): string {
  const s = Number(score || 0);
  if (s >= 8) return "#16a34a"; // strong green
  if (s >= 6.5) return "#4ade80"; // green
  if (s >= 5) return "#a3e635"; // lime
  if (s >= 3.5) return "#eab308"; // amber
  if (s >= 2) return "#f97316"; // orange
  return "#ef4444"; // red
}
