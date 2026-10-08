-- VOD pipeline reliability fixes (2026-10-08).
-- 1. Filing/archiving a review, custom clips and no-op edits no longer unpublish a game.
-- 2. Only APPROVED periods (or a live publication) protect evidence from a new import.
-- 3. Re-entering period times works: one active row per period, archived rows kept as history.
-- 4. Period rows always get a fresh updated_at, cannot be approved without a summary,
--    and approved evidence cannot be overwritten without reopening first.
-- 5. Publishing keeps existing player text and matches players in the current season.

alter table public.vod_review_sessions add column if not exists skip_ranges jsonb not null default '[]'::jsonb;

-- (1)
create or replace function public.invalidate_vod_publication()
returns trigger language plpgsql set search_path to '' as $function$
declare target uuid;
begin
  if tg_table_name='vod_review_sessions' then
    target:=new.id;
    if (new.worker_result,new.review_document,new.full_game_summary,new.tactical_report,new.player_report,
        new.source_start_seconds,new.source_end_seconds,new.vod_url)
       is not distinct from
       (old.worker_result,old.review_document,old.full_game_summary,old.tactical_report,old.player_report,
        old.source_start_seconds,old.source_end_seconds,old.vod_url) then return new; end if;
  else
    if coalesce(new.segment_type,old.segment_type) not in ('period','overtime') then return coalesce(new,old); end if;
    if tg_op='UPDATE' and (to_jsonb(new)-'updated_at') = (to_jsonb(old)-'updated_at') then return new; end if;
    target:=coalesce(new.review_id,old.review_id);
  end if;
  update public.vod_game_publications set active=false where review_id=target and active;
  update public.team_player_game_reports set visibility='management',
    evidence=jsonb_set(coalesce(evidence,'{}'::jsonb),'{verification}','"needs_review"'::jsonb)
    where ai_review_id=target and evidence->>'verification'='approved';
  return coalesce(new,old);
end $function$;

-- (2)
create or replace function public.import_vod_worker_draft(target_review uuid, worker_job text, worker_result jsonb)
returns jsonb language plpgsql set search_path to '' as $function$
declare r public.vod_review_sessions; rollup jsonb;
begin
  perform public.stage_vod_worker_result(target_review,worker_result,worker_job);
  select * into r from public.vod_review_sessions where id=target_review for update;
  perform 1 from public.vod_review_segments where review_id=r.id for update;
  if exists(select 1 from public.vod_review_segments where review_id=r.id and archived_at is null and status='complete')
     or exists(select 1 from public.vod_game_publications where review_id=r.id and active) then
    return jsonb_build_object('review_id',r.id,'staged',true,'reviewed_evidence_preserved',true);
  end if;
  rollup:=coalesce(worker_result->'game_rollup','{}'::jsonb);
  -- Nothing is approved yet, so an older draft report must not outrank the new evidence.
  update public.vod_review_sessions set worker_result=import_vod_worker_draft.worker_result,pending_worker_result=null,review_document=null,
    full_game_summary=coalesce(nullif(rollup->>'summary',''),full_game_summary),
    recurring_patterns=coalesce(nullif(rollup->>'patterns',''),recurring_patterns),
    strengths=coalesce(nullif(rollup->>'strengths',''),strengths),
    corrections=coalesce(nullif(rollup->>'corrections',''),corrections),
    tactical_report=coalesce(nullif(rollup->>'tactical_report',''),tactical_report),
    player_report=coalesce(nullif(rollup->>'player_report',''),player_report),
    professional_writeup=coalesce(nullif(rollup->>'professional_writeup',''),professional_writeup),
    status='reviewing',worker_status='ready_for_review',updated_at=now()
    where id=r.id;
  return jsonb_build_object('review_id',r.id,'imported',true);
end $function$;

create or replace function public.reopen_vod_segment(target_segment uuid, expected_updated_at timestamp with time zone)
returns jsonb language plpgsql set search_path to '' as $function$
declare s public.vod_review_segments;
begin
  select * into s from public.vod_review_segments where id=target_segment for update;
  if s.id is null or auth.uid() is null or not private.vvhl_can_manage_team(auth.uid(),s.team_id) then
    raise exception 'Management access is required' using errcode='42501'; end if;
  if s.updated_at is distinct from expected_updated_at then raise exception 'Period changed elsewhere. Refresh first.'; end if;
  if s.archived_at is not null then raise exception 'Restore this period before reopening it.'; end if;
  update public.vod_review_segments set status='needs_review',analyzed_by=null,updated_at=now() where id=s.id;
  return jsonb_build_object('id',s.id,'status','needs_review');
end $function$;

-- (3) Archived rows are history; only active rows must be unique.
alter table public.vod_review_segments drop constraint if exists vod_review_segments_unique;
create unique index if not exists vod_review_segments_active_unique
  on public.vod_review_segments(review_id,segment_type,segment_index) where archived_at is null;

