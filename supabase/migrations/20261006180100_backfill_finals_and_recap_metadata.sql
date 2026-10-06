-- Backfill: copy existing LGCHL finals onto the Hitmen schedule; add missing metadata to Oct 4 recaps.
update public.lgchl_games set status = status
 where season = 55 and status = 'final' and game_at > now() - interval '30 days';

-- 7. Sunday Oct 4 recaps were posted without the fields the Hitmen Media page filters on.
update public.media_posts m set source_metrics = m.source_metrics || jsonb_build_object(
    'team', 'Calgary Hitmen', 'league', 'LGCHL', 'season', 55, 'week', 2,
    'result', case when (m.source_metrics->>'calgary_score')::int > (m.source_metrics->>'opponent_score')::int then 'W' else 'L' end,
    'final', (m.source_metrics->>'calgary_score') || '-' || (m.source_metrics->>'opponent_score'),
    'game_date', to_char(g.game_at at time zone 'America/Toronto', 'YYYY-MM-DD'),
    'sort_at', to_char(g.game_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  from public.lgchl_games g
 where m.post_type = 'recap' and m.source_metrics->>'team' is null
   and m.source_metrics ? 'lg_game_id' and g.lg_game_id = (m.source_metrics->>'lg_game_id')::bigint;
