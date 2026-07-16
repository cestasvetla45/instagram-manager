// ─────────────────────────────────────────────────────────────
//  Gemini video categorization.
//  Uploads a reel's video via the Files API, waits for processing,
//  then asks gemini to pick the best niche (or propose a new one).
//  Returns a SUGGESTION — the user confirms before it's applied.
// ─────────────────────────────────────────────────────────────

const KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const BASE = "https://generativelanguage.googleapis.com";

export function geminiConfigured(): boolean {
  return Boolean(KEY);
}

// Plain text generation — used by the conversational Telegram bot.
// Returns a friendly fallback string instead of throwing so the bot
// always has something to send.
export async function generateResponse(
  prompt: string,
  opts: { temperature?: number; maxOutputTokens?: number } = {}
): Promise<string> {
  if (!geminiConfigured()) return "🤖 AI isn't configured yet (GEMINI_API_KEY missing).";
  try {
    const res = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts.temperature ?? 0.7,
          maxOutputTokens: opts.maxOutputTokens ?? 600,
        },
      }),
    });
    const j = await res.json();
    if (j?.error) {
      console.error("gemini generateResponse error:", j.error?.message || j.error);
      return "🤖 Sorry, I couldn't process that right now.";
    }
    const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).join("").trim();
    return text || "🤖 Sorry, I couldn't come up with an answer for that.";
  } catch (e: any) {
    console.error("gemini generateResponse threw:", e?.message || e);
    return "🤖 Sorry, something went wrong while thinking about that.";
  }
}

export type NicheSuggestion = {
  niche: string;
  isNew: boolean;
  confidence: number; // 0..1
  reason: string;
  format?: ReelFormat; // single- vs multi-person (from the video)
};

// Person-count format: dances/talking-head = single; skits/interviews = multi.
export type ReelFormat = "single" | "multi" | "unknown";
export type FormatGuess = { format: ReelFormat; confidence: number };

function normFormat(v: any): ReelFormat {
  const s = String(v || "").toLowerCase();
  if (s === "single" || s === "multi") return s;
  return "unknown";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 1) Resumable upload of the video bytes → returns the file resource.
async function uploadVideo(bytes: Buffer, mimeType: string): Promise<{ uri: string; name: string }> {
  const start = await fetch(`${BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": KEY,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "reel" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error(`Gemini upload init failed (${start.status})`);

  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });
  const j = await up.json();
  const file = j?.file;
  if (!file?.uri || !file?.name) throw new Error("Gemini upload did not return a file uri");
  return { uri: file.uri, name: file.name, ...file };
}

// 2) Poll until the uploaded video is ACTIVE (processed) — or fail.
async function waitActive(name: string, maxTries = 15): Promise<void> {
  for (let i = 0; i < maxTries; i++) {
    const res = await fetch(`${BASE}/v1beta/${name}`, { headers: { "x-goog-api-key": KEY } });
    const j = await res.json();
    const state = j?.state;
    if (state === "ACTIVE") return;
    if (state === "FAILED") throw new Error("Gemini failed to process the video");
    await sleep(2000);
  }
  throw new Error("Gemini video processing timed out");
}

async function deleteFile(name: string): Promise<void> {
  try {
    await fetch(`${BASE}/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": KEY } });
  } catch {
    /* best effort */
  }
}

// Watch a vault video and write a caption that follows the user's example format.
export async function generateCaption(
  bytes: Buffer,
  mimeType: string,
  example: string,
  niche = ""
): Promise<string> {
  if (!geminiConfigured()) throw new Error("Gemini not configured. Set GEMINI_API_KEY.");
  const file = await uploadVideo(bytes, mimeType);
  try {
    await waitActive(file.name);
    const prompt = `Write ONE Instagram caption for this reel.${niche ? ` Niche: ${niche}.` : ""}

Match the STYLE, length, tone, punctuation, emoji use, and hashtag pattern of these example caption(s) EXACTLY:
"""
${example.slice(0, 1500)}
"""

Base the caption on what actually happens in the video. Return ONLY the caption text — no quotes, no explanation, no options.`;
    const res = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ file_data: { mime_type: mimeType, file_uri: file.uri } }, { text: prompt }] }],
        generationConfig: { temperature: 0.9 },
      }),
    });
    const j = await res.json();
    if (j?.error) throw new Error(`Gemini: ${j.error.message || JSON.stringify(j.error)}`);
    const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).join("").trim();
    if (!text) throw new Error("Gemini returned no caption");
    return text.replace(/^["']|["']$/g, "");
  } finally {
    deleteFile(file.name);
  }
}

