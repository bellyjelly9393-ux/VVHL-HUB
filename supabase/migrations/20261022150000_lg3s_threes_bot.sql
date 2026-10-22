-- LG3S Threes Bot: prompts, roster snapshots, generation log, feed builders (verified views only).
-- Additive only. All objects lg3s_* / private.lg3s_*.

create table if not exists public.lg3s_prompts (
  feature text not null, version int not null, body text not null,
  is_active boolean not null default true, created_at timestamptz not null default now(),
  primary key (feature, version));
alter table public.lg3s_prompts enable row level security;
revoke all on public.lg3s_prompts from anon, authenticated;

create table if not exists public.lg3s_roster_snapshots (
  id bigserial primary key, captured_at timestamptz not null, source text not null, source_url text,
  payload_hash text not null, n_players int not null, created_at timestamptz not null default now());
create table if not exists public.lg3s_roster_snapshot_rows (
  snapshot_id bigint not null references public.lg3s_roster_snapshots(id) on delete cascade,
  lg_user_id bigint not null, gamertag text, lg_team_id int not null, position text, role text,
  primary key (snapshot_id, lg_user_id));
alter table public.lg3s_roster_snapshots enable row level security;
alter table public.lg3s_roster_snapshot_rows enable row level security;
revoke all on public.lg3s_roster_snapshots, public.lg3s_roster_snapshot_rows from anon, authenticated;

create table if not exists public.lg3s_generation_runs (
  id bigserial primary key, feature text not null, period_key text not null, prompt_version int,
  generator text, status text not null check (status in ('stored_pending_review','stored_needs_review','error_output','duplicate','llm_unavailable','failed')),
  reasons text[] not null default '{}', feed_hash text, output jsonb, post_id bigint, created_at timestamptz not null default now());
alter table public.lg3s_generation_runs enable row level security;
revoke all on public.lg3s_generation_runs from anon, authenticated;

alter table public.lg3s_editorial_posts add column if not exists feature text;
alter table public.lg3s_editorial_posts add column if not exists period_key text;
alter table public.lg3s_editorial_posts add column if not exists prompt_version int;
alter table public.lg3s_editorial_posts add column if not exists output_json jsonb;
alter table public.lg3s_editorial_posts add column if not exists review_reasons text[];
alter table public.lg3s_editorial_posts drop constraint if exists lg3s_editorial_posts_article_type_check;
alter table public.lg3s_editorial_posts add constraint lg3s_editorial_posts_article_type_check check (article_type in
  ('recap','spotlight','power_rankings','night_wrap','preview','daily_three','trio_power_rankings','duo_index','roster_wire','pick3_preview','pick3_recap'));
alter table public.lg3s_editorial_posts drop constraint if exists lg3s_editorial_posts_status_check;
alter table public.lg3s_editorial_posts add constraint lg3s_editorial_posts_status_check check (status in ('pending_review','needs_review','approved','published','rejected'));
create unique index if not exists lg3s_editorial_feature_period_uq on public.lg3s_editorial_posts (feature, period_key) where feature is not null;

-- ---------- helpers ----------
create or replace function private.lg3s_fpts(g int, a int, sog int, hits int, won boolean)
returns numeric language sql immutable set search_path = pg_catalog as $$
  select 3*coalesce(g,0) + 2*coalesce(a,0) + 0.5*coalesce(sog,0) + 0.25*coalesce(hits,0)
       + case when won then 1 else 0 end + case when coalesce(g,0) >= 3 then 3 else 0 end $$;

-- skater lines in verified games with team result (verified views only)
create or replace view private.lg3s_v_skater_results with (security_invoker = true) as
select l.lg_game_id, l.game_night_date, l.lg_user_id, l.gamertag, l.lg_team_id, l.nation, l.position,
       l.goals, l.assists, l.points, l.plus_minus, l.shots, l.hits,
       case when g.away_lg_team_id = l.lg_team_id then g.away_score else g.home_score end gf,
       case when g.away_lg_team_id = l.lg_team_id then g.home_score else g.away_score end ga,
       case when g.away_lg_team_id = l.lg_team_id then g.home_nation else g.away_nation end opponent,
       g.decided_in, g.scheduled_at
from public.lg3s_public_player_lines l join public.lg3s_public_games g using (lg_game_id)
where g.is_verified and l.player_kind = 'skater';

