-- Run after the setup SQL. Every fixture/update is rolled back.
begin;
select set_config('test.vod_review',(select id::text from public.vod_review_sessions
  where title='LG Hitmen · Game 2' and source_start_seconds=1800 limit 1),true);
select set_config('request.jwt.claim.sub',(select created_by::text from public.vod_review_sessions
  where id=current_setting('test.vod_review')::uuid),true);
set local role authenticated;
do $$
declare r public.vod_review_sessions; doc jsonb; result jsonb;
begin
  select * into r from public.vod_review_sessions where id=current_setting('test.vod_review')::uuid;
  if r.id is null then raise exception 'Test fixture review is unavailable'; end if;
  doc:=jsonb_build_object('version',1,'summary','Synthetic approval test',
    'team_systems','{}'::jsonb,'units','[]'::jsonb,'players','[]'::jsonb);
  -- Legacy out-of-window P3 must fail, even if all statuses say complete.
  update public.vod_review_segments set status='complete',analysis_summary='Test evidence',
    end_seconds=r.source_end_seconds+60 where review_id=r.id and segment_type='period' and segment_index=3;
  begin
    perform public.publish_vod_review(r.id,r.updated_at,doc);
    raise exception 'TEST: Out-of-window publication was allowed';
  exception when raise_exception then
    if sqlerrm like 'TEST:%' then raise; end if;
    if sqlerrm not like 'Every period%' then raise; end if;
  end;
  update public.vod_review_segments set end_seconds=r.source_end_seconds where review_id=r.id and segment_type='period' and segment_index=3;
  update public.vod_review_segments set status='complete',analysis_summary='Test evidence' where review_id=r.id and segment_type in ('period','overtime');
  result:=public.publish_vod_review(r.id,r.updated_at,doc);
  if not exists(select 1 from public.vod_game_publications where review_id=r.id and active) then
    raise exception 'Valid approved report did not publish'; end if;
  -- Publication is an upsert, not a duplicate history entry.
  select * into r from public.vod_review_sessions where id=r.id;
  perform public.publish_vod_review(r.id,r.updated_at,doc);
  if (select count(*) from public.vod_game_publications where review_id=r.id)<>1 then
    raise exception 'Repeated publication duplicated history'; end if;
  update public.vod_review_segments set analysis_summary='Changed evidence',status='needs_review'
    where review_id=r.id and segment_type='period' and segment_index=2;
  if exists(select 1 from public.vod_game_publications where review_id=r.id and active) then
    raise exception 'Edited evidence did not invalidate approval'; end if;
  begin
    perform public.publish_vod_review(r.id,r.updated_at,doc);
    raise exception 'TEST: Unapproved period was published';
  exception when raise_exception then
    if sqlerrm like 'TEST:%' then raise; end if;
    if sqlerrm not like 'Every period%' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
  begin
    perform public.publish_vod_review(current_setting('test.vod_review')::uuid,now(),'{}'::jsonb);
    raise exception 'Anonymous publication was allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