// ── Format classification (single vs multi-person) ────────────

const FORMAT_INSTRUCTION = `Classify the reel by how many DISTINCT people appear as on-camera subjects.
- "single": one person is the subject (dance, talking-head, GRWM, workout, lip-sync, POV to camera).
- "multi": two or more people are subjects interacting (skit, street interview, duet, prank, couple/friends content).
Ignore incidental background passers-by, reflections, and crowd shots — judge the intended subjects.`;

// Cheap thumbnail-based guess (one image), run on every scraped reel.
export async function classifyFormatFromThumbnail(
  thumbnailUrl: string,
  caption = ""
): Promise<FormatGuess | null> {
  if (!geminiConfigured() || !thumbnailUrl) return null;
  let bytes: Buffer;
  let mime = "image/jpeg";
  try {
    const res = await fetch(thumbnailUrl);
    if (!res.ok) return null;
    mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    bytes = Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
  const prompt = `${FORMAT_INSTRUCTION}

You only have the cover thumbnail${caption ? ` and caption ("${caption.slice(0, 160)}")` : ""}. Make your best judgment; if the cover shows one person but the caption implies an interaction/skit, prefer "multi".

Return ONLY JSON: {"format": "single"|"multi", "confidence": number between 0 and 1}.`;
  try {
    const res = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: bytes.toString("base64") } }, { text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: { format: { type: "STRING" }, confidence: { type: "NUMBER" } },
            required: ["format", "confidence"],
          },
        },
      }),
    });
    const j = await res.json();
    if (j?.error) return null;
    const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
    const parsed = JSON.parse(text);
    return { format: normFormat(parsed.format), confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)) };
  } catch {
    return null;
  }
}

// Text-only niche-fit check for creator discovery (no video upload).
// Returns null when Gemini isn't configured — discovery works without it.
export type CreatorFit = { niche: string; fit: number; reason: string };
export async function assessCreatorFit(
  username: string,
  bio: string,
  captions: string[],
  niches: string[]
): Promise<CreatorFit | null> {
  if (!geminiConfigured()) return null;
  const list = niches.length ? niches.map((n) => `- ${n}`).join("\n") : "(no niches defined yet)";
  const prompt = `You screen Instagram creators for a short-form content inspiration library.

Our library niches:
${list}

Candidate: @${username}
Bio: """${(bio || "").slice(0, 400)}"""
Recent reel captions:
${captions.filter(Boolean).slice(0, 5).map((c) => `- "${c.slice(0, 150)}"`).join("\n") || "(none)"}

Pick the SINGLE best-fitting niche from the list (or propose ONE new concise niche, 1-3 words lowercase, if none fit), and rate how well this creator fits our library overall.

Return ONLY JSON: {"niche": string, "fit": number between 0 and 1, "reason": one short sentence}.`;
  const res = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            niche: { type: "STRING" },
            fit: { type: "NUMBER" },
            reason: { type: "STRING" },
          },
          required: ["niche", "fit", "reason"],
        },
      },
    }),
  });
  const j = await res.json();
  if (j?.error) throw new Error(`Gemini: ${j.error.message || JSON.stringify(j.error)}`);
  const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
  const parsed = JSON.parse(text);
  return {
    niche: String(parsed.niche || "").trim(),
    fit: Math.max(0, Math.min(1, Number(parsed.fit) || 0)),
    reason: String(parsed.reason || "").slice(0, 300),
  };
}

// ── Full categorization (niche + sub-category + format) ───────

