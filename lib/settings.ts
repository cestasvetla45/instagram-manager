// ─────────────────────────────────────────────────────────────
//  Live-editable app settings (stored in app_settings, key 'discovery').
//  The worker reads these each cycle so tuning changes take effect without
//  a redeploy. Env vars remain the FALLBACK/default when a field is unset.
// ─────────────────────────────────────────────────────────────
import { db } from "./db";

export const SETTINGS_TABLE = "app_settings";
export const DISCOVERY_KEY = "discovery";

export type DiscoverySettings = {
  minFollowers: number;
  maxFollowers: number;
  minScore: number;
  maxAgeDays: number; // reject if no post within N days
  commentReels: number; // comment sections mined per cycle
  vetBudget: number; // candidates vetted per cycle
  useAi: boolean; // run the Gemini niche-fit pass (discovery vetting)
  classifyFormat: boolean; // classify single- vs multi-person on scraped reels
  assumeNiche: boolean; // auto-assign a niche when scraping (inherit / AI guess)
};

function envDefaults(): DiscoverySettings {
  return {
    minFollowers: Number(process.env.DISCOVER_MIN_FOLLOWERS || 1000),
    maxFollowers: Number(process.env.DISCOVER_MAX_FOLLOWERS || 5_000_000),
    minScore: Number(process.env.DISCOVER_MIN_SCORE || 4),
    maxAgeDays: Number(process.env.DISCOVER_MAX_AGE_DAYS || 60),
    commentReels: Number(process.env.DISCOVER_COMMENT_REELS || 3),
    vetBudget: Number(process.env.DISCOVER_VET_PER_CYCLE || 5),
    useAi: process.env.DISCOVER_USE_AI ? process.env.DISCOVER_USE_AI === "1" : true,
    classifyFormat: process.env.DISCOVER_CLASSIFY_FORMAT ? process.env.DISCOVER_CLASSIFY_FORMAT === "1" : true,
    assumeNiche: process.env.DISCOVER_ASSUME_NICHE ? process.env.DISCOVER_ASSUME_NICHE === "1" : true,
  };
}

const NUM_FIELDS: (keyof DiscoverySettings)[] = [
  "minFollowers",
  "maxFollowers",
  "minScore",
  "maxAgeDays",
  "commentReels",
  "vetBudget",
];

export function normalizeSettings(input: any, base = envDefaults()): DiscoverySettings {
  const out: DiscoverySettings = { ...base };
  for (const k of NUM_FIELDS) {
    const v = Number(input?.[k]);
    if (Number.isFinite(v) && v >= 0) (out[k] as number) = v;
  }
  if (typeof input?.useAi === "boolean") out.useAi = input.useAi;
  if (typeof input?.classifyFormat === "boolean") out.classifyFormat = input.classifyFormat;
  if (typeof input?.assumeNiche === "boolean") out.assumeNiche = input.assumeNiche;
  // sane guards
  out.commentReels = Math.min(Math.max(out.commentReels, 0), 25);
  out.vetBudget = Math.min(Math.max(out.vetBudget, 0), 50);
  out.minScore = Math.min(Math.max(out.minScore, 0), 10);
  if (out.maxFollowers < out.minFollowers) out.maxFollowers = out.minFollowers;
  return out;
}

let cache: { value: DiscoverySettings; t: number } | null = null;
const TTL_MS = 30_000;

export async function getDiscoverySettings(): Promise<DiscoverySettings> {
  if (cache && Date.now() - cache.t < TTL_MS) return cache.value;
  let value = envDefaults();
  try {
    const { data } = await db()
      .from(SETTINGS_TABLE)
      .select("value")
      .eq("key", DISCOVERY_KEY)
      .limit(1);
    if (data?.[0]?.value) value = normalizeSettings(data[0].value, envDefaults());
  } catch {
    /* table missing / db down → env defaults */
  }
  cache = { value, t: Date.now() };
  return value;
}

export async function saveDiscoverySettings(input: any): Promise<DiscoverySettings> {
  const value = normalizeSettings(input, await getDiscoverySettings());
  await db()
    .from(SETTINGS_TABLE)
    .upsert({ key: DISCOVERY_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  cache = { value, t: Date.now() };
  return value;
}
