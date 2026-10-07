alter table public.team_player_lockers
  add column if not exists lg_user_id bigint;

create index if not exists team_player_lockers_lg_user_idx
  on public.team_player_lockers(team_id,season,lg_user_id)
  where lg_user_id is not null;

update public.team_player_lockers l
set lg_user_id = (
  select s.lg_user_id
  from public.lg_player_season_stats s
  where s.season=l.season
    and s.league_code='LGCHL'
    and lower(btrim(s.gamertag))=lower(btrim(l.gamertag))
    and s.lg_user_id is not null
  order by s.fetched_at desc nulls last
  limit 1
)
where l.team_id='b0bcbdda-da9d-419d-8f61-b34937966d49'::uuid
  and l.season=55
  and l.lg_user_id is null;

update public.team_player_lockers
set lg_user_id=42401
where team_id='b0bcbdda-da9d-419d-8f61-b34937966d49'::uuid
  and season=55
  and lower(btrim(gamertag))=lower('l Richy 19 l');

-- The live function in production also matches LG Public Log player lines to lockers
-- by lg_user_id first, then by exact gamertag, so renamed/stylized tags route safely.
