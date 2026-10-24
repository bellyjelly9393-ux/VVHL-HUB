-- Lock the four lgchl_hitmen_* views to the War Room.
--
-- These views read through private.cb_* SECURITY DEFINER functions, which skip row-level
-- security. Signed-out visitors (anon key) could read tonight's confirmed lineup, the
-- Calgary roster snapshot, LG box scores and player lines — data the War Room tables
-- themselves only show to Calgary management and active-roster players.
--
-- After this migration the functions return rows only for:
--   * War Room readers: private.vvhl_can_read_war_room (admin, Calgary owner/GM/AGM,
--     active-roster players in team_player_lockers) — the same rule as lineups and
--     hitmen_battle_plans;
--   * service-role requests (server code / bots using the service key);
--   * direct database connections (not through the public API).
-- Everyone else gets zero rows. Signed-out visitors lose access to the views entirely.

create or replace function private.cb_viewer_can_read()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select session_user is distinct from 'authenticator'
      or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      or coalesce(private.vvhl_can_read_war_room(auth.uid(), private.cb_hitmen_team_id()), false)
$$;

create or replace function private.cb_box_scores()
returns table(lg_game_id bigint, season integer, home_team_name text, away_team_name text,
              home_score integer, away_score integer, team_stats jsonb, period_stats jsonb,
              captured_at timestamp with time zone)
language sql
stable
security definer
set search_path to ''
as $$
  select b.lg_game_id, b.season, b.home_team_name, b.away_team_name, b.home_score, b.away_score,
         b.team_stats, b.period_stats, b.captured_at
  from public.lg_game_box_scores b
  where 412 in (b.home_lg_team_id, b.away_lg_team_id)
    and private.cb_viewer_can_read()
  order by b.lg_game_id desc
$$;

create or replace function private.cb_player_lines()
returns table(lg_game_id bigint, gamertag text, team_name text, side text, "position" text,
              goals integer, assists integer, points integer, plus_minus integer, shots integer,
              hits integer, pim integer, takeaways integer, giveaways integer, blocked_shots integer,
              ppg integer, shg integer, gwg integer, saves integer, shots_against integer,
              goals_against integer)
language sql
stable
security definer
set search_path to ''
as $$
  select pl.lg_game_id, pl.gamertag, pl.team_name, pl.side, pl.position, pl.goals, pl.assists,
         pl.points, pl.plus_minus, pl.shots, pl.hits, pl.pim, pl.takeaways, pl.giveaways,
         pl.blocked_shots, pl.ppg, pl.shg, pl.gwg, pl.saves, pl.shots_against, pl.goals_against
  from public.lg_game_player_lines pl
  join public.lg_game_box_scores b
    on b.lg_game_id = pl.lg_game_id and 412 in (b.home_lg_team_id, b.away_lg_team_id)
  where private.cb_viewer_can_read()
$$;

create or replace function private.cb_hitmen_roster()
returns table(gamertag text, "position" text, jersey_number integer, roster_class text, season integer)
language sql
stable
security definer
set search_path to ''
as $$
  select r.gamertag, r.position,
         (select ls.jersey_number::int from public.lineup_slots ls
           where ls.player_id = r.player_id and ls.jersey_number is not null limit 1),
         r.roster_class, r.season
  from public.hitmen_roster_snapshot r
  where r.active
    and r.team_id = private.cb_hitmen_team_id()
    and r.season = (select max(season) from public.hitmen_roster_snapshot)
    and private.cb_viewer_can_read()
  order by r.roster_class, r.lg_slot nulls last, r.gamertag
$$;

create or replace function private.cb_tonight_six()
returns table(lg_game_id bigint, game_at timestamp with time zone, opponent_name text,
              game_label text, slot text, line text, role text, gamertag text,
              jersey_number integer, sort_order integer)
language sql
stable
security definer
set search_path to ''
as $$
  with l as (
    select lu.id, lu.game_label, lu.opponent_name, sg.scheduled_at, sg.source_url
    from public.lineups lu
    left join public.hitmen_schedule_games sg on sg.id = lu.schedule_game_id
    where lu.team_id = private.cb_hitmen_team_id() and lu.lineup_type = 'game' and lu.status = 'confirmed'
      and private.cb_viewer_can_read()
    order by (sg.scheduled_at >= now() - interval '3 hours') desc nulls last,
             case when sg.scheduled_at >= now() - interval '3 hours' then sg.scheduled_at end asc nulls last,
             sg.scheduled_at desc nulls last, lu.is_active desc
    limit 1)
  select substring(l.source_url from 'gameid=([0-9]+)')::bigint, l.scheduled_at, l.opponent_name, l.game_label,
         ls.slot, split_part(ls.slot, '_', 1), split_part(ls.slot, '_', 2), p.gamertag,
         ls.jersey_number::int, ls.sort_order::int
  from l join public.lineup_slots ls on ls.lineup_id = l.id
  left join public.players p on p.id = ls.player_id
  order by ls.sort_order
$$;

-- Signed-out visitors: no access at all.
revoke all on public.lgchl_hitmen_box_scores, public.lgchl_hitmen_player_lines,
              public.lgchl_hitmen_roster, public.lgchl_hitmen_tonight_six from anon;
revoke execute on function private.cb_box_scores(), private.cb_player_lines(),
                           private.cb_hitmen_roster(), private.cb_tonight_six(),
                           private.cb_hitmen_team_id(), private.cb_viewer_can_read()
  from public, anon;

-- Signed-in users keep SELECT on the views; the functions above decide who gets rows.
grant select on public.lgchl_hitmen_box_scores, public.lgchl_hitmen_player_lines,
                public.lgchl_hitmen_roster, public.lgchl_hitmen_tonight_six to authenticated, service_role;
grant execute on function private.cb_box_scores(), private.cb_player_lines(),
                          private.cb_hitmen_roster(), private.cb_tonight_six(),
                          private.cb_hitmen_team_id(), private.cb_viewer_can_read()
  to authenticated, service_role;
