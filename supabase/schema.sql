-- SOVEREIGN database schema — Supabase (Postgres 15+)
-- Run in the Supabase SQL editor, or: psql "$DATABASE_URL" -f schema.sql
-- Idempotent: safe to re-run.

-- ── profiles ──────────────────────────────────────────────────────────────
-- One row per player, keyed by Supabase Auth user id.
-- Username-only accounts use a hidden internal email (<slug>@users.sovereign.game);
-- the real email column stays NULL for them.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text,
  level integer not null default 1,
  xp integer not null default 0,
  coins integer not null default 0,          -- Phase 2 economy faucet
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,16}$')
);
create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username));

-- ── scores (leaderboards) ─────────────────────────────────────────────────
-- One row per finished match. Written ONLY via the submit-score edge function
-- (service role); clients have no direct insert.
create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('blitz', 'epic')),
  template text not null,
  bot_tier text not null check (bot_tier in ('recruit', 'veteran', 'sovereign', 'mixed')),
  score integer not null check (score >= 0),
  territories integer not null default 0,
  eliminations integer not null default 0,
  won boolean not null default false,
  time_ms integer not null check (time_ms > 0),
  match_seed integer not null,
  replay_hash text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists scores_leaderboard_idx
  on public.scores (mode, score desc, created_at desc);
create index if not exists scores_profile_idx on public.scores (profile_id);

-- ── daily_runs ────────────────────────────────────────────────────────────
-- One attempt per player per day. The UNIQUE constraint IS the anti-cheat
-- for multi-attempting the daily challenge.
create table if not exists public.daily_runs (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  seed integer not null,
  score integer not null check (score >= 0),
  time_ms integer not null check (time_ms > 0),
  rank integer,                              -- filled after day closes
  replay_hash text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (profile_id, day)
);
create index if not exists daily_runs_day_score_idx
  on public.daily_runs (day, score desc);

-- ── cosmetics ─────────────────────────────────────────────────────────────
create table if not exists public.cosmetics (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  skin_id text not null,                     -- e.g. 'color:ember', 'trail:neon'
  equipped boolean not null default false,
  unlocked_at timestamptz not null default now(),
  primary key (profile_id, skin_id)
);

-- ── season_ratings (ranked ladder) ────────────────────────────────────────
create table if not exists public.season_ratings (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  season integer not null,
  mode text not null check (mode in ('blitz', 'epic')),
  rating integer not null default 1000,
  tier text not null default 'bronze'
    check (tier in ('bronze','silver','gold','platinum','diamond','sovereign')),
  matches integer not null default 0,
  wins integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (profile_id, season, mode)
);
create index if not exists season_ratings_ladder_idx
  on public.season_ratings (season, mode, rating desc);

-- ── achievements ──────────────────────────────────────────────────────────
create table if not exists public.achievements (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  achievement_id text not null,              -- e.g. 'first_blood'
  unlocked_at timestamptz not null default now(),
  primary key (profile_id, achievement_id)
);

-- ── Row Level Security ────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.scores enable row level security;
alter table public.daily_runs enable row level security;
alter table public.cosmetics enable row level security;
alter table public.season_ratings enable row level security;
alter table public.achievements enable row level security;

-- Public read: leaderboards, profiles, daily boards (anyone can view).
-- Writes: users may only touch their OWN rows; scores/daily_runs inserts go
-- through the service-role edge function (bypasses RLS), so no client insert
-- policy is granted on those two tables.

drop policy if exists "profiles public read" on public.profiles;
create policy "profiles public read" on public.profiles
  for select using (true);

drop policy if exists "profiles owner update" on public.profiles;
create policy "profiles owner update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles owner insert" on public.profiles;
create policy "profiles owner insert" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "scores public read" on public.scores;
create policy "scores public read" on public.scores
  for select using (true);
-- NOTE: no insert/update/delete policy for clients on scores (edge function only).

drop policy if exists "daily public read" on public.daily_runs;
create policy "daily public read" on public.daily_runs
  for select using (true);
-- NOTE: no client insert policy on daily_runs (edge function only).

drop policy if exists "cosmetics owner read" on public.cosmetics;
create policy "cosmetics owner read" on public.cosmetics
  for select using (auth.uid() = profile_id);

drop policy if exists "cosmetics owner insert" on public.cosmetics;
create policy "cosmetics owner insert" on public.cosmetics
  for insert with check (auth.uid() = profile_id);

drop policy if exists "cosmetics owner update" on public.cosmetics;
create policy "cosmetics owner update" on public.cosmetics
  for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "ratings public read" on public.season_ratings;
create policy "ratings public read" on public.season_ratings
  for select using (true);
-- NOTE: rating updates via edge function only (service role).

drop policy if exists "achievements owner read" on public.achievements;
create policy "achievements owner read" on public.achievements
  for select using (auth.uid() = profile_id);
-- NOTE: achievement grants via edge function only (service role).

-- ── Helper: case-insensitive username availability check ───────────────────
create or replace function public.username_available(p_username text)
returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(p_username)
  );
$$;
