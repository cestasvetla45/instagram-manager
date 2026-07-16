# Instagram Manager — Master Handoff

Paste this into a new chat (Fable 5 or otherwise) to bring the model fully up to speed.
Everything real lives in the **repo** and **Supabase**; these docs are the memory a fresh chat won't have.

Read order: this file first, then `DISCOVERY.md` (the newest subsystem), then `SETUP-CHECKLIST.md` (what still needs doing to go live).

Last updated: 2026-07 session that added the whole **Creator Discovery** subsystem, a **24/7 discovery worker**, a **Chrome-extension profile connector**, **in-app live settings**, **single/multi-person reel classification**, and **auto-niche-on-scrape**.

---

## What this is
A custom Instagram management tool for a network of ~7 AI-generated "tall girl / fitness girl" content accounts. It scrapes our own accounts + inspiration creators, scores content, tracks performance, runs a VA operating system, enriches an inspiration library automatically, and now **discovers brand-new trending creators on its own**.

## Stack & locations
- **Repo:** `/Users/tomimiksa/Desktop/IG Scraper/instagram-manager` (Next.js 14.2 App Router, React 18, TypeScript; `typescript.ignoreBuildErrors` + `eslint.ignoreDuringBuilds` on).
- **DB:** Supabase (Postgres + Storage). Project ref `hobqaxdklesgfasihwvw`.
- **Hosting:** Railway. Project `0ac5ad44-ffb6-4e3b-b071-46a8de8f5ba3`. Web service = `instagram-tool`. **Live URL:** `https://instagram-tool-production-e4f2.up.railway.app` (the `-e4f2` one is ours; a different app owns the non-suffixed subdomain). A **worker** service runs `npm run worker`. A **second worker** for discovery (`npm run worker:discovery`) is NEW and still needs to be created (see `SETUP-CHECKLIST.md`).
- **Scraper:** RockSolidAPIs (`https://auto-poster.co.uk/yt_api`, header `AP_API_KEY`). Endpoints in `lib/rocksolid.ts`: `media_data_id.php` (shortcode→id), `get_media_data_v2.php` (media stats), `ig_get_fb_profile.php` (profile, POST), `get_ig_user_reels.php` (listing, POST), `get_post_comments.php` (media_code=shortcode). Retry/backoff built in (429s are constant). Confirmed during this session: the reels listing exposes `coauthor_producers`; the comments endpoint's items carry an `owner:{username,id}`; there is **no** related-profiles/following endpoint on this provider (all 404) — which is why IG's own suggestions come via the Chrome extension instead.
- **Deploy:** `cd instagram-manager && railway up --detach`. **Never** let `tsconfig.tsbuildinfo` or `.next` upload — both are in `.gitignore` + `.railwayignore` (a stray `tsbuildinfo` once caused a BuildKit mount error).

## ⚠️ Deploy state — READ THIS
The last time the assistant checked, `GET /api/discovery/ingest` on the live URL returned **404**, i.e. **none of the discovery work (or the earlier built-but-undeployed stack) is live yet.** Everything below has passed `npx tsc --noEmit` (exit 0). One `railway up --detach` ships all of it. See `SETUP-CHECKLIST.md`.

### Built & live already (from before)
Core scraping, our-reels/accounts dashboards, Growth, Top Reels, Analytics, Comment Intelligence, inspiration library v1 (niches, 0–10 score, paste box).

### Built, type-checks clean, NOT deployed
- **Auth + roles** (`/login`, middleware, `app_users`, `/users`). Roles: admin / va. Stays OFF until `AUTH_SECRET` is set (fail-safe).
- **VA Daily** (`/va`), **Content Vault** (`/vault`), **Sidebar search**, **Inspiration** tooling (scrape-account, mass scrape, niche tagging, AI auto-categorize, content-type filter), **Background enrichment worker** (`lib/discover.ts`).
- **NEW this session — Creator Discovery** (`/discovery`, `lib/discovery.ts`, `worker/discovery.ts`, ingest API, Chrome extension, live settings, format classification, auto-niche). Full detail in `DISCOVERY.md`.

---

## The three background workers (conceptual)
1. **Main refresh worker** — `worker/index.ts` → `npm run worker` → `lib/refresh.ts:runRefreshCycle()`. Refreshes our reels, snapshots accounts, refreshes inspiration reels (24h/48h windows), and drains the enrichment backlog (`lib/discover.ts:enrichBacklog`). Discovery is NO LONGER run here by default (gated behind `DISCOVER_IN_REFRESH=1`).
2. **Discovery worker** (NEW) — `worker/discovery.ts` → `npm run worker:discovery` → `lib/discovery.ts:runDiscovery()`. Own clock (`DISCOVERY_INTERVAL_MINUTES`, default 30). Harvests + vets creator candidates 24/7.
3. Both share the same Supabase + RockSolid creds; separate services so their scraper budgets don't compete.

