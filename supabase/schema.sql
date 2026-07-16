-- ============================================================
--  Instagram Manager — Supabase / Postgres schema
--  Run in the Supabase SQL editor (or via the Supabase MCP).
--  Safe to re-run: uses IF NOT EXISTS everywhere.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- niches (managed list) ----------
create table if not exists niches (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  slug        text,
  created_at  timestamptz default now()
);
create index if not exists idx_niches_name on niches (name);

-- ---------- accounts ----------
create table if not exists inspiration_accounts (
  id            uuid primary key default gen_random_uuid(),
  handle        text unique not null,
  profile_url   text,
  full_name     text,
  niche         text,
  followers     bigint default 0,
  following     bigint default 0,
  posts_count   bigint default 0,
  bio           text,
  why_saved     text,
  profile_pic_url text,
  date_added    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists our_accounts (
  id            uuid primary key default gen_random_uuid(),
  handle        text unique not null,
  profile_url   text,
  niche         text,
  followers     bigint default 0,
  following     bigint default 0,
  posts_count   bigint default 0,
  profile_pic_url text,
  notes         text,
  updated_at    timestamptz default now()
);

-- ---------- reels ----------
create table if not exists inspiration_reels (
  id            uuid primary key default gen_random_uuid(),
  reel_url      text unique not null,
  shortcode     text,
  author_handle text,
  caption       text,
  views         bigint default 0,
  likes         bigint default 0,
  comments      bigint default 0,
  shares        bigint default 0,
  saves         bigint default 0,
  engagement_rate    numeric default 0,
  followers_at_scrape bigint default 0,
  view_follow_ratio  numeric default 0,
  duration_sec  int default 0,
  posted_date   date,
  posted_at     timestamptz,
  thumbnail_url text,
  video_url     text,            -- public Supabase Storage URL
  video_path    text,            -- object path in the bucket
  niche         text,
  status        text default 'To Review',
  tags          text[] default '{}',
  refresh_count int default 0,
  date_scraped  date,
  first_seen_at timestamptz default now(),
  updated_at    timestamptz default now(),
  -- stats locked in at download time (IG often deletes the original later)
  downloaded_at        timestamptz,
  views_at_download    bigint,
  likes_at_download    bigint,
  comments_at_download bigint,
  followers_at_download bigint,
  inspiration_score    numeric,  -- cached 0–10 rubric score
  format               text,     -- 'single' | 'multi' (person count)
  format_source        text,     -- 'thumbnail' (quick guess) | 'video' (accurate)
  discovery_scanned_at timestamptz
);
create index if not exists idx_insp_reels_niche   on inspiration_reels (niche);
create index if not exists idx_insp_reels_score   on inspiration_reels (inspiration_score desc);
create index if not exists idx_insp_reels_views   on inspiration_reels (views desc);
create index if not exists idx_insp_reels_author  on inspiration_reels (author_handle);
create index if not exists idx_insp_reels_posted  on inspiration_reels (posted_at);

create table if not exists our_reels (
  id            uuid primary key default gen_random_uuid(),
  reel_url      text unique not null,
  shortcode     text,
  account_handle text,
  caption       text,
  views         bigint default 0,
  likes         bigint default 0,
  comments      bigint default 0,
  shares        bigint default 0,
  saves         bigint default 0,
  engagement_rate    numeric default 0,
  followers_at_scrape bigint default 0,
  view_follow_ratio  numeric default 0,
  duration_sec  int default 0,
  posted_date   date,
  posted_at     timestamptz,
  thumbnail_url text,
  video_url     text,
  video_path    text,
  format        text,
  format_source text,
  inspiration_source text,
  status        text,
  tags          text[] default '{}',
  date_scraped  date,
  first_seen_at timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_our_reels_account on our_reels (account_handle);
create index if not exists idx_our_reels_posted  on our_reels (posted_at desc);
create index if not exists idx_our_reels_views   on our_reels (views desc);

-- ---------- time series ----------
create table if not exists metric_snapshots (
  id            uuid primary key default gen_random_uuid(),
  reel_url      text not null,
  source        text not null,         -- 'Inspiration' | 'Our'
  views         bigint default 0,
  likes         bigint default 0,
  comments      bigint default 0,
  shares        bigint default 0,
  saves         bigint default 0,
  followers     bigint default 0,
  engagement_rate   numeric default 0,
  view_follow_ratio numeric default 0,
  snapshot_at   timestamptz default now()
);
create index if not exists idx_metric_reel   on metric_snapshots (reel_url);
create index if not exists idx_metric_at     on metric_snapshots (snapshot_at);
create index if not exists idx_metric_source on metric_snapshots (source);

create table if not exists account_snapshots (
  id            uuid primary key default gen_random_uuid(),
  account_handle text not null,
  followers     bigint default 0,
  total_views   bigint default 0,
  reel_count    int default 0,
  snapshot_at   timestamptz default now()
);
create index if not exists idx_acct_snap_handle on account_snapshots (account_handle);
create index if not exists idx_acct_snap_at     on account_snapshots (snapshot_at);

-- ---------- creator discovery ----------
-- Candidates harvested from caption @mentions, collab coauthors and
-- commenters on high-scoring inspiration reels. The worker vets them
-- (profile + sample reels) and the /discovery page is the review queue.
create table if not exists discovery_candidates (
  id            uuid primary key default gen_random_uuid(),
  handle        text unique not null,
  -- pending → (vetting) → suggested | rejected_auto | approved | rejected
  status        text default 'pending',
  sources       jsonb default '{}',   -- {"mention": 3, "comment": 2, "coauthor": 1}
  source_count  int default 0,        -- total sightings (ranking key while pending)
  source_handles text[] default '{}', -- which inspiration accounts led here
  -- profile snapshot (filled at vetting)
  full_name     text,
  bio           text,
  followers     bigint,
  following     bigint,
  posts_count   bigint,
  clips_count   bigint,
  is_private    boolean,
  is_verified   boolean,
  profile_pic_url text,
  -- reel sample stats (filled at vetting)
  discovery_score numeric,            -- 0–10, same rubric as inspiration score
  avg_views     bigint,
  max_views     bigint,
  view_follow_ratio numeric,          -- best reel views ÷ followers
  reels_sampled int default 0,
  last_posted_at timestamptz,
  top_reels     jsonb default '[]',   -- [{url, views, likes, thumbnail_url, posted_at}]
  -- optional Gemini niche-fit pass
  ai_niche      text,
  ai_fit        numeric,              -- 0..1
  ai_reason     text,
  reject_reason text,                 -- why auto-rejected / user note
  created_at    timestamptz default now(),
  vetted_at     timestamptz,
  decided_at    timestamptz,
  updated_at    timestamptz default now()
);
create index if not exists idx_disc_cand_status on discovery_candidates (status);
create index if not exists idx_disc_cand_score  on discovery_candidates (discovery_score desc);
create index if not exists idx_disc_cand_seen   on discovery_candidates (source_count desc);

-- Marks inspiration reels whose comments/caption have been harvested already.
alter table inspiration_reels add column if not exists discovery_scanned_at timestamptz;

-- ---------- app settings (live-editable config, no redeploy) ----------
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- ---------- storage bucket for video files ----------
insert into storage.buckets (id, name, public)
values ('reels', 'reels', true)
on conflict (id) do nothing;