create or replace function private.lg3s_week_bounds(w int, out d0 date, out d1 date)
language sql immutable set search_path = pg_catalog as $$ select date '2026-10-19' + (w-1)*7, date '2026-10-19' + (w-1)*7 + 6 $$;

-- ---------- DAILY THREE ----------
create or replace function private.lg3s_feed_daily_three(p_date date)
returns jsonb language sql stable security definer set search_path = public, private, pg_catalog as $$
with g as (select * from lg3s_public_games where game_night_date = p_date and is_verified),
s as (select r.*, private.lg3s_fpts(goals,assists,shots,hits,gf>ga) fp from private.lg3s_v_skater_results r where game_night_date = p_date),
night as (select lg_user_id, min(gamertag) gamertag, min(nation) team, count(*) gp, sum(goals) g, sum(assists) a, sum(points) p, sum(plus_minus) pm, sum(shots) sog, sum(hits) hits,
           count(*) filter (where goals>=3) hat_tricks, max(goals) best_game_goals from s group by lg_user_id),
gl as (select l.gamertag, l.nation team, sum(l.saves) sv, sum(l.shots_against) sa, sum(l.goals_against) ga, count(*) gp,
           count(*) filter (where l.goals_against = 0) shutouts
       from lg3s_public_player_lines l join g using (lg_game_id) where l.player_kind='goalie' group by 1,2),
tr as (select t.nation team, count(*) gp,
         count(*) filter (where (g.away_nation=t.nation and g.away_score>g.home_score) or (g.home_nation=t.nation and g.home_score>g.away_score)) w,
         sum(case when g.away_nation=t.nation then g.away_score else g.home_score end) gf,
         sum(case when g.away_nation=t.nation then g.home_score else g.away_score end) ga
       from g join lg3s_public_standings t on t.nation in (g.away_nation, g.home_nation) group by 1)
select case when (select count(*) from g) = 0 then jsonb_build_object('insufficient', true, 'insufficient_reason', 'No verified games on '||p_date)
else jsonb_build_object(
  'date', to_char(p_date,'YYYY-MM-DD'), 'date_label', trim(to_char(p_date,'Dy Mon FMDD')),
  'games', (select jsonb_agg(jsonb_build_object('away',away_nation,'away_score',away_score,'home',home_nation,'home_score',home_score,
             'winner', case when away_score>home_score then away_nation else home_nation end,
             'margin', abs(away_score-home_score), 'decided_in', decided_in) order by scheduled_at, lg_game_id) from g),
  'top_performers', (select jsonb_agg(x order by (x->>'points')::int desc, (x->>'goals')::int desc) from (
       select jsonb_build_object('player',gamertag,'team',team,'games',gp,'goals',g,'assists',a,'points',p,'plus_minus',pm,'shots',sog,'hits',hits,'hat_tricks',hat_tricks,
         'stat_line', g||'G '||a||'A '||p||'P'||case when pm is not null then ', '||case when pm>0 then '+' else '' end||pm else '' end||' in '||gp||' GP') x
       from night order by p desc, g desc limit 8) z),
  'notable_stats', jsonb_build_object(
       'hat_tricks', (select coalesce(jsonb_agg(jsonb_build_object('player',gamertag,'team',nation,'goals',goals,'opponent',opponent)),'[]') from s where goals>=3),
       'biggest_win', (select jsonb_build_object('winner',case when away_score>home_score then away_nation else home_nation end,'loser',case when away_score>home_score then home_nation else away_nation end,
                        'score', greatest(away_score,home_score)||'-'||least(away_score,home_score),'margin',abs(away_score-home_score)) from g order by abs(away_score-home_score) desc, lg_game_id limit 1),
       'total_goals', (select sum(away_score+home_score) from g),
       'shutouts', (select coalesce(jsonb_agg(jsonb_build_object('goalie',gamertag,'team',team,'shutouts',shutouts)),'[]') from gl where shutouts>0),
       'most_saves', (select jsonb_build_object('goalie',gamertag,'team',team,'saves',sv,'shots_against',sa) from gl order by sv desc nulls last limit 1),
       'most_hits', (select jsonb_build_object('player',gamertag,'team',team,'hits',hits) from night order by hits desc nulls last limit 1),
       'most_shots', (select jsonb_build_object('player',gamertag,'team',team,'shots',sog) from night order by sog desc nulls last limit 1),
       'top_team_offense', (select jsonb_build_object('team',team,'goals_for',gf,'games',gp) from tr order by gf desc limit 1)),
  'storylines', jsonb_build_object(
       'perfect_nights', (select coalesce(jsonb_agg(jsonb_build_object('team',team,'record',w||'-'||(gp-w),'goals_for',gf,'goals_against',ga) order by gf-ga desc),'[]') from tr where w=gp),
       'winless_nights', (select coalesce(jsonb_agg(jsonb_build_object('team',team,'record',w||'-'||(gp-w),'goals_for',gf,'goals_against',ga) order by gf-ga),'[]') from tr where w=0),
       'standings', (select jsonb_agg(jsonb_build_object('team',nation,'group',group_code,'record',w||'-'||l,'points',pts,'goal_diff',gd) order by pts desc, gd desc, gf desc) from lg3s_public_standings)),
  'source_game_ids', (select jsonb_agg(lg_game_id order by lg_game_id) from g))
