-- LG3S write path (service_role only) + public read views (verified data only).
begin;

-- ---------- schedule upsert: never touches scores/verification ----------
create or replace function public.lg3s_upsert_schedule(p_games jsonb, p_snapshot_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g jsonb; v_old public.lg3s_games; v_changes jsonb := '[]';
begin
  for g in select * from jsonb_array_elements(p_games) loop
    select * into v_old from public.lg3s_games where lg_game_id = (g->>'lg_game_id')::bigint for update;
    if v_old.lg_game_id is null then
      insert into public.lg3s_games (lg_game_id, scheduled_at, away_lg_team_id, home_lg_team_id, source_url, source_snapshot_id)
      values ((g->>'lg_game_id')::bigint, (g->>'scheduled_at')::timestamptz, (g->>'away_lg_team_id')::int, (g->>'home_lg_team_id')::int, g->>'source_url', p_snapshot_id);
      v_changes := v_changes || jsonb_build_object('game', g->>'lg_game_id', 'change', 'new');
    else
      if v_old.away_lg_team_id <> (g->>'away_lg_team_id')::int or v_old.home_lg_team_id <> (g->>'home_lg_team_id')::int then
        -- matchup change on an existing id is never auto-applied
        update public.lg3s_games set verification_status = case when verification_status in ('verified','corrected') then verification_status else 'needs_review' end,
          verification_flags = array(select distinct unnest(verification_flags || array['schedule_matchup_changed'])), updated_at = now()
          where lg_game_id = v_old.lg_game_id;
        v_changes := v_changes || jsonb_build_object('game', v_old.lg_game_id, 'change', 'matchup_conflict');
      elsif v_old.scheduled_at <> (g->>'scheduled_at')::timestamptz and v_old.status <> 'final' then
        update public.lg3s_games set scheduled_at = (g->>'scheduled_at')::timestamptz, updated_at = now() where lg_game_id = v_old.lg_game_id;
        v_changes := v_changes || jsonb_build_object('game', v_old.lg_game_id, 'change', 'rescheduled', 'from', v_old.scheduled_at, 'to', g->>'scheduled_at');
      end if;
    end if;
  end loop;
  return v_changes;
end $$;

-- ---------- game ingest: the verification state machine ----------
-- p: {lg_game_id, scheduled_at, away_lg_team_id, home_lg_team_id, is_final, away_score, home_score, decided_in,
--     period_stats, team_stats, checks, flags[], passed, payload_hash, source_url, snapshot_id, lines[], now?}
-- Rules: FINAL + all blocking checks pass + identical payload_hash on two polls >= 10 min apart => verified.
--        verified/corrected rows are NEVER downgraded; a different passing+stable payload => 'corrected' (+history);
--        a different failing/less-complete payload => rejected + logged, stored data untouched.
create or replace function public.lg3s_ingest_game(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := coalesce((p->>'now')::timestamptz, now());
  v_id bigint := (p->>'lg_game_id')::bigint;
  v_hash text := p->>'payload_hash';
  v_pass boolean := coalesce((p->>'passed')::boolean, false) and coalesce((p->>'is_final')::boolean, false);
  v_window interval := interval '10 minutes';
  g public.lg3s_games; v_stable boolean; v_action text; v_new_status public.lg3s_verification_status;
begin
  select * into g from public.lg3s_games where lg_game_id = v_id for update;
  if g.lg_game_id is null then
    insert into public.lg3s_games (lg_game_id, scheduled_at, away_lg_team_id, home_lg_team_id, source_url)
    values (v_id, (p->>'scheduled_at')::timestamptz, (p->>'away_lg_team_id')::int, (p->>'home_lg_team_id')::int, p->>'source_url')
    returning * into g;
  end if;
  if g.away_lg_team_id <> (p->>'away_lg_team_id')::int or g.home_lg_team_id <> (p->>'home_lg_team_id')::int then
    insert into public.lg3s_corrections (lg_game_id, action, reason, old_payload_hash, new_payload_hash) values (v_id, 'rejected', 'page teams differ from stored matchup', g.payload_hash, v_hash);
    return jsonb_build_object('game', v_id, 'action', 'rejected_matchup');
  end if;

  update public.lg3s_games set last_fetched_at = v_now where lg_game_id = v_id;

  -- same payload as stored => nothing to do
  if g.payload_hash is not distinct from v_hash and g.verification_status in ('verified','corrected') then
    update public.lg3s_games set candidate_hash = null, candidate_first_seen_at = null, candidate_seen_count = 0 where lg_game_id = v_id;
    return jsonb_build_object('game', v_id, 'action', 'unchanged', 'status', g.verification_status);
  end if;

  -- stability window bookkeeping (only for passing finals)
  if v_pass then
    if g.candidate_hash is distinct from v_hash then
      update public.lg3s_games set candidate_hash = v_hash, candidate_first_seen_at = v_now, candidate_seen_count = 1 where lg_game_id = v_id;
      v_stable := false;
    else
      update public.lg3s_games set candidate_seen_count = candidate_seen_count + 1 where lg_game_id = v_id;
      v_stable := v_now - g.candidate_first_seen_at >= v_window;
    end if;
  end if;

  if g.verification_status in ('verified','corrected') then
    if not v_pass then
      insert into public.lg3s_corrections (lg_game_id, action, reason, old_payload_hash, new_payload_hash, new_values)
      values (v_id, 'rejected', 'changed source payload failed checks or not FINAL; verified data kept', g.payload_hash, v_hash,
              jsonb_build_object('checks', p->'checks', 'flags', p->'flags', 'away_score', p->'away_score', 'home_score', p->'home_score'));
      return jsonb_build_object('game', v_id, 'action', 'rejected_downgrade', 'status', g.verification_status);
    elsif not v_stable then
      if g.candidate_hash is distinct from v_hash then
        insert into public.lg3s_corrections (lg_game_id, action, reason, old_payload_hash, new_payload_hash) values (v_id, 'pending_stability', 'source changed after verification; awaiting stability window', g.payload_hash, v_hash);
      end if;
      return jsonb_build_object('game', v_id, 'action', 'correction_pending', 'status', g.verification_status);
    end if;
    -- reparse=true: OUR parser changed (source unchanged) -> stays 'verified'; otherwise LG changed the data -> 'corrected'
    if coalesce((p->>'reparse')::boolean, false) then v_action := 'reparsed'; v_new_status := g.verification_status; else v_action := 'corrected'; v_new_status := 'corrected'; end if;
    insert into public.lg3s_corrections (lg_game_id, action, reason, old_payload_hash, new_payload_hash, old_values, new_values)
    select v_id, 'applied', case when v_action = 'reparsed' then 'parser fix re-parse (source unchanged)' else 'stable passing correction from source' end, g.payload_hash, v_hash,
      jsonb_build_object('away_score', g.away_score, 'home_score', g.home_score, 'period_stats', g.period_stats,
        'lines', (select coalesce(jsonb_agg(to_jsonb(l) - 'updated_at'), '[]') from public.lg3s_player_game_lines l where l.lg_game_id = v_id)),
      jsonb_build_object('away_score', p->'away_score', 'home_score', p->'home_score', 'period_stats', p->'period_stats', 'lines', p->'lines');
  elsif v_pass and v_stable then v_action := 'verified'; v_new_status := 'verified';
  elsif v_pass then v_action := 'provisional'; v_new_status := 'provisional';
  elsif coalesce((p->>'is_final')::boolean, false) then v_action := 'needs_review'; v_new_status := 'needs_review';
  else v_action := 'unverified'; v_new_status := 'unverified';
  end if;

  update public.lg3s_games set
    status = case when (p->>'is_final')::boolean then 'final' when p->>'away_score' is not null then 'in_progress' else status end,
    away_score = (p->>'away_score')::int, home_score = (p->>'home_score')::int, decided_in = p->>'decided_in',
    period_stats = nullif(p->'period_stats', 'null'::jsonb), team_stats = p->'team_stats', verification_checks = p->'checks',
    verification_flags = coalesce(array(select jsonb_array_elements_text(p->'flags')), '{}'),
    verification_status = v_new_status, payload_hash = v_hash, source_snapshot_id = nullif(p->>'snapshot_id','')::bigint,
    final_confirmed_at = case when v_new_status in ('verified','corrected') then v_now else final_confirmed_at end,
    verified_by = case when v_new_status in ('verified','corrected') then 'auto' else verified_by end,
    candidate_hash = case when v_new_status in ('verified','corrected') then null else candidate_hash end,
    candidate_first_seen_at = case when v_new_status in ('verified','corrected') then null else candidate_first_seen_at end,
    candidate_seen_count = case when v_new_status in ('verified','corrected') then 0 else candidate_seen_count end,
    updated_at = v_now
  where lg_game_id = v_id;

  -- replace lines atomically (only reached when not protecting a verified row)
  delete from public.lg3s_player_game_lines where lg_game_id = v_id;
  insert into public.lg3s_player_game_lines (lg_game_id, lg_user_id, player_kind, lg_team_id_at_game, gamertag_at_game, position,
    goals, assists, points, plus_minus, shots, shot_attempts, hits, takeaways, giveaways, blocks, interceptions, pim_seconds, toi_seconds, pass_pct,
    shots_against, goals_against, saves, save_pct, gaa, is_placeholder, identity_flags, source_snapshot_id, updated_at)
  select v_id, (l->>'lg_user_id')::bigint, l->>'kind', (l->>'lg_team_id')::int, l->>'gamertag', l->>'position',
    (l->>'g')::int, (l->>'a')::int, (l->>'p')::int, (l->>'plus_minus')::int, (l->>'shots')::int, (l->>'shot_attempts')::int, (l->>'hits')::int,
    (l->>'takeaways')::int, (l->>'giveaways')::int, (l->>'blocks')::int, (l->>'interceptions')::int, (l->>'pim_s')::int, (l->>'toi_s')::int, (l->>'pass_pct')::numeric,
    (l->>'shots_against')::int, (l->>'goals_against')::int, (l->>'saves')::int, (l->>'save_pct')::numeric, (l->>'gaa')::numeric,
    coalesce((l->>'is_placeholder')::boolean, false), coalesce(array(select jsonb_array_elements_text(l->'flags')), '{}'), nullif(p->>'snapshot_id','')::bigint, v_now
  from jsonb_array_elements(p->'lines') l
  where l->>'lg_user_id' is not null and l->>'lg_team_id' is not null;

  return jsonb_build_object('game', v_id, 'action', v_action, 'status', v_new_status);
end $$;

revoke all on function public.lg3s_ingest_game(jsonb) from public, anon, authenticated;
revoke all on function public.lg3s_upsert_schedule(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.lg3s_ingest_game(jsonb) to service_role;
grant execute on function public.lg3s_upsert_schedule(jsonb, bigint) to service_role;

-- ---------- public read path ----------
-- Base tables keep RLS on. anon gets column-limited SELECT + an RLS policy restricted to verified rows;
-- the public views are security_invoker so that RLS is enforced (no security-definer view).
grant select (lg_team_id, nation, group_code, crest_path) on public.lg3s_teams to anon, authenticated;
create policy lg3s_teams_public_read on public.lg3s_teams for select to anon, authenticated using (true);

grant select (lg_game_id, season, scheduled_at, game_night_date, away_lg_team_id, home_lg_team_id, status, away_score, home_score, decided_in,
  period_stats, verification_status, verification_flags, final_confirmed_at, source_url) on public.lg3s_games to anon, authenticated;
create policy lg3s_games_public_read on public.lg3s_games for select to anon, authenticated using (true);  -- schedule is public; scores masked in view

grant select (lg_game_id, lg_user_id, player_kind, lg_team_id_at_game, gamertag_at_game, position, goals, assists, points, plus_minus, shots, hits,
  takeaways, giveaways, blocks, interceptions, toi_seconds, shots_against, goals_against, saves, save_pct, gaa, is_placeholder) on public.lg3s_player_game_lines to anon, authenticated;
create policy lg3s_lines_public_read_verified on public.lg3s_player_game_lines for select to anon, authenticated
  using (exists (select 1 from public.lg3s_games g where g.lg_game_id = lg3s_player_game_lines.lg_game_id and g.verification_status in ('verified','corrected')));

grant select (captured_at, source, group_code, lg_team_id, rank, gp, w, l, otw, otl, pts, gf, ga, gd, streak, source_url) on public.lg3s_standings_snapshots to anon, authenticated;
create policy lg3s_standings_public_read on public.lg3s_standings_snapshots for select to anon, authenticated using (source = 'lg_official');

create or replace view public.lg3s_public_games with (security_invoker = true) as
select g.lg_game_id, g.season, g.scheduled_at, g.game_night_date, g.away_lg_team_id, ta.nation as away_nation, g.home_lg_team_id, th.nation as home_nation,
  case when g.verification_status in ('verified','corrected') then g.status else case when g.status = 'final' then 'pending_verification' else g.status end end as status,
  case when g.verification_status in ('verified','corrected') then g.away_score end as away_score,
  case when g.verification_status in ('verified','corrected') then g.home_score end as home_score,
  case when g.verification_status in ('verified','corrected') then g.decided_in end as decided_in,
  case when g.verification_status in ('verified','corrected') then g.period_stats end as period_stats,
  g.verification_status in ('verified','corrected') as is_verified, g.verification_status = 'corrected' as was_corrected,
  g.final_confirmed_at as verified_at, g.source_url
from public.lg3s_games g join public.lg3s_teams ta on ta.lg_team_id = g.away_lg_team_id join public.lg3s_teams th on th.lg_team_id = g.home_lg_team_id;

create or replace view public.lg3s_public_player_lines with (security_invoker = true) as
select l.lg_game_id, g.game_night_date, l.lg_user_id, l.player_kind, l.lg_team_id_at_game as lg_team_id, t.nation, l.gamertag_at_game as gamertag, l.position,
  l.goals, l.assists, l.points, l.plus_minus, l.shots, l.hits, l.takeaways, l.giveaways, l.blocks, l.interceptions, l.toi_seconds,
  l.shots_against, l.goals_against, l.saves, l.save_pct, l.gaa
from public.lg3s_player_game_lines l
join public.lg3s_games g on g.lg_game_id = l.lg_game_id and g.verification_status in ('verified','corrected')
join public.lg3s_teams t on t.lg_team_id = l.lg_team_id_at_game
where not l.is_placeholder;

create or replace view public.lg3s_public_standings with (security_invoker = true) as
with r as (
  select g.away_lg_team_id team, g.away_score gf, g.home_score ga, g.decided_in from public.lg3s_games g where g.verification_status in ('verified','corrected')
  union all
  select g.home_lg_team_id, g.home_score, g.away_score, g.decided_in from public.lg3s_games g where g.verification_status in ('verified','corrected')
)
select t.lg_team_id, t.nation, t.group_code,
  count(r.team)::int gp,
  count(*) filter (where r.gf > r.ga and coalesce(r.decided_in,'REG') = 'REG')::int w,
  count(*) filter (where r.gf < r.ga and coalesce(r.decided_in,'REG') = 'REG')::int l,
  count(*) filter (where r.gf > r.ga and r.decided_in in ('OT','SO'))::int otw,
  count(*) filter (where r.gf < r.ga and r.decided_in in ('OT','SO'))::int otl,
  -- Points: regulation W = 2 (matches LG table). OT/SO point values not published by LG -> null until confirmed.
  case when count(*) filter (where r.decided_in in ('OT','SO')) = 0 then 2 * count(*) filter (where r.gf > r.ga)::int end pts,
  coalesce(sum(r.gf),0)::int gf, coalesce(sum(r.ga),0)::int ga, coalesce(sum(r.gf - r.ga),0)::int gd
from public.lg3s_teams t left join r on r.team = t.lg_team_id
group by t.lg_team_id, t.nation, t.group_code;

create or replace view public.lg3s_public_official_standings with (security_invoker = true) as
select s.captured_at, s.group_code, s.lg_team_id, s.rank, s.gp, s.w, s.l, s.otw, s.otl, s.pts, s.gf, s.ga, s.gd, s.streak, s.source_url
from public.lg3s_standings_snapshots s
where s.source = 'lg_official' and s.captured_at = (select max(x.captured_at) from public.lg3s_standings_snapshots x where x.source = 'lg_official');

create or replace view public.lg3s_public_skater_leaders with (security_invoker = true) as
select lg_user_id, (array_agg(gamertag order by game_night_date desc))[1] gamertag, (array_agg(lg_team_id order by game_night_date desc))[1] lg_team_id,
  (array_agg(nation order by game_night_date desc))[1] nation, count(*)::int gp, sum(goals)::int g, sum(assists)::int a, sum(points)::int p,
  sum(plus_minus)::int plus_minus, sum(shots)::int shots, sum(hits)::int hits
from public.lg3s_public_player_lines where player_kind = 'skater' group by lg_user_id;

create or replace view public.lg3s_public_goalie_leaders with (security_invoker = true) as
select lg_user_id, (array_agg(gamertag order by game_night_date desc))[1] gamertag,
  array_agg(distinct nation) nations_played_for, count(*)::int gp, sum(shots_against)::int sa, sum(goals_against)::int ga, sum(saves)::int sv,
  round(sum(saves)::numeric / nullif(sum(shots_against),0), 3) sv_pct, round(sum(goals_against)::numeric / nullif(count(*),0), 2) gaa_per_game
from public.lg3s_public_player_lines where player_kind = 'goalie' group by lg_user_id;

grant select on public.lg3s_public_games, public.lg3s_public_player_lines, public.lg3s_public_standings, public.lg3s_public_official_standings,
  public.lg3s_public_skater_leaders, public.lg3s_public_goalie_leaders to anon, authenticated;

commit;
