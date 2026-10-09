-- Scheduled opponent refresh now also runs on Sunday and Monday nights (Tuesday and Saturday already ran),
-- so Sunday, Monday and Tuesday game nights each get a pull right after the games.
-- Same 23:30-23:40 America/New_York window as before; the dated run key still blocks duplicate runs.
create or replace function public.hitmen_request_opponent_refresh(p_reason text default 'manual')
returns uuid language plpgsql security definer set search_path='' as $function$
declare v_id uuid; v_key text; v_local timestamp:=now() at time zone 'America/New_York';
begin
  if not (coalesce(auth.role(),'')='service_role' or (session_user='postgres' and current_setting('role',true) in ('none','postgres')) or (auth.uid() is not null and private.vvhl_can_manage_team(auth.uid(),'b0bcbdda-da9d-419d-8f61-b34937966d49'))) then raise exception 'Calgary management access required'; end if;
  perform pg_advisory_xact_lock(553901);
  select id into v_id from public.hitmen_opponent_refresh_runs where finished_at is null order by requested_at desc limit 1;
  if v_id is not null then return v_id; end if;
  if p_reason='scheduled' then
    -- isodow: 7 = Sunday, 1 = Monday, 2 = Tuesday (game nights), 6 = Saturday (kept from the original schedule)
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
end $function$;
