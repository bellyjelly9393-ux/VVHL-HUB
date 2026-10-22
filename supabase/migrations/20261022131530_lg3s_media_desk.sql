-- LG3S media desk: deterministic DRAFT generation from verified data only. Status always 'pending_review'. No publishing path.
create or replace view public.lg3s_public_game_facts with (security_invoker = true) as
select g.lg_game_id, g.game_night_date, g.scheduled_at, g.away_lg_team_id, g.away_nation, g.away_score, g.home_lg_team_id, g.home_nation, g.home_score,
  g.decided_in, g.period_stats, g.verified_at, g.was_corrected, g.source_url,
  (select coalesce(jsonb_agg(jsonb_build_object('lg_user_id', l.lg_user_id, 'gamertag', l.gamertag, 'nation', l.nation, 'kind', l.player_kind, 'pos', l.position,
     'g', l.goals, 'a', l.assists, 'p', l.points, 'pm', l.plus_minus, 'sog', l.shots, 'sa', l.shots_against, 'ga', l.goals_against, 'sv', l.saves, 'sv_pct', l.save_pct)
     order by l.player_kind desc, l.points desc nulls last, l.goals desc nulls last), '[]'::jsonb)
   from public.lg3s_public_player_lines l where l.lg_game_id = g.lg_game_id) as lines
from public.lg3s_public_games g where g.is_verified;
grant select on public.lg3s_public_game_facts to anon, authenticated;

create or replace function private.lg3s_week_of(d date) returns int language sql immutable as $$
  select (((d - date '2026-10-19') / 7) + 1)::int  -- week 1 = Mon Oct 19 – Sun Oct 25, 2026 (LG schedule "Week 1")
$$;

create or replace function private.lg3s_recap_facts(p_game bigint) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('lg_game_id', f.lg_game_id, 'away', f.away_nation, 'home', f.home_nation, 'away_score', f.away_score, 'home_score', f.home_score,
    'decided_in', f.decided_in, 'periods', f.period_stats,
    'stars', (select jsonb_agg(x order by (x->>'p')::int desc, (x->>'g')::int desc, x->>'gamertag') from (select x from jsonb_array_elements(f.lines) x where x->>'kind' = 'skater' order by (x->>'p')::int desc, (x->>'g')::int desc, x->>'gamertag' limit 3) s),
    'goalies', (select jsonb_agg(x) from jsonb_array_elements(f.lines) x where x->>'kind' = 'goalie'))
  from public.lg3s_public_game_facts f where f.lg_game_id = p_game
$$;

