-- Box scores captured through the authenticated LG browser bridge, automatic Hitmen
-- schedule finals, and an idempotent publish path for automatic game recaps.

-- 2. Box scores (one per official LG game) and per-player lines.
create table if not exists public.lg_game_box_scores (
  lg_game_id bigint primary key,
  league text not null default 'LGCHL',
  season integer not null,
  home_lg_team_id integer,
  away_lg_team_id integer,
  home_team_name text,
  away_team_name text,
  home_score integer not null,
  away_score integer not null,
  team_stats jsonb not null default '[]'::jsonb,   -- raw "Team Stats" lines, in page order
  period_stats jsonb not null default '[]'::jsonb, -- raw "Period Stats" lines, in page order
  saved_at_text text,
  source_snapshot_id uuid references public.lg_auth_snapshots(id) on delete set null,
  captured_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.lg_game_player_lines (
  lg_game_id bigint not null references public.lg_game_box_scores(lg_game_id) on delete cascade,
  gamertag text not null,
  lg_user_id bigint,
  team_name text,
  side text check (side in ('home','away')),
  position text,
  goals integer, assists integer, points integer, plus_minus integer,
  shots integer, hits integer, pim integer,
  takeaways integer, giveaways integer, interceptions integer, blocked_shots integer,
  faceoff_wins integer, faceoff_losses integer,
  pass_attempts integer, pass_completions integer,
  ppg integer, shg integer, gwg integer,
  saves integer, shots_against integer, goals_against integer,
  raw jsonb not null default '{}'::jsonb,
  primary key (lg_game_id, gamertag)
);
create index if not exists lg_game_player_lines_team_idx on public.lg_game_player_lines (team_name, lg_game_id);
create index if not exists lg_game_box_scores_snapshot_idx on public.lg_game_box_scores (source_snapshot_id);

alter table public.lg_game_box_scores enable row level security;
alter table public.lg_game_player_lines enable row level security;
revoke all on table public.lg_game_box_scores, public.lg_game_player_lines from anon, authenticated;
grant select on table public.lg_game_box_scores, public.lg_game_player_lines to authenticated;

create policy "Calgary management reads LG box scores" on public.lg_game_box_scores
  for select to authenticated
  using (private.vvhl_can_manage_team((select auth.uid()), 'b0bcbdda-da9d-419d-8f61-b34937966d49'::uuid));
create policy "Calgary management reads LG player lines" on public.lg_game_player_lines
  for select to authenticated
  using (private.vvhl_can_manage_team((select auth.uid()), 'b0bcbdda-da9d-419d-8f61-b34937966d49'::uuid));

-- 3. Apply a parsed Public Log. Called only by the lg-auth-ingest Edge Function (service role).
--    The parsed goal totals must match the official LGCHL final score, or nothing is written.
create or replace function public.lg_apply_box_score(
  p_snapshot_id uuid,
  p_lg_game_id bigint,
  p_scores integer[],
  p_players jsonb,
  p_team_stats jsonb,
  p_period_stats jsonb,
  p_saved_at text,
  p_captured_at timestamptz
) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  g public.lgchl_games;
  v_home text; v_away text;
  v_first_is_home boolean;
  p jsonb; v_team text; v_side text; v_uid bigint; v_pos text;
  v_lines integer := 0; v_unassigned integer := 0;
  v_home_goals integer := 0; v_away_goals integer := 0;
  n text;
begin
  select * into g from public.lgchl_games where lg_game_id = p_lg_game_id;
  if not found then raise exception 'LG game % is not in the official LGCHL game index yet', p_lg_game_id; end if;
  if g.status <> 'final' then raise exception 'LG game % is not final in the official index', p_lg_game_id; end if;
  if coalesce(array_length(p_scores,1),0) < 2 then raise exception 'Box score is missing team goal totals'; end if;

  -- LG lists the two team totals in page order; match them to the official home/away score.
  if p_scores[1] = g.away_score and p_scores[2] = g.home_score then v_first_is_home := false;
  elsif p_scores[1] = g.home_score and p_scores[2] = g.away_score then v_first_is_home := true;
  else raise exception 'Box score totals %-% do not match the official final %-% for game %',
    p_scores[1], p_scores[2], g.away_score, g.home_score, p_lg_game_id;
  end if;

  select name into v_home from public.lgchl_teams where lg_team_id = g.home_lg_team_id and season = g.season;
  select name into v_away from public.lgchl_teams where lg_team_id = g.away_lg_team_id and season = g.season;

  insert into public.lg_game_box_scores as b (
    lg_game_id, league, season, home_lg_team_id, away_lg_team_id, home_team_name, away_team_name,
    home_score, away_score, team_stats, period_stats, saved_at_text, source_snapshot_id, captured_at, updated_at
  ) values (
    g.lg_game_id, 'LGCHL', g.season, g.home_lg_team_id, g.away_lg_team_id, v_home, v_away,
    g.home_score, g.away_score, coalesce(p_team_stats,'[]'::jsonb), coalesce(p_period_stats,'[]'::jsonb),
    p_saved_at, p_snapshot_id, p_captured_at, now()
  ) on conflict (lg_game_id) do update set
    team_stats = excluded.team_stats, period_stats = excluded.period_stats, saved_at_text = excluded.saved_at_text,
    source_snapshot_id = excluded.source_snapshot_id, captured_at = excluded.captured_at, updated_at = now();

  for p in select * from jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) loop
    n := trim(p->>'gamertag');
    if coalesce(n,'') = '' then continue; end if;
    -- Team comes from the current LG roster (stable LG user id when known). Never guessed.
    select r.team_name, r.lg_user_id, r.position into v_team, v_uid, v_pos
      from public.lg_roster_players r
     where r.league = 'LGCHL' and r.season = g.season and lower(r.gamertag) = lower(n)
       and r.team_name in (v_home, v_away)
     order by r.active desc, r.source_updated_at desc nulls last
     limit 1;
    v_side := case when v_team = v_home then 'home' when v_team = v_away then 'away' else null end;
    if v_side is null then v_unassigned := v_unassigned + 1; v_team := null; v_uid := null; v_pos := null; end if;

    insert into public.lg_game_player_lines (
      lg_game_id, gamertag, lg_user_id, team_name, side, position,
      goals, assists, points, plus_minus, shots, hits, pim, takeaways, giveaways, interceptions, blocked_shots,
      faceoff_wins, faceoff_losses, pass_attempts, pass_completions, ppg, shg, gwg,
      saves, shots_against, goals_against, raw
    ) values (
      g.lg_game_id, n, v_uid, v_team, v_side, v_pos,
      nullif(p->>'goals','')::int, nullif(p->>'assists','')::int, nullif(p->>'points','')::int, nullif(p->>'plus_minus','')::int,
      nullif(p->>'shots','')::int, nullif(p->>'hits','')::int, nullif(p->>'pim','')::int,
      nullif(p->>'takeaways','')::int, nullif(p->>'giveaways','')::int, nullif(p->>'interceptions','')::int, nullif(p->>'blocked_shots','')::int,
      nullif(p->>'faceoff_wins','')::int, nullif(p->>'faceoff_losses','')::int,
      nullif(p->>'pass_attempts','')::int, nullif(p->>'pass_completions','')::int,
      nullif(p->>'ppg','')::int, nullif(p->>'shg','')::int, nullif(p->>'gwg','')::int,
      nullif(p->>'saves','')::int, nullif(p->>'shots_against','')::int, nullif(p->>'goals_against','')::int,
      coalesce(p->'raw','{}'::jsonb)
    ) on conflict (lg_game_id, gamertag) do update set
      lg_user_id = excluded.lg_user_id, team_name = excluded.team_name, side = excluded.side, position = excluded.position,
      goals = excluded.goals, assists = excluded.assists, points = excluded.points, plus_minus = excluded.plus_minus,
      shots = excluded.shots, hits = excluded.hits, pim = excluded.pim, takeaways = excluded.takeaways,
      giveaways = excluded.giveaways, interceptions = excluded.interceptions, blocked_shots = excluded.blocked_shots,
      faceoff_wins = excluded.faceoff_wins, faceoff_losses = excluded.faceoff_losses,
      pass_attempts = excluded.pass_attempts, pass_completions = excluded.pass_completions,
      ppg = excluded.ppg, shg = excluded.shg, gwg = excluded.gwg, saves = excluded.saves,
      shots_against = excluded.shots_against, goals_against = excluded.goals_against, raw = excluded.raw;
    v_lines := v_lines + 1;
    if v_side = 'home' then v_home_goals := v_home_goals + coalesce(nullif(p->>'goals','')::int,0);
    elsif v_side = 'away' then v_away_goals := v_away_goals + coalesce(nullif(p->>'goals','')::int,0); end if;
  end loop;

  return jsonb_build_object(
    'lg_game_id', g.lg_game_id, 'home', v_home, 'away', v_away,
    'final', g.away_score || '-' || g.home_score, 'player_lines', v_lines, 'unassigned_players', v_unassigned,
    'goals_reconcile', (v_home_goals = g.home_score and v_away_goals = g.away_score)
  );
