// Railway background worker — runs the full refresh cycle on an interval.
// Start with: npm run worker   (Railway service start command)
// No external scheduler dependency (plain setInterval) to keep the dep tree clean.
import { runRefreshCycle } from "../lib/refresh";

const INTERVAL_MIN = Number(process.env.WORKER_INTERVAL_MINUTES || 120); // default every 2h

let running = false;
async function run(trigger: string) {
  if (running) {
    console.log(new Date().toISOString(), `skip (${trigger}): previous cycle still running`);
    return;
  }
  running = true;
  const start = Date.now();
  console.log(new Date().toISOString(), `refresh cycle start (${trigger})`);
  try {
    const summary = await runRefreshCycle();
    console.log(
      new Date().toISOString(),
      `cycle done in ${((Date.now() - start) / 1000).toFixed(1)}s`,
      JSON.stringify(summary)
    );
  } catch (e: any) {
    console.error("cycle error:", e?.message || e);
  } finally {
    running = false;
  }
}

if (!process.env.SUPABASE_URL || !process.env.ROCKSOLID_API_KEY) {
  console.warn("⚠ Worker missing SUPABASE_URL / ROCKSOLID_API_KEY — set them in Railway variables.");
}

console.log(`▶ worker started; interval = ${INTERVAL_MIN} min`);
setInterval(() => run("interval"), INTERVAL_MIN * 60 * 1000);

// Run once on boot if requested (recommended for the first deploy).
if (process.env.RUN_ON_BOOT === "1") run("boot");