create or replace function public.set_vod_period_windows(target_review uuid, expected_updated_at timestamp with time zone,
  window_start integer, window_end integer, periods jsonb, skip_ranges jsonb default '[]'::jsonb)
returns jsonb language plpgsql set search_path to '' as $function$
declare r public.vod_review_sessions; blocked text; bad text; kept integer; added integer; removed integer; ots integer;
begin
  select * into r from public.vod_review_sessions where id=target_review for update;
  if r.id is null or auth.uid() is null or not private.vvhl_can_manage_team(auth.uid(),r.team_id) then
    raise exception 'Management access is required' using errcode='42501'; end if;
  if expected_updated_at is not null and r.updated_at is distinct from expected_updated_at then
    raise exception 'Game changed elsewhere. Refresh first.'; end if;
  if window_start is null or window_end is null or window_start<0 or window_end<=window_start then
    raise exception 'Enter a valid game start and game end.'; end if;
  if jsonb_typeof(periods) is distinct from 'array' or jsonb_typeof(coalesce(skip_ranges,'[]'::jsonb)) is distinct from 'array' then
    raise exception 'Invalid period list.'; end if;
  create temporary table if not exists pg_temp.vod_defs(segment_type text, segment_index integer, label text, start_seconds integer, end_seconds integer) on commit drop;
  delete from pg_temp.vod_defs;
  insert into pg_temp.vod_defs select d.segment_type,d.segment_index,d.label,d.start_seconds,d.end_seconds
    from jsonb_to_recordset(periods) as d(segment_type text, segment_index integer, label text, start_seconds integer, end_seconds integer);
  if exists(select 1 from pg_temp.vod_defs where segment_type not in ('period','overtime') or segment_index is null or segment_index<1
            or coalesce(btrim(label),'')='' or start_seconds is null or end_seconds is null or end_seconds<=start_seconds
            or start_seconds<window_start or end_seconds>window_end) then
    raise exception 'Every period needs a start before its end, inside the game window.'; end if;
  if (select count(distinct segment_index) from pg_temp.vod_defs where segment_type='period' and segment_index between 1 and 3)<>3 then
    raise exception 'Enter the start of Period 1, Period 2 and Period 3.'; end if;
  if exists(select 1 from pg_temp.vod_defs group by segment_type,segment_index having count(*)>1)
     or exists(select 1 from pg_temp.vod_defs a join pg_temp.vod_defs b on (a.segment_type,a.segment_index)<>(b.segment_type,b.segment_index)
               and a.start_seconds<b.end_seconds and b.start_seconds<a.end_seconds) then
    raise exception 'Periods overlap or repeat.'; end if;
  select string_agg(x,', ') into bad from (select 'skip '||coalesce(e->>'start','?')||'-'||coalesce(e->>'end','?') x
    from jsonb_array_elements(coalesce(skip_ranges,'[]'::jsonb)) e
    where jsonb_typeof(e->'start')<>'number' or jsonb_typeof(e->'end')<>'number'
       or (e->>'end')::numeric<=(e->>'start')::numeric or (e->>'start')::numeric<window_start or (e->>'end')::numeric>window_end) q;
  if bad is not null then raise exception 'Invalid skipped section: %', bad; end if;
  select string_agg(s.label,', ' order by s.start_seconds) into blocked from public.vod_review_segments s
    where s.review_id=r.id and s.archived_at is null and s.segment_type in ('period','overtime') and s.status='complete'
      and not exists(select 1 from pg_temp.vod_defs d where (d.segment_type,d.segment_index,d.start_seconds,d.end_seconds)=(s.segment_type,s.segment_index,s.start_seconds,s.end_seconds));
  if blocked is not null then
    raise exception 'Reopen % before changing their times. Approved periods are protected.', blocked; end if;
  update public.vod_review_segments s set archived_at=now(),archived_by=auth.uid(),updated_at=now()
    where s.review_id=r.id and s.archived_at is null and s.segment_type in ('period','overtime')
      and not exists(select 1 from pg_temp.vod_defs d where (d.segment_type,d.segment_index,d.start_seconds,d.end_seconds)=(s.segment_type,s.segment_index,s.start_seconds,s.end_seconds));
  get diagnostics removed=row_count;
  update public.vod_review_segments s set label=d.label,updated_at=now() from pg_temp.vod_defs d
    where s.review_id=r.id and s.archived_at is null and (d.segment_type,d.segment_index,d.start_seconds,d.end_seconds)=(s.segment_type,s.segment_index,s.start_seconds,s.end_seconds)
      and s.label is distinct from d.label;
  insert into public.vod_review_segments(review_id,team_id,segment_type,segment_index,label,start_seconds,end_seconds,status,confidence)
    select r.id,r.team_id,d.segment_type,d.segment_index,d.label,d.start_seconds,d.end_seconds,'queued','preliminary' from pg_temp.vod_defs d
    where not exists(select 1 from public.vod_review_segments s where s.review_id=r.id and s.archived_at is null
      and (d.segment_type,d.segment_index,d.start_seconds,d.end_seconds)=(s.segment_type,s.segment_index,s.start_seconds,s.end_seconds));
  get diagnostics added=row_count;
  select count(*) into kept from pg_temp.vod_defs; kept:=kept-added;
  select count(*) into ots from pg_temp.vod_defs where segment_type='overtime';
  update public.vod_review_sessions set source_start_seconds=window_start,source_end_seconds=window_end,
    duration_seconds=window_end-window_start,skip_ranges=coalesce(set_vod_period_windows.skip_ranges,'[]'::jsonb),
    overtime_count=ots,status=case when status in ('complete','archived') then status else 'reviewing' end,updated_at=now()
    where id=r.id;
  return jsonb_build_object('review_id',r.id,'kept',kept,'added',added,'archived',removed);