end $$;
revoke all on function public.lg_apply_box_score(uuid,bigint,integer[],jsonb,jsonb,jsonb,text,timestamptz) from public, anon, authenticated;
grant execute on function public.lg_apply_box_score(uuid,bigint,integer[],jsonb,jsonb,jsonb,text,timestamptz) to service_role;

-- 4. Calgary finals from the last two weeks that still need a box score or a recap.
--    The bridge page asks the signed-in LG tab to fetch exactly these Public Logs.
create or replace function public.lg_auth_pending_box_scores(p_days integer default 14)
returns table (lg_game_id bigint, game_at timestamptz, opponent text, has_box_score boolean, has_recap boolean)
language plpgsql security definer set search_path to '' stable as $$
begin
  if not private.vvhl_can_manage_team(auth.uid(), 'b0bcbdda-da9d-419d-8f61-b34937966d49'::uuid) then
    raise exception 'Calgary management access required';
  end if;
  return query
  select g.lg_game_id, g.game_at,
         case when th.name = 'Calgary Hitmen' then ta.name else th.name end,
         exists (select 1 from public.lg_game_box_scores b where b.lg_game_id = g.lg_game_id),
         exists (select 1 from public.media_posts m where m.post_type = 'recap' and m.source_metrics->>'lg_game_id' = g.lg_game_id::text)
    from public.lgchl_games g
    join public.lgchl_teams th on th.lg_team_id = g.home_lg_team_id and th.season = g.season
    join public.lgchl_teams ta on ta.lg_team_id = g.away_lg_team_id and ta.season = g.season
   where g.season = 55 and g.status = 'final'
     and g.game_at > now() - make_interval(days => greatest(1, least(coalesce(p_days,14), 60)))
     and 'Calgary Hitmen' in (th.name, ta.name)
   order by g.game_at;