## Environment variables (names only; user sets values in Railway)
**Already set:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ROCKSOLID_API_KEY` (+ optional `ROCKSOLID_BASE_URL`, `ROCKSOLID_AUTH_HEADER`).

**Needed / new:**
- `GEMINI_API_KEY` — Google AI Studio key, starts `AIza…` (an `AQ.` token is wrong/OAuth). Powers video categorization, caption generation, discovery niche-fit, reel-format & niche AI. Model defaults to `gemini-3.5-flash` (`GEMINI_MODEL` to override).
- `AUTH_SECRET` (+ `ADMIN_USERNAME`, `ADMIN_PASSWORD`) — turns auth on.
- `INGEST_SECRET` — **NEW.** Shared secret the Chrome extension authenticates with (falls back to `CRON_SECRET` if unset). You make it up (`openssl rand -hex 32`). If `AUTH_SECRET` is on but `INGEST_SECRET` is unset, the ingest endpoint safely rejects everything.
- Enrichment worker: `RUN_ON_BOOT=1`, `WORKER_INTERVAL_MINUTES` (~20–30 while backlog drains), `ENRICH_PER_CYCLE=8`, `ENRICH_REELS_PER_ACCOUNT=8`, optional `CRON_SECRET`.
- Discovery worker: `DISCOVERY_INTERVAL_MINUTES=30`. Optional `DISCOVER_IN_REFRESH=1` to also run discovery inside the main worker.
- **Discovery tuning defaults (all optional — now editable live in the app UI, see below):** `DISCOVER_MIN_FOLLOWERS=1000`, `DISCOVER_MAX_FOLLOWERS=5000000`, `DISCOVER_MIN_SCORE=4`, `DISCOVER_MAX_AGE_DAYS=60`, `DISCOVER_COMMENT_REELS=3`, `DISCOVER_VET_PER_CYCLE=5`, `DISCOVER_USE_AI=1`, `DISCOVER_CLASSIFY_FORMAT=1`, `DISCOVER_ASSUME_NICHE=1`. Env vars are only the fallback — the live values live in the `app_settings` table and are edited on the Discovery page's ⚙ Tuning panel (no redeploy).

---

## Database — schema & migrations
Canonical schema: `supabase/schema.sql` (safe to re-run; `IF NOT EXISTS` everywhere). All migrations below were **already applied to the live Supabase project** this session via the Supabase MCP.

Tables of note: `inspiration_reels`, `inspiration_accounts`, `our_reels`, `our_accounts`, `niches`, `metric_snapshots`, `account_snapshots`, plus auth/va/vault tables.

**New this session (already applied):**
- `discovery_candidates` — the discovery queue. Key columns: `handle` (unique), `status` (`pending`→`suggested`|`rejected_auto`|`approved`|`rejected`), `sources` (jsonb `{mention,comment,coauthor,related,suggested,explore}`), `source_count`, `source_handles[]`, profile snapshot (`followers`, `following`, `posts_count`, `clips_count`, `is_private`, `is_verified`, `bio`, …), vetting results (`discovery_score`, `avg_views`, `max_views`, `view_follow_ratio`, `reels_sampled`, `last_posted_at`, `top_reels` jsonb), AI (`ai_niche`, `ai_fit`, `ai_reason`), `reject_reason`, timestamps.
- `app_settings` — key/value jsonb (`key='discovery'` holds live tuning). Read by `lib/settings.ts` with env fallback, 30s cache.
- `inspiration_reels.discovery_scanned_at` — marks reels already mined for mentions/comments.
- `inspiration_reels.format` + `format_source`, and same on `our_reels` — single/multi-person label (`'single'|'multi'`) and where it came from (`'thumbnail'|'video'`).

---

## Key files (this session)
- `lib/discovery.ts` — discovery engine: harvest (mentions/coauthors/comments/ingest) → vet → queue. `runDiscovery()`, `ingestHandles()`, `recordCoauthors()`.
- `lib/settings.ts` — live discovery settings (DB + env fallback + cache).
- `lib/classify.ts` — scrape-time enrichment shared by all import paths: `assumedAccountNiche()`, `thumbnailFormatPatch()`.
- `lib/gemini.ts` — added `classifyFormatFromThumbnail()` (image), `assessCreatorFit()` (text niche-fit), and `format` output on `categorizeVideo()` (video).
- `lib/rocksolid.ts` — added `scrapeCommentUsers()` and `coauthors` on reel stubs.
- `lib/discover.ts`, `lib/save.ts`, `app/api/inspiration/scrape-account/route.ts`, `app/api/inspiration/ai-categorize/route.ts` — wired to assume niche + classify format.
- `lib/refresh.ts` — discovery pulled out of the default cycle (env-gated).
- `worker/discovery.ts` — the 24/7 discovery service.
- `app/discovery/page.tsx` — review UI + ⚙ live tuning panel.
- `app/api/discovery/{route,run,decide,ingest,settings}/route.ts` — discovery APIs.
- `middleware.ts` — exempts machine endpoints (`/api/discovery/ingest`, GET cron routes) from cookie auth.
- `app/components/Sidebar.tsx`, `ReelCard.tsx`, `app/inspiration/page.tsx`, `app/api/reels/route.ts`, `lib/db.ts` — format badge + filter, discovery nav link.
- `extension/` — the Chrome MV3 connector (see `DISCOVERY.md` + `extension/README.md`).

## New API endpoints
- `GET /api/discovery?status=suggested|pending|approved|rejected|rejected_auto` — queue + counts.
- `POST /api/discovery/run` (or `GET ?key=CRON_SECRET`) — run a discovery batch now.
- `POST /api/discovery/decide` `{id, decision:"approve"|"reject", niche?, importNow?}` — approve → joins `inspiration_accounts`; enrichment worker then pulls top reels.
- `POST /api/discovery/ingest` `{handles[], source, sourceHandle}` header `x-ingest-secret` — Chrome extension feed (also `GET` to test connection).
- `GET/POST /api/discovery/settings` — read/save live tuning.

---

## Open threads / next steps
1. **Deploy** (`railway up --detach`) — the whole stack incl. discovery is waiting. See `SETUP-CHECKLIST.md`.
2. **Create the discovery worker service** on Railway (`npm run worker:discovery`) + set `INGEST_SECRET`.
3. **Load the Chrome extension** onto a discovery IG profile (chrome://extensions → Load unpacked → `extension/`).
4. **Inspiration backlog:** ~115 creator accounts added; only a handful scraped live (rate limits). Enrichment worker fills the rest once deployed + `RUN_ON_BOOT=1`. Now: newly scraped reels arrive niche-tagged + format-classified automatically.
5. **@realmartinachen** top-10 reel downloads were blocked by scraper throttle — retry later.
6. Bigger roadmap: "niches popping off" trend detection from snapshots (not built); the assistant cannot create/log into IG accounts (user does that, then the extension reads its Explore); consider official IG Graph API for our own accounts' accurate followers/saves/shares.

## Key strategic findings (carry-over context for advice)
- **giantgirlamy reach collapsed** (30M/wk → hundreds) from **reposting the same reel** → IG duplicate/unoriginal-content penalty + fatigue. Fix: fresh video every trial, never the same file.
- **Sub-niche per account is real:** gaze/reaction wins on giantgirlamy (4×) & tallgirlkimxo (5×); size-mismatch wins on tallchinesechick (3.1×) and flops as gaze there. Match concept→account. (This is exactly why single/multi-person + niche tagging now happen at scrape time.)
- **Engaged base is the gap:** giantgirlamy likes/follower ≈1.4% vs verytallmaddy ≈5.3%. Chase likes/follower ≥5% and eng/view 4–6%, not raw follower count. (Discovery scores per-follower reach, not follower count.)
- **Production realism matters:** 60fps + iPhone grain + micromovements defeat the "AI" reflex → watch-through → reach.
- **AI metadata:** IG reads C2PA + IPTC "Digital Source Type" → AI label; strip metadata but realism + originality matter more. EU AI Act may require disclosure.
- **Scoring:** inspiration score 0–10 weights views/follower + raw views heaviest, then velocity, then engagement (`lib/score.ts`). Our reels' Performance Score = views/day × (1 + 5×engagement). Exclude chinaboxgirl + amythegolfer (golf) from tall-girl rankings.

## Constraints / gotchas
- Scraper rate-limits hard ("429" / "try again later") — everything uses backoff and small batches; bulk work goes through workers, not live requests.
- Assistant can't create or log into IG accounts and won't handle passwords — user sets all secrets in Railway.
- Assistant **cannot run the `railway up` deploy or load the Chrome extension itself**: terminals are typing-blocked and `chrome://` + file pickers aren't drivable via its browser tools. Those two steps need the user or a terminal-capable agent. The assistant CAN do Railway dashboard config via the browser once deployed.
- Gemini calls are gated by the two live toggles (assume-niche, classify-format) and the `useAi` discovery toggle — turn off to cut cost. All AI is best-effort: throttled/unconfigured Gemini never blocks a scrape.
- Sandbox bash calls are isolated + capped ~45s; long jobs are chunked and persisted.
