-- Fix: store SQL NULL (not JSON null) when LG publishes no period breakdown; drop over-strict weekly PR unique index.
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

update public.lg3s_games set period_stats = null where period_stats = 'null'::jsonb;
drop index if exists public.lg3s_editorial_week_uq;
