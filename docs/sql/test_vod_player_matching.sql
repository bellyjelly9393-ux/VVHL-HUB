-- Run inside a transaction with vod_player_matching.sql; caller always rolls back.
select set_config('request.jwt.claim.sub','9c6f974d-ed28-4471-951f-a38ebc733895',true);
set local role authenticated;
do $$
declare r public.vod_review_sessions; l public.team_player_lockers; doc jsonb; p jsonb; result jsonb; before_count integer; after_count integer; context jsonb;
begin
select * into r from public.vod_review_sessions where id='c708381b-1692-4168-8c75-18e4482ba9a7';
select * into l from public.team_player_lockers where team_id=r.team_id and gamertag='imona_plain' order by season desc limit 1;
context:=public.vod_player_match_context(r.id);
if not exists(select 1 from jsonb_array_elements(context->'candidates') c where c->>'id'=l.id::text and (c->>'played')::boolean) then raise exception 'Official game participants missing'; end if;
doc:=r.review_document;
select value into p from jsonb_array_elements(doc->'players') where value->>'player'=l.gamertag;
p:=p||jsonb_build_object('strengths','Synthetic unique observation','evidence_timestamps',jsonb_build_array(r.source_start_seconds+1));
doc:=jsonb_set(doc,'{players}',doc->'players'||jsonb_build_array(p||'{"player":"Synthetic CHEL alias"}'::jsonb,p||'{"player":"Synthetic second alias"}'::jsonb));
doc:=doc||jsonb_build_object('player_matches',jsonb_build_object('synthetic chel alias',l.id,'synthetic second alias',l.id));
select count(*) into before_count from public.team_player_game_reports where ai_review_id=r.id;
result:=public.publish_vod_review(r.id,r.updated_at,doc);
select * into r from public.vod_review_sessions where id=r.id;
perform public.publish_vod_review(r.id,r.updated_at,doc);
select count(*) into after_count from public.team_player_game_reports where ai_review_id=r.id;
if before_count<>after_count then raise exception 'Repeated alias routing created extra rows'; end if;
if (select count(*) from public.team_player_game_reports where ai_review_id=r.id and locker_id=l.id)<>1 then raise exception 'Duplicate locker report'; end if;
if not exists(select 1 from public.team_player_game_reports where ai_review_id=r.id and locker_id=l.id and strengths like '%Synthetic unique observation%' and evidence->'source_names' ? 'Synthetic CHEL alias' and evidence->'source_names' ? l.gamertag) then raise exception 'Merged notes or original name lost'; end if;
if exists(select 1 from public.team_player_game_reports where ai_review_id=r.id and locker_id=l.id and (length(strengths)-length(replace(strengths,'Synthetic unique observation','')))/length('Synthetic unique observation')<>1) then raise exception 'Duplicate note text'; end if;
select * into r from public.vod_review_sessions where id=r.id;
begin
 perform public.publish_vod_review(r.id,r.updated_at,jsonb_set(doc,array['player_matches','synthetic chel alias'],'"00000000-0000-0000-0000-000000000000"'::jsonb));
 raise exception 'TEST: invalid locker allowed';
exception when raise_exception then if sqlerrm not like 'Selected player does not belong%' then raise; end if; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
 perform public.vod_player_match_context('c708381b-1692-4168-8c75-18e4482ba9a7');
 raise exception 'TEST: anonymous player access allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
