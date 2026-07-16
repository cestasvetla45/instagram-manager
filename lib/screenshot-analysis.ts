// ─────────────────────────────────────────────────────────────
//  Reel analytics screenshot analysis (Gemini Vision).
//  A VA uploads the Instagram "insights" screenshots for one of
//  our posted reels (retention graph, demographics, territories,
//  reach). We feed the images to Gemini and get back a structured
//  breakdown plus actionable feedback for the next reel.
//
//  Same Gemini call pattern as lib/gemini.ts. Screenshots are
//  images, so we send them inline (base64) — no Files API upload /
//  ACTIVE polling needed (that's only required for video bytes).
// ─────────────────────────────────────────────────────────────

import { scrapeReel } from "./rocksolid";

const KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const BASE = "https://generativelanguage.googleapis.com";

export function geminiConfigured(): boolean {
  return Boolean(KEY);
}

export type ReelAnalysis = {
  retention_graph: { second: number; retention: number }[];
  avg_retention: number;
  skip_rate: number;
  peak_retention: number;
  drop_off_points: { second: number; drop: number }[];
  demographics: { age: Record<string, number>; gender: Record<string, number>; top_countries: string[] };
  top_territories: string[];
  feedback: string;
  strengths: string[];
  weaknesses: string[];
  score: number;
};

// ---- small helpers ----
const num = (v: any): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};
const arr = (v: any): any[] => (Array.isArray(v) ? v : []);
const strArr = (v: any): string[] => arr(v).map((x) => String(x)).filter(Boolean);

// Gemini sometimes wraps JSON in ```json fences despite the instruction.
function parseJson(text: string): any {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

// Coerce a raw Gemini object into the strict ReelAnalysis shape.
function normalize(raw: any): ReelAnalysis {
  const demo = raw?.demographics || {};
  return {
    retention_graph: arr(raw?.retention_graph)
      .map((p: any) => ({ second: num(p?.second), retention: num(p?.retention) }))
      .filter((p) => Number.isFinite(p.second)),
    avg_retention: num(raw?.avg_retention),
    skip_rate: num(raw?.skip_rate),
    peak_retention: num(raw?.peak_retention),
    drop_off_points: arr(raw?.drop_off_points).map((p: any) => ({ second: num(p?.second), drop: num(p?.drop) })),
    demographics: {
      age: demo?.age && typeof demo.age === "object" ? demo.age : {},
      gender: demo?.gender && typeof demo.gender === "object" ? demo.gender : {},
      top_countries: strArr(demo?.top_countries),
    },
    top_territories: strArr(raw?.top_territories),
    feedback: String(raw?.feedback || "").slice(0, 1000),
    strengths: strArr(raw?.strengths).slice(0, 5),
    weaknesses: strArr(raw?.weaknesses).slice(0, 5),
    score: Math.max(0, Math.min(10, num(raw?.score))),
  };
}

const SCREENSHOT_PROMPT = `You are a social media analytics expert. Analyze these Instagram reel performance screenshots.
Extract and return as JSON:
1. retention_graph: array of {second, retention} points (estimate from the visual graph, 0-100 scale)
2. avg_retention: average retention percentage
3. skip_rate: percentage who left in first 3 seconds
4. peak_retention: highest retention point
5. drop_off_points: array of {second, drop} where major drops happen
6. demographics: {age: {"13-17": X, "18-24": Y, "25-34": Z, ...}, gender: {"male": X, "female": Y}, top_countries: ["US", "UK", ...]}
7. top_territories: array of country names
8. feedback: what should the creator fix on their next reel? (2-3 sentences, actionable)
9. strengths: array of 2-3 things that worked well
10. weaknesses: array of 2-3 things to fix
11. score: 0-10 overall performance score

Return ONLY valid JSON, no markdown fences.`;

// Download an image URL and return an inline_data part for Gemini.
async function toInlinePart(url: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0] || "image/png";
    if (!mime.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return { inline_data: { mime_type: mime, data: bytes.toString("base64") } };
  } catch {
    return null;
  }
}