end $$;
revoke all on function public.lg_auth_pending_box_scores(integer) from public, anon;
grant execute on function public.lg_auth_pending_box_scores(integer) to authenticated;

-- 5. Publish an automatic recap once per LG game (Calgary management only).
create or replace function public.hitmen_publish_auto_recap(p_lg_game_id bigint, p_title text, p_body text, p_metrics jsonb)
returns uuid
language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  if not private.vvhl_can_manage_team(auth.uid(), 'b0bcbdda-da9d-419d-8f61-b34937966d49'::uuid) then
    raise exception 'Calgary management access required';
  end if;
  if coalesce(trim(p_title),'') = '' or length(coalesce(p_body,'')) < 200 then raise exception 'Recap is empty'; end if;
  if not exists (select 1 from public.lg_game_box_scores where lg_game_id = p_lg_game_id) then
    raise exception 'No verified box score for game %', p_lg_game_id;
  end if;
  select id into v_id from public.media_posts
   where post_type = 'recap' and source_metrics->>'lg_game_id' = p_lg_game_id::text limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.media_posts (season, post_type, title, body, source_metrics, is_auto_draft, published, published_at)
  values ('S55', 'recap', left(trim(p_title), 160), p_body,
          coalesce(p_metrics,'{}'::jsonb) || jsonb_build_object('lg_game_id', p_lg_game_id, 'team', 'Calgary Hitmen', 'auto', true),
          true, true, now())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.hitmen_publish_auto_recap(bigint,text,text,jsonb) from public, anon;
