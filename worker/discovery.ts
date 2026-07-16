// Railway discovery worker — runs creator discovery 24/7 on its own clock,
// independent of the main refresh worker (so its scraper-API budget never
// competes with reel refreshes in the same process).
//
// Railway: add a service on this repo with start command  npm run worker:discovery
import { runDiscovery } from "../lib/discovery";

const INTERVAL_MIN = Number(process.env.DISCOVERY_INTERVAL_MINUTES || 30);

let running = false;
async function run(trigger: string) {
  if (running) {
    console.log(new Date().toISOString(), `skip (${trigger}): previous discovery run still going`);
    return;
  }
  running = true;
  const start = Date.now();
  console.log(new Date().toISOString(), `discovery run start (${trigger})`);
  try {
    const summary = await runDiscovery();
    console.log(
      new Date().toISOString(),
      `discovery done in ${((Date.now() - start) / 1000).toFixed(1)}s`,
      JSON.stringify(summary)
    );
  } catch (e: any) {
    console.error("discovery error:", e?.message || e);
  } finally {
    running = false;
  }
}

if (!process.env.SUPABASE_URL || !process.env.ROCKSOLID_API_KEY) {
  console.warn("⚠ Discovery worker missing SUPABASE_URL / ROCKSOLID_API_KEY — set them in Railway variables.");
}

console.log(`▶ discovery worker started; interval = ${INTERVAL_MIN} min`);
setInterval(() => run("interval"), INTERVAL_MIN * 60 * 1000);
run("boot");