// One generateContent call over the given parts → normalized analysis.
async function runVision(parts: any[]): Promise<ReelAnalysis> {
  const res = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });
  const j = await res.json();
  if (j?.error) throw new Error(`Gemini: ${j.error.message || JSON.stringify(j.error)}`);
  const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).join("").trim();
  if (!text) throw new Error("Gemini returned no analysis");
  let raw: any;
  try {
    raw = parseJson(text);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 160)}`);
  }
  return normalize(raw);
}

// ── Public: analyze analytics screenshots ─────────────────────
export async function analyzeReelScreenshot(screenshotUrls: string[]): Promise<ReelAnalysis> {
  if (!geminiConfigured()) throw new Error("Gemini not configured. Set GEMINI_API_KEY.");
  const urls = (screenshotUrls || []).filter(Boolean);
  if (!urls.length) throw new Error("No screenshot URLs provided");

  const imageParts = (await Promise.all(urls.map(toInlinePart))).filter(Boolean);
  if (!imageParts.length) throw new Error("Could not download any of the screenshots");

  return runVision([...imageParts, { text: SCREENSHOT_PROMPT }]);
}

// ── Public: fallback when no screenshots exist ────────────────
// Re-scrape the live reel stats, compare to the inspiration reel it
// was modeled on (if linked), and ask Gemini (text-only) for feedback.
// Retention/demographics can't be recovered without screenshots, so
// those come back empty — only the qualitative feedback is filled in.
export async function analyzeReelWithoutScreenshots(
  reelUrl: string,
  inspirationReelUrl?: string
): Promise<ReelAnalysis> {
  if (!geminiConfigured()) throw new Error("Gemini not configured. Set GEMINI_API_KEY.");
  if (!reelUrl) throw new Error("reelUrl required");

  const reel = await scrapeReel(reelUrl);
  const engagement =
    reel.views > 0 ? ((reel.likes + reel.comments + reel.shares + reel.saves) / reel.views) * 100 : 0;

  let insp: Awaited<ReturnType<typeof scrapeReel>> | null = null;
  if (inspirationReelUrl) {
    try {
      insp = await scrapeReel(inspirationReelUrl);
    } catch {
      insp = null;
    }
  }

  const fmt = (n: number) => n.toLocaleString("en-US");
  const inspLine = insp
    ? `Inspiration reel it was modeled on (@${insp.authorHandle}): ${fmt(insp.views)} views, ${fmt(insp.likes)} likes, ${fmt(insp.comments)} comments, ${insp.durationSec}s.`
    : "No inspiration reel linked for comparison.";
  const ratio = insp && insp.views > 0 ? (reel.views / insp.views) * 100 : null;

  const prompt = `You are a short-form Instagram performance analyst. No analytics screenshots are available for this reel — judge it from the public stats only.

OUR reel (@${reel.authorHandle}): ${fmt(reel.views)} views, ${fmt(reel.likes)} likes, ${fmt(
    reel.comments
  )} comments, ${fmt(reel.shares)} shares, ${fmt(reel.saves)} saves, ${reel.durationSec}s.
Engagement rate: ${engagement.toFixed(2)}% of views.
${inspLine}${ratio != null ? ` Our reel did ${ratio.toFixed(0)}% of the inspiration reel's views.` : ""}
Caption: "${(reel.caption || "").slice(0, 300)}"

Return ONLY valid JSON (no markdown fences):
{
  "feedback": "2-3 sentence actionable note on what to fix on the next reel",
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "score": 0-10 overall performance score
}`;

  const res = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
    }),
  });
  const j = await res.json();
  if (j?.error) throw new Error(`Gemini: ${j.error.message || JSON.stringify(j.error)}`);
  const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).join("").trim();
  let raw: any = {};
  try {
    raw = parseJson(text);
  } catch {
    raw = {};
  }

  // Reuse the strict shape; retention/demographics stay empty here.
  return normalize({
    feedback: raw?.feedback,
    strengths: raw?.strengths,
    weaknesses: raw?.weaknesses,
    score: raw?.score,
  });
}
