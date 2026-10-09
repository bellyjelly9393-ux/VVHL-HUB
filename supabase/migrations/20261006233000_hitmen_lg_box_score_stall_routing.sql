create unique index if not exists team_player_game_reports_official_game_locker
  on public.team_player_game_reports(schedule_game_id, locker_id)
  where ai_review_id is null and schedule_game_id is not null;

create or replace function private.hitmen_route_lg_player_line_to_stall()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team constant uuid := 'b0bcbdda-da9d-419d-8f61-b34937966d49'::uuid;
  v_game public.lgchl_games;
  v_box public.lg_game_box_scores;
  v_schedule public.hitmen_schedule_games;
  v_locker public.team_player_lockers;
  v_created_by uuid;
  v_opponent text;
  v_hit_score integer;
  v_opp_score integer;
  v_result text;
  v_stats jsonb;
begin
  if coalesce(new.team_name,'') <> 'Calgary Hitmen' then return new; end if;
  select * into v_game from public.lgchl_games where lg_game_id = new.lg_game_id;
  select * into v_box from public.lg_game_box_scores where lg_game_id = new.lg_game_id;
  if v_game.lg_game_id is null or v_box.lg_game_id is null then return new; end if;

  if v_game.home_lg_team_id = 412 then
    v_opponent := v_box.away_team_name; v_hit_score := v_box.home_score; v_opp_score := v_box.away_score;
  elsif v_game.away_lg_team_id = 412 then
    v_opponent := v_box.home_team_name; v_hit_score := v_box.away_score; v_opp_score := v_box.home_score;
  else return new; end if;

  select s.* into v_schedule from public.hitmen_schedule_games s
   where s.team_id=v_team and s.season=v_game.season and lower(s.opponent_name)=lower(v_opponent)
     and abs(extract(epoch from (s.scheduled_at-v_game.game_at)))<=1800
   order by abs(extract(epoch from (s.scheduled_at-v_game.game_at))) limit 1;
  if v_schedule.id is null then return new; end if;

  select l.* into v_locker from public.team_player_lockers l
   where l.team_id=v_team and l.season=v_game.season and l.roster_class<>'historical'
     and lower(btrim(l.gamertag))=lower(btrim(new.gamertag))
   order by l.updated_at desc nulls last limit 1;
  if v_locker.id is null then return new; end if;

  select v.created_by into v_created_by from public.vod_review_sessions v
   where v.schedule_game_id=v_schedule.id and v.created_by is not null
   order by v.created_at desc limit 1;
  if v_created_by is null then
    select m.user_id into v_created_by from public.team_memberships m
     where m.team_id=v_team and m.active is not false and lower(m.role) in ('owner','gm','agm')
     order by case lower(m.role) when 'owner' then 1 when 'gm' then 2 else 3 end limit 1;
  end if;
  if v_created_by is null then return new; end if;

  v_result := (case when v_hit_score>v_opp_score then 'W' when coalesce(v_schedule.overtime,false) then 'OTL' else 'L' end)
    || ' ' || v_hit_score::text || '-' || v_opp_score::text;

  v_stats := jsonb_strip_nulls(jsonb_build_object(
    'goals',new.goals,'assists',new.assists,'points',coalesce(new.points,coalesce(new.goals,0)+coalesce(new.assists,0)),
    'plus_minus',new.plus_minus,'shots',new.shots,'hits',new.hits,'pim',new.pim,
    'takeaways',new.takeaways,'giveaways',new.giveaways,'interceptions',new.interceptions,'blocked_shots',new.blocked_shots,
    'faceoff_wins',new.faceoff_wins,'faceoff_losses',new.faceoff_losses,
    'faceoff_pct',case when coalesce(new.faceoff_wins,0)+coalesce(new.faceoff_losses,0)>0
      then round((100.0*coalesce(new.faceoff_wins,0)/(coalesce(new.faceoff_wins,0)+coalesce(new.faceoff_losses,0)))::numeric,1) else null end,
    'pass_attempts',new.pass_attempts,'pass_completions',new.pass_completions,
    'passing_pct',case when coalesce(new.pass_attempts,0)>0
      then round((100.0*coalesce(new.pass_completions,0)/new.pass_attempts)::numeric,1) else null end,
    'ppg',new.ppg,'shg',new.shg,'gwg',new.gwg,
    'saves',new.saves,'shots_faced',new.shots_against,'goals_against',new.goals_against,
    'save_pct_derived',case when coalesce(new.shots_against,0)>0
      then round((100.0*coalesce(new.saves,0)/new.shots_against)::numeric,1) else null end
  ));

  insert into public.team_player_game_reports(
    team_id,season,locker_id,schedule_game_id,week,game_date,opponent_name,position_played,result,
    stats,evidence,visibility,created_by,updated_at
  ) values (
    v_team,v_game.season,v_locker.id,v_schedule.id,v_schedule.week,v_schedule.scheduled_at,v_opponent,
    coalesce(new.position,v_locker.position),v_result,v_stats,
    jsonb_build_object('source','LeagueGaming verified Public Log','lg_game_id',new.lg_game_id,
      'stat_status','verified','box_score_captured_at',v_box.captured_at,'vod_status','pending'),
    'player',v_created_by,now()
  )
  on conflict (schedule_game_id,locker_id)
    where ai_review_id is null and schedule_game_id is not null
  do update set
    position_played=excluded.position_played,result=excluded.result,stats=excluded.stats,
    evidence=coalesce(public.team_player_game_reports.evidence,'{}'::jsonb)||excluded.evidence,
    visibility='player',updated_at=now();

  return new;
end
$$;

drop trigger if exists hitmen_route_lg_player_line_to_stall on public.lg_game_player_lines;
create trigger hitmen_route_lg_player_line_to_stall
  after insert or update on public.lg_game_player_lines
  for each row execute function private.hitmen_route_lg_player_line_to_stall();
