-- Management fixture checks. All data changes and test history are rolled back.
begin;
select set_config('test.vod_review','aac7edaf-5ad5-4388-95a6-3b679fb0e3ea',true);
select set_config('request.jwt.claim.sub','9c6f974d-ed28-4471-951f-a38ebc733895',true);
set local role authenticated;
do $$
declare r public.vod_review_sessions; s public.vod_review_segments; before_period jsonb;
  before_doc jsonb; before_result jsonb; result jsonb; custom_id uuid; n integer; marker_id uuid;
begin
  select * into r from public.vod_review_sessions where id=current_setting('test.vod_review')::uuid;
  if r.id is null or r.review_document is null then raise exception 'Reviewed fixture unavailable'; end if;
  before_doc:=r.review_document;before_result:=r.worker_result;
  select to_jsonb(x) into before_period from public.vod_review_segments x where review_id=r.id and segment_type='period' and segment_index=1;
  perform public.stage_vod_worker_result(r.id,'{"game_rollup":{"summary":"Synthetic rerun draft"}}'::jsonb,r.worker_job_id);
  result:=public.import_vod_worker_draft(r.id,r.worker_job_id,'{"game_rollup":{"summary":"Synthetic rerun draft"}}'::jsonb);
  if result->>'reviewed_evidence_preserved' is distinct from 'true' then raise exception 'Reviewed result was not protected'; end if;
  if exists(select 1 from public.vod_review_sessions where id=r.id and (review_document is distinct from before_doc or worker_result is distinct from before_result)) then raise exception 'Rerun overwrote reviewed evidence'; end if;
  if not exists(select 1 from public.vod_game_publications where review_id=r.id and active) then raise exception 'Staging a draft invalidated publication'; end if;
  begin
    perform public.stage_vod_worker_result(r.id,'{}'::jsonb,'obsolete-job');
    raise exception 'TEST: Obsolete job accepted';
  exception when raise_exception then if sqlerrm not like 'Worker job changed%' then raise; end if; end;

  insert into public.vod_review_segments(review_id,team_id,segment_type,segment_index,label,start_seconds,end_seconds,status,analysis_summary,analyzed_by)
    select r.id,r.team_id,'custom',coalesce(max(segment_index),0)+1,'Synthetic archived correction',1801,1810,'complete','Keep historical reviewed evidence',auth.uid()
    from public.vod_review_segments where review_id=r.id and segment_type='custom' returning id into custom_id;
  insert into public.vod_review_markers(review_id,segment_id,team_id,timestamp_seconds,category,note,created_by)
    values(r.id,custom_id,r.team_id,1805,'general','Keep historical timestamp',auth.uid()) returning id into marker_id;
  select * into s from public.vod_review_segments where id=custom_id;
  before_period:=to_jsonb(s);
  perform public.set_vod_segment_archive(s.id,s.updated_at,true);
  select * into s from public.vod_review_segments where id=custom_id;
  if s.archived_at is null or s.archived_by is distinct from auth.uid() then raise exception 'Archive missing manager metadata'; end if;
  if (to_jsonb(s)-'archived_at'-'archived_by'-'updated_at') is distinct from (before_period-'archived_at'-'archived_by'-'updated_at') then raise exception 'Archive changed reviewed evidence'; end if;
  if not exists(select 1 from public.vod_review_markers where id=marker_id) then raise exception 'Archive deleted timestamps'; end if;
  if not exists(select 1 from public.vod_evidence_history where segment_id=s.id and snapshot=before_period) then raise exception 'Archive missing history snapshot'; end if;
  -- Archived custom data cannot leak into approved sources; repeat publish cannot duplicate player reports.
  select * into r from public.vod_review_sessions where id=r.id;
  result:=public.publish_vod_review(r.id,r.updated_at,before_doc);
  if jsonb_array_length(result->'unmatched_players')<>0 or (result->>'player_reports')::integer<>jsonb_array_length(before_doc->'players') then raise exception 'Exact player routing failed: %',result; end if;
  if exists(select 1 from public.vod_game_publications v,jsonb_array_elements(v.report->'approved_periods') p where v.review_id=r.id and p->>'id'=custom_id::text) then raise exception 'Archived source leaked into publication'; end if;
  select count(*) into n from public.team_player_game_reports where ai_review_id=r.id;
  select * into r from public.vod_review_sessions where id=r.id;
  perform public.publish_vod_review(r.id,r.updated_at,before_doc);
  if (select count(*) from public.team_player_game_reports where ai_review_id=r.id)<>n then raise exception 'Refresh duplicated player reports'; end if;
  if exists(select 1 from public.team_player_game_reports where ai_review_id=r.id and (evidence->>'timestamp_basis' is distinct from 'full_vod' or evidence->>'source_vod_url' is distinct from r.vod_url)) then raise exception 'Player timestamp provenance missing'; end if;
  if not exists(select 1 from public.vod_evidence_history where review_id=r.id and kind='publication_before_update') then raise exception 'Publication history missing'; end if;

  select * into s from public.vod_review_segments where id=custom_id;
  perform public.set_vod_segment_archive(s.id,s.updated_at,false);
  select * into s from public.vod_review_segments where id=custom_id;
  if s.archived_at is not null or s.analysis_summary<>'Keep historical reviewed evidence' or s.status<>'complete' then raise exception 'Restore changed reviewed evidence'; end if;
  select * into s from public.vod_review_segments where review_id=r.id and segment_type='period' and segment_index=2;
  before_period:=to_jsonb(s);
  perform public.reopen_vod_segment(s.id,s.updated_at);
  select * into s from public.vod_review_segments where id=s.id;
  if s.status<>'needs_review' or (to_jsonb(s)-'status'-'updated_at') is distinct from (before_period-'status'-'updated_at') then raise exception 'Reopen destroyed evidence or reviewer metadata'; end if;
  if exists(select 1 from public.vod_game_publications where review_id=r.id and active) then raise exception 'Reopen left old publication active'; end if;
  select * into r from public.vod_review_sessions where id=r.id;
  begin
    perform public.publish_vod_review(r.id,r.updated_at,before_doc);
    raise exception 'TEST: Unapproved period published';
  exception when raise_exception then if sqlerrm not like 'Every period%' then raise; end if; end;
  begin
    perform public.set_vod_segment_archive(s.id,'2000-01-01'::timestamptz,true);
    raise exception 'TEST: Stale archive accepted';
  exception when raise_exception then if sqlerrm not like 'Period changed%' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
  begin
    perform public.publish_vod_review(current_setting('test.vod_review')::uuid,now(),'{}'::jsonb);
    raise exception 'Anonymous publication allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_vod_segment_archive(gen_random_uuid(),now(),true);
    raise exception 'Anonymous archive allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: draft protection, obsolete jobs, archive/restore, history, exact player routing, repeat publication, provenance, approval and anonymous access' as result;
