-- Season 55 opponent refresh. Existing LG importer, auth rules and scouting tables are reused.
create table public.hitmen_opponent_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null default 'b0bcbdda-da9d-419d-8f61-b34937966d49',
  season integer not null default 55,
  run_key text not null unique,
  reason text not null,
  requested_at timestamptz not null default now(),
  requested_by uuid references auth.users(id),
  finished_at timestamptz
);
create table public.hitmen_opponent_refresh_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.hitmen_opponent_refresh_runs(id),
  team_id uuid not null default 'b0bcbdda-da9d-419d-8f61-b34937966d49',
  opponent_name text not null,
  source text not null check (source in ('lg_roster','lg_chl','ea_nhl27')),
  priority integer not null,
  status text not null default 'pending' check (status in ('pending','running','complete','partial','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  lease uuid,
  detail jsonb not null default '{}',
  unique (run_id,opponent_name,source)
);
create index on public.hitmen_opponent_refresh_tasks(status,available_at,priority);
create index on public.hitmen_opponent_refresh_tasks(run_id);
alter table public.hitmen_opponent_refresh_runs enable row level security;
alter table public.hitmen_opponent_refresh_tasks enable row level security;
create policy opponent_refresh_read on public.hitmen_opponent_refresh_runs for select to authenticated using (private.vvhl_can_view_team(auth.uid(),team_id));
create policy opponent_refresh_read on public.hitmen_opponent_refresh_tasks for select to authenticated using (private.vvhl_can_view_team(auth.uid(),team_id));
grant select on public.hitmen_opponent_refresh_runs, public.hitmen_opponent_refresh_tasks to authenticated;
grant all on public.hitmen_opponent_refresh_runs, public.hitmen_opponent_refresh_tasks to service_role;
alter table public.hitmen_opponent_source_snapshots add column refresh_run_id uuid references public.hitmen_opponent_refresh_runs(id);
create unique index opponent_refresh_snapshot_once on public.hitmen_opponent_source_snapshots(refresh_run_id,opponent_name,source) where refresh_run_id is not null;

create function private.hitmen_save_opponent_rosters(p_rows jsonb,p_as_of timestamptz,p_run uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o record; r jsonb; incoming jsonb; old_rows jsonb; added jsonb; departed jsonb;
  previous_count integer; incoming_count integer; applied integer:=0; skipped jsonb:='[]';
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)<50 or p_as_of is null then raise exception 'Incomplete roster response'; end if;
  for o in select * from public.hitmen_opponents where team_id='b0bcbdda-da9d-419d-8f61-b34937966d49' and season=55 for update loop
    select coalesce(jsonb_agg(x),'[]') into incoming from jsonb_array_elements(p_rows) x where x->>'team'=o.opponent_name;
    incoming_count:=jsonb_array_length(incoming);
    select coalesce(jsonb_agg(to_jsonb(p)),'[]'),count(*) into old_rows,previous_count from public.hitmen_opponent_roster_players p where p.team_id=o.team_id and p.season=55 and p.opponent_name=o.opponent_name and p.active;
    -- Missing teams, duplicated IDs, malformed players and suspicious shrinkage cannot erase a roster.
    if incoming_count<10 or incoming_count<ceil(previous_count*0.75) or exists(select 1 from jsonb_array_elements(incoming) x where coalesce(x->>'uid','')!~'^[0-9]+$' or coalesce(trim(x->>'name'),'')='' or coalesce(x->>'position',x->>'pos','') not in ('LW','C','RW','LD','RD','G'))
       or (select count(distinct x->>'uid') from jsonb_array_elements(incoming) x)<>incoming_count
       or (select count(distinct lower(trim(x->>'name'))) from jsonb_array_elements(incoming) x)<>incoming_count
       or (o.lg_roster_updated_at is not null and p_as_of<=o.lg_roster_updated_at) then
      skipped:=skipped||jsonb_build_array(o.opponent_name); continue;
    end if;
    select coalesce(jsonb_agg(x),'[]') into added from jsonb_array_elements(incoming) x where not exists(select 1 from jsonb_array_elements(old_rows) y where y->>'source_player_uid'=x->>'uid');
    select coalesce(jsonb_agg(x),'[]') into departed from jsonb_array_elements(old_rows) x where not exists(select 1 from jsonb_array_elements(incoming) y where y->>'uid'=x->>'source_player_uid');
    for r in select * from jsonb_array_elements(incoming) loop
      -- Carry management line assignments through an exact-ID gamertag rename.
      update public.hitmen_opponent_roster_players set gamertag=r->>'name' where team_id=o.team_id and season=55 and opponent_name=o.opponent_name and source_player_uid=(r->>'uid')::bigint and gamertag<>r->>'name'
        and not exists(select 1 from public.hitmen_opponent_roster_players p where p.team_id=o.team_id and p.season=55 and p.opponent_name=o.opponent_name and p.gamertag=r->>'name');
      insert into public.hitmen_opponent_roster_players(team_id,season,opponent_name,source_player_uid,gamertag,position,salary,management_role,roster_role,active,source_label,source_url,source_updated_at)
      values(o.team_id,55,o.opponent_name,(r->>'uid')::bigint,r->>'name',coalesce(r->>'position',r->>'pos'),nullif(r->>'salary','')::numeric,r->>'management_role',r->>'roster_role',true,'LGCHL Season 55 public roster','https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=roster&leagueid=39&seasonid=55',p_as_of)
      on conflict(team_id,season,opponent_name,gamertag) do update set source_player_uid=excluded.source_player_uid,position=excluded.position,salary=excluded.salary,management_role=excluded.management_role,roster_role=excluded.roster_role,active=true,source_label=excluded.source_label,source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,updated_at=now();
    end loop;
    update public.hitmen_opponent_roster_players p set active=false,updated_at=now() where p.team_id=o.team_id and p.season=55 and p.opponent_name=o.opponent_name and p.active and not exists(select 1 from jsonb_array_elements(incoming) x where x->>'uid'=p.source_player_uid::text and x->>'name'=p.gamertag);
    insert into public.hitmen_opponent_source_snapshots(team_id,season,opponent_name,source,source_label,source_url,payload,fetched_at,created_by,refresh_run_id)
    values(o.team_id,55,o.opponent_name,'lg_roster','LGCHL Season 55 roster and observed changes','https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=roster&leagueid=39&seasonid=55',jsonb_build_object('players',incoming,'previous_as_of',o.lg_roster_updated_at,'arrivals',added,'departures',departed,'note','Observed roster changes; not proof of a trade or transaction type'),p_as_of,auth.uid(),p_run);
    update public.hitmen_opponents set lg_roster_updated_at=p_as_of,source_updated_at=p_as_of where id=o.id;
    applied:=applied+1;
  end loop;
  return jsonb_build_object('teams_updated',applied,'teams_preserved',skipped);
end $$;
revoke all on function private.hitmen_save_opponent_rosters(jsonb,timestamptz,uuid) from public,anon,authenticated;

create or replace function public.apply_hitmen_opponent_roster_snapshot(p_rows jsonb,p_source_updated_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.vvhl_can_manage_team(auth.uid(),'b0bcbdda-da9d-419d-8f61-b34937966d49') then raise exception 'Calgary management access required'; end if;
  return private.hitmen_save_opponent_rosters(p_rows,p_source_updated_at);
end $$;

create function public.hitmen_request_opponent_refresh(p_reason text default 'manual') returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_key text; v_local timestamp:=now() at time zone 'America/New_York';
begin
  if not (coalesce(auth.role(),'')='service_role' or (session_user='postgres' and current_setting('role',true) in ('none','postgres')) or (auth.uid() is not null and private.vvhl_can_manage_team(auth.uid(),'b0bcbdda-da9d-419d-8f61-b34937966d49'))) then raise exception 'Calgary management access required'; end if;
  perform pg_advisory_xact_lock(553901);
  select id into v_id from public.hitmen_opponent_refresh_runs where finished_at is null order by requested_at desc limit 1;
  if v_id is not null then return v_id; end if;
  if p_reason='scheduled' then
    if extract(isodow from v_local) not in (1,2,6,7) or v_local::time<'23:30' or v_local::time>='23:40' then return null; end if;
    v_key:='season55:'||v_local::date;
  else v_key:='manual:'||gen_random_uuid(); end if;
  if not exists(select 1 from public.hitmen_schedule_games where team_id='b0bcbdda-da9d-419d-8f61-b34937966d49' and season=55 and scheduled_at>=now() and status in ('scheduled','postponed')) then return null; end if;
  insert into public.hitmen_opponent_refresh_runs(run_key,reason,requested_by) values(v_key,left(p_reason,100),auth.uid()) on conflict(run_key) do nothing returning id into v_id;
  if v_id is null then return null; end if;
  insert into public.hitmen_opponent_refresh_tasks(run_id,opponent_name,source,priority) values(v_id,'*','lg_roster',0);
  insert into public.hitmen_opponent_refresh_tasks(run_id,opponent_name,source,priority)
  select v_id,o.opponent_name,s.source,(case when min(g.scheduled_at)<now()+interval '8 days' then 10 else 100 end)+(case when s.source='lg_chl' then 0 else 1 end)
    from public.hitmen_opponents o join public.hitmen_schedule_games g on g.team_id=o.team_id and g.season=o.season and g.opponent_name=o.opponent_name
    cross join (values('lg_chl'),('ea_nhl27')) s(source)
    where o.team_id='b0bcbdda-da9d-419d-8f61-b34937966d49' and o.season=55 and g.scheduled_at>=now() and g.status in ('scheduled','postponed') group by o.opponent_name,s.source;
  perform public.lg_enqueue(39,55,55,array['regular'],1,true);
  perform public.lg_kick_worker();
  return v_id;
end $$;
revoke all on function public.hitmen_request_opponent_refresh(text) from public,anon;
grant execute on function public.hitmen_request_opponent_refresh(text) to authenticated,service_role;

create function public.hitmen_claim_opponent_refresh() returns setof public.hitmen_opponent_refresh_tasks
language plpgsql security definer set search_path='' as $$
begin
  update public.hitmen_opponent_refresh_tasks set status=case when attempts>=3 then 'failed' else 'pending' end,available_at=now(),detail=jsonb_build_object('error','Worker lease expired; previous evidence retained') where status='running' and started_at<now()-interval '4 minutes';
  return query update public.hitmen_opponent_refresh_tasks t set status='running',attempts=attempts+1,started_at=now(),lease=gen_random_uuid()
  where t.id in (select id from public.hitmen_opponent_refresh_tasks where status='pending' and available_at<=now() order by priority,available_at for update skip locked limit 3) returning t.*;
end $$;
revoke all on function public.hitmen_claim_opponent_refresh() from public,anon,authenticated;
grant execute on function public.hitmen_claim_opponent_refresh() to service_role;

create function public.hitmen_finish_opponent_refresh(p_id uuid,p_lease uuid,p_result jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare t public.hitmen_opponent_refresh_tasks; r jsonb; m public.hitmen_opponent_player_stats; v_detail jsonb:=coalesce(p_result->'detail','{}'); v_status text:=p_result->>'status'; v_as_of timestamptz:=(p_result->>'as_of')::timestamptz;
begin
  select * into t from public.hitmen_opponent_refresh_tasks where id=p_id and lease=p_lease and status='running' for update;
  if not found then return false; end if;
  if v_status='defer' then
    update public.hitmen_opponent_refresh_tasks set status='pending',attempts=greatest(0,attempts-1),available_at=now()+interval '1 minute',detail=v_detail where id=t.id; return true;
  elsif v_status='failed' then
    update public.hitmen_opponent_refresh_tasks set status=case when attempts<3 then 'pending' else 'failed' end,available_at=now()+interval '5 minutes',finished_at=case when attempts>=3 then now() end,detail=v_detail where id=t.id;
  else
    if v_status not in ('complete','partial') or v_as_of is null then raise exception 'Invalid refresh result'; end if;
    if t.source='lg_roster' then
      v_detail:=v_detail||private.hitmen_save_opponent_rosters(p_result->'players',v_as_of,t.run_id);
      if jsonb_array_length(v_detail->'teams_preserved')>0 then v_status:='partial'; end if;
    else
      insert into public.hitmen_opponent_source_snapshots(team_id,season,opponent_name,source,source_label,source_url,payload,fetched_at,refresh_run_id)
      values(t.team_id,55,t.opponent_name,t.source,p_result->>'label',p_result->>'url',coalesce(p_result->'payload','{}')||jsonb_build_object('coverage',v_detail,'checked_at',now()),v_as_of,t.run_id);
      for r in select * from jsonb_array_elements(coalesce(p_result->'players','[]')) loop
        select * into m from jsonb_populate_record(null::public.hitmen_opponent_player_stats,r);
        if coalesce(m.gamertag,'')='' then raise exception 'Player identity missing'; end if;
        insert into public.hitmen_opponent_player_stats(team_id,season,opponent_name,gamertag,source_player_uid,position,source,source_key,games_played,wins,losses,goals,assists,points,plus_minus,shots,hits,pim,takeaways,giveaways,faceoff_pct,passing_pct,goalie_save_pct,goalie_gaa,raw_stats,source_updated_at)
        values(t.team_id,55,t.opponent_name,m.gamertag,m.source_player_uid,m.position,t.source,'current',m.games_played,m.wins,m.losses,m.goals,m.assists,m.points,m.plus_minus,m.shots,m.hits,m.pim,m.takeaways,m.giveaways,m.faceoff_pct,m.passing_pct,m.goalie_save_pct,m.goalie_gaa,m.raw_stats,coalesce(m.source_updated_at,v_as_of))
        on conflict(team_id,season,opponent_name,gamertag,source,source_key) do update set source_player_uid=excluded.source_player_uid,position=excluded.position,games_played=excluded.games_played,wins=excluded.wins,losses=excluded.losses,goals=excluded.goals,assists=excluded.assists,points=excluded.points,plus_minus=excluded.plus_minus,shots=excluded.shots,hits=excluded.hits,pim=excluded.pim,takeaways=excluded.takeaways,giveaways=excluded.giveaways,faceoff_pct=excluded.faceoff_pct,passing_pct=excluded.passing_pct,goalie_save_pct=excluded.goalie_save_pct,goalie_gaa=excluded.goalie_gaa,raw_stats=excluded.raw_stats,source_updated_at=excluded.source_updated_at,updated_at=now()
        where public.hitmen_opponent_player_stats.source_updated_at is null or public.hitmen_opponent_player_stats.source_updated_at<=excluded.source_updated_at;
      end loop;
      if t.source='ea_nhl27' then update public.hitmen_opponents set ea_updated_at=v_as_of where team_id=t.team_id and season=55 and opponent_name=t.opponent_name; end if;
    end if;
    update public.hitmen_opponent_refresh_tasks set status=v_status,detail=v_detail,finished_at=now() where id=t.id;
  end if;
  update public.hitmen_opponent_refresh_runs r set finished_at=now() where r.id=t.run_id and not exists(select 1 from public.hitmen_opponent_refresh_tasks x where x.run_id=r.id and x.status in ('pending','running'));
  return true;
end $$;
revoke all on function public.hitmen_finish_opponent_refresh(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.hitmen_finish_opponent_refresh(uuid,uuid,jsonb) to service_role;

create function public.hitmen_kick_opponent_refresh() returns bigint language plpgsql security definer set search_path='' as $$
declare v_req bigint;
begin
  perform public.hitmen_request_opponent_refresh('scheduled');
  update public.hitmen_opponent_refresh_runs r set finished_at=now() where r.finished_at is null and not exists(select 1 from public.hitmen_opponent_refresh_tasks t where t.run_id=r.id and t.status in ('pending','running'));
  if not exists(select 1 from public.hitmen_opponent_refresh_tasks where (status='pending' and available_at<=now()) or (status='running' and started_at<now()-interval '4 minutes')) then return null; end if;
  if exists(select 1 from public.hitmen_opponent_refresh_tasks where status='running' and started_at>now()-interval '2 minutes') then return null; end if;
  select net.http_post(url:='https://lrgllzvwgvqagcpiyvfd.supabase.co/functions/v1/hitmen-opponent-refresh',body:='{}',headers:=jsonb_build_object('Content-Type','application/json','x-sync-token',(select value from public.lg_sync_settings where key='sync_token')),timeout_milliseconds:=100000) into v_req;
  return v_req;
end $$;
revoke all on function public.hitmen_kick_opponent_refresh() from public,anon,authenticated;
grant execute on function public.hitmen_kick_opponent_refresh() to service_role;
-- Frequent lightweight tick; actual pulls only Sunday/Monday/Tuesday/Saturday 23:30 America/New_York.
-- The timezone conversion handles DST. A dated unique run key prevents duplicate runs.
select cron.schedule('hitmen-opponent-refresh','*/2 * * * *','select public.hitmen_kick_opponent_refresh()');
