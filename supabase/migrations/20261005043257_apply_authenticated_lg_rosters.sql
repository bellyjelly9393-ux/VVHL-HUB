create or replace function public.lg_apply_authenticated_roster_capture(
  p_rows jsonb,
  p_as_of timestamptz,
  p_snapshot_id uuid,
  p_league text default 'LGCHL',
  p_season integer default 55
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  r jsonb;
  old_row public.lg_roster_players;
  v_uid bigint;
  v_name text;
  v_team text;
  v_pos text;
  v_salary integer;
  v_management text;
  v_role text;
  v_seen integer := 0;
  v_added integer := 0;
  v_removed integer := 0;
  v_changed integer := 0;
  v_teams integer := 0;
  v_hitmen jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' or p_as_of is null or p_snapshot_id is null then
    raise exception 'Invalid authenticated roster capture';
  end if;

  select count(distinct x->>'team') into v_teams
  from jsonb_array_elements(p_rows) x
  where coalesce(trim(x->>'team'),'') <> '';

  if jsonb_array_length(p_rows) < 50 or v_teams < 20 then
    raise exception 'Roster capture is incomplete (% players / % teams)', jsonb_array_length(p_rows), v_teams;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'uid','') !~ '^[0-9]+$'
       or coalesce(trim(r->>'name'),'') = ''
       or coalesce(r->>'position','') not in ('LW','C','RW','LD','RD','G')
       or coalesce(trim(r->>'team'),'') = '' then
      raise exception 'Roster capture contains a malformed player row';
    end if;

    v_uid := (r->>'uid')::bigint;
    v_name := trim(r->>'name');
    v_team := trim(r->>'team');
    v_pos := r->>'position';
    v_salary := nullif(r->>'salary','')::integer;
    v_management := nullif(r->>'management_role','');
    v_role := coalesce(nullif(r->>'roster_role',''),'Active');

    select *
      into old_row
    from public.lg_roster_players p
    where p.season = p_season
      and p.league = p_league
      and (p.lg_user_id = v_uid or lower(p.gamertag) = lower(v_name))
    order by case when p.lg_user_id = v_uid then 0 else 1 end
    limit 1
    for update;

    if found then
      if old_row.team_name is distinct from v_team then
        insert into public.lg_roster_change_candidates(
          source_snapshot_id,season,league,lg_user_id,gamertag,event_type,previous_state,current_state
        ) values (
          p_snapshot_id,p_season,p_league,v_uid,v_name,'team_change',to_jsonb(old_row),r
        );
        v_changed := v_changed + 1;
      end if;

      if old_row.roster_role is not null and old_row.roster_role is distinct from v_role then
        insert into public.lg_roster_change_candidates(
          source_snapshot_id,season,league,lg_user_id,gamertag,event_type,previous_state,current_state
        ) values (
          p_snapshot_id,p_season,p_league,v_uid,v_name,
          case
            when lower(old_row.roster_role) like '%training%' and lower(v_role) not like '%training%' then 'tc_call_up'
            when lower(old_row.roster_role) not like '%training%' and lower(v_role) like '%training%' then 'sent_to_tc'
            else 'management_change'
          end,
          to_jsonb(old_row),r
        );
        v_changed := v_changed + 1;
      end if;

      if old_row.position is distinct from v_pos then
        insert into public.lg_roster_change_candidates(
          source_snapshot_id,season,league,lg_user_id,gamertag,event_type,previous_state,current_state
        ) values (p_snapshot_id,p_season,p_league,v_uid,v_name,'position_change',to_jsonb(old_row),r);
        v_changed := v_changed + 1;
      end if;

      if old_row.salary is distinct from v_salary then
        insert into public.lg_roster_change_candidates(
          source_snapshot_id,season,league,lg_user_id,gamertag,event_type,previous_state,current_state
        ) values (p_snapshot_id,p_season,p_league,v_uid,v_name,'salary_change',to_jsonb(old_row),r);
        v_changed := v_changed + 1;
      end if;

      if old_row.management_role is distinct from v_management then
        insert into public.lg_roster_change_candidates(
          source_snapshot_id,season,league,lg_user_id,gamertag,event_type,previous_state,current_state
        ) values (p_snapshot_id,p_season,p_league,v_uid,v_name,'management_change',to_jsonb(old_row),r);
        v_changed := v_changed + 1;
      end if;

      if old_row.gamertag is distinct from v_name then
        insert into public.lg_roster_change_candidates(
          source_snapshot_id,season,league,lg_user_id,gamertag,event_type,previous_state,current_state
        ) values (p_snapshot_id,p_season,p_league,v_uid,v_name,'gamertag_change',to_jsonb(old_row),r);
        v_changed := v_changed + 1;
      end if;

      update public.lg_roster_players
      set lg_user_id = v_uid,
          team_name = v_team,
          gamertag = v_name,
          position = v_pos,
          salary = v_salary,
          management_role = v_management,
          roster_role = v_role,
          active = true,
          source_label = 'LeagueGaming authenticated browser roster',
          source_updated_at = p_as_of,
          source_capture_id = p_snapshot_id
      where id = old_row.id;
    else
      insert into public.lg_roster_players(
        season,team_name,gamertag,position,salary,management_role,league_tag,ra_tag,
        active,source_label,source_updated_at,league,lg_user_id,roster_role,source_capture_id
      ) values (
        p_season,v_team,v_name,v_pos,v_salary,v_management,false,false,
        true,'LeagueGaming authenticated browser roster',p_as_of,p_league,v_uid,v_role,p_snapshot_id
      );

      insert into public.lg_roster_change_candidates(
        source_snapshot_id,season,league,lg_user_id,gamertag,event_type,current_state
      ) values (p_snapshot_id,p_season,p_league,v_uid,v_name,'roster_added',r);
      v_added := v_added + 1;
    end if;

    v_seen := v_seen + 1;
  end loop;

  for old_row in
    select *
    from public.lg_roster_players p
    where p.season = p_season
      and p.league = p_league
      and p.active
      and not exists (
        select 1
        from jsonb_array_elements(p_rows) x
        where (p.lg_user_id is not null and x->>'uid' = p.lg_user_id::text)
           or (p.lg_user_id is null and lower(x->>'name') = lower(p.gamertag))
      )
    for update
  loop
    insert into public.lg_roster_change_candidates(
      source_snapshot_id,season,league,lg_user_id,gamertag,event_type,previous_state
    ) values (
      p_snapshot_id,p_season,p_league,old_row.lg_user_id,old_row.gamertag,'roster_removed',to_jsonb(old_row)
    );
    update public.lg_roster_players
      set active=false,source_updated_at=p_as_of,source_capture_id=p_snapshot_id
      where id=old_row.id;
    v_removed := v_removed + 1;
  end loop;

  if p_league = 'LGCHL' and p_season = 55 then
    v_hitmen := private.hitmen_save_opponent_rosters(p_rows,p_as_of,null);
  end if;

  return jsonb_build_object(
    'players_seen',v_seen,
    'teams_seen',v_teams,
    'added_candidates',v_added,
    'removed_candidates',v_removed,
    'change_candidates',v_changed,
    'opponent_rosters',v_hitmen
  );
end
$function$;

revoke all on function public.lg_apply_authenticated_roster_capture(jsonb,timestamptz,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.lg_apply_authenticated_roster_capture(jsonb,timestamptz,uuid,text,integer) to service_role;
