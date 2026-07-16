// ─────────────────────────────────────────────────────────────
//  Reel performance orchestration.
//  Sits between the reel_performance table and the AI analysis in
//  lib/screenshot-analysis.ts. Also distils "winner templates"
//  from the reels that performed well and suggests fresh
//  inspiration that matches a winning pattern.
// ─────────────────────────────────────────────────────────────

import { db } from "./db";
import {
  analyzeReelScreenshot,
  analyzeReelWithoutScreenshots,
  type ReelAnalysis,
} from "./screenshot-analysis";

const PERF = "reel_performance";
const TEMPLATES = "winner_templates";
const HOUR = 3600 * 1000;

// Reels scoring at/above this are flagged winners and feed templates.
const WINNER_SCORE = Number(process.env.WINNER_SCORE || 7);

// Run the right analysis for a single reel_performance row.
export async function analyzeReelRow(row: any): Promise<ReelAnalysis> {
  const shots: string[] = Array.isArray(row?.screenshot_urls) ? row.screenshot_urls.filter(Boolean) : [];
  if (shots.length) return analyzeReelScreenshot(shots);
  if (row?.reel_url) return analyzeReelWithoutScreenshots(row.reel_url, row.inspiration_reel_url || undefined);
  throw new Error("Reel has neither screenshots nor a reel_url to analyze");
}

