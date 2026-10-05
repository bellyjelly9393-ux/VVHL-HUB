-- LGCHL (LeagueGaming CHL, league 39) league-wide feed shared by the site live ticker
-- (api/lgchl-scores.js) and the War Room landing league crawl.
-- Writer: Edge Function lgchl-league-sync (service_role) on pg_cron. Readers: anyone (public league data).
-- Adds new objects only; no existing table is altered.

create table public.lgchl_teams (
  lg_team_id    integer primary key,
  season        integer not null default 55,
  name          text not null,
  abbr          text not null,
  nickname      text not null,
  league        text not null check (league in ('WHL','OHL','QMJHL')),
  conference    text not null check (conference in ('Eastern','Western')),
  division      text not null,                       -- LG standings table, e.g. 'WHL Eastern 2'
  logo_path     text,
  updated_at    timestamptz not null default now()
);

create table public.lgchl_games (
  lg_game_id       bigint primary key,
  lg_league_id     integer not null default 39,
  season           integer not null default 55,
  week             integer,
  game_at          timestamptz,
  game_at_label_et text,                              -- raw LG label, e.g. 'Sun Oct 04 09:00pm' (US Eastern)
  away_lg_team_id  integer not null references public.lgchl_teams(lg_team_id),
  home_lg_team_id  integer not null references public.lgchl_teams(lg_team_id),
  away_score       smallint,
  home_score       smallint,
  status           text not null default 'scheduled' check (status in ('scheduled','final','postponed','cancelled')),
  decided_in       text check (decided_in in ('REG','OT','SO')),
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

create table public.lgchl_standings_snapshots (
  id          bigint generated always as identity primary key,
  season      integer not null default 55,
  lg_team_id  integer not null references public.lgchl_teams(lg_team_id),
  taken_at    timestamptz not null default now(),
  division_rank smallint,
  gp smallint, w smallint, l smallint, otw smallint, otl smallint, pts smallint,
  gf smallint, ga smallint, gd smallint, streak text, last10 text, home text, away text
);
create index lgchl_standings_latest on public.lgchl_standings_snapshots (lg_team_id, taken_at desc);

create table public.lgchl_sync_runs (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('full','delta')),
  status          text not null default 'running' check (status in ('running','done','failed')),
  team_ids        integer[] not null default '{}',
  next_index      integer not null default 0,
  requests        integer not null default 0,
  pages_failed    integer not null default 0,
  games_upserted  integer not null default 0,
  finals_before   integer,
  finals_after    integer,
  error           text,
  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index lgchl_sync_runs_recent on public.lgchl_sync_runs (started_at desc);

-- Never let a schedule page without a score downgrade a known final.
create function private.lgchl_keep_finals() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'final' and new.status <> 'final' then
    new.status := old.status; new.away_score := old.away_score; new.home_score := old.home_score;
  end if;
  if (new.status, new.away_score, new.home_score, new.game_at, new.week)
     is not distinct from (old.status, old.away_score, old.home_score, old.game_at, old.week) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  new.first_seen_at := old.first_seen_at;
  return new;
end $$;
create trigger lgchl_games_keep_finals before update on public.lgchl_games
  for each row execute function private.lgchl_keep_finals();

-- Latest standings per team with conference rank (PTS, then GD, then GF).
create view public.lgchl_standings_current with (security_invoker = true) as
with latest as (
  select distinct on (s.lg_team_id) s.*
  from public.lgchl_standings_snapshots s
  order by s.lg_team_id, s.taken_at desc
)
select t.lg_team_id, t.name, t.abbr, t.nickname, t.league, t.conference, t.division, t.logo_path,
       l.gp, l.w, l.l, l.otw, l.otl, l.pts, l.gf, l.ga, l.gd, l.streak, l.last10, l.home, l.away,
       l.division_rank,
       rank() over (partition by t.league, t.conference order by l.pts desc, l.gd desc, l.gf desc)::smallint as conference_rank,
       count(*) over (partition by t.league, t.conference)::smallint as conference_size,
       max(l.pts) over (partition by t.league, t.conference) as conference_leader_pts,
       l.taken_at as standings_at
from public.lgchl_teams t
join latest l on l.lg_team_id = t.lg_team_id;

-- Board: every game with team display data and the "big game" flag.
-- BIG GAME RULE (computed live from current standings; WHL games are always shown by the ticker,
-- the flag matters for OHL/QMJHL). A game is big when ANY of:
--   top4_clash    both teams rank top 4 in their conference (by PTS, GD, GF)
--   leader_chase  one team leads its conference and the other is within 2 PTS of it
--   division_race same division, both in the top half of the conference, within 1 PT of each other
create view public.lgchl_games_board with (security_invoker = true) as
select g.lg_game_id, g.season, g.week, g.game_at, g.status, g.decided_in,
       g.away_lg_team_id, a.abbr as away_abbr, a.nickname as away_nick, a.logo_path as away_logo, g.away_score,
       a.conference_rank as away_conf_rank, a.pts as away_pts,
       g.home_lg_team_id, h.abbr as home_abbr, h.nickname as home_nick, h.logo_path as home_logo, g.home_score,
       h.conference_rank as home_conf_rank, h.pts as home_pts,
       h.league, (a.league <> h.league) as interleague,
       r.reasons as big_reasons, coalesce(cardinality(r.reasons) > 0, false) as big_game,
       g.source_url, g.fetched_at, g.updated_at
from public.lgchl_games g
join public.lgchl_standings_current a on a.lg_team_id = g.away_lg_team_id
join public.lgchl_standings_current h on h.lg_team_id = g.home_lg_team_id
cross join lateral (
  select array_remove(array[
    case when a.conference_rank <= 4 and h.conference_rank <= 4 then 'top4_clash' end,
    case when a.league = h.league and a.conference = h.conference
          and ((a.conference_rank = 1 and a.pts - h.pts <= 2) or (h.conference_rank = 1 and h.pts - a.pts <= 2))
         then 'leader_chase' end,
    case when a.division = h.division and abs(a.pts - h.pts) <= 1
          and a.conference_rank <= ceil(a.conference_size / 2.0) and h.conference_rank <= ceil(h.conference_size / 2.0)
         then 'division_race' end
  ], null) as reasons
) r;

alter table public.lgchl_teams enable row level security;
alter table public.lgchl_games enable row level security;
alter table public.lgchl_standings_snapshots enable row level security;
alter table public.lgchl_sync_runs enable row level security;

create policy lgchl_teams_public_read on public.lgchl_teams for select to anon, authenticated using (true);
create policy lgchl_games_public_read on public.lgchl_games for select to anon, authenticated using (true);
create policy lgchl_standings_public_read on public.lgchl_standings_snapshots for select to anon, authenticated using (true);
-- lgchl_sync_runs: no policies -> service_role only.

revoke all on public.lgchl_teams, public.lgchl_games, public.lgchl_standings_snapshots, public.lgchl_sync_runs,
  public.lgchl_standings_current, public.lgchl_games_board from anon, authenticated;
grant select on public.lgchl_teams, public.lgchl_games, public.lgchl_standings_snapshots,
  public.lgchl_standings_current, public.lgchl_games_board to anon, authenticated;
grant all on public.lgchl_teams, public.lgchl_games, public.lgchl_standings_snapshots, public.lgchl_sync_runs to service_role;

-- Cron kick (same pattern as public.lg_kick_worker, but kept in the unexposed private schema: pg_net POST with the shared x-sync-token).
--   'full'     start a full refresh (standings + all 62 team schedules) unless one is running
--   'delta'    only if games should have finished (start + 35 min) in the last 8 h but have no score
--   'continue' resume a running multi-call refresh that has not been touched for 2.5 min
create function private.lgchl_kick_sync(p_mode text default 'continue')
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_req bigint; v_running public.lgchl_sync_runs;
begin
  if p_mode not in ('full','delta','continue') then raise exception 'bad mode %', p_mode; end if;
  select * into v_running from public.lgchl_sync_runs where status = 'running' order by id desc limit 1;
  if v_running.id is not null and v_running.updated_at < now() - interval '20 minutes' then
    update public.lgchl_sync_runs set status = 'failed', error = coalesce(error, 'stalled'), finished_at = now() where id = v_running.id;
    v_running := null;
  end if;
  if p_mode = 'continue' then
    if v_running.id is null or v_running.updated_at > now() - interval '150 seconds' then return null; end if;
  elsif v_running.id is not null then
    return null;                                   -- a run is in progress; the 'continue' job finishes it
  elsif p_mode = 'delta' and not exists (
    select 1 from public.lgchl_games
    where status = 'scheduled' and game_at < now() - interval '35 minutes' and game_at > now() - interval '8 hours') then
    return null;
  end if;
  select net.http_post(
    url := 'https://lrgllzvwgvqagcpiyvfd.supabase.co/functions/v1/lgchl-league-sync',
    body := jsonb_build_object('mode', p_mode, 'budgetMs', 100000),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-token', (select value from public.lg_sync_settings where key = 'sync_token')),
    timeout_milliseconds := 150000) into v_req;
  return v_req;
end $$;
revoke all on function private.lgchl_kick_sync(text) from public, anon, authenticated;
grant execute on function private.lgchl_kick_sync(text) to service_role;
