-- ============================================================
--  Reel Performance — schema extension (Task 5a)
--  Tracks how OUR posted reels performed 24h after posting,
--  plus AI analysis of analytics screenshots (retention graph,
--  demographics, territories) and the "winner templates" that
--  emerge from the reels that did well.
--  Run in Supabase SQL editor. Safe to re-run (IF NOT EXISTS).
-- ============================================================

-- ---------- reel_performance ----------
-- One row per posted reel we want to measure. Filled in by the VA
-- (screenshots + basic stats) and enriched by Gemini Vision.
create table if not exists reel_performance (
  id              uuid primary key default gen_random_uuid(),
  reel_url        text,
  account_handle  text not null,
  va_name         text,
  brief_id        uuid references content_briefs(id) on delete set null,
  concept_id      uuid references content_concepts(id) on delete set null,
  inspiration_reel_url text,
  posted_at       timestamptz,
  views_24h       bigint,
  likes_24h       bigint,
  comments_24h    bigint,
  shares_24h      bigint,
  saves_24h       bigint,
  retention_graph     jsonb,
  avg_retention       numeric,
  skip_rate           numeric,
  peak_retention      numeric,
  drop_off_points     jsonb,
  demographics        jsonb,
  top_territories     jsonb,
  ai_feedback         text,
  ai_strengths        text[],
  ai_weaknesses       text[],
  ai_score            numeric,
  ai_analyzed_at      timestamptz,
  screenshot_urls     text[] default '{}',
  is_winner           boolean default false,
  winner_template     text,
  trend_tags          text[] default '{}',
  status              text default 'posted',
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
-- Retention-curve shape distilled by lib/reel-performance.identifyTrends()
-- (Task 5b): 'U-shape' | 'declining' | 'spike-end' | 'flat'.
alter table reel_performance add column if not exists retention_curve text;

create index if not exists idx_perf_account on reel_performance (account_handle);
create index if not exists idx_perf_posted  on reel_performance (posted_at desc);
create index if not exists idx_perf_winner  on reel_performance (is_winner desc, ai_score desc);
create index if not exists idx_perf_concept on reel_performance (concept_id);
create index if not exists idx_perf_status  on reel_performance (status);

-- ---------- winner_templates ----------
-- A repeatable pattern distilled from reels that performed well.
create table if not exists winner_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  pattern         jsonb,
  avg_retention   numeric,
  avg_views       bigint,
  avg_skip_rate   numeric,
  instance_count  int default 0,
  content_type    text,
  sub_category    text,
  niche           text,
  hook_type       text,
  avg_duration    numeric,
  retention_curve text,
  inspiration_reel_urls text[] default '{}',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ---------- storage bucket for screenshots ----------
insert into storage.buckets (id, name, public)
values ('reel-screenshots', 'reel-screenshots', true)
on conflict (id) do nothing;