end $function$;

-- (4)
create or replace function public.guard_vod_period()
returns trigger language plpgsql set search_path to '' as $function$
begin
  new.updated_at:=now();
  if new.archived_at is null and new.status='complete' and coalesce(btrim(new.analysis_summary),'')='' then
    raise exception '% needs a summary before it can be approved.', new.label; end if;
  if old.status='complete' and new.status='complete' and old.archived_at is null and new.archived_at is null
     and (new.analysis_summary,new.offense_notes,new.defense_notes,new.transition_notes,new.forecheck_notes,new.breakout_notes,
          new.special_teams_notes,new.player_notes,new.start_seconds,new.end_seconds)
         is distinct from
         (old.analysis_summary,old.offense_notes,old.defense_notes,old.transition_notes,old.forecheck_notes,old.breakout_notes,
          old.special_teams_notes,old.player_notes,old.start_seconds,old.end_seconds) then
    raise exception '% is approved. Reopen it before changing it.', new.label; end if;
  return new;
end $function$;
drop trigger if exists guard_vod_period on public.vod_review_segments;
create trigger guard_vod_period before update on public.vod_review_segments for each row execute function public.guard_vod_period();

-- (5)
create or replace function public.publish_vod_review(target_review uuid, expected_updated_at timestamp with time zone, report jsonb)
returns jsonb language plpgsql set search_path to '' as $function$
declare r public.vod_review_sessions; p jsonb; n integer; routed integer:=0; l public.team_player_lockers; matches integer; unmatched jsonb:='[]'::jsonb; latest integer;
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
  update public.vod_review_sessions set review_document=report,
    full_game_summary=coalesce(nullif(report->>'summary',''),full_game_summary),
    tactical_report=coalesce(nullif(report->>'tactical_report',''),tactical_report),
    player_report=coalesce(nullif(report->>'player_report',''),player_report),status='complete',updated_at=now() where id=r.id;
  insert into public.vod_game_publications(review_id,team_id,report,published_by)
    values(r.id,r.team_id,report,auth.uid())
    on conflict(review_id) do update set report=excluded.report,active=true,
      published_by=excluded.published_by,published_at=now();
  select max(season) into latest from public.team_player_lockers where team_id=r.team_id;
  for p in select value from jsonb_array_elements(report->'players') loop
    select count(*) into matches from public.team_player_lockers where team_id=r.team_id
      and lower(btrim(gamertag))=lower(btrim(p->>'player'));
    if matches>1 then
      select count(*) into matches from public.team_player_lockers where team_id=r.team_id and season=latest
        and lower(btrim(gamertag))=lower(btrim(p->>'player'));
    end if;
    if matches<>1 then unmatched:=unmatched||jsonb_build_array(p->>'player'); continue; end if;
    select * into l from public.team_player_lockers where team_id=r.team_id
      and lower(btrim(gamertag))=lower(btrim(p->>'player')) order by season desc limit 1;
    insert into public.team_player_game_reports(team_id,season,locker_id,schedule_game_id,game_date,opponent_name,position_played,ai_review_id,stats,visibility,created_by)
      select r.team_id,l.season,l.id,r.schedule_game_id,r.game_date,r.opponent_label,p->>'position',r.id,'{}'::jsonb,'management',auth.uid()
      where not exists(select 1 from public.team_player_game_reports where ai_review_id=r.id and locker_id=l.id and team_id=r.team_id);
    update public.team_player_game_reports g set
      strengths=coalesce(nullif(p->>'strengths',''),g.strengths),improvements=coalesce(nullif(p->>'concerns',''),g.improvements),
      tactical_notes=coalesce(nullif(p->>'habits',''),g.tactical_notes),coach_summary=coalesce(nullif(p->>'coach_note',''),g.coach_summary),
      visibility='player',position_played=coalesce(nullif(p->>'position',''),g.position_played),updated_at=now(),
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
end $function$;

-- Deleting a game that was once published no longer fails on the publication row.
alter table public.vod_game_publications drop constraint if exists vod_game_publications_review_id_fkey;
alter table public.vod_game_publications add constraint vod_game_publications_review_id_fkey
  foreign key (review_id) references public.vod_review_sessions(id) on delete cascade;