end $$;

-- ---------- TRIO POWER RANKINGS ----------
create or replace function private.lg3s_feed_power_rankings(p_week int, p_thru date default null)
returns jsonb language sql stable security definer set search_path = public, private, pg_catalog as $$
with b as (select * from private.lg3s_week_bounds(p_week)),
g as (select g.* from lg3s_public_games g, b where g.is_verified and g.game_night_date <= least(b.d1, coalesce(p_thru, b.d1))),
st as (select s.*, row_number() over (order by pts desc, gd desc, gf desc, nation) standings_rank from lg3s_public_standings s),
res as (select t.nation team, g.game_night_date, g.scheduled_at, g.lg_game_id,
          case when g.away_nation=t.nation then g.away_score else g.home_score end gf,
          case when g.away_nation=t.nation then g.home_score else g.away_score end ga,
          case when g.away_nation=t.nation then g.home_nation else g.away_nation end opp
        from st t join g on t.nation in (g.away_nation,g.home_nation)),
wk as (select r.team, count(*) gp, count(*) filter (where gf>ga) w, count(*) filter (where gf<ga) l, sum(gf) gf, sum(ga) ga from res r, b where r.game_night_date >= b.d0 group by 1),
last3 as (select team, jsonb_agg(jsonb_build_object('opponent',opp,'result',case when gf>ga then 'W' else 'L' end,'score',gf||'-'||ga) order by scheduled_at desc) l3
          from (select *, row_number() over (partition by team order by scheduled_at desc) rn from res) z where rn<=3 group by team),
tp as (select nation team, jsonb_agg(jsonb_build_object('player',gamertag,'goals',g,'assists',a,'points',p) order by p desc, g desc) players
       from (select r.nation, r.gamertag, sum(goals) g, sum(assists) a, sum(points) p, row_number() over (partition by r.nation order by sum(points) desc, sum(goals) desc) rn
             from private.lg3s_v_skater_results r join g using (lg_game_id) group by 1,2) z where rn<=3 group by 1),
prev as (select o->>'team' team, (o->>'rank')::int rk from lg3s_editorial_posts p, jsonb_array_elements(p.output_json->'rankings') o
         where p.feature='trio_power_rankings' and p.status in ('approved','published') and p.period_key < 'S1-W'||lpad(p_week::text,2,'0')
         and p.id = (select max(id) from lg3s_editorial_posts where feature='trio_power_rankings' and status in ('approved','published') and period_key < 'S1-W'||lpad(p_week::text,2,'0')))
select case when (select count(*) from g) = 0 then jsonb_build_object('insufficient',true,'insufficient_reason','No verified games yet')
else jsonb_build_object(
  'week_label', 'Week '||p_week, 'data_through', (select to_char(max(game_night_date),'YYYY-MM-DD') from g),
  'week_complete', (select coalesce(p_thru, d1) >= d1 from b),
  'teams', (select jsonb_agg(jsonb_build_object('team',st.nation,'group',st.group_code,'standings_rank',st.standings_rank,'record',st.w||'-'||st.l,
              'points',st.pts,'goals_for',st.gf,'goals_against',st.ga,'goal_diff',st.gd,
              'week_record', coalesce(wk.w,0)||'-'||coalesce(wk.l,0), 'last_rank', prev.rk,
              'recent_results', coalesce(last3.l3,'[]'), 'top_players', coalesce(tp.players,'[]')) order by st.standings_rank)
            from st left join wk on wk.team=st.nation left join last3 on last3.team=st.nation left join tp on tp.team=st.nation left join prev on prev.team=st.nation),
  'source_game_ids', (select jsonb_agg(lg_game_id order by lg_game_id) from g))
