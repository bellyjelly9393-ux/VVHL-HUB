-- Preserve reviewed evidence and historical publications while allowing new drafts.
alter table public.vod_review_segments
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id);
alter table public.vod_review_sessions add column if not exists pending_worker_result jsonb;

create table if not exists public.vod_evidence_history (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  review_id uuid not null,
  segment_id uuid,
  kind text not null,
  snapshot jsonb not null,
  recorded_by uuid,
  recorded_at timestamptz not null default now()
);
alter table public.vod_evidence_history enable row level security;
revoke all on public.vod_evidence_history from anon,authenticated;
grant select,insert on public.vod_evidence_history to authenticated;
create policy vod_history_read on public.vod_evidence_history for select to authenticated
  using (private.vvhl_can_manage_team(auth.uid(),team_id));
create policy vod_history_append on public.vod_evidence_history for insert to authenticated
  with check (recorded_by=auth.uid() and private.vvhl_can_manage_team(auth.uid(),team_id));
create index if not exists vod_history_review_time on public.vod_evidence_history(review_id,recorded_at desc);

create or replace function public.preserve_vod_evidence_history() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and (to_jsonb(new)-'updated_at'-'worker_updated_at'-'worker_status'-'worker_job_id'-'pending_worker_result')
      is not distinct from (to_jsonb(old)-'updated_at'-'worker_updated_at'-'worker_status'-'worker_job_id'-'pending_worker_result') then return new; end if;
  if tg_table_name='vod_review_segments' then
    insert into public.vod_evidence_history(team_id,review_id,segment_id,kind,snapshot,recorded_by)
      values(old.team_id,old.review_id,old.id,'period_before_'||lower(tg_op),to_jsonb(old),auth.uid());
  elsif tg_table_name='vod_game_publications' then
    insert into public.vod_evidence_history(team_id,review_id,kind,snapshot,recorded_by)
      values(old.team_id,old.review_id,'publication_before_'||lower(tg_op),to_jsonb(old),auth.uid());
  elsif old.review_document is not null then
    insert into public.vod_evidence_history(team_id,review_id,kind,snapshot,recorded_by)
      values(old.team_id,old.id,'review_before_'||lower(tg_op),to_jsonb(old),auth.uid());
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.preserve_vod_evidence_history() from public,anon,authenticated;
create trigger preserve_vod_period before update or delete on public.vod_review_segments
  for each row execute function public.preserve_vod_evidence_history();
create trigger preserve_vod_publication before update or delete on public.vod_game_publications
  for each row execute function public.preserve_vod_evidence_history();
create trigger preserve_vod_review before update or delete on public.vod_review_sessions
  for each row execute function public.preserve_vod_evidence_history();

