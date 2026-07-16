-- ============================================================
--  Inspiration Library — schema extension
--  Adds: sub-categories (street interview, dance, skit, cooking, etc.),
--  trays (spam posting vs regular posting), and trending detection.
--  Run in Supabase SQL editor. Safe to re-run (IF NOT EXISTS / ADD IF NOT EXISTS).
-- ============================================================

-- ---------- sub_categories ----------
-- A managed list of content sub-categories (street interview, dance, skit, cooking, etc.)
-- These are independent of niche — a "tall girl" account can do "dance" or "street interview" content
create table if not exists sub_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,           -- 'street interview', 'dance', 'skit', 'cooking'
  label       text,                           -- display name
  color       text,                           -- hex color for UI badges
  sort_order  int default 0,
  created_at  timestamptz default now()
);

-- Seed common sub-categories
insert into sub_categories (name, label, sort_order)
select * from (values
  ('dance', 'Dance', 1),
  ('street-interview', 'Street Interview', 2),
  ('skit', 'Skit', 3),
  ('cooking', 'Cooking', 4),
  ('talking-head', 'Talking Head', 5),
  ('reaction', 'Reaction', 6),
  ('transition', 'Transition', 7),
  ('outfit', 'Outfit / Fashion', 8),
  ('mirror', 'Mirror', 9),
  ('gaze', 'Gaze / POV', 10),
  ('lifestyle', 'Lifestyle', 11),
  ('comedy', 'Comedy', 12),
  ('tutorial', 'Tutorial', 13),
  ('gym', 'Gym / Fitness', 14),
  ('pool', 'Pool / Beach', 15)
) as v(name, label, sort_order)
where not exists (select 1 from sub_categories);

-- ---------- trays ----------
-- Separate trays for different content strategies
-- 'spam' = spam posting (high frequency, repurposed)
-- 'regular' = regular posting (original, curated)
-- 'pipeline' = for the content pipeline (concepts → briefs → production)
create table if not exists inspiration_trays (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,           -- 'spam', 'regular', 'pipeline'
  label       text,                           -- display name
  description text,
  color       text,
  sort_order  int default 0,
  created_at  timestamptz default now()
);

insert into inspiration_trays (name, label, description, sort_order)
select * from (values
  ('spam', 'Spam Posting', 'High-frequency repurposed content for backup/farm accounts', 1),
  ('regular', 'Regular Posting', 'Curated original content for primary accounts', 2),
  ('pipeline', 'Content Pipeline', 'Inspiration for the AI content generation pipeline', 3)
) as v(name, label, description, sort_order)
where not exists (select 1 from inspiration_trays);

-- ---------- Add sub_category + tray to inspiration_reels ----------
alter table inspiration_reels add column if not exists sub_category text;
alter table inspiration_reels add column if not exists tray text default 'regular';
alter table inspiration_reels add column if not exists is_viral boolean default false;
alter table inspiration_reels add column if not exists viral_score numeric default 0;
alter table inspiration_reels add column if not exists trend_velocity numeric default 0;
-- trend_velocity = how fast views are growing (views per hour since posting)
alter table inspiration_reels add column if not exists last_trend_check timestamptz;

create index if not exists idx_insp_reels_subcat on inspiration_reels (sub_category);
create index if not exists idx_insp_reels_tray   on inspiration_reels (tray);
create index if not exists idx_insp_reels_viral  on inspiration_reels (is_viral desc, viral_score desc);

-- ---------- Add sub_category + tray to inspiration_accounts ----------
alter table inspiration_accounts add column if not exists sub_category text;
alter table inspiration_accounts add column if not exists tray text default 'regular';
alter table inspiration_accounts add column if not exists is_active boolean default true;

create index if not exists idx_insp_acct_tray   on inspiration_accounts (tray);
create index if not exists idx_insp_acct_subcat on inspiration_accounts (sub_category);

-- ---------- Helper: calculate trend velocity ----------
-- Returns views-per-hour since posting
create or replace function reel_trend_velocity(p_reel_url text)
returns numeric as $$
declare
  r record;
  hours_since numeric;
begin
  select views, posted_at into r from inspiration_reels where reel_url = p_reel_url limit 1;
  if not found or r.posted_at is null then return 0; end if;
  hours_since = extract(epoch from (now() - r.posted_at)) / 3600;
  if hours_since < 1 then hours_since = 1; end if;
  return round((r.views / hours_since)::numeric, 2);
end;
$$ language plpgsql stable;

-- ---------- Helper: mark viral ----------
-- A reel is viral if: views > 100k AND view/follow_ratio > 2
-- OR if trend_velocity > 1000 (1000 views/hour)
create or replace function mark_reel_viral(p_reel_url text)
returns boolean as $$
declare
  r record;
  velocity numeric;
begin
  select views, view_follow_ratio, followers_at_scrape into r
  from inspiration_reels where reel_url = p_reel_url limit 1;
  if not found then return false; end if;

  velocity := reel_trend_velocity(p_reel_url);

  declare
    v_is_viral boolean := false;
    score numeric := 0;
  begin
    -- Base score from views
    if r.views > 1000000 then score := score + 40;
    elsif r.views > 500000 then score := score + 30;
    elsif r.views > 100000 then score := score + 20;
    elsif r.views > 50000 then score := score + 10;
    end if;

    -- Boost from view/follow ratio (reach beyond audience = viral)
    if r.view_follow_ratio > 10 then score := score + 30;
    elsif r.view_follow_ratio > 5 then score := score + 20;
    elsif r.view_follow_ratio > 2 then score := score + 10;
    end if;

    -- Boost from trend velocity
    if velocity > 5000 then score := score + 30;
    elsif velocity > 1000 then score := score + 20;
    elsif velocity > 500 then score := score + 10;
    end if;

    v_is_viral := score >= 50;
    update inspiration_reels
      set is_viral = v_is_viral,
          viral_score = score,
          trend_velocity = velocity,
          last_trend_check = now()
      where reel_url = p_reel_url;
    return v_is_viral;
  end;
end;
$$ language plpgsql;