end $$;

-- ---------- DUO INDEX ----------
create or replace function private.lg3s_duo_pairs(p_thru date)
returns table(p1 text, p2 text, u1 bigint, u2 bigint, team text, games_together int, w int, l int, gf int, ga int, combined_points int,
              win_pct numeric, goal_diff_per_game numeric, points_per_game numeric)
language sql stable security definer set search_path = public, private, pg_catalog as $$
  select a.gamertag, b.gamertag, a.lg_user_id, b.lg_user_id, a.nation, count(*)::int,
         count(*) filter (where a.gf>a.ga)::int, count(*) filter (where a.gf<a.ga)::int, sum(a.gf)::int, sum(a.ga)::int, sum(a.points+b.points)::int,
         round(count(*) filter (where a.gf>a.ga)::numeric/count(*),3), round(sum(a.gf-a.ga)::numeric/count(*),2), round(sum(a.points+b.points)::numeric/count(*),2)
  from private.lg3s_v_skater_results a join private.lg3s_v_skater_results b
    on a.lg_game_id=b.lg_game_id and a.lg_team_id=b.lg_team_id and a.lg_user_id<b.lg_user_id
  where a.game_night_date <= p_thru
  group by 1,2,3,4,5 $$;

create or replace function private.lg3s_feed_duo_index(p_week int, p_thru date default null, p_min int default 4)
returns jsonb language sql stable security definer set search_path = public, private, pg_catalog as $$
with b as (select * from private.lg3s_week_bounds(p_week)),
cut as (select least(b.d1, coalesce(p_thru,b.d1)) c from b),
pr as (select * from private.lg3s_duo_pairs((select c from cut))),
el as (select *, row_number() over (partition by team order by win_pct desc, goal_diff_per_game desc, points_per_game desc, p1, p2) team_rn from pr where games_together >= p_min),
top as (select *, row_number() over (order by win_pct desc, goal_diff_per_game desc, points_per_game desc, p1, p2) rk from el where team_rn = 1),
j as (select rk, jsonb_build_object('rank',rk,'players',jsonb_build_array(p1,p2),'team',team,'games_together',games_together,'record_together',w||'-'||l,
        'goal_diff_per_game',goal_diff_per_game,'points_per_game',points_per_game,'combined_points',combined_points,'goals_for',gf,'goals_against',ga,'win_pct',win_pct) o from top where rk<=5)
select jsonb_build_object(
  'week_label','Week '||p_week, 'data_through', (select to_char(c,'YYYY-MM-DD') from cut), 'min_games', p_min,
  'pairs_considered', (select count(*) from pr), 'max_games_together', (select coalesce(max(games_together),0) from pr),
  'top_duos', coalesce((select jsonb_agg(o order by rk) from j),'[]'),
  'odd_couple_candidates', coalesce((select jsonb_agg(jsonb_build_object('players',jsonb_build_array(p1,p2),'team',team,'record_together',w||'-'||l,'games_together',games_together,'combined_points',combined_points))
        from (select * from el where w>0 order by combined_points asc, goal_diff_per_game desc limit 3) z),'[]'),
  'needs_counseling_candidates', coalesce((select jsonb_agg(jsonb_build_object('players',jsonb_build_array(p1,p2),'team',team,'record_together',w||'-'||l,'games_together',games_together,'goal_diff_per_game',goal_diff_per_game))
        from (select * from el order by win_pct, goal_diff_per_game limit 3) z),'[]'),
  'insufficient', not exists (select 1 from j),
  'insufficient_reason', case when not exists (select 1 from j) then 'No duo has '||p_min||'+ games together yet (max so far: '||(select coalesce(max(games_together),0) from pr)||')' end)
$$;

