-- ============================================================
--  Content Pipeline — schema extension
--  Manages the flow: inspiration reel → concept → brief →
--  Airtable (photo generation) → video → assign to account →
--  posted. Enforces: no video repeat within 14 days, no same
--  concept on same account.
--  Run in Supabase SQL editor. Safe to re-run (IF NOT EXISTS).
-- ============================================================

-- ---------- content_types ----------
-- Top-level taxonomy: 'talking' | 'dance' (extensible)
create table if not exists content_types (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,           -- 'talking', 'dance'
  label       text,                           -- display name
  sort_order  int default 0,
  created_at  timestamptz default now()
);

-- Seed the two types the user has right now
insert into content_types (name, label, sort_order)
select 'talking', 'Talking', 1
where not exists (select 1 from content_types where name = 'talking');

insert into content_types (name, label, sort_order)
select 'dance', 'Dance', 2
where not exists (select 1 from content_types where name = 'dance');

-- ---------- subniches ----------
-- Dance subniches (e.g. 'twerk', 'sensual', 'hip-hop', etc.)
-- talking has no subniches (subnience is nullable on concepts)
create table if not exists subniches (
  id            uuid primary key default gen_random_uuid(),
  name          text unique not null,
  content_type  text not null default 'dance',  -- which type this subnience belongs to
  created_at    timestamptz default now()
);
create index if not exists idx_subniches_type on subniches (content_type);

-- ---------- content_concepts ----------
-- A reusable content idea derived from inspiration.
-- e.g. "shower dance", "gaze reaction", "mirror outfit transition"
-- ONE concept can produce MANY briefs (e.g. 5 outfits = 5 briefs)
create table if not exists content_concepts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  content_type    text not null default 'dance',   -- talking | dance
  subniche        text,                             -- e.g. 'twerk' (nullable for talking)
  niche           text,                             -- account niche (tall girl, etc.)
  description     text,
  -- link back to the inspiration reel that sparked this concept
  inspiration_reel_url  text,
  inspiration_thumbnail text,
  inspiration_account   text,
  -- AI-extracted prompt hints for photo generation
  visual_prompt   text,    -- e.g. "girl in shower, steam, backlit, sensual"
  hook_text       text,    -- on-screen text / caption idea
  status          text default 'active',  -- active | retired
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_concepts_type    on content_concepts (content_type);
create index if not exists idx_concepts_subniche on content_concepts (subniche);
create index if not exists idx_concepts_niche   on content_concepts (niche);
create index if not exists idx_concepts_status  on content_concepts (status);

-- ---------- content_briefs ----------
-- A specific production brief — one "reel to make."
-- One concept → many briefs (outfit variants, angle variants, etc.)
-- This is what gets pushed to Airtable for photo generation.
create table if not exists content_briefs (
  id              uuid primary key default gen_random_uuid(),
  concept_id      uuid references content_concepts(id) on delete cascade,
  title           text not null,
  variant_label   text,    -- e.g. "Outfit 1 — red dress", "Angle B — close-up"
  -- the actual prompt for the photo/video generation pipeline
  generation_prompt  text,    -- full prompt for the AI image generator
  reference_reel_url text,    -- can differ from concept's inspiration reel
  reference_thumbnail text,
  -- Airtable sync
  airtable_record_id text,    -- ID in the "Ai Reels Workflow Setup" base
  airtable_synced_at timestamptz,
  -- status flow: draft → pushed → photos_ready → video_ready → assigned → posted
  status          text default 'draft',
  notes           text,
  created_by      text,    -- who created the brief (VA name, etc.)
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_briefs_concept on content_briefs (concept_id);
create index if not exists idx_briefs_status  on content_briefs (status);
create index if not exists idx_briefs_airtable on content_briefs (airtable_record_id);

-- ---------- content_assignments ----------
-- Which account gets which brief. Enforces the cooldown rules.
create table if not exists content_assignments (
  id              uuid primary key default gen_random_uuid(),
  brief_id        uuid references content_briefs(id) on delete cascade,
  concept_id      uuid references content_concepts(id) on delete set null,
  account_handle  text not null,
  -- assigned → posted | expired | skipped
  status          text default 'assigned',
  assigned_at     timestamptz default now(),
  posted_at       timestamptz,
  cooldown_expires_at timestamptz,  -- = posted_at + 14 days (set when posted)
  -- the actual reel URL once posted (links to va_posts)
  reel_url        text,
  va_name         text,    -- which VA posted it
  notes           text,
  created_at      timestamptz default now()
);
create index if not exists idx_assign_account on content_assignments (account_handle);
create index if not exists idx_assign_brief   on content_assignments (brief_id);
create index if not exists idx_assign_concept on content_assignments (concept_id);
create index if not exists idx_assign_status  on content_assignments (status);
create index if not exists idx_assign_posted  on content_assignments (posted_at desc);

-- ---------- Add content_type/subniche to our_accounts ----------
-- So each account can be tagged with what kind of content it runs
alter table our_accounts add column if not exists content_type text default 'dance';
alter table our_accounts add column if not exists subniche text;
alter table our_accounts add column if not exists va_group text;  -- 'VA1' | 'VA2' etc.

-- ---------- Add content_type to inspiration_reels ----------
-- So inspiration reels are tagged by what kind of content they are
alter table inspiration_reels add column if not exists content_type text;
alter table inspiration_reels add column if not exists subniche text;

-- ---------- Helper: check if a concept is available for an account ----------
-- Returns true if the concept has NOT been assigned+posted to this account
-- (the "no same concept on same account" rule)
create or replace function concept_available_for_account(
  p_concept_id uuid,
  p_account_handle text
) returns boolean as $$
begin
  return not exists (
    select 1 from content_assignments
    where concept_id = p_concept_id
      and account_handle = p_account_handle
      and status = 'posted'
  );
end;
$$ language plpgsql stable;

-- ---------- Helper: check video cooldown ----------
-- Returns true if the account has no assignment posted in the last 14 days
-- for the same brief (the "no video repeat within 2 weeks" rule)
create or replace function brief_off_cooldown(
  p_brief_id uuid,
  p_account_handle text
) returns boolean as $$
begin
  return not exists (
    select 1 from content_assignments
    where brief_id = p_brief_id
      and account_handle = p_account_handle
      and status = 'posted'
      and cooldown_expires_at > now()
  );
end;
$$ language plpgsql stable;
