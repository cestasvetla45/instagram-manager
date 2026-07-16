# Setup checklist — going live

Nothing from the recent sessions is deployed yet. This is the exact sequence.
Steps 1 and 4 must be done by the user or a terminal-capable agent (the assistant can't type into terminals or load Chrome extensions). Steps 2–3 the assistant can do in the Railway web dashboard once step 1 is live.

## 1. Deploy the web app  (terminal)
```
cd "/Users/tomimiksa/Desktop/IG Scraper/instagram-manager" && railway up --detach
```
Watch that `.next` and `tsconfig.tsbuildinfo` do NOT upload (both are ignored). Confirm live: `GET /api/discovery/ingest` should return JSON (not 404).

## 2. Set env vars on the web service  (Railway → Variables)
- `INGEST_SECRET` — invent one, e.g. `openssl rand -hex 32`. (Example generated earlier: `c3ea74934c60cd8bb56895a75e8ace6543b13930f402d300c3cbde5bb50532c8` — use your own if you prefer.)
- `GEMINI_API_KEY` — Google AI Studio key starting `AIza…` (needed for niche + format AI; discovery still runs without it, just no AI labels).
- (When ready to require login) `AUTH_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
- Tuning is optional — defaults are fine, and everything is editable live on the Discovery page afterward.

## 3. Create the 24/7 discovery worker  (Railway → New service, same repo)
- Start command: `npm run worker:discovery`
- Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ROCKSOLID_API_KEY`, `GEMINI_API_KEY` (optional), `DISCOVERY_INTERVAL_MINUTES=30`.
- (Also confirm the existing enrichment worker service has `RUN_ON_BOOT=1` and sensible `WORKER_INTERVAL_MINUTES` to drain the ~107-account backlog.)

## 4. Install the Chrome extension  (browser, manual)
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension/` folder in the repo.
2. Click the icon → paste **App URL** `https://instagram-tool-production-e4f2.up.railway.app` and the **INGEST_SECRET** from step 2 → **Test** (should say "Connected ✓") → Save.
3. Log that Chrome profile into the discovery Instagram account. Browse Explore / Reels / competitors' "similar accounts". The popup counts captured/sent/added.

## 5. Verify end-to-end
- Open `/discovery` → ⚙ tuning loads → **Run discovery now** returns counts.
- Browse IG with the extension on → new candidates appear under **Queue**, then **Suggested** after the worker vets them.
- Approve one → it appears in `inspiration_accounts`; its reels get scraped niche-tagged + format-classified.

## Notes
- All DB migrations are already applied to Supabase (`discovery_candidates`, `app_settings`, `format`/`format_source`, `discovery_scanned_at`). `supabase/schema.sql` is the re-runnable canonical copy.
- If auth is ON but `INGEST_SECRET` is unset, ingest rejects everything by design (fail-safe).