-- ---------- ROSTER WIRE ----------
create or replace function private.lg3s_feed_roster_wire(p_snapshot bigint default null)
returns jsonb language sql stable security definer set search_path = public, private, pg_catalog as $$
with cur as (select * from lg3s_roster_snapshots where id = coalesce(p_snapshot,(select max(id) from lg3s_roster_snapshots))),
prv as (select s.* from lg3s_roster_snapshots s, cur where s.id < cur.id order by s.id desc limit 1),
c as (select r.* from lg3s_roster_snapshot_rows r join cur on r.snapshot_id=cur.id),
p as (select r.* from lg3s_roster_snapshot_rows r join prv on r.snapshot_id=prv.id),
t as (select lg_team_id, nation from lg3s_teams),
mv as (select * from (
  select 'signed' type, c.gamertag, null::text from_team, tc.nation to_team from c join t tc using (lg_team_id) where not exists (select 1 from p where p.lg_user_id=c.lg_user_id)
  union all select 'released', p.gamertag, tp.nation, null from p join t tp using (lg_team_id) where not exists (select 1 from c where c.lg_user_id=p.lg_user_id)
  union all select 'moved', c.gamertag, tp.nation, tc.nation from c join p using (lg_user_id) join t tc on tc.lg_team_id=c.lg_team_id join t tp on tp.lg_team_id=p.lg_team_id where c.lg_team_id<>p.lg_team_id) z(type, gamertag, from_team, to_team) where exists (select 1 from prv))
select case when not exists (select 1 from cur) then jsonb_build_object('insufficient',true,'insufficient_reason','No roster snapshot yet')
else jsonb_build_object(
  'updated_label', (select trim(to_char(captured_at at time zone 'America/Toronto','Dy Mon FMDD')) from cur),
  'snapshot_id', (select id from cur), 'previous_snapshot_id', (select id from prv),
  'is_baseline', not exists (select 1 from prv),
  'players_on_rosters', (select n_players from cur),
  'moves', coalesce((select jsonb_agg(jsonb_build_object('date',(select to_char(captured_at at time zone 'America/Toronto','YYYY-MM-DD') from cur),'type',type,'players',jsonb_build_array(gamertag),'from_team',from_team,'to_team',to_team) order by type, gamertag) from mv),'[]'))
end $$;

-- ---------- PICK YOUR 3 (prices; deterministic) ----------
create or replace function private.lg3s_feed_pick3(p_week int)
returns jsonb language sql stable security definer set search_path = public, private, pg_catalog as $$
with b as (select * from private.lg3s_week_bounds(p_week)),
hist as (select r.*, private.lg3s_fpts(goals,assists,shots,hits,gf>ga) fp, row_number() over (partition by lg_user_id order by scheduled_at desc) rn
         from private.lg3s_v_skater_results r, b where r.game_night_date < b.d0),
agg as (select lg_user_id, (array_agg(gamertag order by scheduled_at desc))[1] player, (array_agg(nation order by scheduled_at desc))[1] team, count(*) gp,
          sum(points) pts, round(sum(points)::numeric/count(*),2) ppg, round(avg(fp),2) fpts_pg, round(avg(fp) filter (where rn<=3),2) fpts_last3, sum(goals) g, sum(assists) a, sum(shots) sog, sum(hits) hits
        from hist group by 1),
sc as (select *, round(0.6*ppg*3 + 0.4*fpts_last3/3.0, 3) price_score from agg),
rk as (select *, row_number() over (order by price_score desc, ppg desc, fpts_last3 desc, player) r, count(*) over () n from sc),
pr as (select *, case when r<=5 then (array[15,14,14,13,13])[r]
                      else greatest(4, least(12, round(12 - 8.0*(r-6)/greatest(n-6,1))))::int end price from rk),
vp as (select lg_user_id from pr where price<=7 order by fpts_last3/price desc, ppg desc limit 3),
up as (select count(*) n from lg3s_public_games g, b where g.game_night_date between b.d0 and b.d1)
select case when (select count(*) from agg) = 0 then jsonb_build_object('insufficient',true,'insufficient_reason','No verified skater games before Week '||p_week)
else jsonb_build_object(
  'week_label','Week '||p_week, 'rules', jsonb_build_object('picks',3,'max_per_team',1,'cap',30,'price_min',4,'price_max',15,
      'scoring', jsonb_build_object('goal',3,'assist',2,'sog',0.5,'hit',0.25,'team_win',1,'hat_trick_bonus',3), 'lock','first puck drop of the week'),
  'pricing_inputs', jsonb_build_object('ppg_weight',0.6,'last3_weight',0.4,'matchup_weight',0,'matchup_status',
      case when (select n from up)=0 then 'unavailable: upcoming schedule not loaded' else 'loaded' end),
  'players', (select jsonb_agg(jsonb_build_object('player',player,'team',team,'price',price,'opponents',
        coalesce((select jsonb_agg(distinct case when g.away_nation=pr.team then g.home_nation else g.away_nation end) from lg3s_public_games g, b where g.game_night_date between b.d0 and b.d1 and pr.team in (g.away_nation,g.home_nation)),'[]'),
        'is_value_pick', lg_user_id in (select lg_user_id from vp), 'gp',gp,'points',pts,'ppg',ppg,'fantasy_pts_per_game',fpts_pg,'fantasy_pts_last3',fpts_last3) order by price desc, r) from pr),
  'source_game_ids', (select jsonb_agg(distinct lg_game_id) from hist))