create or replace function private.lg3s_generate_drafts() returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g record; f jsonb; v_star jsonb; body text; n_recap int := 0; n_spot int := 0; n_pr int := 0; night record; wk record; win text; lose text; ws int; ls int; r record; i int;
begin
  -- recaps: one per verified game
  for g in select * from public.lg3s_public_game_facts f where not exists (select 1 from public.lg3s_editorial_posts e where e.idempotency_key = 'recap:' || f.lg_game_id) loop
    f := private.lg3s_recap_facts(g.lg_game_id);
    if g.away_score > g.home_score then win := g.away_nation; lose := g.home_nation; ws := g.away_score; ls := g.home_score; else win := g.home_nation; lose := g.away_nation; ws := g.home_score; ls := g.away_score; end if;
    body := format(E'**Final%s: %s %s, %s %s** (%s at %s, %s ET).\n\n', case when g.decided_in in ('OT','SO') then '/' || g.decided_in else '' end, win, ws, lose, ls,
      g.away_nation, g.home_nation, to_char(g.scheduled_at at time zone 'America/Toronto', 'Dy Mon DD, HH12:MI AM'));
    if jsonb_typeof(g.period_stats) = 'array' and jsonb_array_length(g.period_stats) = 2 then
      body := body || format(E'By period: %s %s · %s %s.\n\n',
        g.away_nation, (select string_agg(v, '-') from jsonb_array_elements_text((select p->'goals' from jsonb_array_elements(g.period_stats) p where (p->>'lg_team_id')::int = g.away_lg_team_id)) v),
        g.home_nation, (select string_agg(v, '-') from jsonb_array_elements_text((select p->'goals' from jsonb_array_elements(g.period_stats) p where (p->>'lg_team_id')::int = g.home_lg_team_id)) v));
    else body := body || E'Period-by-period scoring was not published on the LG game page.\n\n'; end if;
    body := body || E'**Three stars (by points):**\n';
    i := 0;
    for v_star in select value from jsonb_array_elements(f->'stars') loop
      i := i + 1; body := body || format(E'%s. %s (%s, %s) — %sG %sA, %sP, %s%s\n', i, v_star->>'gamertag', v_star->>'nation', v_star->>'pos', v_star->>'g', v_star->>'a', v_star->>'p', case when (v_star->>'pm')::int > 0 then '+' else '' end, v_star->>'pm');
    end loop;
    body := body || E'\n**In goal:** ' || (select string_agg(format('%s (%s) %s saves on %s', x->>'gamertag', x->>'nation', x->>'sv', x->>'sa'), ' · ') from jsonb_array_elements(f->'goalies') x) || E'.\n\n';
    body := body || format('_Source: [LeagueGaming game %s](%s) · verified %s ET. Draft generated from verified data; pending editor review._', g.lg_game_id, g.source_url, to_char(g.verified_at at time zone 'America/Toronto', 'Mon DD HH12:MI AM'));
    insert into public.lg3s_editorial_posts (article_type, lg_game_id, game_night_date, week, idempotency_key, title, body_md, derived_from_game_ids, facts)
    values ('recap', g.lg_game_id, g.game_night_date, private.lg3s_week_of(g.game_night_date), 'recap:' || g.lg_game_id, format('%s %s, %s %s', win, ws, lose, ls), body, array[g.lg_game_id], f)
    on conflict do nothing;
    n_recap := n_recap + 1;
  end loop;

  -- spotlight: top skater of each fully-verified game night
  for night in select game_night_date d, array_agg(lg_game_id order by lg_game_id) ids from public.lg3s_public_games group by 1
      having bool_and(is_verified) and not exists (select 1 from public.lg3s_editorial_posts e where e.idempotency_key = 'spotlight:' || game_night_date) loop
    select lg_user_id, (array_agg(gamertag))[1] gt, (array_agg(nation))[1] nat, count(*) gp, sum(goals) g, sum(assists) a, sum(points) p, array_agg(lg_game_id order by lg_game_id) games
      into r from public.lg3s_public_player_lines where game_night_date = night.d and player_kind = 'skater' group by lg_user_id order by sum(points) desc, sum(goals) desc, min(gamertag) limit 1;
    insert into public.lg3s_editorial_posts (article_type, game_night_date, week, idempotency_key, title, body_md, derived_from_game_ids, facts)
    values ('spotlight', night.d, private.lg3s_week_of(night.d), 'spotlight:' || night.d, format('Spotlight: %s (%s) — %s points on %s', r.gt, r.nat, r.p, to_char(night.d, 'Mon DD')),
      format(E'%s led all skaters on %s with **%s goals and %s assists (%s points)** across %s games for %s.\n\n_Verified LG data only; pending editor review._', r.gt, to_char(night.d, 'FMDay, Mon DD'), r.g, r.a, r.p, r.gp, r.nat),
      r.games, jsonb_build_object('lg_user_id', r.lg_user_id, 'gamertag', r.gt, 'nation', r.nat, 'gp', r.gp, 'g', r.g, 'a', r.a, 'p', r.p, 'night', night.d))
    on conflict do nothing;
    n_spot := n_spot + 1;
  end loop;

  -- power rankings: after each week's verified games (draft; regenerated only via new idempotency key)
  for wk in select * from (select private.lg3s_week_of(game_night_date) w, array_agg(lg_game_id) ids, max(game_night_date) last_night from public.lg3s_public_games where is_verified group by 1) q
      where not exists (select 1 from public.lg3s_editorial_posts e where e.idempotency_key = 'power_rankings:' || q.w || ':' || q.last_night) loop
    body := format(E'ECM Power Rankings — Week %s (through %s). Ordered by points, then goal differential, then goals for (ECM editorial order, not an official tiebreaker).\n\n', wk.w, to_char(wk.last_night, 'Mon DD'));
    i := 0;
    for r in select * from public.lg3s_public_standings where gp > 0 order by pts desc nulls last, gd desc, gf desc, nation loop
      i := i + 1; body := body || format(E'%s. **%s** (Grp %s) %s-%s%s, %s pts, GF %s / GA %s (%s%s)\n', i, r.nation, r.group_code, r.w, r.l,
        case when r.otw + r.otl > 0 then format(' (%s OTW, %s OTL)', r.otw, r.otl) else '' end, coalesce(r.pts::text, 'n/a'), r.gf, r.ga, case when r.gd > 0 then '+' else '' end, r.gd);
    end loop;
    body := body || E'\n_Draft from verified LG data; pending editor review. Add commentary before publishing._';
    insert into public.lg3s_editorial_posts (article_type, week, game_night_date, idempotency_key, title, body_md, derived_from_game_ids, facts)
    values ('power_rankings', wk.w, wk.last_night, 'power_rankings:' || wk.w || ':' || wk.last_night, format('Power Rankings — Week %s (through %s)', wk.w, to_char(wk.last_night, 'Mon DD')), body, wk.ids,
      (select jsonb_agg(to_jsonb(s) order by s.pts desc nulls last, s.gd desc, s.gf desc, s.nation) from public.lg3s_public_standings s where s.gp > 0))
    on conflict do nothing;
    n_pr := n_pr + 1;
  end loop;
  perform private.lg3s_check_draft_accuracy();
  return jsonb_build_object('recaps', n_recap, 'spotlights', n_spot, 'power_rankings', n_pr);