// Canonical sub-category slugs (match the sub_categories table naming).
export const SUB_CATEGORIES = [
  "street-interview", "dance", "skit", "cooking", "talking-head", "reaction",
  "transition", "outfit", "mirror", "gaze", "lifestyle", "comedy", "tutorial", "gym", "pool",
] as const;

// Definitions injected on the second (higher-effort) pass.
const SUB_CATEGORY_DEFS = `- street-interview: creator interviews strangers on the street, usually holding a mic and asking questions
- dance: the subject is dancing (choreographed or freestyle)
- skit: a scripted acted-out scene or sketch, often two or more people playing roles
- cooking: preparing, making, or presenting food / recipes
- talking-head: one person speaking directly to camera (story time, opinion, advice)
- reaction: reacting to other content, an event, or something off-screen
- transition: quick edited transitions (outfit change, scene swap) used as the main gimmick
- outfit: fashion showcase — GRWM, try-on hauls, outfit-of-the-day
- mirror: filmed in / centered on a mirror (mirror-selfie style)
- gaze: static or slow close-up looking into the camera with minimal action (thirst-trap)
- lifestyle: day-in-the-life, vlog, aesthetic lifestyle b-roll
- comedy: humor-first content — jokes, bits, funny voiceover
- tutorial: teaching or how-to (a skill, makeup, an edit, etc.)
- gym: working out / fitness in a gym setting
- pool: pool, beach, or swimwear / water content`;

const SUB_CATEGORY_LIST = "street interview, dance, skit, cooking, talking head, reaction, transition, outfit, mirror, gaze, lifestyle, comedy, tutorial, gym, pool";

export type FullCategory = {
  niche: string;
  isNew: boolean;
  confidence: number;
  reason: string;
  format: ReelFormat;
  sub_category: string; // "" when the guess isn't a known sub-category
  sub_category_confidence: number;
  sub_category_reason: string;
};

// Normalize a Gemini sub-category answer ("street interview") to a known slug ("street-interview"), else "".
function normSubCategory(v: any): string {
  const s = String(v || "").toLowerCase().trim().replace(/\s+/g, "-");
  return (SUB_CATEGORIES as readonly string[]).includes(s) ? s : "";
}

const CATEGORY_SCHEMA = {
  type: "OBJECT",
  properties: {
    niche: { type: "STRING" },
    isNew: { type: "BOOLEAN" },
    confidence: { type: "NUMBER" },
    sub_category: { type: "STRING" },
    sub_category_confidence: { type: "NUMBER" },
    format: { type: "STRING" },
    reasoning: { type: "STRING" },
  },
  required: ["niche", "sub_category", "sub_category_confidence", "format"],
} as const;

// One generateContent call against an already-uploaded video, returns parsed JSON.
async function runCategoryPass(fileUri: string, mimeType: string, prompt: string): Promise<any> {
  const res = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ file_data: { mime_type: mimeType, file_uri: fileUri } }, { text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: CATEGORY_SCHEMA },
    }),
  });
  const j = await res.json();
  if (j?.error) throw new Error(`Gemini: ${j.error.message || JSON.stringify(j.error)}`);
  const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 160)}`);
  }
}

// Niche + sub-category + person-count in one video pass, with a two-stage
// escalation when the sub-category is uncertain. The caller decides whether a
// low-confidence sub-category should be stored or sent to the review queue.
export async function categorizeVideoFull(
  bytes: Buffer,
  mimeType: string,
  niches: string[],
  caption = ""
): Promise<FullCategory> {
  if (!geminiConfigured()) throw new Error("Gemini not configured. Set GEMINI_API_KEY.");

  const file = await uploadVideo(bytes, mimeType);
  try {
    await waitActive(file.name);

    const list = niches.length ? niches.map((n) => `- ${n}`).join("\n") : "(no niches defined yet)";
    const capCtx = caption ? `\n\nCaption + hashtags (context): "${caption.slice(0, 400)}"` : "";

    const firstPrompt = `You categorize short-form Instagram reels for a content library.

Existing niches:
${list}

