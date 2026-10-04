-- DRAFT · NOT APPLIED · needs Seth's OK (it changes a trigger and adds a function).
-- Goal: keep Calgary's Training Camp in sync from the source the opponent refresh already downloads.
-- Today nothing automated writes public.hitmen_roster_snapshot; Calgary rows were hand-loaded, and the
-- trigger below only creates lockers for active_roster, so new TC rows never reached the team locker.
-- Rules kept: insert-only for TC; never deletes, archives or deactivates; never touches active_roster
-- rows (counts, stalls and account links stay a human decision); no RLS or access change.

-- 1) Trigger: an active training_camp roster row also gets a TC locker (roster_class 'tc', the value the
--    team locker / workspace / lineup room already read). Active-roster branch unchanged.
create or replace function public.sync_hitmen_locker_from_roster()
returns trigger language plpgsql set search_path to '' as $function$
begin
  if new.active and new.roster_class='active_roster' then
    insert into public.team_player_lockers(team_id,season,roster_snapshot_id,player_id,gamertag,position,salary,management_role,jersey_name,roster_class,updated_at)
    values(new.team_id,new.season,new.id,new.player_id,new.gamertag,new.position,new.salary,new.management_role,new.gamertag,'active_roster',now())
    on conflict (team_id,season,gamertag) do update set
      roster_snapshot_id=excluded.roster_snapshot_id,
      player_id=coalesce(excluded.player_id,public.team_player_lockers.player_id),
      position=excluded.position, salary=excluded.salary, management_role=excluded.management_role,
      jersey_name=coalesce(public.team_player_lockers.jersey_name,excluded.jersey_name),
      roster_class='active_roster', updated_at=now();
  elsif new.active and new.roster_class='training_camp' then
    insert into public.team_player_lockers(team_id,season,roster_snapshot_id,player_id,gamertag,position,salary,jersey_name,roster_class,updated_at)
    values(new.team_id,new.season,new.id,new.player_id,new.gamertag,new.position,new.salary,new.gamertag,'tc',now())
    on conflict (team_id,season,gamertag) do update set
      roster_snapshot_id=excluded.roster_snapshot_id, position=excluded.position,
      roster_class=case when public.team_player_lockers.roster_class='active_roster' then public.team_player_lockers.roster_class else 'tc' end,
      updated_at=now();
  else
    update public.team_player_lockers
    set roster_class=case when new.active then (case when new.roster_class='training_camp' then 'tc' else new.roster_class end) else 'historical' end,
        roster_snapshot_id=new.id, updated_at=now()
    where team_id=new.team_id and season=new.season and lower(btrim(gamertag))=lower(btrim(new.gamertag));
  end if;
  return new;
end $function$;
-- NOTE: the TC branch never demotes an existing active_roster locker (a TC row for someone already on the
-- active roster leaves their stall alone).

-- 2) Insert-only TC sync, called by the hitmen-opponent-refresh Edge Function right after it parses the
--    league roster page (rows = lib/calgary-roster.mjs calgaryRows(), training_camp only).
create or replace function private.hitmen_add_calgary_training_camp(p_rows jsonb, p_as_of timestamptz)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare r jsonb; added jsonb:='[]'; v_player uuid;
  team constant uuid:='b0bcbdda-da9d-419d-8f61-b34937966d49';
begin
  if jsonb_typeof(p_rows)<>'array' or p_as_of is null then raise exception 'Bad TC payload'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    continue when coalesce(r->>'roster_class','')<>'training_camp' or coalesce(r->>'position','') not in ('LW','C','RW','LD','RD','G') or coalesce(trim(r->>'gamertag'),'')='';
    -- I/l twin of an existing row (LG renders them alike): leave it, report only
    continue when exists(select 1 from public.hitmen_roster_snapshot s where s.team_id=team and s.season=55
      and lower(translate(s.gamertag,'I','l'))=lower(translate(r->>'gamertag','I','l')));
    insert into public.players(gamertag,primary_position,status,approved) values(r->>'gamertag',r->>'position','available',true)
      on conflict (gamertag) do nothing;
    select id into v_player from public.players where gamertag=r->>'gamertag';
    insert into public.hitmen_roster_snapshot(team_id,season,player_id,gamertag,position,salary,roster_class,active,source_label,source_updated_at)
      values(team,55,v_player,r->>'gamertag',r->>'position',coalesce(nullif(r->>'salary','')::int,750000),'training_camp',true,'LeagueGaming public Season 55 roster (Training Camp)',p_as_of)
      on conflict (team_id,season,gamertag) do nothing;
    if found then added:=added||jsonb_build_array(r->>'gamertag'); end if;
  end loop;
  -- departures: reported, never deactivated here
  return jsonb_build_object('added',added,'departed',(select coalesce(jsonb_agg(s.gamertag),'[]') from public.hitmen_roster_snapshot s
    where s.team_id=team and s.season=55 and s.active and s.roster_class='training_camp'
      and not exists(select 1 from jsonb_array_elements(p_rows) x where lower(translate(x->>'gamertag','I','l'))=lower(translate(s.gamertag,'I','l')))));
end $function$;
revoke all on function private.hitmen_add_calgary_training_camp(jsonb,timestamptz) from public, anon, authenticated;

-- 3) Edge Function hook (supabase/functions/hitmen-opponent-refresh/index.ts, lgRoster()), after
--    `const players = parseRosters(html);`:
--      const tc = calgaryRows(players).filter(r => r.roster_class === 'training_camp');
--      if (tc.length) await checked(db.rpc('hitmen_add_calgary_training_camp', {p_rows: tc, p_as_of: asOf}));
--    (needs a public wrapper or a service-role call to the private function; deploy only after 1 and 2.)
