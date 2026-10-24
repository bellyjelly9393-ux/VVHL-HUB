import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PUBLIC_SOURCES, FORBIDDEN_NAME, FORBIDDEN_COLUMNS, PrivacyError, assertPublicRead, createPublicReader, snapshotBackend } from '../supabase/functions/lgchl-league-writer/public-sources.mjs';
import { loadNight } from '../supabase/functions/lgchl-league-writer/load.mjs';
import { composeNightWrap, mention } from '../supabase/functions/lgchl-league-writer/compose.mjs';

const DIR = new URL('../supabase/functions/lgchl-league-writer/', import.meta.url);
// Real private tables in the hub database that must never feed a league write-up.
const PRIVATE_TABLES = ['hitmen_opponent_ea_games', 'hitmen_opponent_pregame_reports', 'hitmen_opponent_player_scout_reports', 'hitmen_opponent_zone_stats',
  'hitmen_opponent_player_shot_history', 'hitmen_opponent_lg_games', 'hitmen_opponent_lg_player_games', 'hitmen_battle_plans', 'hitmen_unit_plans', 'hitmen_ai_analysis_runs',
  'hitmen_player_reports', 'hitmen_roster_snapshot', 'lgchl_hitmen_box_scores', 'lgchl_hitmen_player_lines', 'lgchl_hitmen_roster', 'lgchl_hitmen_tonight_six', 'player_chemistry_scores', 'player_intelligence_profiles',
  'player_valuation_snapshots', 'scouting_notes', 'scouting_auto_reports', 'scouting_manual_reports', 'scouting_players', 'scouting_shot_events', 'team_scouting_reports',
  'team_pre_scout_reports', 'team_chelscout_intel', 'team_external_scouting_reports', 'team_line_weekly_reports', 'team_player_game_reports', 'vod_review_sessions',
  'vod_observations', 'vod_review_markers', 'vod_evidence_history', 'vods', 'lineups', 'lineup_slots', 'wm_game_lineup', 'media_posts', 'postgame_media_jobs', 'lg_auth_snapshots',
  'integration_server_secrets', 'lg_roster_players', 'team_competitive_games'];

test('allowlist contains only public LG sources and no forbidden table or column', () => {
  for (const [t, src] of Object.entries(PUBLIC_SOURCES)) {
    assert.ok(!FORBIDDEN_NAME.test(t), t + ' matches the forbidden-name guard');
    assert.ok(!PRIVATE_TABLES.includes(t), t + ' is a private table');
    for (const c of src.columns) assert.ok(!FORBIDDEN_COLUMNS.has(c), t + '.' + c + ' is a forbidden column');
  }
  assert.deepEqual(Object.keys(PUBLIC_SOURCES).sort(), ['lg_game_box_scores', 'lg_game_player_lines', 'lg_player_season_stats', 'lgchl_games', 'lgchl_player_stat_history',
    'lgchl_standings_current', 'lgchl_standings_snapshots', 'lgchl_teams', 'wm_lgchl_s55_player_leaders'], 'adding a source is a privacy review: update this list deliberately');
});

test('every private table is refused by the reader', async () => {
  const reader = createPublicReader(async () => [{ secret: 'x' }]);
  for (const t of PRIVATE_TABLES) {
    assert.ok(FORBIDDEN_NAME.test(t) || !(t in PUBLIC_SOURCES), t);
    await assert.rejects(reader.read(t, ['id']), PrivacyError, t);
  }
  assert.equal(reader.reads.length, 0, 'no backend call was attempted');
});

