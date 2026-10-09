-- Game-scoped player identities. No fuzzy identity matching and no cross-team aliases.
create or replace function public.vod_player_match_context(target_review uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.vod_review_sessions; game_season integer; candidates jsonb; suggestions jsonb;
begin
select * into r from public.vod_review_sessions where id=target_review;
if r.id is null or auth.uid() is null or not private.vvhl_can_manage_team(auth.uid(),r.team_id) then
 raise exception 'Management access to this team is required' using errcode='42501';
end if;
select season into game_season from public.hitmen_schedule_games where id=r.schedule_game_id and team_id=r.team_id;
if game_season is null then select max(season) into game_season from public.team_player_lockers where team_id=r.team_id; end if;
select coalesce(jsonb_agg(x order by x.gamertag),'[]'::jsonb) into candidates from (
 select l.id,l.gamertag,l.position,l.lg_user_id::text as lg_user_id,
 exists(select 1 from public.team_player_game_reports g where g.team_id=r.team_id and g.locker_id=l.id and g.schedule_game_id=r.schedule_game_id and g.ai_review_id is null) as played,
 exists(select 1 from public.lineups u join public.lineup_slots s on s.lineup_id=u.id
 where u.team_id=r.team_id and u.schedule_game_id=r.schedule_game_id and u.is_active is not false and s.player_id=l.player_id) as lineup
 from public.team_player_lockers l where l.team_id=r.team_id and l.season=game_season
) x;
select coalesce(jsonb_agg(distinct jsonb_build_object('name',m.key,'locker_id',l.id,'gamertag',l.gamertag)),'[]'::jsonb)
into suggestions from public.vod_game_publications v
cross join lateral jsonb_each_text(coalesce(v.report->'player_matches','{}'::jsonb)) m
join public.team_player_lockers l on l.id::text=m.value and l.team_id=r.team_id and l.season=game_season
where v.team_id=r.team_id and v.active and v.review_id<>r.id;
return jsonb_build_object('candidates',candidates,'suggestions',suggestions,'matches',coalesce(r.review_document->'player_matches','{}'::jsonb));
end $$;
revoke all on function public.vod_player_match_context(uuid) from public,anon;
grant execute on function public.vod_player_match_context(uuid) to authenticated;

create or replace function public.publish_vod_review(target_review uuid, expected_updated_at timestamp with time zone, report jsonb)
returns jsonb language plpgsql set search_path to '' as $function$
declare r public.vod_review_sessions; p jsonb; n integer; routed integer:=0; l public.team_player_lockers; matches integer; unmatched jsonb:='[]'::jsonb; latest integer; entry record; resolved jsonb:='[]'::jsonb; selected text; source_name text;
begin
select * into r from public.vod_review_sessions where id=target_review for update;
if r.id is null or auth.uid() is null or not private.vvhl_can_manage_team(auth.uid(),r.team_id) then
raise exception 'Management access to this team is required' using errcode='42501';
end if;
if r.updated_at is distinct from expected_updated_at then raise exception 'Review changed elsewhere. Refresh before publishing.'; end if;
report:=report||jsonb_build_object(
'player_matches',coalesce(report->'player_matches',r.review_document->'player_matches','{}'::jsonb),
'approved_periods',coalesce((select jsonb_agg(to_jsonb(s) order by s.start_seconds) from public.vod_review_segments s
where s.review_id=r.id and s.archived_at is null and s.status='complete'),'[]'::jsonb),
'approved_markers',coalesce((select jsonb_agg(to_jsonb(m) order by m.timestamp_seconds) from public.vod_review_markers m
join public.vod_review_segments s on s.id=m.segment_id
where s.review_id=r.id and s.archived_at is null and s.status='complete'),'[]'::jsonb));
update public.vod_review_sessions set review_document=report,
full_game_summary=coalesce(nullif(report->>'summary',''),full_game_summary),
tactical_report=coalesce(nullif(report->>'tactical_report',''),tactical_report),
player_report=coalesce(nullif(report->>'player_report',''),player_report),status='complete',updated_at=now() where id=r.id;
insert into public.vod_game_publications(review_id,team_id,report,published_by)
values(r.id,r.team_id,report,auth.uid())
on conflict(review_id) do update set report=excluded.report,active=true,
published_by=excluded.published_by,published_at=now();
select season into latest from public.hitmen_schedule_games where id=r.schedule_game_id and team_id=r.team_id;
if latest is null then select max(season) into latest from public.team_player_lockers where team_id=r.team_id; end if;
-- Keep original report names and evidence intact; resolve only the routing identity.
for p in select value from jsonb_array_elements(report->'players') loop
source_name:=btrim(p->>'player');
selected:=report->'player_matches'->>lower(source_name);
if selected='ignore' then continue; end if;
if selected is not null and selected<>'' then
  select count(*) into matches from public.team_player_lockers where id::text=selected and team_id=r.team_id and season=latest;
  if matches<>1 then raise exception 'Selected player does not belong to this team and game season'; end if;
  select * into l from public.team_player_lockers where id::text=selected and team_id=r.team_id and season=latest;
else
  select count(*) into matches from public.team_player_lockers where team_id=r.team_id and season=latest and lower(btrim(gamertag))=lower(source_name);
  if matches<>1 then unmatched:=unmatched||jsonb_build_array(source_name); continue; end if;
  select * into l from public.team_player_lockers where team_id=r.team_id and season=latest and lower(btrim(gamertag))=lower(source_name);
end if;
resolved:=resolved||jsonb_build_array(p||jsonb_build_object('locker_id',l.id,'source_name',source_name));
end loop;
-- Multiple CHEL names and the gamertag share ONE canonical locker entry.
for entry in select value->>'locker_id' as locker_id, jsonb_agg(value) as entries
  from jsonb_array_elements(resolved) group by value->>'locker_id' loop
select * into l from public.team_player_lockers where id::text=entry.locker_id and team_id=r.team_id;
p:=jsonb_build_object('player',l.gamertag,'position',l.position,
  'source_names',(select jsonb_agg(distinct value->>'source_name') from jsonb_array_elements(entry.entries)),
  'rating',(select value->'rating' from jsonb_array_elements(entry.entries) where value->'rating'<>'null'::jsonb order by (lower(value->>'source_name')=lower(l.gamertag)) desc limit 1),
  'evidence_timestamps',coalesce((select jsonb_agg(t order by t) from (select distinct t from jsonb_array_elements(entry.entries) e cross join lateral jsonb_array_elements(coalesce(e->'evidence_timestamps','[]'::jsonb)) t) stamps),'[]'::jsonb));
-- Distinct lines retain each observation without repeating identical notes.
for selected in select unnest(array['strengths','concerns','habits','coach_note']) loop
  p:=p||jsonb_build_object(selected,(select string_agg(line,E'\n' order by line) from
    (select distinct btrim(line) line from jsonb_array_elements(entry.entries) e
     cross join lateral regexp_split_to_table(coalesce(e->>selected,''),E'\n') line where btrim(line)<>'') notes));
end loop;
insert into public.team_player_game_reports(team_id,season,locker_id,schedule_game_id,game_date,opponent_name,position_played,ai_review_id,stats,visibility,created_by)
select r.team_id,l.season,l.id,r.schedule_game_id,r.game_date,r.opponent_label,p->>'position',r.id,'{}'::jsonb,'management',auth.uid()
on conflict (ai_review_id,locker_id) where ai_review_id is not null do nothing;
update public.team_player_game_reports g set
strengths=coalesce(nullif(p->>'strengths',''),g.strengths),improvements=coalesce(nullif(p->>'concerns',''),g.improvements),
tactical_notes=coalesce(nullif(p->>'habits',''),g.tactical_notes),coach_summary=coalesce(nullif(p->>'coach_note',''),g.coach_summary),
visibility='player',position_played=coalesce(nullif(p->>'position',''),g.position_played),updated_at=now(),
evidence=(case when jsonb_typeof(g.evidence)='object' then g.evidence else jsonb_build_object('legacy_evidence',g.evidence) end)||jsonb_build_object(
'source_names',p->'source_names','lg_user_id',l.lg_user_id,'verification','approved','approved_by',auth.uid(),'rating',p->'rating',
'evidence_timestamps',coalesce(p->'evidence_timestamps','[]'::jsonb),'approved_at',now(),
'source_vod_url',r.vod_url,'timestamp_basis','full_vod','source_start_seconds',r.source_start_seconds,
'source_end_seconds',r.source_end_seconds,'approved_periods',report->'approved_periods',
'unit_reports',coalesce((select jsonb_agg(distinct u) from jsonb_array_elements(report->'units') u
where exists(select 1 from jsonb_array_elements_text(u->'players') member
where exists(select 1 from jsonb_array_elements_text(p->'source_names') name where lower(btrim(member))=lower(btrim(name))))),'[]'::jsonb))
where g.ai_review_id=r.id and g.team_id=r.team_id and g.locker_id=l.id;
get diagnostics n=row_count;routed:=routed+n;
end loop;
-- A corrected mapping withdraws obsolete VOD routing without deleting its audit evidence.
update public.team_player_game_reports g set visibility='management',updated_at=now()
where g.ai_review_id=r.id and g.team_id=r.team_id and not exists(select 1 from jsonb_array_elements(resolved) e where e->>'locker_id'=g.locker_id::text);
return jsonb_build_object('review_id',r.id,'player_reports',routed,'unmatched_players',unmatched);
end $function$;
