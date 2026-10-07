create unique index if not exists media_posts_media_key_unique
  on public.media_posts ((source_metrics->>'media_key'))
  where source_metrics ? 'media_key';

create or replace function private.hitmen_publish_final_media_wire()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team constant uuid := 'b0bcbdda-da9d-419d-8f61-b34937966d49'::uuid;
  v_result text; v_title text; v_body text; v_key text; v_record text;
  v_game_no integer; v_w integer; v_l integer; v_otl integer; v_existing uuid;
begin
  if new.team_id<>v_team or new.status<>'final' or new.calgary_score is null or new.opponent_score is null then return new; end if;
  v_result:=case when new.calgary_score>new.opponent_score then 'W'
                 when coalesce(new.overtime,false) then 'OTL' else 'L' end;

  select count(*) filter(where s.calgary_score>s.opponent_score),
         count(*) filter(where s.calgary_score<s.opponent_score and not coalesce(s.overtime,false)),
         count(*) filter(where s.calgary_score<s.opponent_score and coalesce(s.overtime,false)),
         count(*)
  into v_w,v_l,v_otl,v_game_no
  from public.hitmen_schedule_games s
  where s.team_id=v_team and s.season=new.season and s.status='final' and s.scheduled_at<=new.scheduled_at;

  v_record:=coalesce(v_w,0)::text||'-'||coalesce(v_l,0)::text||'-'||coalesce(v_otl,0)::text;
  v_key:='hitmen-'||new.id::text||'-final';

  if v_result='W' then
    v_title:='FINAL: Hitmen '||new.calgary_score::text||', '||new.opponent_name||' '||new.opponent_score::text;
    v_body:='Calgary closes out a '||new.calgary_score::text||'-'||new.opponent_score::text||' win over '||new.opponent_name||
      '. The final is live in the Hitmen Media Room and linked into player game history. Individual Public Log stats and VOD-backed notes will attach as those sources are verified.';
  elsif v_result='OTL' then
    v_title:='FINAL: '||new.opponent_name||' '||new.opponent_score::text||', Hitmen '||new.calgary_score::text||' (OT)';
    v_body:='Calgary earns a point in a '||new.opponent_score::text||'-'||new.calgary_score::text||' overtime loss to '||new.opponent_name||
      '. The result is live in the Hitmen Media Room and player game history while verified stats and VOD notes continue through the pipeline.';
  else
    v_title:='FINAL: '||new.opponent_name||' '||new.opponent_score::text||', Hitmen '||new.calgary_score::text;
    v_body:=new.opponent_name||' takes a '||new.opponent_score::text||'-'||new.calgary_score::text||
      ' final over Calgary. The result is live in the Hitmen Media Room and linked into player game history. Verified Public Log stats and VOD-backed notes will attach as they clear the pipeline.';
  end if;

  select id into v_existing from public.media_posts where source_metrics->>'media_key'=v_key limit 1;
  if v_existing is null then
    insert into public.media_posts(season,post_type,title,body,source_metrics,is_auto_draft,published,published_at)
    values('S'||new.season::text,'announcement',v_title,v_body,
      jsonb_build_object('team','Calgary Hitmen','league','LGCHL','season',new.season,'week',new.week,
        'media_key',v_key,'game_date',to_char(new.scheduled_at at time zone 'America/Toronto','YYYY-MM-DD'),
        'sort_at',new.scheduled_at,'record',v_record,'opponent',new.opponent_name,
        'final',new.calgary_score::text||'-'||new.opponent_score::text,'result',v_result,'game_no',v_game_no,
        'schedule_game_id',new.id,'status','final','vod_status','pending'),
      false,true,now());
  else
    update public.media_posts set title=v_title,body=v_body,
      source_metrics=source_metrics||jsonb_build_object('record',v_record,'final',new.calgary_score::text||'-'||new.opponent_score::text,'result',v_result,'status','final'),
      published=true,published_at=coalesce(published_at,now()),updated_at=now()
    where id=v_existing;
  end if;
  return new;
end
$$;

drop trigger if exists hitmen_publish_final_media_wire on public.hitmen_schedule_games;
create trigger hitmen_publish_final_media_wire
after insert or update of status,calgary_score,opponent_score,overtime on public.hitmen_schedule_games
for each row execute function private.hitmen_publish_final_media_wire();