create or replace function public.set_vod_segment_archive(target_segment uuid,expected_updated_at timestamptz,archive_segment boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.vod_review_segments;
begin
  select * into s from public.vod_review_segments where id=target_segment for update;
  if s.id is null or auth.uid() is null or not private.vvhl_can_manage_team(auth.uid(),s.team_id) then
    raise exception 'Management access is required' using errcode='42501'; end if;
  if s.updated_at is distinct from expected_updated_at then raise exception 'Period changed elsewhere. Refresh first.'; end if;
  update public.vod_review_segments set archived_at=case when archive_segment then now() else null end,
    archived_by=case when archive_segment then auth.uid() else null end,updated_at=now() where id=s.id;
  return jsonb_build_object('id',s.id,'archived',archive_segment);
end $$;
revoke all on function public.set_vod_segment_archive(uuid,timestamptz,boolean) from public,anon;
grant execute on function public.set_vod_segment_archive(uuid,timestamptz,boolean) to authenticated;

create or replace function public.reopen_vod_segment(target_segment uuid,expected_updated_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.vod_review_segments;
begin
  select * into s from public.vod_review_segments where id=target_segment for update;
  if s.id is null or auth.uid() is null or not private.vvhl_can_manage_team(auth.uid(),s.team_id) then
    raise exception 'Management access is required' using errcode='42501'; end if;
  if s.updated_at is distinct from expected_updated_at then raise exception 'Period changed elsewhere. Refresh first.'; end if;
  if s.archived_at is not null then raise exception 'Restore this period before reopening it.'; end if;
  update public.vod_review_segments set status='needs_review',updated_at=now() where id=s.id;
  return jsonb_build_object('id',s.id,'status','needs_review');
end $$;
revoke all on function public.reopen_vod_segment(uuid,timestamptz) from public,anon;
grant execute on function public.reopen_vod_segment(uuid,timestamptz) to authenticated;

create or replace function public.stage_vod_worker_result(target_review uuid,worker_result jsonb,worker_job text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.vod_review_sessions;
begin
  select * into r from public.vod_review_sessions where id=target_review for update;
  if r.id is null or auth.uid() is null or not private.vvhl_can_manage_team(auth.uid(),r.team_id) then
    raise exception 'Management access is required' using errcode='42501'; end if;
  if r.worker_job_id is distinct from worker_job then raise exception 'Worker job changed. Refresh first.'; end if;
  if jsonb_typeof(worker_result) is distinct from 'object' then raise exception 'Invalid worker result'; end if;
  update public.vod_review_sessions set pending_worker_result=stage_vod_worker_result.worker_result,worker_updated_at=now() where id=r.id;
  return jsonb_build_object('review_id',r.id,'staged',true);
end $$;
revoke all on function public.stage_vod_worker_result(uuid,jsonb,text) from public,anon;
grant execute on function public.stage_vod_worker_result(uuid,jsonb,text) to authenticated;

create or replace function public.import_vod_worker_draft(target_review uuid,worker_job text,worker_result jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.vod_review_sessions; rollup jsonb;
begin
  perform public.stage_vod_worker_result(target_review,worker_result,worker_job);
  select * into r from public.vod_review_sessions where id=target_review for update;
  -- Lock period rows as well: a concurrent management approval must win over import.
  perform 1 from public.vod_review_segments where review_id=r.id for update;
  if r.review_document is not null or exists(select 1 from public.vod_review_segments
    where review_id=r.id and (status='complete' or analyzed_by is not null)) then
    return jsonb_build_object('review_id',r.id,'staged',true,'reviewed_evidence_preserved',true);
  end if;
  rollup:=coalesce(worker_result->'game_rollup','{}'::jsonb);
  update public.vod_review_sessions set worker_result=import_vod_worker_draft.worker_result,
    full_game_summary=coalesce(nullif(rollup->>'summary',''),full_game_summary),
    recurring_patterns=rollup->>'patterns',strengths=rollup->>'strengths',corrections=rollup->>'corrections',
    tactical_report=rollup->>'tactical_report',player_report=rollup->>'player_report',
    professional_writeup=rollup->>'professional_writeup',status='reviewing',worker_status='ready_for_review',updated_at=now()
    where id=r.id;
  return jsonb_build_object('review_id',r.id,'imported',true);
end $$;
revoke all on function public.import_vod_worker_draft(uuid,text,jsonb) from public,anon;
grant execute on function public.import_vod_worker_draft(uuid,text,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.validate_vod_publication()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.vod_review_sessions; stop_at integer;
begin
  if not new.active then return new; end if;
  select * into r from public.vod_review_sessions where id=new.review_id for update;
  if r.id is null or auth.uid() is null or r.team_id<>new.team_id
     or not private.vvhl_can_manage_team(auth.uid(),r.team_id) then
    raise exception 'Management access to this team is required' using errcode='42501';
  end if;
  stop_at:=coalesce(r.source_end_seconds,r.source_start_seconds+r.duration_seconds);
  if stop_at is null or stop_at<=r.source_start_seconds then raise exception 'A valid game window is required'; end if;
  if (select count(distinct segment_index) from public.vod_review_segments
      where review_id=r.id and archived_at is null and segment_type='period' and segment_index between 1 and 3)<>3 then
    raise exception 'Confirm Period 1, Period 2 and Period 3 before publishing';
  end if;
  if exists(select 1 from public.vod_review_segments where review_id=r.id and archived_at is null
    and segment_type in ('period','overtime') and
    (status<>'complete' or nullif(btrim(analysis_summary),'') is null
     or end_seconds is null or end_seconds<=start_seconds
     or start_seconds<r.source_start_seconds or end_seconds>stop_at)) then
    raise exception 'Every period must be approved and inside the game window';
  end if;
  if exists(select 1 from public.vod_review_segments a join public.vod_review_segments b
    on a.review_id=b.review_id and a.id<>b.id and a.start_seconds<b.end_seconds and b.start_seconds<a.end_seconds
    where a.review_id=r.id and a.archived_at is null and b.archived_at is null and a.segment_type in ('period','overtime') and b.segment_type in ('period','overtime')) then
    raise exception 'Period windows overlap';
  end if;
  if new.report->>'version' is distinct from '1'
     or jsonb_typeof(new.report->'team_systems') is distinct from 'object'
     or jsonb_typeof(new.report->'units') is distinct from 'array'
     or jsonb_typeof(new.report->'players') is distinct from 'array'
     or nullif(btrim(new.report->>'summary'),'') is null then
    raise exception 'A complete three-layer review document is required';
  end if;
  new.published_by:=auth.uid();new.published_at:=now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.publish_vod_review(target_review uuid, expected_updated_at timestamp with time zone, report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.vod_review_sessions; p jsonb; n integer; routed integer:=0; l public.team_player_lockers; matches integer; unmatched jsonb:='[]'::jsonb;
begin
  select * into r from public.vod_review_sessions where id=target_review for update;
  if r.id is null or auth.uid() is null or not private.vvhl_can_manage_team(auth.uid(),r.team_id) then
    raise exception 'Management access to this team is required' using errcode='42501';
  end if;
  if r.updated_at is distinct from expected_updated_at then raise exception 'Review changed elsewhere. Refresh before publishing.'; end if;
  report:=report||jsonb_build_object(
    'approved_periods',coalesce((select jsonb_agg(to_jsonb(s) order by s.start_seconds) from public.vod_review_segments s
      where s.review_id=r.id and s.archived_at is null and s.status='complete'),'[]'::jsonb),
    'approved_markers',coalesce((select jsonb_agg(to_jsonb(m) order by m.timestamp_seconds) from public.vod_review_markers m
      join public.vod_review_segments s on s.id=m.segment_id
      where s.review_id=r.id and s.archived_at is null and s.status='complete'),'[]'::jsonb));
  -- Save the exact reviewed wording. The publication trigger validates periods atomically.
  update public.vod_review_sessions set review_document=report,
    full_game_summary=report->>'summary',tactical_report=report->>'tactical_report',
    player_report=report->>'player_report',status='complete',updated_at=now() where id=r.id;
  insert into public.vod_game_publications(review_id,team_id,report,published_by)
    values(r.id,r.team_id,report,auth.uid())
    on conflict(review_id) do update set report=excluded.report,active=true,
      published_by=excluded.published_by,published_at=now();
  for p in select value from jsonb_array_elements(report->'players') loop
    select count(*) into matches from public.team_player_lockers where team_id=r.team_id
      and lower(btrim(gamertag))=lower(btrim(p->>'player'));
    if matches<>1 then unmatched:=unmatched||jsonb_build_array(p->>'player'); continue; end if;
    select * into l from public.team_player_lockers where team_id=r.team_id
      and lower(btrim(gamertag))=lower(btrim(p->>'player'));
    insert into public.team_player_game_reports(team_id,season,locker_id,schedule_game_id,game_date,opponent_name,position_played,ai_review_id,stats,visibility,created_by)
      select r.team_id,l.season,l.id,r.schedule_game_id,r.game_date,r.opponent_label,p->>'position',r.id,'{}'::jsonb,'management',auth.uid()
      where not exists(select 1 from public.team_player_game_reports where ai_review_id=r.id and locker_id=l.id and team_id=r.team_id);
    update public.team_player_game_reports g set
      strengths=p->>'strengths',improvements=p->>'concerns',tactical_notes=p->>'habits',
      coach_summary=p->>'coach_note',visibility='player',position_played=coalesce(nullif(p->>'position',''),g.position_played),updated_at=now(),
      evidence=(case when jsonb_typeof(g.evidence)='object' then g.evidence else jsonb_build_object('legacy_evidence',g.evidence) end)||jsonb_build_object(
        'verification','approved','approved_by',auth.uid(),'rating',p->'rating',
        'evidence_timestamps',coalesce(p->'evidence_timestamps','[]'::jsonb),'approved_at',now(),
        'source_vod_url',r.vod_url,'timestamp_basis','full_vod','source_start_seconds',r.source_start_seconds,
        'source_end_seconds',r.source_end_seconds,'approved_periods',report->'approved_periods',
        'unit_reports',coalesce((select jsonb_agg(u) from jsonb_array_elements(report->'units') u
          where exists(select 1 from jsonb_array_elements_text(u->'players') member
            where lower(btrim(member))=lower(btrim(p->>'player')))),'[]'::jsonb))
      where g.ai_review_id=r.id and g.team_id=r.team_id and g.locker_id=l.id;
    get diagnostics n=row_count;routed:=routed+n;
  end loop;
  return jsonb_build_object('review_id',r.id,'player_reports',routed,'unmatched_players',unmatched);
end $function$
;