test('select *, embeds, private columns and unfiltered season stats are refused', () => {
  assert.throws(() => assertPublicRead('lgchl_games', ['*']), PrivacyError);
  assert.throws(() => assertPublicRead('lgchl_games', []), PrivacyError);
  assert.throws(() => assertPublicRead('lgchl_games', ['lg_game_id', 'hitmen_opponents(*)']), PrivacyError);
  assert.throws(() => assertPublicRead('lg_game_player_lines', ['gamertag', 'lg_user_id']), PrivacyError);
  assert.throws(() => assertPublicRead('lg_game_player_lines', ['raw']), PrivacyError);
  assert.throws(() => assertPublicRead('lg_player_season_stats', ['gamertag', 'scouting_player_id'], { league_code: { op: 'eq', value: 'LGCHL' }, season_type: { op: 'eq', value: 'regular' } }), PrivacyError);
  assert.throws(() => assertPublicRead('lg_player_season_stats', ['gamertag']), PrivacyError, 'must be pinned to LGCHL regular season');
  assert.throws(() => assertPublicRead('lg_game_box_scores', ['lg_game_id', 'period_stats'], { league: { op: 'eq', value: 'LGCHL' } }), PrivacyError);
  assert.throws(() => assertPublicRead('lgchl_games', ['lg_game_id'], { team_id: { op: 'eq', value: 1 } }), PrivacyError);
  assert.throws(() => assertPublicRead('lgchl_games', ['lg_game_id'], { season: { op: 'like', value: '%' } }), PrivacyError);
  assert.doesNotThrow(() => assertPublicRead('lgchl_games', ['lg_game_id', 'game_at'], { season: { op: 'eq', value: 55 } }));
});

test('rows are re-projected, so an over-returning backend cannot leak a column', async () => {
  const reader = createPublicReader(async () => [{ gamertag: 'A', goals: 1, lg_user_id: 999, raw: { x: 1 } }]);
  const rows = await reader.read('lg_game_player_lines', ['gamertag', 'goals']);
  assert.deepEqual(rows, [{ gamertag: 'A', goals: 1 }]);
});

