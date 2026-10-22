-- LG3S International (LeagueGaming leagueid=154, season 1) — isolated namespace.
-- Touches NOTHING outside lg3s_* objects. All timestamps timestamptz (UTC). Writes: service_role only.
begin;

do $$ begin
  create type public.lg3s_verification_status as enum ('unverified','provisional','verified','needs_review','corrected');
exception when duplicate_object then null; end $$;

create table if not exists public.lg3s_teams (
  lg_team_id   integer primary key,
  nation       text not null,
  group_code   text not null check (group_code in ('A','B')),
  crest_path   text,
  source_url   text not null,
  updated_at   timestamptz not null default now()
);

create table if not exists public.lg3s_source_snapshots (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('game','schedule','standings','roster')),
  source_id    text not null,                 -- gameid / teamid / 'standings'
  url          text not null,
  fetched_at   timestamptz not null default now(),
  http_status  integer,
  sha256       text,                          -- hash of raw body
  payload_hash text,                          -- hash of canonical parsed payload
  bytes        integer,
  storage_path text,                          -- optional raw HTML in storage
  parse_error  text
);
create index if not exists lg3s_source_snapshots_src_idx on public.lg3s_source_snapshots (kind, source_id, fetched_at desc);

create table if not exists public.lg3s_games (
  lg_game_id            bigint primary key,
  season                integer not null default 1,
  scheduled_at          timestamptz not null,
  game_night_date       date generated always as (((scheduled_at at time zone 'America/Toronto') - interval '6 hours')::date) stored,
  away_lg_team_id       integer not null references public.lg3s_teams(lg_team_id),
  home_lg_team_id       integer not null references public.lg3s_teams(lg_team_id),
  status                text not null default 'scheduled' check (status in ('scheduled','in_progress','final','postponed','cancelled')),
  away_score            integer check (away_score >= 0),
  home_score            integer check (home_score >= 0),
  decided_in            text check (decided_in in ('REG','OT','SO')),
  period_stats          jsonb,
  team_stats            jsonb,
  verification_status   public.lg3s_verification_status not null default 'unverified',
  verification_checks   jsonb,
  verification_flags    text[] not null default '{}',
  payload_hash          text,                 -- hash of the payload currently stored
  candidate_hash        text,                 -- stability window: hash being confirmed
  candidate_first_seen_at timestamptz,
  candidate_seen_count  integer not null default 0,
  source_url            text not null,
  source_snapshot_id    bigint references public.lg3s_source_snapshots(id),
  first_seen_at         timestamptz not null default now(),
  last_fetched_at       timestamptz,
  final_confirmed_at    timestamptz,
  verified_by           text check (verified_by in ('auto','manual')),
  correction_note       text,
  updated_at            timestamptz not null default now(),
  check (away_lg_team_id <> home_lg_team_id)
);
create index if not exists lg3s_games_night_idx on public.lg3s_games (game_night_date, scheduled_at);
create index if not exists lg3s_games_vs_idx on public.lg3s_games (verification_status);

create table if not exists public.lg3s_player_game_lines (
  lg_game_id        bigint not null references public.lg3s_games(lg_game_id) on delete cascade,
  lg_user_id        bigint not null,
  player_kind       text not null check (player_kind in ('skater','goalie')),
  lg_team_id_at_game integer not null references public.lg3s_teams(lg_team_id),
  gamertag_at_game  text not null,
  position          text,
  goals integer, assists integer, points integer, plus_minus integer, shots integer, shot_attempts integer,
  hits integer, takeaways integer, giveaways integer, blocks integer, interceptions integer, pim_seconds integer, toi_seconds integer, pass_pct numeric,
  shots_against integer, goals_against integer, saves integer, save_pct numeric, gaa numeric,
  is_placeholder    boolean not null default false,   -- e.g. LG system account userid=1
  identity_flags    text[] not null default '{}',
  source_snapshot_id bigint references public.lg3s_source_snapshots(id),
  updated_at        timestamptz not null default now(),
  primary key (lg_game_id, lg_user_id, player_kind)
);
create index if not exists lg3s_lines_user_idx on public.lg3s_player_game_lines (lg_user_id);
create index if not exists lg3s_lines_team_idx on public.lg3s_player_game_lines (lg_team_id_at_game);
create index if not exists lg3s_lines_snap_idx on public.lg3s_player_game_lines (source_snapshot_id);
create index if not exists lg3s_games_snap_idx on public.lg3s_games (source_snapshot_id);
create index if not exists lg3s_games_away_idx on public.lg3s_games (away_lg_team_id);
create index if not exists lg3s_games_home_idx on public.lg3s_games (home_lg_team_id);