Watch the video and answer:
1. What niche does this creator fit? Pick the SINGLE best from the list, or propose ONE new concise niche (1-3 words, lowercase) if none fit.
2. What type of content is this? Pick ONE from: ${SUB_CATEGORY_LIST}.
3. Is this a single-person or multi-person video?
${FORMAT_INSTRUCTION}
4. How confident are you in the content-type / sub-category? (0.0 to 1.0)${capCtx}

Return ONLY JSON: {"niche": string, "isNew": boolean, "confidence": number between 0 and 1, "sub_category": string, "sub_category_confidence": number between 0 and 1, "format": "single"|"multi", "reasoning": one short sentence}.`;

    let parsed = await runCategoryPass(file.uri, mimeType, firstPrompt);

    // Second, higher-effort pass with explicit definitions when unsure.
    if (Number(parsed?.sub_category_confidence || 0) < 0.85) {
      const secondPrompt = `You categorize the CONTENT TYPE of short-form Instagram reels. Watch carefully and pick the single best-matching content type.

Content-type definitions:
${SUB_CATEGORY_DEFS}

Also give the best niche from this list (or propose one, 1-3 words lowercase):
${list}

And the person-count format:
${FORMAT_INSTRUCTION}${capCtx}

Return ONLY JSON: {"niche": string, "isNew": boolean, "confidence": number between 0 and 1, "sub_category": string, "sub_category_confidence": number between 0 and 1, "format": "single"|"multi", "reasoning": one short sentence}.`;
      const second = await runCategoryPass(file.uri, mimeType, secondPrompt);
      // Keep whichever pass was more confident about the sub-category.
      if (Number(second?.sub_category_confidence || 0) >= Number(parsed?.sub_category_confidence || 0)) {
        parsed = second;
      }
    }

    const subConf = Math.max(0, Math.min(1, Number(parsed.sub_category_confidence) || 0));
    const reason = String(parsed.reasoning || parsed.reason || "").slice(0, 300);
    return {
      niche: String(parsed.niche || "").trim(),
      isNew: Boolean(parsed.isNew),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason,
      format: normFormat(parsed.format),
      sub_category: normSubCategory(parsed.sub_category),
      sub_category_confidence: subConf,
      sub_category_reason: reason,
    };
  } finally {
    deleteFile(file.name);
  }
}

export async function categorizeVideo(
  bytes: Buffer,
  mimeType: string,
  niches: string[],
  caption = ""
): Promise<NicheSuggestion> {
  if (!geminiConfigured()) throw new Error("Gemini not configured. Set GEMINI_API_KEY.");

  const file = await uploadVideo(bytes, mimeType);
  try {
    await waitActive(file.name);

    const list = niches.length ? niches.map((n) => `- ${n}`).join("\n") : "(no niches defined yet)";
    const prompt = `You categorize short-form Instagram reels for a content library.

Existing niches:
${list}

Watch the video${caption ? ` (caption: "${caption.slice(0, 200)}")` : ""} and choose the SINGLE best-fitting niche from the existing list. If none fit well, you may propose ONE new concise niche name (1-3 words, lowercase). Base your decision on what actually happens in the video — the subject, format, and hook.

Also classify the person-count format:
${FORMAT_INSTRUCTION}

Return ONLY JSON: {"niche": string, "isNew": boolean, "confidence": number between 0 and 1, "reason": one short sentence, "format": "single"|"multi"}.`;

    const res = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { file_data: { mime_type: mimeType, file_uri: file.uri } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              niche: { type: "STRING" },
              isNew: { type: "BOOLEAN" },
              confidence: { type: "NUMBER" },
              reason: { type: "STRING" },
              format: { type: "STRING" },
            },
            required: ["niche", "isNew", "confidence", "reason"],
          },
        },
      }),
    });
    const j = await res.json();
    if (j?.error) throw new Error(`Gemini: ${j.error.message || JSON.stringify(j.error)}`);
    const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Gemini returned non-JSON: ${text.slice(0, 160)}`);
    }
    return {
      niche: String(parsed.niche || "").trim(),
      isNew: Boolean(parsed.isNew),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason: String(parsed.reason || "").slice(0, 300),
      format: normFormat(parsed.format),
    };
  } finally {
    deleteFile(file.name);
  }
}
