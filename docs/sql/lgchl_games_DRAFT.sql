-- ============================================================================================
-- DRAFT - NOT APPLIED. Do not run until Seth approves (table names, RLS scope, scheduler).
-- League-wide LGCHL schedule/scores store shared by the live ticker (api/lgchl-scores.js) and
-- the War Room landing league crawl (war-room-plan PLAN.md section 4, which called the games
-- table lgchl_league_games; pick ONE name before applying - this draft uses lgchl_games).
-- Source: public LeagueGaming pages (standings + 62 per-team full schedule pages), league 39.
-- Writer: service_role only (Supabase Edge Function lgchl-league-sync on pg_cron, same pattern
-- as the existing lg-stats-sync / lg-stats-worker). Readers: see RLS choice below.
-- ============================================================================================

create table public.lgchl_teams (
  lg_team_id    integer primary key,              -- LG teamid, e.g. 412 = Calgary Hitmen
  season        integer not null default 55,
  name          text not null,                    -- 'Calgary Hitmen'
  abbr          text not null,                    -- 'CGY' (ticker)
  nickname      text not null,                    -- 'Hitmen' (War Room mockups)
  league        text not null check (league in ('WHL','OHL','QMJHL')),
  division      text,                             -- standings table label, e.g. 'WHL Eastern 2'
  logo_path     text,                             -- '/assets/lgchl/s55/48/team412.webp'
  updated_at    timestamptz not null default now()
);

create table public.lgchl_games (
  lg_game_id       bigint primary key,            -- LG gameid (page=game&gameid=...)
  lg_league_id     integer not null default 39,
  season           integer not null default 55,
  week             integer,
  game_at          timestamptz,                   -- LG shows US Eastern without a year; parsed to UTC
  away_lg_team_id  integer not null references public.lgchl_teams(lg_team_id),
  home_lg_team_id  integer not null references public.lgchl_teams(lg_team_id),
  away_score       smallint,
  home_score       smallint,
  status           text not null default 'scheduled'
                   check (status in ('scheduled','final','postponed','cancelled')),
  decided_in       text check (decided_in in ('REG','OT','SO')),   -- null until a game page is read
  source_url       text not null,
  first_seen_at    timestamptz not null default now(),
  fetched_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (away_lg_team_id <> home_lg_team_id),
  check ((status = 'final') = (away_score is not null and home_score is not null))
);
create index lgchl_games_season_time on public.lgchl_games (season, game_at);
create index lgchl_games_away on public.lgchl_games (away_lg_team_id, game_at);
create index lgchl_games_home on public.lgchl_games (home_lg_team_id, game_at);
create index lgchl_games_open on public.lgchl_games (game_at) where status = 'scheduled';

-- Optional: point-in-time standings for War Room race/trend panels.
create table public.lgchl_standings_snapshots (
  id           bigint generated always as identity primary key,
  season       integer not null default 55,
  lg_team_id   integer not null references public.lgchl_teams(lg_team_id),
  taken_at     timestamptz not null default now(),
  gp smallint, w smallint, l smallint, otw smallint, otl smallint, pts smallint,
  gf smallint, ga smallint, streak text, last10 text, home text, away text,
  unique (season, lg_team_id, taken_at)
);

-- Sync bookkeeping so the worker can do cheap deltas and we can see failures (e.g. Cloudflare).
create table public.lgchl_sync_runs (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind in ('full','delta','game_pages')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  requests      integer not null default 0,
  games_upserted integer not null default 0,
  finals_new    integer not null default 0,
  error         text
);

-- Ticker-shaped read model: yesterday/today finals + tonight's slate, joined to team display data.
create view public.lgchl_games_board with (security_invoker = true) as
select g.lg_game_id, g.season, g.week, g.game_at, g.status, g.decided_in,
       g.away_lg_team_id, a.abbr as away_abbr, a.nickname as away_nick, a.logo_path as away_logo, g.away_score,
       g.home_lg_team_id, h.abbr as home_abbr, h.nickname as home_nick, h.logo_path as home_logo, g.home_score,
       a.league, g.source_url, g.fetched_at