create table if not exists public.lg3s_standings_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  source text not null check (source in ('lg_official','computed_verified')),
  group_code text not null, lg_team_id integer not null references public.lg3s_teams(lg_team_id),
  rank integer, gp integer, w integer, l integer, otw integer, otl integer, pts integer, gf integer, ga integer, gd integer, streak text,
  source_url text, payload_hash text
);
create index if not exists lg3s_standings_cap_idx on public.lg3s_standings_snapshots (source, captured_at desc);
create index if not exists lg3s_standings_team_idx on public.lg3s_standings_snapshots (lg_team_id);

create table if not exists public.lg3s_sync_runs (
  id bigint generated always as identity primary key,
  mode text not null, started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','partial','failed','skipped')),
  requests integer not null default 0, games_checked integer not null default 0,
  changes jsonb not null default '[]', errors jsonb not null default '[]',
  idempotency_key text unique
);

create table if not exists public.lg3s_corrections (
  id bigint generated always as identity primary key,
  lg_game_id bigint not null references public.lg3s_games(lg_game_id),
  detected_at timestamptz not null default now(),
  action text not null check (action in ('applied','rejected','pending_stability','manual')),
  reason text not null,
  old_payload_hash text, new_payload_hash text,
  old_values jsonb, new_values jsonb
);
create index if not exists lg3s_corrections_game_idx on public.lg3s_corrections (lg_game_id, detected_at desc);

create table if not exists public.lg3s_editorial_posts (
  id bigint generated always as identity primary key,
  article_type text not null check (article_type in ('recap','spotlight','power_rankings','night_wrap','preview')),
  lg_game_id bigint references public.lg3s_games(lg_game_id),
  week integer, game_night_date date,
  idempotency_key text not null unique,
  status text not null default 'pending_review' check (status in ('pending_review','approved','published','rejected')),
  title text not null, body_md text not null,
  derived_from_game_ids bigint[] not null default '{}',
  facts jsonb not null default '{}',          -- every stat cited, for accuracy audit
  accuracy jsonb,                             -- {checked_at, facts_total, facts_matched, mismatches[]}
  generator text not null default 'lg3s-media-desk',
  created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by text
);
create unique index if not exists lg3s_editorial_game_uq on public.lg3s_editorial_posts (article_type, lg_game_id) where lg_game_id is not null;
create index if not exists lg3s_editorial_game_idx on public.lg3s_editorial_posts (lg_game_id);

-- RLS: on, no policies => anon/authenticated see nothing in base tables.
alter table public.lg3s_teams enable row level security;
alter table public.lg3s_source_snapshots enable row level security;
alter table public.lg3s_games enable row level security;
alter table public.lg3s_player_game_lines enable row level security;
alter table public.lg3s_standings_snapshots enable row level security;
alter table public.lg3s_sync_runs enable row level security;
alter table public.lg3s_corrections enable row level security;
alter table public.lg3s_editorial_posts enable row level security;
revoke all on public.lg3s_teams, public.lg3s_source_snapshots, public.lg3s_games, public.lg3s_player_game_lines,
  public.lg3s_standings_snapshots, public.lg3s_sync_runs, public.lg3s_corrections, public.lg3s_editorial_posts from anon, authenticated;

commit;