test('writer source never touches a database client or a private table directly', () => {
  for (const f of ['compose.mjs', 'load.mjs']) {
    const src = fs.readFileSync(new URL(f, DIR), 'utf8');
    assert.ok(!/supabase-js|createClient|\.from\(|\.rpc\(|fetch\(/.test(src), f + ' must only use the reader');
    for (const t of PRIVATE_TABLES) assert.ok(!src.includes(t), f + ' mentions ' + t);
    for (const m of src.matchAll(/reader\.read\('([a-z0-9_]+)'/g)) assert.ok(m[1] in PUBLIC_SOURCES, m[1]);
  }
  const index = fs.readFileSync(new URL('index.ts', DIR), 'utf8');
  for (const t of PRIVATE_TABLES) assert.ok(!index.includes(t), 'index.ts mentions ' + t);
  assert.ok(!/publish|discord|webhook/i.test(index.replace(/No AI, no LG requests, no publishing, no Discord\./, '')), 'index.ts must not publish or post');
});

// ---------- synthetic night: 4 teams, 2 games ----------
const iso = (s) => new Date(s).toISOString();
function fixture({ extraPrivate = true } = {}) {
  const teams = [1, 2, 3, 4].map((id) => ({ lg_team_id: id, season: 55, name: ['Alpha Aces', 'Bravo Bears', 'Charlie Cats', 'Delta Dogs'][id - 1], abbr: 'T' + id, nickname: ['Aces', 'Bears', 'Cats', 'Dogs'][id - 1], league: 'WHL', conference: 'Eastern', division: 'WHL Eastern 1' }));
  const games = [
    { lg_game_id: 11, season: 55, week: 3, game_at: iso('2026-10-14T01:00Z'), away_lg_team_id: 1, home_lg_team_id: 2, away_score: 4, home_score: 3, status: 'final', decided_in: null, source_url: 'https://lg.example/11' },
    { lg_game_id: 12, season: 55, week: 3, game_at: iso('2026-10-14T01:00Z'), away_lg_team_id: 3, home_lg_team_id: 4, away_score: 0, home_score: 3, status: 'final', decided_in: null, source_url: 'https://lg.example/12' },
    { lg_game_id: 13, season: 55, week: 4, game_at: iso('2026-10-19T01:00Z'), away_lg_team_id: 1, home_lg_team_id: 3, away_score: null, home_score: null, status: 'scheduled', decided_in: null, source_url: null },
  ];
  const snap = (id, t, gp, w, l, otw, otl, gf, ga, streak) => ({ season: 55, lg_team_id: id, taken_at: iso(t), gp, w, l, otw, otl, pts: 2 * w + otl, gf, ga, gd: gf - ga, streak, last10: '5-5-0', division_rank: 1 });
  const snapshots = [
    snap(1, '2026-10-13T03:00Z', 10, 5, 5, 0, 0, 30, 30, '-1L'), snap(2, '2026-10-13T03:00Z', 10, 8, 2, 0, 0, 40, 20, '4W'),
    snap(3, '2026-10-13T03:00Z', 10, 6, 4, 0, 0, 30, 25, '1W'), snap(4, '2026-10-13T03:00Z', 10, 2, 8, 0, 0, 15, 40, '-3L'),
    snap(1, '2026-10-14T01:40Z', 11, 6, 5, 1, 0, 34, 33, '1W'), snap(2, '2026-10-14T01:40Z', 11, 8, 2, 0, 1, 43, 24, '-1L'),
    snap(3, '2026-10-14T01:40Z', 11, 6, 5, 0, 0, 30, 28, '-1L'), snap(4, '2026-10-14T01:40Z', 11, 3, 8, 0, 0, 18, 40, '1W'),
  ];
  const boxes = [{ lg_game_id: 11, league: 'LGCHL', season: 55, home_lg_team_id: 2, away_lg_team_id: 1, home_team_name: 'Bravo Bears', away_team_name: 'Alpha Aces', home_score: 3, away_score: 4, team_stats: ['goals', '4', 'shots', '20', 'goals', '3', 'shots', '25'], captured_at: iso('2026-10-14T03:00Z'), period_stats: ['SECRET_PERIOD_BLOB'] }];
  const L = (gamertag, side, position, goals, assists, extra = {}) => ({ lg_game_id: 11, gamertag, team_name: null, side, position, goals, assists, points: goals + assists, plus_minus: 0, shots: 3, hits: 0, ppg: 0, shg: 0, gwg: 0, saves: 0, shots_against: 0, goals_against: 0, lg_user_id: 123456, raw: { canary: 'RAW_CANARY' }, ...extra });
  const lines = [L('ace_one', 'away', 'C', 3, 0, { gwg: 1 }), L('ace two', 'away', 'LW', 1, 2), L('a3', 'away', 'RW', 0, 1), L('a4', 'away', 'LD', 0, 0), L('a5', 'away', 'RD', 0, 0), L('aceG', 'away', 'G', 0, 0, { saves: 22, shots_against: 25, goals_against: 3 }),
    L('bear_1', 'home', 'C', 2, 0), L('b2', 'home', 'LW', 1, 1), L('b3', 'home', 'RW', 0, 1), L('b4', 'home', 'LD', 0, 0), L('b5', 'home', 'RD', 0, 0), L('bearG', 'home', 'G', 0, 0, { saves: 16, shots_against: 20, goals_against: 4 })];
  const leaders = [
    { gamertag: 'ace_one', position: 'C', player_kind: 'skater', lg_team_id: 1, team_name: 'Alpha Aces', gp: 4, fetched_at: iso('2026-10-14T10:00Z'), goals: 11, assists: 9, points: 20, plus_minus: 3, shots: 40, hits: 1, takeaways: 1, blocked_shots: 0, save_pct: null, gaa: null, goalie_shots_against: null, goalie_goals_against: null },
    { gamertag: 'bear_1', position: 'C', player_kind: 'skater', lg_team_id: 2, team_name: 'Bravo Bears', gp: 4, fetched_at: iso('2026-10-14T10:00Z'), goals: 15, assists: 20, points: 35, plus_minus: 3, shots: 40, hits: 1, takeaways: 1, blocked_shots: 0, save_pct: null, gaa: null, goalie_shots_against: null, goalie_goals_against: null },
  ];
  const snapshot = { lgchl_teams: teams, lgchl_games: games, lgchl_standings_snapshots: snapshots, lgchl_standings_current: [], lg_game_box_scores: boxes, lg_game_player_lines: lines, wm_lgchl_s55_player_leaders: leaders, lg_player_season_stats: [] };
  if (extraPrivate) Object.assign(snapshot, {
    hitmen_opponent_ea_games: [{ note: 'PRIVATE_CANARY_EA' }], scouting_notes: [{ body: 'PRIVATE_CANARY_SCOUT' }], vod_observations: [{ note: 'PRIVATE_CANARY_VOD' }],
    player_chemistry_scores: [{ score: 'PRIVATE_CANARY_CHEM' }], hitmen_opponent_pregame_reports: [{ body: 'PRIVATE_CANARY_PREGAME' }],
  });
  return snapshot;
}
async function run(snapshot = fixture(), opts = {}) {
  const reader = createPublicReader(snapshotBackend(snapshot));
  const ctx = await loadNight(reader, { night: '2026-10-13' });
  return { wrap: composeNightWrap(ctx, { generatedAt: '2026-10-14T12:00:00Z', ...opts }), reader };
}

test('full pipeline never reads private tables and never emits private canaries', async () => {
  const { wrap, reader } = await run();
  assert.ok(wrap.ok);
  const read = new Set(reader.reads.map((r) => r.table));
  for (const t of read) assert.ok(t in PUBLIC_SOURCES, t);
  const out = JSON.stringify(wrap);
  for (const c of ['PRIVATE_CANARY', 'RAW_CANARY', 'SECRET_PERIOD_BLOB', '123456']) assert.ok(!out.includes(c), c + ' leaked');
});

test('night wrap content is computed from the data, deterministic and cites only real players', async () => {
  const a = (await run()).wrap, b = (await run()).wrap;
  assert.equal(a.markdown, b.markdown, 'deterministic');
  assert.match(a.markdown, /^status: draft$/m);
  assert.match(a.markdown, /published: false/);
  assert.match(a.markdown, /Alpha Aces 4\*\* \| @ \| Bravo Bears 3 \| OT/, 'OT detected from LG OTW/OTL snapshot deltas');
  assert.match(a.markdown, /\*\*Delta Dogs 3\*\* \| shutout/);
  assert.match(a.markdown, /Hat tricks:\*\* \*\*@ace\\_one\*\* \(Alpha Aces\)/);
  assert.match(a.markdown, /@ace\\_one\*\* \(Alpha Aces\) reached 20 points tonight; 20 on the season/);
  assert.match(a.markdown, /Snapped:\*\* Bravo Bears \(had won 4 straight\)/);
  const known = new Set(fixture().lg_game_player_lines.map((l) => l.gamertag).concat(fixture().wm_lgchl_s55_player_leaders.map((p) => p.gamertag)));
  for (const m of a.mentions) assert.ok(known.has(m), m);
  assert.equal(mention('mr_couture._85073'), '**@mr\\_couture.\\_85073**');
  assert.ok(!/said|told|believes|feels|according to/i.test(a.markdown), 'no invented quotes or attributions');
});

test('a night with games still in progress is not written unless asked', async () => {
  const s = fixture(); s.lgchl_games[1] = { ...s.lgchl_games[1], status: 'scheduled', away_score: null, home_score: null };
  const { wrap } = await run(s);
  assert.equal(wrap.ok, false);
  assert.match(wrap.reason, /1 of 2 games are not final/);
});

test('milestones need every team game that night box-scored', async () => {
  const s = fixture();
  s.lgchl_games.push({ lg_game_id: 14, season: 55, week: 3, game_at: iso('2026-10-14T01:35Z'), away_lg_team_id: 1, home_lg_team_id: 4, away_score: 2, home_score: 1, status: 'final', decided_in: null, source_url: null });
  const { wrap } = await run(s);
  assert.ok(wrap.ok);
  assert.ok(!/reached 20 points tonight/.test(wrap.markdown), 'Alpha played an un-box-scored game, so the pre-night total is unknown');
  assert.match(wrap.markdown, /1 of 2 games box-scored/);
});

test('partial night: finals written, unreported games listed by schedule only, no invented result', async () => {
  const s = fixture();
  s.lgchl_games[1] = { ...s.lgchl_games[1], status: 'scheduled', away_score: null, home_score: null, source_url: null };
  // Four more finals the same night -> 5 of 6 final (83%).
  [[21, 2, 1, 2, 5], [22, 4, 1, 1, 2], [23, 1, 4, 3, 1], [24, 3, 2, 2, 4]].forEach(([id, a, h, as, hs]) =>
    s.lgchl_games.push({ lg_game_id: id, season: 55, week: 3, game_at: iso('2026-10-14T00:30Z'), away_lg_team_id: a, home_lg_team_id: h, away_score: as, home_score: hs, status: 'final', decided_in: null, source_url: null }));
  const { wrap } = await run(s, { allowPartial: true, minFinalShare: 0.8 });
  assert.ok(wrap.ok, wrap.reason);
  assert.deepEqual(wrap.metrics.not_reported, [12]);
  assert.equal(wrap.metrics.finals, 5);
  assert.equal(wrap.metrics.scheduled_games, 6);
  assert.ok(!wrap.scores.some((g) => g.lg_game_id === 12), 'unreported game has no score card');
  const sources = wrap.markdown.slice(wrap.markdown.indexOf('## Sources & coverage'));
  assert.match(sources, /- Gap: Not yet reported \(1\): Charlie Cats at Delta Dogs, scheduled 9:00 PM ET \(LG game 12\)\./);
  const before = wrap.markdown.slice(0, wrap.markdown.indexOf('## Sources & coverage'));
  assert.ok(!/Charlie Cats \d|Delta Dogs \d/.test(before.split('\n').filter((l) => /Charlie Cats/.test(l) && /Delta Dogs/.test(l)).join('\n')), 'no result line pairs the unreported teams');
});

test('partial night below the 80% floor saves nothing and says why', async () => {
  const s = fixture(); s.lgchl_games[1] = { ...s.lgchl_games[1], status: 'scheduled', away_score: null, home_score: null };
  const { wrap } = await run(s, { allowPartial: true, minFinalShare: 0.8 });
  assert.equal(wrap.ok, false);
  assert.match(wrap.reason, /only 1 of 2 games are final \(50%, need 80%\)/);
  assert.deepEqual(wrap.pending, [12]);
});

test('nightly edge path runs in partial mode with the 80% floor and logs refusals', () => {
  const src = fs.readFileSync(new URL('index.ts', DIR), 'utf8');
  assert.match(src, /composeNightWrap\(ctx, \{ allowPartial: body\.partial !== false, minFinalShare: 0\.8 \}\)/);
  assert.match(src, /console\.log\(JSON\.stringify\(\{ writer: WRITER_VERSION, night, saved: false, reason/);
  assert.ok(src.indexOf('if (!wrap.ok)') < src.indexOf("db.rpc('lgchl_media_save_draft'"), 'refusal returns before any save');
});

test('Players of the Night: three stars and goalie of the night from stat-history deltas, with coverage', async () => {
  const s = fixture();
  const H = (gamertag, kind, team, t, gp, goals, assists, ga = null, sa = null) => ({ season: 55, player_kind: kind, gamertag, lg_team_id: team, position: kind === 'goalie' ? 'G' : 'C', gp, goals, assists, points: goals + assists, plus_minus: 0, shots: 10, hits: 0,
    goalie_saves: sa == null ? null : sa - ga, goalie_shots_against: sa, goalie_goals_against: ga, taken_at: iso(t) });
  s.lgchl_player_stat_history = [
    H('star_a', 'skater', 1, '2026-10-13T15:00Z', 3, 1, 1), H('star_a', 'skater', 1, '2026-10-14T10:00Z', 5, 4, 3),
    H('star_b', 'skater', 2, '2026-10-13T15:00Z', 3, 0, 0), H('star_b', 'skater', 3, '2026-10-14T10:00Z', 5, 2, 3), // traded mid-night: still counted
    H('star_c', 'skater', 4, '2026-10-13T15:00Z', 3, 0, 0), H('star_c', 'skater', 4, '2026-10-14T10:00Z', 5, 1, 1),
    H('newbie', 'skater', 4, '2026-10-14T10:00Z', 2, 5, 5), // no pre-night total: never ranked
    H('wall', 'goalie', 2, '2026-10-13T15:00Z', 3, 0, 0, 5, 60), H('wall', 'goalie', 2, '2026-10-14T10:00Z', 5, 0, 0, 7, 120),
    H('sieve', 'goalie', 3, '2026-10-13T15:00Z', 3, 0, 0, 5, 60), H('sieve', 'goalie', 3, '2026-10-14T10:00Z', 4, 0, 0, 6, 70), // 10 shots: below 50
  ];
  const { wrap } = await run(s);
  assert.ok(wrap.ok);
  const sec = wrap.markdown.slice(wrap.markdown.indexOf('## Players of the Night'), wrap.markdown.indexOf('## Player spotlights'));
  assert.match(sec, /\*\*First star:\*\* \*\*@star\\_a\*\* \(Alpha Aces\) — 3 G, 2 A, 5 PTS in two games/);
  assert.match(sec, /\*\*Second star:\*\* \*\*@star\\_b\*\* \(Charlie Cats\)/);
  assert.match(sec, /\*\*Goalie of the night:\*\* \*\*@wall\*\* \(Bravo Bears\) — 58 saves on 60 shots/);
  assert.ok(!/newbie|sieve/.test(sec), 'no pre-night total or too few shots: not ranked');
  assert.match(sec, /goals accounted for/);
});

test('LG Media page picks Players of the Night with the same rule', async () => {
  const vm = await import('node:vm');
  const win = { WMDesk: { $: () => null, esc: (x) => String(x), read: async () => [], ordinal: String, tint: () => {}, F: {} } };
  vm.runInNewContext(fs.readFileSync(new URL('../lgchl-media-segments.js', import.meta.url), 'utf8'), { window: win });
  const R = (night, kind, gamertag, points, goals, extra = {}) => ({ night, night_finals: 2, night_final_goals: 10, player_kind: kind, gamertag, lg_team_id: 1, gp: 2, points, goals, shots: 5, ...extra });
  const n = win.LGCHLSegments.pickNight([R('2026-10-12', 'skater', 'old', 9, 9), R('2026-10-13', 'skater', 'b', 4, 1), R('2026-10-13', 'skater', 'a', 4, 3), R('2026-10-13', 'skater', 'zero', 0, 0),
    R('2026-10-13', 'goalie', 'g1', 0, 0, { saves: 45, shots_against: 49 }), R('2026-10-13', 'goalie', 'g2', 0, 0, { saves: 50, shots_against: 55 })]);
  assert.equal(n.night, '2026-10-13');
  assert.deepEqual(n.skaters.map((p) => p.gamertag), ['a', 'b']);
  assert.deepEqual(n.goalies.map((p) => p.gamertag), ['g2'], '50+ shots faced');
  assert.equal(n.goals, 4); assert.equal(n.finalGoals, 10);
});

test('Players of the Night views read only public schedule and stat-history tables', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261019200000_lgchl_players_of_the_night.sql', import.meta.url), 'utf8');
  const tables = new Set([...sql.matchAll(/(?:from|join)\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]));
  assert.deepEqual([...tables].sort(), ['lgchl_games', 'lgchl_player_stat_history']);
  assert.ok(!/lg_user_id|scouting|hitmen/i.test(sql.replace(/^--.*$/gm, '')));
  assert.match(sql, /security_invoker = true/);
});
