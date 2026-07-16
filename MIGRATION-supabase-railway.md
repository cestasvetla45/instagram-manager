# Migration → Supabase + Railway (v2)

The app now runs on **Supabase** (Postgres + Storage for the video files) and
deploys to **Railway** (a web service + a background worker). Airtable and Vercel
are no longer used. The scraper (RockSolidAPIs) is unchanged.

```
 Browser ──▶ Next.js web service (Railway) ──▶ Supabase Postgres + Storage
                                            ▲
 Worker service (Railway, node-cron) ───────┘  every 2h: refresh + new posts
        │
        └──▶ RockSolidAPIs (scrape)
```

## 1. Supabase

1. Create a project at https://supabase.com (or let me do it via the Supabase
   connector). Pick a region close to you.
2. **SQL** — open the SQL editor and run `supabase/schema.sql` (creates all
   tables, indexes, and the public `reels` storage bucket).
3. **Keys** — Project Settings → API. Copy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (server-side only — never
     ship this to the browser)

Why Supabase: Postgres indexes make the dashboard/queries fast at scale, there's
no 5 req/sec API cap like Airtable, and the `reels` bucket stores each MP4
durably so videos survive Instagram deletions.

## 2. Railway — two services from this repo

Create a Railway project and add **two services** pointing at the same repo
(push it to GitHub first, or use `railway up`):

| Service | Start command | Purpose |
|---------|---------------|---------|
| **web** | `npm run start` (default, from `railway.toml`) | the Next.js dashboard |
| **worker** | `npm run worker` | bi-hourly refresh + new-post detection |

For the **worker** service, in its Settings set the **Custom Start Command** to
`npm run worker` (and optionally Build Command to `npm install` to skip the
Next build it doesn't need).

### Environment variables (set on BOTH services)

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ROCKSOLID_API_KEY=e735ef5d0a5dd9b36ebf2be0c02d17b6
```

Worker-only (optional):

```
WORKER_CRON=0 */2 * * *     # default: every 2 hours
RUN_ON_BOOT=1               # run one cycle right after deploy (handy first time)
```

Railway injects `PORT` automatically; the web `start` script already binds to it.

## 3. Deploy

```bash
cd "/Users/tomimiksa/Desktop/IG Scraper/instagram-manager"
npm install            # pulls @supabase/supabase-js, node-cron, tsx
npm run build          # sanity check the web build locally (optional)

# then either: railway up   (Railway CLI),  or connect the GitHub repo in Railway
```

Railway gives the web service a public URL — that's your dashboard. The worker
runs headless and prints a log line each cycle.

## What changed vs. the Airtable version

- `lib/db.ts` — Supabase client + row→fields mappers (the API still returns the
  same JSON shape, so all the pages/components are unchanged).
- `lib/storage.ts` — downloads each reel MP4 and uploads it to the `reels` bucket;
  the stored public URL is what the dashboard's Download button serves.
- `lib/refresh.ts` — the refresh cycle, shared by the worker and the
  `/api/refresh` route.
- `worker/index.ts` — node-cron scheduler (no Vercel Pro cron limits anymore).
- `lib/airtable.ts` is now unused and can be deleted.

## Refresh behaviour (unchanged from before)

- Our reels + per-account view totals: refreshed every run (every 2h).
- New posts on our accounts: auto-detected and added each run.
- Inspiration reels: scraped only at ~24h and ~48h after posting.
- Videos: stored to Supabase Storage on first capture / whenever the copy is
  missing.

## Scaling notes

- Postgres indexes are already created for the hot query paths (niche, views,
  account_handle, posted_at, snapshot_at).
- The worker guards against overlapping cycles. If you track thousands of reels,
  raise the worker service resources and consider splitting inspiration vs. our
  refreshes onto different `WORKER_CRON`s (two worker services).
- Storage: the `reels` bucket is public for easy playback/download; switch to
  signed URLs if you need it private.