end $$;

-- ---------- dispatcher + store (service_role only) ----------
create or replace function public.lg3s_threes_feed(p_feature text, p_period text)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_catalog as $$
declare w int; thru date;
begin
  -- period formats: daily_three 'YYYY-MM-DD'; weekly 'S1-W01' or 'S1-W01@YYYY-MM-DD' (data through); roster_wire 'snap-<id>' or 'latest'
  if p_feature = 'daily_three' then return private.lg3s_feed_daily_three(p_period::date); end if;
  if p_feature = 'roster_wire' then return private.lg3s_feed_roster_wire(case when p_period like 'snap-%' then substr(p_period,6)::bigint end); end if;
  w := substring(p_period from 'W(\d+)')::int; thru := nullif(split_part(p_period,'@',2),'')::date;
  if w is null then raise exception 'bad period %', p_period; end if;
  if p_feature = 'trio_power_rankings' then return private.lg3s_feed_power_rankings(w, thru); end if;
  if p_feature = 'duo_index' then return private.lg3s_feed_duo_index(w, thru); end if;
  if p_feature = 'pick3_preview' then return private.lg3s_feed_pick3(w); end if;
  if p_feature = 'pick3_recap' then return jsonb_build_object('insufficient',true,'insufficient_reason','Pick Your 3 entry/scoring is not built; no site-scored results exist'); end if;
  raise exception 'unknown feature %', p_feature;
end $$;

create or replace function public.lg3s_threes_prompt(p_feature text)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  select jsonb_build_object('base',(select body from lg3s_prompts where feature='base' and is_active order by version desc limit 1),
    'base_version',(select version from lg3s_prompts where feature='base' and is_active order by version desc limit 1),
    'feature',(select body from lg3s_prompts where feature=p_feature and is_active order by version desc limit 1),
    'version',(select version from lg3s_prompts where feature=p_feature and is_active order by version desc limit 1)) $$;