grant execute on function public.hitmen_publish_auto_recap(bigint,text,text,jsonb) to authenticated;

-- 6. When an official LGCHL Calgary game goes final, copy the score onto the Hitmen schedule.
create or replace function private.hitmen_apply_lgchl_final()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_away text; v_home text; v_calgary_home boolean; v_opp text;
begin
  if new.status <> 'final' or new.home_score is null or new.away_score is null then return new; end if;
  select name into v_away from public.lgchl_teams where lg_team_id = new.away_lg_team_id and season = new.season;
  select name into v_home from public.lgchl_teams where lg_team_id = new.home_lg_team_id and season = new.season;
  if v_home = 'Calgary Hitmen' then v_calgary_home := true; v_opp := v_away;
  elsif v_away = 'Calgary Hitmen' then v_calgary_home := false; v_opp := v_home;
  else return new; end if;
  update public.hitmen_schedule_games s set
    status = 'final',
    calgary_score = case when v_calgary_home then new.home_score else new.away_score end,
    opponent_score = case when v_calgary_home then new.away_score else new.home_score end,
    source_url = coalesce(s.source_url, new.source_url),
    source_label = coalesce(s.source_label, 'LGCHL official game index'),
    updated_at = now()
  where s.team_id = 'b0bcbdda-da9d-419d-8f61-b34937966d49'
    and s.season = new.season
    and s.opponent_name = v_opp
    and abs(extract(epoch from (s.scheduled_at - new.game_at))) <= 1800
    and (s.status <> 'final' or s.calgary_score is null);
  return new;
end $$;
create or replace trigger hitmen_apply_lgchl_final
  after insert or update of status, home_score, away_score on public.lgchl_games
  for each row execute function private.hitmen_apply_lgchl_final();

-- 7. Recap de-duplication (applied separately as recap_dedupe_by_opponent_and_date).
--    Week 1 recaps predate lg_game_id in source_metrics, so also match on opponent + Eastern game date + final.
create or replace function private.hitmen_recap_exists(p_lg_game_id bigint)
returns boolean language sql security definer set search_path to '' stable as $$
  select exists (
    select 1
      from public.media_posts m, public.lgchl_games g
      join public.lgchl_teams th on th.lg_team_id = g.home_lg_team_id and th.season = g.season
      join public.lgchl_teams ta on ta.lg_team_id = g.away_lg_team_id and ta.season = g.season
     where g.lg_game_id = p_lg_game_id and m.post_type = 'recap'
       and (m.source_metrics->>'lg_game_id' = p_lg_game_id::text
            or (m.source_metrics->>'opponent' = case when th.name = 'Calgary Hitmen' then ta.name else th.name end
                and m.source_metrics->>'game_date' = to_char(g.game_at at time zone 'America/Toronto', 'YYYY-MM-DD')
                and coalesce(m.source_metrics->>'final','') in ('',
                     (case when th.name = 'Calgary Hitmen' then g.home_score else g.away_score end) || '-' ||
                     (case when th.name = 'Calgary Hitmen' then g.away_score else g.home_score end))))
  );
$$;
revoke all on function private.hitmen_recap_exists(bigint) from public, anon, authenticated;
-- lg_auth_pending_box_scores.has_recap and hitmen_publish_auto_recap now call private.hitmen_recap_exists();
-- the publish function also takes a per-game advisory lock and raises instead of posting a second recap.
