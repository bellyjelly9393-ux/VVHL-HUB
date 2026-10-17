-- LGCHL Season 55 player stat history (public season totals only).
-- Every time the existing LG player-stats sync writes a changed LGCHL S55 regular-season row into
-- lg_player_season_stats, one copy of the totals is kept here. Players of the Week and Trending Now
-- are the difference between copies. Nothing here reads private, Hitmen or scouting data, and the
-- trigger can never block the sync: any error inside it is swallowed.

create table if not exists public.lgchl_player_stat_history (
  id bigint generated always as identity primary key,
  season integer not null,
  player_kind text not null check (player_kind in ('skater','goalie')),
  gamertag text not null,
  lg_user_id bigint,
  lg_team_id integer,
  position text,
  gp integer not null default 0,
  goals integer not null default 0,
  assists integer not null default 0,
  points integer not null default 0,
  plus_minus integer not null default 0,
  shots integer not null default 0,
  hits integer not null default 0,
  takeaways integer not null default 0,
  blocked_shots integer not null default 0,
  goalie_saves integer,
  goalie_shots_against integer,
  goalie_goals_against integer,
  taken_at timestamptz not null default now()
);
create index if not exists lgchl_psh_player_time on public.lgchl_player_stat_history (season, player_kind, gamertag, taken_at desc);
create index if not exists lgchl_psh_time on public.lgchl_player_stat_history (taken_at);

alter table public.lgchl_player_stat_history enable row level security;
revoke all on public.lgchl_player_stat_history from public, anon, authenticated;
grant select on public.lgchl_player_stat_history to anon, authenticated;
drop policy if exists lgchl_psh_public_read on public.lgchl_player_stat_history;
create policy lgchl_psh_public_read on public.lgchl_player_stat_history for select to anon, authenticated using (season = 55);

create or replace function public.lgchl_capture_player_stat_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int := 0;
begin
  if new.league_code is distinct from 'LGCHL' or new.season_type is distinct from 'regular' or new.season is distinct from 55 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.games_played is not distinct from old.games_played and new.stats is not distinct from old.stats
     and new.lg_team_id is not distinct from old.lg_team_id then
    return new;
  end if;
  n := coalesce(nullif(new.stats->>'gp','')::numeric, new.games_played, 0)::int;
  insert into public.lgchl_player_stat_history
    (season, player_kind, gamertag, lg_user_id, lg_team_id, position, gp, goals, assists, points, plus_minus, shots, hits,
     takeaways, blocked_shots, goalie_saves, goalie_shots_against, goalie_goals_against, taken_at)
  values
    (new.season, new.player_kind, new.gamertag, new.lg_user_id, new.lg_team_id, new.position,
     coalesce(new.games_played, n),
     coalesce(nullif(new.stats->>'goals','')::numeric,0)::int,
     coalesce(nullif(new.stats->>'assists','')::numeric,0)::int,
     coalesce(nullif(new.stats->>'points','')::numeric,0)::int,
     coalesce(nullif(new.stats->>'plusminus','')::numeric,0)::int,
     coalesce(nullif(new.stats->>'shots','')::numeric,0)::int,
     coalesce(nullif(new.stats->>'hits','')::numeric,0)::int,
     coalesce(nullif(new.stats->>'takeaway','')::numeric,0)::int,
     coalesce(nullif(new.stats->>'bs','')::numeric,0)::int,
     case when new.player_kind = 'goalie' then coalesce(nullif(new.stats->>'sog','')::numeric,0)::int - coalesce(nullif(new.stats->>'ga','')::numeric,0)::int end,
     case when new.player_kind = 'goalie' then coalesce(nullif(new.stats->>'sog','')::numeric,0)::int end,
     case when new.player_kind = 'goalie' then coalesce(nullif(new.stats->>'ga','')::numeric,0)::int end,
     now());
  return new;
exception when others then
  return new; -- never interfere with the stats sync
end;
$$;
revoke all on function public.lgchl_capture_player_stat_history() from public, anon, authenticated;

drop trigger if exists lgchl_capture_player_stat_history on public.lg_player_season_stats;
create trigger lgchl_capture_player_stat_history
  after insert or update on public.lg_player_season_stats
  for each row execute function public.lgchl_capture_player_stat_history();

-- Baseline: today's totals, so the first game night after this lands already has something to compare with.
insert into public.lgchl_player_stat_history
  (season, player_kind, gamertag, lg_user_id, lg_team_id, position, gp, goals, assists, points, plus_minus, shots, hits,
   takeaways, blocked_shots, goalie_saves, goalie_shots_against, goalie_goals_against, taken_at)
