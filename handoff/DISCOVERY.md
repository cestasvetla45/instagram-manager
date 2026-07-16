# Creator Discovery — deep dive

The subsystem that finds NEW trending creators to add to the inspiration library, automatically and 24/7. Read `HANDOFF.md` first for the big picture.

## Goal
Continuously surface creators we don't already track who are (a) in our tall-girl/fitness lane and (b) demonstrably viral *right now*, then queue them for one-click approval into the inspiration library — where the existing enrichment worker scrapes their top reels.

## Pipeline: Harvest → Vet → Review

### 1. Harvest (find candidate handles)
Sources, each recorded in `discovery_candidates.sources` as a counter:
- **`mention`** — `@handles` parsed out of captions on inspiration reels already in the DB. Cheap, DB-only.
- **`coauthor`** — collab co-authors (`coauthor_producers`) seen while listing an account's reels. Captured during enrichment via `recordCoauthors()`.
- **`comment`** — usernames of people commenting on our top-scoring, comment-rich inspiration reels (score ≥ 6, ≥ 50 comments). Costs scraper calls, so only a few reels per cycle (`commentReels`). Peers comment on peers.
- **`related` / `suggested` / `explore`** — creators Instagram itself surfaces to a logged-in discovery profile, fed in by the **Chrome extension** (below). This is how we get IG's own recommendation graph, since the scraper provider has no related-profiles endpoint.
- **`manual`** — anything pasted into the ingest endpoint directly.

A handle already in `inspiration_accounts` / `our_accounts`, or already decided (`approved`/`rejected`/`rejected_auto`), is never re-queued. Reels are flagged `discovery_scanned_at` so they aren't re-mined.

### 2. Vet (score the candidates)
`vetPending()` processes the top `vetBudget` pending candidates per cycle, ranked by `source_count` (a handle seen across many collabs/comments/suggestions gets vetted first). For each, `vetOne()`:
1. Scrapes the profile. **Auto-rejects** (with a stored `reject_reason`) if private, below `minFollowers`, above `maxFollowers` (celebrity/brand), or no reels.
2. Pulls their most recent ~12 reels. Auto-rejects if inactive (no post within `maxAgeDays`).
3. **Scores** their *best* recent reel with the library rubric (`lib/score.ts`: views/follower 35%, raw views 30%, velocity 20%, engagement 15%), then multiplies by a consistency factor (avg views ÷ best views) so one lucky hit doesn't inflate them. Result = `discovery_score` (0–10). Below `minScore` → auto-reject.
4. If `useAi`: a text-only Gemini pass (`assessCreatorFit`) guesses the best niche + a 0–1 fit score.
5. Survivors become `status='suggested'` with stats, `view_follow_ratio`, and `top_reels` thumbnails saved.

**"Most viral" = ranked by proven recent per-follower reach, not follower count** — matching the strategic finding that engaged-base reach beats raw size.

### 3. Review (`/discovery` page)
Tabs: Suggested (sorted by score), Queue (pending), Approved, Auto-rejected, Rejected. Each card shows score badge, followers/reels/avg-views/best/ratio, bio, source line ("3× mention · 2× comment via @…"), AI niche guess, and top-reel thumbnails.
- **Approve** (optional niche + "import top reels now"): upserts into `inspiration_accounts` with the niche and a "why saved" note, marks the candidate `approved`. The enrichment worker (or immediate import) then pulls their top reels — which now arrive niche-tagged + format-classified.
- **Reject**: marks `rejected` with a note.
- **▶ Run discovery now**: fires a batch on demand and reports counts.
- **⚙ Discovery tuning**: live-editable settings, saved to `app_settings`, used by the worker next cycle. No redeploy. Fields: min/max followers, min score, max days since post, comment scans/cycle, accounts vetted/cycle, + toggles for AI niche-fit, assume-niche-on-scrape, classify-format.

## The 24/7 worker
`worker/discovery.ts` (`npm run worker:discovery`) runs `runDiscovery()` on boot then every `DISCOVERY_INTERVAL_MINUTES` (default 30), independent of the main refresh worker so scraper budgets don't collide. Deploy as a **separate Railway service** on the same repo.

## Chrome extension (profile connector) — `extension/`
MV3 extension that rides a logged-in Instagram profile and feeds IG's own suggestions into the queue. **Passive**: it only reads the JSON responses IG already sends the browser while you browse (via a fetch/XHR wrapper in `inject.js`, MAIN world) — it never clicks, follows, or requests anything on IG's behalf, which keeps the discovery account low-risk.
- `inject.js` scans related-profiles / explore / suggested-user payloads for public user objects, classifies the source, posts handles to the page.
- `content.js` relays them to `background.js`.
- `background.js` dedupes, batches (~20s / 200 handles), and POSTs to `/api/discovery/ingest` with the `x-ingest-secret`. Tracks captured/sent/added stats.
- `popup.html`/`popup.js` — set App URL + INGEST_SECRET, toggle capture, Test connection, view counters.

Install: `chrome://extensions` → Developer mode → Load unpacked → select `extension/`. Then set App URL (`https://instagram-tool-production-e4f2.up.railway.app`) + the `INGEST_SECRET` from Railway, hit Test (→ "Connected ✓"), log the profile into the discovery IG account, and browse Explore/Reels/competitor "similar accounts". The more that account engages with tall-girl/fitness content, the better IG's suggestions — and the queue — become.

## Reel format classification (single vs multi-person)
Every scraped reel gets `format` = `single` (dance / talking-head / solo) or `multi` (skit / street interview / duet), with `format_source`:
- **`thumbnail`** — fast cover-image guess (`classifyFormatFromThumbnail`, Gemini image) at scrape time, on every reel. Gated by the `classifyFormat` toggle.
- **`video`** — accurate label captured for free when a reel is AI-categorized (`categorizeVideo` watches the actual video and now also returns `format`). Upgrades the thumbnail guess; a "✓" next to the badge marks video-sourced labels.
UI: badge on each `ReelCard`; filter on the Inspiration page (All / Single / Multi / Unclassified) via `?format=` on `/api/reels`.

## Assume-niche-on-scrape
Scraping an account no longer dumps reels in as "Untagged." `assumedAccountNiche()` (in `lib/classify.ts`), gated by the `assumeNiche` toggle: (1) inherit the account's existing niche; else (2) Gemini guesses one from bio + recent captions, pins it on the account, and registers any brand-new niche in the `niches` table so it appears in filters. Discovery-approved accounts already carry a niche from approval, so their reels inherit it. Wired into `lib/discover.ts` (backlog worker), `scrape-account` route, and `lib/save.ts`.

## Files
Engine `lib/discovery.ts` · settings `lib/settings.ts` · scrape enrichment `lib/classify.ts` · Gemini `lib/gemini.ts` · scraper `lib/rocksolid.ts` · worker `worker/discovery.ts` · UI `app/discovery/page.tsx` · APIs `app/api/discovery/*` · extension `extension/*`.