from public.lgchl_games g
join public.lgchl_teams a on a.lg_team_id = g.away_lg_team_id
join public.lgchl_teams h on h.lg_team_id = g.home_lg_team_id;

alter table public.lgchl_teams enable row level security;
alter table public.lgchl_games enable row level security;
alter table public.lgchl_standings_snapshots enable row level security;
alter table public.lgchl_sync_runs enable row level security;

-- RLS DECISION FOR SETH. This is public league data (it's on leaguegaming.com).
-- Option A (shown): readable by anyone, so the public ticker can query PostgREST with the
--   publishable key and Vercel needs no service key.
-- Option B: replace "to anon, authenticated" with "to authenticated" to match the War Room
--   plan; the public ticker would then keep reading via api/lgchl-scores.js with a server key.
create policy lgchl_teams_read on public.lgchl_teams for select to anon, authenticated using (true);
create policy lgchl_games_read on public.lgchl_games for select to anon, authenticated using (true);
create policy lgchl_standings_read on public.lgchl_standings_snapshots for select to anon, authenticated using (true);
-- sync runs: no select policy -> service_role only.

grant select on public.lgchl_teams, public.lgchl_games, public.lgchl_standings_snapshots, public.lgchl_games_board to anon, authenticated;
grant all on public.lgchl_teams, public.lgchl_games, public.lgchl_standings_snapshots, public.lgchl_sync_runs to service_role;

-- Idempotent upsert used by the worker (service_role). Finals are never downgraded to scheduled.
create function private.lgchl_upsert_games(p_rows jsonb)
returns integer language sql security definer set search_path = '' as $$
  with src as (
    select * from jsonb_to_recordset(p_rows) as r(
      lg_game_id bigint, week integer, game_at timestamptz, away_lg_team_id integer, home_lg_team_id integer,
      away_score smallint, home_score smallint, status text, source_url text)
  ), up as (
    insert into public.lgchl_games as g (lg_game_id, week, game_at, away_lg_team_id, home_lg_team_id,
      away_score, home_score, status, source_url, fetched_at, updated_at)
    select lg_game_id, week, game_at, away_lg_team_id, home_lg_team_id, away_score, home_score,
      status, source_url, now(), now() from src
    on conflict (lg_game_id) do update set
      week = excluded.week,
      game_at = excluded.game_at,
      away_score = coalesce(excluded.away_score, g.away_score),
      home_score = coalesce(excluded.home_score, g.home_score),
      status = case when g.status = 'final' and excluded.status = 'scheduled' then g.status else excluded.status end,
      fetched_at = now(),
      updated_at = case when (g.away_score, g.home_score, g.status, g.game_at)
                         is distinct from (excluded.away_score, excluded.home_score, excluded.status, excluded.game_at)
                        then now() else g.updated_at end
    returning 1
  ) select count(*)::integer from up;
$$;
revoke all on function private.lgchl_upsert_games(jsonb) from public, anon, authenticated;
grant execute on function private.lgchl_upsert_games(jsonb) to service_role;

-- Scheduler (pg_cron -> Edge Function), same auth pattern as lg-stats-worker (x-sync-token from
-- lg_sync_settings). Game nights are Sun-Tue; LG slots are 7:00-10:30 PM ET (23:00-02:30 UTC+).
-- select cron.schedule('lgchl-league-delta', '*/10 23,0-4 * * 0,1,2,3', $$select public.lgchl_kick_sync('delta')$$);
-- select cron.schedule('lgchl-league-full',  '15 */6 * * *',              $$select public.lgchl_kick_sync('full')$$);
-- (public.lgchl_kick_sync would mirror public.lg_kick_worker(): net.http_post to the function.)