select p.season, p.player_kind, p.gamertag, p.lg_user_id, p.lg_team_id, p.position, coalesce(p.games_played,0),
  coalesce(nullif(p.stats->>'goals','')::numeric,0)::int, coalesce(nullif(p.stats->>'assists','')::numeric,0)::int,
  coalesce(nullif(p.stats->>'points','')::numeric,0)::int, coalesce(nullif(p.stats->>'plusminus','')::numeric,0)::int,
  coalesce(nullif(p.stats->>'shots','')::numeric,0)::int, coalesce(nullif(p.stats->>'hits','')::numeric,0)::int,
  coalesce(nullif(p.stats->>'takeaway','')::numeric,0)::int, coalesce(nullif(p.stats->>'bs','')::numeric,0)::int,
  case when p.player_kind='goalie' then coalesce(nullif(p.stats->>'sog','')::numeric,0)::int - coalesce(nullif(p.stats->>'ga','')::numeric,0)::int end,
  case when p.player_kind='goalie' then coalesce(nullif(p.stats->>'sog','')::numeric,0)::int end,
  case when p.player_kind='goalie' then coalesce(nullif(p.stats->>'ga','')::numeric,0)::int end,
  now()
from public.lg_player_season_stats p
where p.league_code = 'LGCHL' and p.season = 55 and p.season_type = 'regular'
  and not exists (select 1 from public.lgchl_player_stat_history h where h.season = 55);

-- Game weeks and nights from the public schedule.
-- Players of the Week: the latest completed week (every game final). Totals just before the week
-- started vs. the latest totals taken before the next week started.
create or replace view public.lgchl_public_week_players
with (security_invoker = true) as
with weeks as (
  select week, min(game_at) as starts_at, bool_and(status = 'final') as done
  from public.lgchl_games where season = 55 and week is not null group by week
), wk as (
  select w.week, w.starts_at,
         (select min(n.starts_at) from weeks n where n.week > w.week) as next_at
  from weeks w where w.done order by w.week desc limit 1
), base as (
  select distinct on (h.player_kind, h.gamertag) h.*
  from public.lgchl_player_stat_history h, wk
  where h.season = 55 and h.taken_at < wk.starts_at
  order by h.player_kind, h.gamertag, h.taken_at desc
), cur as (
  select distinct on (h.player_kind, h.gamertag) h.*
  from public.lgchl_player_stat_history h, wk
  where h.season = 55 and h.taken_at >= wk.starts_at and (wk.next_at is null or h.taken_at < wk.next_at)
  order by h.player_kind, h.gamertag, h.taken_at desc
)
select wk.week, c.player_kind, c.gamertag, c.position, c.lg_team_id,
  c.gp - b.gp as gp, c.goals - b.goals as goals, c.assists - b.assists as assists, c.points - b.points as points,
  c.plus_minus - b.plus_minus as plus_minus, c.shots - b.shots as shots, c.hits - b.hits as hits,
  c.goalie_saves - b.goalie_saves as saves, c.goalie_shots_against - b.goalie_shots_against as shots_against,
  c.goalie_goals_against - b.goalie_goals_against as goals_against, c.taken_at as through_at
from cur c join base b using (player_kind, gamertag) cross join wk
where c.gp > b.gp;

-- Trending now: the last two game nights with results. Each player's totals before that window
-- (or their earliest saved totals before the latest night) vs. their latest totals.
create or replace view public.lgchl_public_trending_players
with (security_invoker = true) as
with nights as (
  select (game_at at time zone 'America/Toronto')::date as night, min(game_at) as starts_at
  from public.lgchl_games where season = 55 and status = 'final' group by 1
), win as (
  select min(starts_at) as from_at, max(starts_at) as last_at
  from (select starts_at from nights order by night desc limit 2) x
), cur as (
  select distinct on (h.player_kind, h.gamertag) h.*
  from public.lgchl_player_stat_history h where h.season = 55
  order by h.player_kind, h.gamertag, h.taken_at desc
), base as (
  select distinct on (h.player_kind, h.gamertag) h.*
  from public.lgchl_player_stat_history h, win
  where h.season = 55 and h.taken_at < win.last_at
  order by h.player_kind, h.gamertag,
           (h.taken_at < win.from_at) desc,                         -- prefer totals from before the window
           case when h.taken_at < win.from_at then h.taken_at end desc nulls last,
           h.taken_at asc                                           -- otherwise the earliest saved
)
select c.player_kind, c.gamertag, c.position, c.lg_team_id,
  c.gp - b.gp as gp, c.goals - b.goals as goals, c.assists - b.assists as assists, c.points - b.points as points,
  c.plus_minus - b.plus_minus as plus_minus, c.shots - b.shots as shots, c.hits - b.hits as hits,
  c.goalie_saves - b.goalie_saves as saves, c.goalie_shots_against - b.goalie_shots_against as shots_against,
  c.goalie_goals_against - b.goalie_goals_against as goals_against,
  b.taken_at as since_at, c.taken_at as through_at
from cur c join base b using (player_kind, gamertag)
where c.gp > b.gp;

revoke all on public.lgchl_public_week_players, public.lgchl_public_trending_players from public, anon, authenticated;
grant select on public.lgchl_public_week_players, public.lgchl_public_trending_players to anon, authenticated;
