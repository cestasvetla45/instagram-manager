# Reel Lab — Instagram Manager

A self-hosted dashboard to scrape Instagram reels, download them, build an
inspiration database of reels + accounts, track your own accounts, and watch
performance over time. Data lives in **Airtable**; scraping runs through your
**RockSolidAPIs** key. Built with Next.js, deployable to Vercel in a few minutes.

## What it does

- **Add / Scrape** — paste one or many reel URLs; it pulls views, likes,
  comments, caption, thumbnail and the video file URL, then saves to Airtable.
  Add accounts by handle to pull follower/post counts.
- **Inspiration Reels** — searchable, sortable gallery of saved reference reels
  with one-click download.
- **Our Reels** — the same, for reels from your own accounts.
- **Accounts** — tables of inspiration accounts and your accounts.
- **Analytics** — top reels, average-views-over-time trend (from snapshots),
  and a benchmark of your reels vs. inspiration.
- **Daily auto-refresh** — a Vercel Cron re-scrapes tracked reels each morning
  and logs a metric snapshot so trends build automatically.

## Your Airtable base

A base called **Instagram Manager** was already created in your account
(`appS9dwcribegqibV`) with five tables: Inspiration Reels, Inspiration Accounts,
Our Accounts, Our Reels, Metric Snapshots. The app reads/writes it via the API.

## 1. Configure environment

Copy `.env.example` to `.env.local` and fill it in.

### Airtable
1. Go to https://airtable.com/create/tokens
2. Create a token with scopes `data.records:read`, `data.records:write`,
   `schema.bases:read`, and access to the **Instagram Manager** base.
3. Set `AIRTABLE_TOKEN`. `AIRTABLE_BASE_ID` is already `appS9dwcribegqibV`.

### RockSolidAPIs — pre-wired ✅
The adapter (`lib/rocksolid.ts`) is already built for the **Instagram Scraper
Stable API** ([docs](https://rocksolidapis.auto-poster.co.uk/instagram-scraper-stable-api-docs))
and tested against the live API, so you only need to set your key:

| Var | Value |
|-----|-------|
| `ROCKSOLID_API_KEY` | your key (already filled into `.env.example`) |
| `ROCKSOLID_BASE_URL` | `https://auto-poster.co.uk/yt_api` (default) |
| `ROCKSOLID_AUTH_HEADER` | `AP_API_KEY` (default) |

How it maps to the API:

- **Reel scrape** → `media_data_id.php` (shortcode → `media_id`) then
  `get_media_data_v2.php` (full media, incl. `video_play_count`, likes, comments,
  caption, `display_url` thumbnail and direct `video_url`).
- **Account scrape** → `ig_get_fb_profile.php` (`data=basic`) for follower/post counts.
- **Bulk import** → `get_ig_user_reels.php` is wired in `scrapeUserReels()` if you
  want to pull a whole account's recent reels at once (not yet exposed in the UI).

Verified live values for a sample reel: 1.78M plays, 128k likes, 452 comments,
caption + thumbnail + downloadable MP4 all returned correctly.

## 2. Run locally

```bash
npm install
npm run dev
# open http://localhost:3000
```

## 3. Deploy to Vercel

```bash
npm i -g vercel        # if you don't have it
vercel                 # first deploy (links the project)
# add the env vars in the Vercel dashboard → Project → Settings → Environment Variables
vercel --prod          # production deploy
```

Or push this folder to a GitHub repo and "Import Project" at vercel.com — then
paste the env vars in the setup screen.

The daily refresh cron in `vercel.json` runs `GET /api/refresh` at 06:00 UTC.
Adjust the schedule there if you like.

## How metrics tracking works

Every time a reel is scraped or refreshed, a row is written to **Metric
Snapshots** with that day's views/likes/comments. The Analytics "average views
over time" chart is built from those snapshots, so the more often you refresh
(or the longer the cron runs), the richer your trend history.

## Files

```
app/
  page.tsx              Overview / KPIs
  add/                  Scrape reels + add accounts
  inspiration/          Inspiration gallery
  our-reels/            Our reels gallery
  accounts/             Account tables
  analytics/            Charts
  api/
    scrape/             POST: scrape reel URLs → Airtable
    scrape-profile/     POST: scrape an account
    reels/ accounts/    GET: read from Airtable
    refresh/            POST/GET: re-scrape + snapshot (cron target)
    download/           GET: stream the reel mp4 as a download
    snapshots/          GET: time-series for charts
    status/             GET: config check
lib/
  rocksolid.ts          Configurable RockSolidAPIs adapter
  airtable.ts           Airtable REST client
  save.ts               Save/refresh logic
```

## Niches, refresh cadence & the live dashboard

- **Niches** — tag each inspiration account with a niche; its reels inherit it
  automatically when scraped (you can override a single reel by editing its
  `Niche` in Airtable). The **Inspiration Generator** page lets you pick a niche
  + how many videos + a ranking metric and returns your top performers.
- **Refresh cadence** (the `/api/refresh` cron, every 2 hours):
  - Our reels: re-scraped every run; a `Metric Snapshot` is logged each time.
  - Our accounts: a per-account total-views/followers snapshot is logged → the
    **Accounts Dashboard** trend.
  - New-post detection: each account's recent reels are polled; anything new is
    auto-added to Our Reels with `First Seen At` set, and shows in the dashboard's
    "Recently posted" feed.
  - Inspiration reels: scraped only **twice** — once ~24h after posting, once
    ~48h — then left alone (saves API quota). The "Refresh metrics" button on the
    Inspiration page forces an immediate re-scrape if you want it sooner.
- **Video persistence** — on first capture (and any later refresh where the copy
  is missing) the reel's MP4 is pushed to the Airtable `Video` attachment, which
  Airtable rehosts. So even after Instagram deletes the original, your copy lives.

### Deploy note — the 2-hourly cron needs Vercel Pro

Vercel's Hobby (free) plan only runs cron jobs once per day. The `vercel.json`
cron is set to `0 */2 * * *` (every 2 hours) which requires **Pro**. If you're on
Hobby, either upgrade, or point a free external scheduler (e.g. cron-job.org) at:

```
https://<your-app>.vercel.app/api/refresh
```

every 2 hours. To stop strangers from hitting that URL and burning your API
quota, set a `CRON_SECRET` env var and call it as `/api/refresh?key=<secret>`.

## Notes & limits

- The `Video` attachment in Airtable is fetched by Airtable at save time, so that
  copy persists even after the Instagram CDN link dies.
- Respect Instagram's terms and the rate limits / quota of your RockSolidAPIs plan.
  Our reels + account snapshots re-scrape every 2 hours, so watch your request
  budget if you track a lot of your own reels.
- `AIRTABLE_BASE_ID` now defaults to this project's base in code, so only
  `AIRTABLE_TOKEN` and `ROCKSOLID_API_KEY` are strictly required as env vars.
