-- AI film evidence is stored as a separate, management-only game report.
-- Existing official-stat reports and reviewed coaching notes are untouched.
alter table public.team_player_game_reports
  add column if not exists ai_review_id uuid references public.vod_review_sessions(id) on delete set null;
create unique index if not exists team_player_game_reports_ai_review_locker
  on public.team_player_game_reports(ai_review_id,locker_id) where ai_review_id is not null;

create or replace function public.route_vod_player_reports()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  game_season integer;
  game_week integer;
  entry record;
  target_locker uuid;
  matches integer;
  current_seasons integer;
begin
  if new.worker_status <> 'ready_for_review' or new.created_by is null then return new; end if;
  if jsonb_typeof(new.worker_result->'chunks') is distinct from 'array' then return new; end if;
  if new.schedule_game_id is not null then
    select season,week into game_season,game_week from public.hitmen_schedule_games
      where id=new.schedule_game_id and team_id=new.team_id;
    if game_season is null then return new; end if;
  else
    -- With no game-season link, route only if the team has one unambiguous season.
    select count(distinct season),min(season) into current_seasons,game_season
      from public.team_player_lockers where team_id=new.team_id;
    if current_seasons <> 1 then return new; end if;
  end if;
  for entry in
    select lower(btrim(p->>'player')) as player_key,
      string_agg(distinct nullif(p->>'strengths',''), E'\n') as strengths,
      string_agg(distinct nullif(p->>'concerns',''), E'\n') as improvements,
      string_agg(distinct nullif(p->>'habits',''), E'\n') as tactical_notes,
      string_agg(distinct nullif(p->>'coach_note',''), E'\n') as coach_summary,
      jsonb_agg(distinct jsonb_build_object('period',c->>'label','start',c->'start','end',c->'end',
        'player',p->>'player','confidence',p->>'confidence','timestamps',p->'evidence_timestamps')) as evidence
    from jsonb_array_elements(new.worker_result->'chunks') c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c#>'{review,player_evaluations}')='array'
        then c#>'{review,player_evaluations}' else '[]'::jsonb end) p
    where nullif(btrim(p->>'player'),'') is not null
      and jsonb_typeof(p->'evidence_timestamps')='array'
      and case when jsonb_typeof(p->'evidence_timestamps')='array' then jsonb_array_length(p->'evidence_timestamps')>0 else false end
      and exists (select 1 from jsonb_array_elements(
        case when jsonb_typeof(c#>'{review,observations}')='array'
        then c#>'{review,observations}' else '[]'::jsonb end) o
        where lower(btrim(o->>'player'))=lower(btrim(p->>'player'))
          and o->>'source'='gameplay')
    group by lower(btrim(p->>'player'))
  loop
    select count(*),(array_agg(id))[1] into matches,target_locker
      from public.team_player_lockers
      where team_id=new.team_id and season=game_season
        and lower(btrim(gamertag))=entry.player_key;
    if matches <> 1 then continue; end if;
    insert into public.team_player_game_reports
      (team_id,season,locker_id,ai_review_id,schedule_game_id,week,game_date,opponent_name,
       strengths,improvements,tactical_notes,coach_summary,evidence,visibility,created_by)
    values (new.team_id,game_season,target_locker,new.id,new.schedule_game_id,game_week,
      new.game_date,new.opponent_label,entry.strengths,entry.improvements,entry.tactical_notes,
      '[AI draft — needs management review]' || E'\n' || coalesce(entry.coach_summary,''),
      jsonb_build_object('source','vod_ai','review_id',new.id,'vod_url',new.vod_url,
        'source_offset_seconds',new.source_start_seconds,'verification','needs_review',
        'chunks',entry.evidence), 'management',new.created_by)
    on conflict (ai_review_id,locker_id) where ai_review_id is not null do nothing;
  end loop;
  return new;
end $$;
revoke all on function public.route_vod_player_reports() from public,anon,authenticated;
create trigger route_vod_player_reports_after_result
  after update of worker_result,worker_status on public.vod_review_sessions
  for each row execute function public.route_vod_player_reports();

