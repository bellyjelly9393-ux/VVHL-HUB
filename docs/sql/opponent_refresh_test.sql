begin;
set local role authenticated;
do $$ begin
  begin perform public.hitmen_request_opponent_refresh('test'); raise exception 'AUTH TEST FAILED'; exception when others then if sqlerrm='AUTH TEST FAILED' then raise; end if; end;
  if has_function_privilege('authenticated','public.hitmen_finish_opponent_refresh(uuid,uuid,jsonb)','EXECUTE') or has_function_privilege('anon','public.hitmen_claim_opponent_refresh()','EXECUTE') then raise exception 'Worker privileges exposed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','9c6f974d-ed28-4471-951f-a38ebc733895',true);
do $$
declare p jsonb; result jsonb; count_before int; count_after int; target text; first_uid bigint; original_name text;
begin
 select count(*) into count_before from public.hitmen_opponent_roster_players where active;
 select opponent_name,source_player_uid,gamertag into target,first_uid,original_name from public.hitmen_opponent_roster_players where active order by opponent_name,gamertag limit 1;
 select jsonb_agg(jsonb_build_object('team',opponent_name,'uid',source_player_uid,'name',gamertag,'position',position,'salary',salary,'management_role',management_role,'roster_role',roster_role)) into p from public.hitmen_opponent_roster_players where active;
 result:=public.apply_hitmen_opponent_roster_snapshot(p,now());
 if (result->>'teams_updated')::int<>39 then raise exception 'Expected 39 teams, got %',result; end if;
 select count(*) into count_after from public.hitmen_opponent_roster_players where active;
 if count_after<>count_before then raise exception 'Roster changed on identical snapshot'; end if;
 if exists(select 1 from public.hitmen_opponent_roster_players where active and position is null) then raise exception 'Position lost'; end if;
 -- Omit one team completely. The other 38 update and the omitted roster survives.
 select jsonb_agg(x) into p from jsonb_array_elements(p) x where x->>'team'<>target;
 result:=public.apply_hitmen_opponent_roster_snapshot(p,now()+interval '1 second');
 if (result->>'teams_updated')::int<>38 or jsonb_array_length(result->'teams_preserved')<>1 then raise exception 'Missing-team protection failed: %',result; end if;
 if not exists(select 1 from public.hitmen_opponent_roster_players where opponent_name=target and active and source_player_uid=first_uid) then raise exception 'Missing team was deactivated'; end if;
end $$;
set local role authenticated;
select public.hitmen_request_opponent_refresh('rollback-test') is not null as management_queue_works;
rollback;