create or replace function public.lg3s_store_threes(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_feature text := p->>'feature'; v_period text := p->>'period_key'; v_status text := p->>'status';
        v_existing record; v_id bigint; v_run text; v_ids bigint[];
begin
  select array_agg(x::bigint) into v_ids from jsonb_array_elements_text(coalesce(p->'source_game_ids','[]')) x;
  if v_status in ('pending_review','needs_review') then
    select id, status into v_existing from lg3s_editorial_posts where feature=v_feature and period_key=v_period;
    if found and v_existing.status <> 'needs_review' then
      v_run := 'duplicate'; v_id := v_existing.id;
    else
      if found then delete from lg3s_editorial_posts where id = v_existing.id; end if;
      insert into lg3s_editorial_posts(article_type, feature, period_key, week, game_night_date, idempotency_key, status, title, body_md, derived_from_game_ids,
                                       facts, accuracy, generator, prompt_version, output_json, review_reasons)
      values (v_feature, v_feature, v_period, nullif(p->>'week','')::int, nullif(p->>'game_night_date','')::date, 'threes:'||v_feature||':'||v_period, v_status,
              coalesce(p->>'title', v_feature||' '||v_period), coalesce(p->>'body_md', jsonb_pretty(coalesce(p->'output','{}'::jsonb))), coalesce(v_ids,'{}'), coalesce(p->'feed','{}'), coalesce(p->'checks','{}'), coalesce(p->>'generator','unknown'), (p->>'prompt_version')::int, p->'output',
              array(select jsonb_array_elements_text(coalesce(p->'reasons','[]'))))
      returning id into v_id;
      v_run := 'stored_'||v_status;
    end if;
  else v_run := v_status; end if;
  insert into lg3s_generation_runs(feature, period_key, prompt_version, generator, status, reasons, feed_hash, output, post_id)
  values (v_feature, v_period, (p->>'prompt_version')::int, p->>'generator', v_run, array(select jsonb_array_elements_text(coalesce(p->'reasons','[]'))),
          md5(coalesce(p->'feed','{}')::text), p->'output', v_id);
  return jsonb_build_object('run_status', v_run, 'post_id', v_id);
end $$;

-- roster snapshot ingest
create or replace function public.lg3s_ingest_roster(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_hash text := md5((select string_agg(x->>'lg_user_id'||':'||(x->>'lg_team_id'), ',' order by (x->>'lg_user_id')::bigint) from jsonb_array_elements(p->'rows') x));
        v_last text; v_id bigint;
begin
  select payload_hash into v_last from lg3s_roster_snapshots order by id desc limit 1;
  if v_last = v_hash and not coalesce((p->>'force')::boolean,false) then return jsonb_build_object('unchanged',true,'payload_hash',v_hash); end if;
  insert into lg3s_roster_snapshots(captured_at, source, source_url, payload_hash, n_players)
  values ((p->>'captured_at')::timestamptz, p->>'source', p->>'source_url', v_hash, jsonb_array_length(p->'rows')) returning id into v_id;
  insert into lg3s_roster_snapshot_rows(snapshot_id, lg_user_id, gamertag, lg_team_id, position, role)
  select v_id, (x->>'lg_user_id')::bigint, x->>'gamertag', (x->>'lg_team_id')::int, x->>'position', x->>'role' from jsonb_array_elements(p->'rows') x;
  return jsonb_build_object('snapshot_id', v_id, 'payload_hash', v_hash);
end $$;

revoke all on function public.lg3s_threes_feed(text,text), public.lg3s_threes_prompt(text), public.lg3s_store_threes(jsonb), public.lg3s_ingest_roster(jsonb) from public, anon, authenticated;
grant execute on function public.lg3s_threes_feed(text,text), public.lg3s_threes_prompt(text), public.lg3s_store_threes(jsonb), public.lg3s_ingest_roster(jsonb) to service_role;
revoke all on function private.lg3s_feed_daily_three(date), private.lg3s_feed_power_rankings(int,date), private.lg3s_duo_pairs(date), private.lg3s_feed_duo_index(int,date,int),
  private.lg3s_feed_roster_wire(bigint), private.lg3s_feed_pick3(int) from public, anon, authenticated;
grant all on public.lg3s_prompts, public.lg3s_roster_snapshots, public.lg3s_roster_snapshot_rows, public.lg3s_generation_runs to service_role;
grant usage, select on all sequences in schema public to service_role;

-- kicker (token read inside DB; never exposed)
create or replace function private.lg3s_kick_threes(p_body jsonb)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_req bigint;
begin
  select net.http_post(
    url := 'https://lrgllzvwgvqagcpiyvfd.supabase.co/functions/v1/lg3s-threes-bot',
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-token', (select value from public.lg_sync_settings where key = 'sync_token')),
    timeout_milliseconds := 150000) into v_req;
  return v_req;
end $$;
revoke all on function private.lg3s_kick_threes(jsonb) from public, anon, authenticated;

-- prompt seed v1 (files: threes-bot/prompts/*.v1.md)
insert into public.lg3s_prompts(feature,version,body) values ('base',1,$p$You are Threes Bot, the LG3s desk writer for Elite Chel Media's international 3s league.
Voice: punchy, fun, lightly trash-talky — never mean, never personal.
Rules:
- Use ONLY the data in the FEED. Never invent players, teams, scores, stats, trades, quotes or injuries.
- Every number you write must appear in the FEED exactly as given (do not compute new totals or percentages).
- Write gamertags and team names exactly as they appear in the FEED (case, spaces, symbols).
- Never mention data sources, syncing, websites, databases, scrapers or "the feed" in public copy.
- If the FEED is empty, inconsistent or marked insufficient, return {"error": "<short reason>"} and nothing else.
- Output a single JSON object only. No markdown, no commentary.
- Every headline must be under 70 characters.
$p$) on conflict do nothing;
insert into public.lg3s_prompts(feature,version,body) values ('daily_three',1,$p$FEATURE: DAILY THREE (morning after a game night).
Pick exactly three items from the FEED for FEED.date:
1. slot "performer": the night's best individual performance (use FEED.top_performers). stat_line must be copied from that player's stat_line.
2. slot "stat": one striking number from FEED.notable_stats; stat_value copied exactly, subject is the player or team it belongs to.
3. slot "storyline": a team/standings storyline from FEED.storylines; list the teams and players it involves.
Blurbs are 2-3 sentences. tagline under 12 words.
Return exactly:
{"date":"","tagline":"","items":[{"slot":"performer","headline":"","blurb":"","player":"","team":"","stat_line":""},{"slot":"stat","headline":"","blurb":"","stat_value":"","subject":""},{"slot":"storyline","headline":"","blurb":"","teams":[],"players":[]}]}
$p$) on conflict do nothing;
insert into public.lg3s_prompts(feature,version,body) values ('duo_index',1,$p$FEATURE: DUO INDEX (weekly).
The FEED already ranks eligible pairs (minimum 4 games together, at most one pair per team in the top 5). Do not re-rank and do not change any number.
For each FEED.top_duos entry copy rank, players, team, games_together, record_together, goal_diff_per_game and points_per_game exactly; add a fun nickname and a one-sentence breakdown using only FEED numbers.
odd_couple: pick from FEED.odd_couple_candidates. needs_counseling: pick from FEED.needs_counseling_candidates.
If FEED.top_duos is empty, return {"error": FEED.insufficient_reason}.
Return exactly:
{"week_label":"","top_duos":[{"rank":1,"players":["",""],"team":"","nickname":"","games_together":0,"record_together":"","goal_diff_per_game":0,"points_per_game":0,"breakdown":""}],"odd_couple":{"players":[],"team":"","note":""},"needs_counseling":{"players":[],"team":"","note":""}}
$p$) on conflict do nothing;
insert into public.lg3s_prompts(feature,version,body) values ('pick3_preview',1,$p$FEATURE: PICK YOUR 3 — PROMPT A (prices + preview).
Rules for readers: pick 3 skaters, max 1 per team, $30 cap. Scoring: goal 3, assist 2, shot on goal 0.5, hit 0.25, team win 1, hat trick +3. Picks lock at the week's first puck drop.
Prices are already set in FEED.players (computed from points per game first, then the last 3 games, then matchup when available). Copy player, team, price, opponents and is_value_pick exactly. Write a short note per player and a punchy intro that mentions the $30 cap.
Return exactly:
{"week_label":"","intro":"","players":[{"player":"","team":"","price":0,"opponents":[],"is_value_pick":false,"note":""}]}
$p$) on conflict do nothing;
insert into public.lg3s_prompts(feature,version,body) values ('pick3_recap',1,$p$FEATURE: PICK YOUR 3 — PROMPT B (weekly recap).
FEED contains site-scored results. NEVER recalculate points; copy every number exactly from FEED.
Return exactly:
{"week_label":"","headline":"","recap":"","mvp_pick":{"player":"","points":0,"picked_by_pct":0,"note":""},"bust":{"player":"","points":0,"picked_by_pct":0,"note":""},"steal":{"player":"","price":0,"points":0,"note":""},"weekly_winner_shoutout":"","season_leader_shoutout":""}
$p$) on conflict do nothing;
insert into public.lg3s_prompts(feature,version,body) values ('roster_wire',1,$p$FEATURE: ROSTER WIRE (after each roster update).
FEED.moves is the computed difference versus the previous roster. Keep every move, newest first, copying date, type, players, from_team and to_team exactly. Write a ticker under 100 characters, a hot_take, impact (Blockbuster|Big|Depth), is_big_move (true only for Blockbuster or Big) and winner (a team name from the move, or "TBD").
If FEED.moves is empty, return "moves": [] and a fun one-sentence quiet_note.
Return exactly:
{"updated_label":"","moves":[{"date":"","type":"","players":[],"from_team":"","to_team":"","ticker":"","is_big_move":false,"impact":"Depth","hot_take":"","winner":""}],"quiet_note":""}
$p$) on conflict do nothing;
insert into public.lg3s_prompts(feature,version,body) values ('trio_power_rankings',1,$p$FEATURE: TRIO POWER RANKINGS (weekly, after the week's last game night).
Rank every team in FEED.teams. Start from FEED.teams[].standings_rank and adjust only for form shown in FEED (recent results, goal difference, top players). Copy record and last_rank exactly from FEED; movement is "new" when last_rank is null, otherwise up/down/same versus last_rank.
trio_grade is one of A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F. vibe is 3-5 words. take is 2 sentences and names at least one player from that team's key_players. key_players come from that team's FEED.top_players.
Return exactly:
{"week_label":"","rankings":[{"rank":1,"team":"","last_rank":null,"movement":"new","record":"","trio_grade":"","vibe":"","take":"","key_players":[]}],"riser":{"team":"","note":""},"faller":{"team":"","note":""}}
$p$) on conflict do nothing;
