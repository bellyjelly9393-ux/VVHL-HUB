-- Additive approval workflow. Existing AI drafts, statistics and originals remain intact.
alter table public.vod_review_segments
  add column if not exists confidence text not null default 'preliminary',
  add column if not exists forecheck_notes text,
  add column if not exists breakout_notes text;
alter table public.vod_review_segments drop constraint vod_review_segments_status_check;
alter table public.vod_review_segments add constraint vod_review_segments_status_check
  check (status in ('queued','reviewing','needs_review','rejected','complete'));
alter table public.vod_review_sessions add column if not exists review_document jsonb;
create table public.vod_game_publications (
  review_id uuid primary key references public.vod_review_sessions(id),
  team_id uuid not null references public.teams(id),
  report jsonb not null,
  active boolean not null default true,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now()
);
alter table public.vod_game_publications enable row level security;
revoke all on public.vod_game_publications from anon, authenticated;
grant select,insert,update on public.vod_game_publications to authenticated;
create policy vod_publications_management on public.vod_game_publications
  for all to authenticated
  using (private.vvhl_can_manage_team(auth.uid(),team_id))
  with check (private.vvhl_can_manage_team(auth.uid(),team_id));

create function public.validate_vod_publication() returns trigger
language plpgsql security invoker set search_path='' as $$
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
      where review_id=r.id and segment_type='period' and segment_index between 1 and 3)<>3 then
    raise exception 'Confirm Period 1, Period 2 and Period 3 before publishing';
  end if;
  if exists(select 1 from public.vod_review_segments where review_id=r.id
    and segment_type in ('period','overtime') and
    (status<>'complete' or nullif(btrim(analysis_summary),'') is null
     or end_seconds is null or end_seconds<=start_seconds
     or start_seconds<r.source_start_seconds or end_seconds>stop_at)) then
    raise exception 'Every period must be approved and inside the game window';
  end if;
  if exists(select 1 from public.vod_review_segments a join public.vod_review_segments b
    on a.review_id=b.review_id and a.id<>b.id and a.start_seconds<b.end_seconds and b.start_seconds<a.end_seconds
    where a.review_id=r.id and a.segment_type in ('period','overtime') and b.segment_type in ('period','overtime')) then
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
end $$;
revoke all on function public.validate_vod_publication() from public,anon,authenticated;
create trigger validate_vod_publication before insert or update on public.vod_game_publications
  for each row execute function public.validate_vod_publication();

create function public.invalidate_vod_publication() returns trigger
language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
  if tg_table_name='vod_review_sessions' then
    target:=new.id;
    if (new.worker_result,new.review_document,new.full_game_summary,new.tactical_report,new.player_report,
        new.source_start_seconds,new.source_end_seconds,new.vod_url,new.status)
       is not distinct from
       (old.worker_result,old.review_document,old.full_game_summary,old.tactical_report,old.player_report,
        old.source_start_seconds,old.source_end_seconds,old.vod_url,old.status) then return new; end if;
  else
    target:=coalesce(new.review_id,old.review_id);
  end if;
  update public.vod_game_publications set active=false where review_id=target and active;
  update public.team_player_game_reports set visibility='management',
    evidence=jsonb_set(coalesce(evidence,'{}'::jsonb),'{verification}','"needs_review"'::jsonb)
    where ai_review_id=target and evidence->>'verification'='approved';
  return coalesce(new,old);
end $$;
revoke all on function public.invalidate_vod_publication() from public,anon,authenticated;
create trigger invalidate_vod_report after update on public.vod_review_sessions
  for each row execute function public.invalidate_vod_publication();
create trigger invalidate_vod_period after insert or update or delete on public.vod_review_segments
  for each row execute function public.invalidate_vod_publication();

create function public.publish_vod_review(target_review uuid,expected_updated_at timestamptz,report jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.vod_review_sessions; p jsonb; n integer; routed integer:=0;
begin
  select * into r from public.vod_review_sessions where id=target_review for update;
  if r.id is null or auth.uid() is null or not private.vvhl_can_manage_team(auth.uid(),r.team_id) then
    raise exception 'Management access to this team is required' using errcode='42501';
  end if;
  if r.updated_at is distinct from expected_updated_at then raise exception 'Review changed elsewhere. Refresh before publishing.'; end if;
  -- Save the exact reviewed wording. The publication trigger validates periods atomically.
  update public.vod_review_sessions set review_document=report,
    full_game_summary=report->>'summary',tactical_report=report->>'tactical_report',
    player_report=report->>'player_report',status='complete',updated_at=now() where id=r.id;
  insert into public.vod_game_publications(review_id,team_id,report,published_by)
    values(r.id,r.team_id,report,auth.uid())
    on conflict(review_id) do update set report=excluded.report,active=true,
      published_by=excluded.published_by,published_at=now();
  for p in select value from jsonb_array_elements(report->'players') loop
    -- Reuse existing unambiguous AI-to-locker routing; never infer identity from a partial name.
    update public.team_player_game_reports g set
      strengths=p->>'strengths',improvements=p->>'concerns',tactical_notes=p->>'habits',
      coach_summary=p->>'coach_note',visibility='player',updated_at=now(),
      evidence=coalesce(g.evidence,'{}'::jsonb)||jsonb_build_object(
        'verification','approved','approved_by',auth.uid(),'rating',p->'rating',
        'evidence_timestamps',p->'evidence_timestamps','approved_at',now(),
        'unit_reports',coalesce((select jsonb_agg(u) from jsonb_array_elements(report->'units') u
          where exists(select 1 from jsonb_array_elements_text(u->'players') member
            where lower(btrim(member))=lower(btrim(p->>'player')))),'[]'::jsonb))
    from public.team_player_lockers l
    where g.ai_review_id=r.id and g.team_id=r.team_id and g.locker_id=l.id
      and lower(btrim(l.gamertag))=lower(btrim(p->>'player'));
    get diagnostics n=row_count;routed:=routed+n;
  end loop;
  return jsonb_build_object('review_id',r.id,'player_reports',routed);
end $$;
revoke all on function public.publish_vod_review(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.publish_vod_review(uuid,timestamptz,jsonb) to authenticated;