// Persist an analysis onto a reel_performance row and mark it analyzed.
export async function saveAnalysis(id: string, a: ReelAnalysis): Promise<void> {
  const isWinner = a.score >= WINNER_SCORE;
  const { error } = await db()
    .from(PERF)
    .update({
      retention_graph: a.retention_graph,
      avg_retention: a.avg_retention,
      skip_rate: a.skip_rate,
      peak_retention: a.peak_retention,
      drop_off_points: a.drop_off_points,
      demographics: a.demographics,
      top_territories: a.top_territories,
      ai_feedback: a.feedback,
      ai_strengths: a.strengths,
      ai_weaknesses: a.weaknesses,
      ai_score: a.score,
      is_winner: isWinner,
      ai_analyzed_at: new Date().toISOString(),
      status: "analyzed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

// Analyze one specific reel by id or reel_url.
export async function analyzeOne(opts: { id?: string; reel_url?: string }): Promise<any> {
  let q = db().from(PERF).select("*").limit(1);
  if (opts.id) q = q.eq("id", opts.id);
  else if (opts.reel_url) q = q.eq("reel_url", opts.reel_url);
  else throw new Error("id or reel_url required");
  const { data, error } = await q;
  if (error) throw error;
  const row = (data || [])[0];
  if (!row) throw new Error("Reel performance row not found");
  const analysis = await analyzeReelRow(row);
  await saveAnalysis(row.id, analysis);
  return { id: row.id, reel_url: row.reel_url, score: analysis.score, is_winner: analysis.score >= WINNER_SCORE };
}

// Find reels that are 24h+ old and not yet analyzed, and analyze a batch.
export async function analyzeDueReels(opts: { limit?: number } = {}): Promise<{
  analyzed: number;
  winners: number;
  failed: { id: string; error: string }[];
}> {
  const limit = Math.max(1, Math.min(20, opts.limit ?? 5));
  const cutoff = new Date(Date.now() - 24 * HOUR).toISOString();
  const { data, error } = await db()
    .from(PERF)
    .select("*")
    .eq("status", "posted")
    .is("ai_analyzed_at", null)
    .lt("posted_at", cutoff)
    .order("posted_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  let analyzed = 0;
  let winners = 0;
  const failed: { id: string; error: string }[] = [];
  for (const row of data || []) {
    try {
      const a = await analyzeReelRow(row);
      await saveAnalysis(row.id, a);
      analyzed++;
      if (a.score >= WINNER_SCORE) winners++;
    } catch (e: any) {
      failed.push({ id: row.id, error: e?.message || String(e) });
    }
  }
  return { analyzed, winners, failed };
}

// ── Stats for the UI ──────────────────────────────────────────
export async function getPerformanceStats(
  opts: { account_handle?: string } = {}
): Promise<{
  total: number;
  analyzed: number;
  pending: number;
  winners: number;
  avg_score: number;
  avg_retention: number;
  top_reels: any[];
}> {
  let q = db()
    .from(PERF)
    .select("id, reel_url, account_handle, ai_score, avg_retention, views_24h, is_winner, status, ai_analyzed_at")
    .limit(5000);
  if (opts.account_handle) q = q.eq("account_handle", opts.account_handle);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data || [];

  const analyzedRows = rows.filter((r: any) => r.ai_analyzed_at);
  const scores = analyzedRows.map((r: any) => Number(r.ai_score)).filter((n: number) => !isNaN(n));
  const rets = analyzedRows.map((r: any) => Number(r.avg_retention)).filter((n: number) => !isNaN(n));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const top = [...analyzedRows]
    .sort((a: any, b: any) => Number(b.ai_score || 0) - Number(a.ai_score || 0))
    .slice(0, 10);

  return {
    total: rows.length,
    analyzed: analyzedRows.length,
    pending: rows.length - analyzedRows.length,
    winners: rows.filter((r: any) => r.is_winner).length,
    avg_score: Number(avg(scores).toFixed(2)),
    avg_retention: Number(avg(rets).toFixed(2)),
    top_reels: top,
  };
}

// ── small numeric helpers reused below ────────────────────────
const asNum = (v: any) => (isNaN(Number(v)) ? 0 : Number(v));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// Thresholds that define a "winning" pattern / reel (Task 5b spec).
const GROUP_MIN = 3; // reels needed before a group counts as a pattern
const PATTERN_RETENTION = 60;
const PATTERN_SCORE = 6;
const WINNER_REEL_SCORE = 8;
const WINNER_REEL_RETENTION = 70;

// ── Retention curve classification ────────────────────────────
// Classify a reel's retention_graph into one of four shapes:
//   "U-shape"   dips in the middle then recovers toward the end
//   "declining" steady fall from start to finish
//   "spike-end" gains toward the end (peaks late)
//   "flat"      stays roughly consistent throughout
export function classifyRetentionCurve(graph: any): string {
  const pts = (Array.isArray(graph) ? graph : [])
    .map((p: any) => ({ second: Number(p?.second), retention: Number(p?.retention) }))
    .filter((p: any) => Number.isFinite(p.second) && Number.isFinite(p.retention))
    .sort((a: any, b: any) => a.second - b.second);
  if (pts.length < 3) return "flat";

  const rets = pts.map((p: any) => p.retention);
  const n = rets.length;
  const first = rets[0];
  const last = rets[n - 1];
  const min = Math.min(...rets);
  const max = Math.max(...rets);
  const minIdx = rets.indexOf(min);
  const range = max - min;

  // Very little movement over the whole clip.
  if (range <= 10) return "flat";

  // Dips in the middle third, then climbs back up meaningfully.
  const inMiddle = minIdx > 0 && minIdx < n - 1;
  if (inMiddle && last - min >= range * 0.3) return "U-shape";

  // Peaks late — ends at/near the maximum and above where it started.
  if (last >= max - range * 0.15 && last > first) return "spike-end";

  // Otherwise it trends down over time.
  return "declining";
}

// ── Trend identification + winner-template distillation ───────
// Groups every analyzed reel by (content_type, sub_category, niche)
// — taken from its linked concept — and, for each group of 3+ reels
// that averages strong retention and AI score, upserts a
// winner_templates row. Also flags standout individual reels and
// tags each reel with its retention-curve shape.
export async function identifyTrends(): Promise<{
  winner_templates: any[];
  trend_summaries: any[];
  total_analyzed: number;
}> {
  const { data, error } = await db()
    .from(PERF)
    .select(
      "id, concept_id, avg_retention, skip_rate, views_24h, ai_score, retention_graph, inspiration_reel_url"
    )
    .eq("status", "analyzed")
    .limit(5000);
  if (error) throw error;
  const reels = data || [];

  // Resolve concept metadata (content_type, sub_category, niche) once.
  const conceptIds = Array.from(new Set(reels.map((r: any) => r.concept_id).filter(Boolean)));
  const concepts = new Map<string, any>();
  if (conceptIds.length) {
    const { data: cs } = await db()
      .from("content_concepts")
      .select("id, name, content_type, subniche, niche, hook_text")
      .in("id", conceptIds as string[]);
    for (const c of cs || []) concepts.set(c.id, c);
  }

  const metaFor = (r: any) => {
    const c = r.concept_id ? concepts.get(r.concept_id) : null;
    return {
      content_type: c?.content_type || null,
      sub_category: c?.subniche || null,
      niche: c?.niche || null,
    };
  };

  // Tag every reel with its retention-curve shape (cheap; helps the UI).
  // Best-effort: if the retention_curve column hasn't been migrated yet,
  // don't let it break trend identification — just skip the tagging.
  try {
    const results = await Promise.all(
      reels
        .map((r: any) => ({ r, curve: classifyRetentionCurve(r.retention_graph) }))
        .map(({ r, curve }: any) =>
          db()
            .from(PERF)
            .update({ retention_curve: curve, updated_at: new Date().toISOString() })
            .eq("id", r.id)
        )
    );
    if (results.some((res: any) => res?.error)) {
      // eslint-disable-next-line no-console
      console.warn("retention_curve tagging skipped:", results.find((res: any) => res?.error)?.error?.message);
    }
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn("retention_curve tagging failed:", e?.message || e);
  }

  // Flag standout individual reels (score > 8 AND retention > 70).
  const winnerIds = reels
    .filter(
      (r: any) =>
        asNum(r.ai_score) > WINNER_REEL_SCORE && asNum(r.avg_retention) > WINNER_REEL_RETENTION
    )
    .map((r: any) => r.id);
  if (winnerIds.length) {
    await db().from(PERF).update({ is_winner: true }).in("id", winnerIds);
  }

  // Group by content_type + sub_category + niche.
  const groups = new Map<string, { meta: any; rows: any[] }>();
  for (const r of reels) {
    const meta = metaFor(r);
    const key = `${meta.content_type || "?"}|${meta.sub_category || "?"}|${meta.niche || "?"}`;
    if (!groups.has(key)) groups.set(key, { meta, rows: [] });
    groups.get(key)!.rows.push(r);
  }

  // Load existing templates so we can upsert on (content_type, sub_category, niche).
  const { data: existingTpls } = await db().from(TEMPLATES).select("*").limit(5000);
  const sameGroup = (t: any, m: any) =>
    (t.content_type || null) === m.content_type &&
    (t.sub_category || null) === m.sub_category &&
    (t.niche || null) === m.niche;

  const trend_summaries: any[] = [];
  const savedTemplates: any[] = [];

  for (const { meta, rows } of groups.values()) {
    if (rows.length < GROUP_MIN) continue; // not enough to be a repeatable trend

    const avg_retention = Number(mean(rows.map((r) => asNum(r.avg_retention))).toFixed(2));
    const avg_views = Math.round(mean(rows.map((r) => asNum(r.views_24h))));
    const avg_skip_rate = Number(mean(rows.map((r) => asNum(r.skip_rate))).toFixed(2));
    const avg_ai_score = Number(mean(rows.map((r) => asNum(r.ai_score))).toFixed(2));
    const isWinnerPattern = avg_retention > PATTERN_RETENTION && avg_ai_score > PATTERN_SCORE;

    // Most common retention-curve shape across the group.
    const curveCounts = new Map<string, number>();
    for (const r of rows) {
      const c = classifyRetentionCurve(r.retention_graph);
      curveCounts.set(c, (curveCounts.get(c) || 0) + 1);
    }
    const retention_curve =
      [...curveCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "flat";

    const label =
      [meta.content_type, meta.sub_category, meta.niche].filter(Boolean).join(" · ") || "General";

    const summary = {
      content_type: meta.content_type,
      sub_category: meta.sub_category,
      niche: meta.niche,
      label,
      instance_count: rows.length,
      avg_retention,
      avg_views,
      avg_skip_rate,
      avg_ai_score,
      retention_curve,
      is_winner_pattern: isWinnerPattern,
    };
    trend_summaries.push(summary);

    // Only winning patterns become / update winner_templates.
    if (!isWinnerPattern) continue;

    const inspUrls = Array.from(
      new Set(rows.map((r) => r.inspiration_reel_url).filter(Boolean))
    ) as string[];

    const payload: any = {
      name: label,
      description: `Auto-distilled from ${rows.length} analyzed reels (avg retention ${avg_retention}%, avg score ${avg_ai_score}).`,
      pattern: { reel_ids: rows.map((r) => r.id), concept_ids: rows.map((r) => r.concept_id).filter(Boolean) },
      avg_retention,
      avg_views,
      avg_skip_rate,
      instance_count: rows.length,
      content_type: meta.content_type,
      sub_category: meta.sub_category,
      niche: meta.niche,
      retention_curve,
      inspiration_reel_urls: inspUrls,
      updated_at: new Date().toISOString(),
    };

    const existing = (existingTpls || []).find((t: any) => sameGroup(t, meta));
    if (existing) {
      const { data: upd } = await db()
        .from(TEMPLATES)
        .update(payload)
        .eq("id", existing.id)
        .select()
        .limit(1);
      if (upd && upd[0]) savedTemplates.push(upd[0]);
    } else {
      const { data: ins } = await db().from(TEMPLATES).insert(payload).select().limit(1);
      if (ins && ins[0]) savedTemplates.push(ins[0]);
    }

    // Tag the member reels with this template label for traceability.
    await db()
      .from(PERF)
      .update({ winner_template: label })
      .in("id", rows.map((r) => r.id));
  }

  return {
    winner_templates: savedTemplates,
    trend_summaries,
    total_analyzed: reels.length,
  };
}

// ── All winner templates, each with its instance reels ────────
export async function getWinnerTemplates(): Promise<any[]> {
  const { data: tpls, error } = await db()
    .from(TEMPLATES)
    .select("*")
    .order("avg_retention", { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw error;
  const templates = tpls || [];

  // Attach the reel_performance rows referenced by each template's pattern.
  const allIds = Array.from(
    new Set(templates.flatMap((t: any) => (Array.isArray(t.pattern?.reel_ids) ? t.pattern.reel_ids : [])))
  ) as string[];
  const instances = new Map<string, any>();
  if (allIds.length) {
    const { data: rows } = await db()
      .from(PERF)
      .select(
        "id, reel_url, account_handle, ai_score, avg_retention, skip_rate, views_24h, is_winner, retention_curve, inspiration_reel_url"
      )
      .in("id", allIds);
    for (const r of rows || []) instances.set(r.id, r);
  }

  return templates.map((t: any) => ({
    ...t,
    instances: (Array.isArray(t.pattern?.reel_ids) ? t.pattern.reel_ids : [])
      .map((id: string) => instances.get(id))
      .filter(Boolean),
  }));
}

// ── Suggest fresh inspiration that matches a winning template ──
// Finds inspiration_reels matching the template's pattern (by
// sub_category when set, else by niche), excludes any already turned
// into a concept or brief, and returns the top 10 unused reels sorted
// by viral_score so the team can clone the winning pattern with new
// source material.
export async function generateInspirationFromWinners(
  templateId: string
): Promise<{ template: any; suggestions: any[] }> {
  const { data: t, error } = await db().from(TEMPLATES).select("*").eq("id", templateId).limit(1);
  if (error) throw error;
  const tpl = (t || [])[0];
  if (!tpl) throw new Error("Winner template not found");

  // Reel URLs already consumed by a concept or a brief — skip those.
  const used = new Set<string>();
  const [{ data: usedConcepts }, { data: usedBriefs }] = await Promise.all([
    db().from("content_concepts").select("inspiration_reel_url").not("inspiration_reel_url", "is", null).limit(5000),
    db().from("content_briefs").select("reference_reel_url").not("reference_reel_url", "is", null).limit(5000),
  ]);
  for (const c of usedConcepts || []) if (c.inspiration_reel_url) used.add(c.inspiration_reel_url);
  for (const b of usedBriefs || []) if (b.reference_reel_url) used.add(b.reference_reel_url);

  let q = db()
    .from("inspiration_reels")
    .select(
      "reel_url, author_handle, caption, niche, content_type, sub_category, views, thumbnail_url, viral_score"
    )
    .order("viral_score", { ascending: false, nullsFirst: false })
    .limit(300);

  // Prefer the more specific sub_category match; fall back to niche.
  if (tpl.sub_category) q = q.eq("sub_category", tpl.sub_category);
  else if (tpl.niche) q = q.eq("niche", tpl.niche);
  if (tpl.content_type) q = q.eq("content_type", tpl.content_type);

  const { data: reels } = await q;

  const suggestions = (reels || [])
    .filter((r: any) => r.reel_url && !used.has(r.reel_url))
    .slice(0, 10);

  return { template: tpl, suggestions };
}

// ── Raw performance records for the stats API ─────────────────
// Returns full reel_performance rows with optional filtering by
// account, status, winner-only and posted-at date range.
export async function getPerformanceRecords(opts: {
  account_handle?: string;
  status?: string;
  winners_only?: boolean;
  since?: string;
  until?: string;
  limit?: number;
} = {}): Promise<any[]> {
  const limit = Math.max(1, Math.min(1000, opts.limit ?? 100));
  let q = db().from(PERF).select("*").order("posted_at", { ascending: false, nullsFirst: false }).limit(limit);
  if (opts.account_handle) q = q.eq("account_handle", opts.account_handle);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.winners_only) q = q.eq("is_winner", true);
  if (opts.since) q = q.gte("posted_at", opts.since);
  if (opts.until) q = q.lte("posted_at", opts.until);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