end $$;

-- Accuracy tracker: re-derive every draft's facts from CURRENT verified data and record matches/mismatches.
create or replace function private.lg3s_check_draft_accuracy() returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare e record; cur jsonb; total int := 0; ok int := 0;
begin
  for e in select * from public.lg3s_editorial_posts where status = 'pending_review' loop
    cur := case e.article_type
      when 'recap' then private.lg3s_recap_facts(e.lg_game_id)
      when 'spotlight' then (select jsonb_build_object('lg_user_id', lg_user_id, 'gamertag', (array_agg(gamertag))[1], 'nation', (array_agg(nation))[1], 'gp', count(*), 'g', sum(goals), 'a', sum(assists), 'p', sum(points), 'night', e.game_night_date)
                             from public.lg3s_public_player_lines where game_night_date = e.game_night_date and player_kind = 'skater' and lg_user_id = (e.facts->>'lg_user_id')::bigint group by lg_user_id)
      when 'power_rankings' then (select jsonb_agg(to_jsonb(s) order by s.pts desc nulls last, s.gd desc, s.gf desc, s.nation) from public.lg3s_public_standings s
                                  where s.gp > 0 and exists (select 1 from public.lg3s_public_games g where g.is_verified and g.lg_game_id = any(e.derived_from_game_ids)))
      end;
    total := total + 1;
    if cur = e.facts then ok := ok + 1; end if;
    update public.lg3s_editorial_posts set accuracy = jsonb_build_object('checked_at', now(), 'facts_match_verified_data', cur = e.facts,
      'source_games_still_verified', (select bool_and(is_verified) from public.lg3s_public_games where lg_game_id = any(e.derived_from_game_ids)))
    where id = e.id;
  end loop;
  return jsonb_build_object('drafts_checked', total, 'facts_match', ok);
end $$;

revoke all on function private.lg3s_generate_drafts() from public, anon, authenticated;
revoke all on function private.lg3s_check_draft_accuracy() from public, anon, authenticated;
revoke all on function private.lg3s_recap_facts(bigint) from public, anon, authenticated;
