// LGCHL (LeagueGaming CHL, league 39, S55) league feed: read side.
// The data is scraped by the Supabase Edge Function `lgchl-league-sync` (pg_cron) into
// public.lgchl_teams / lgchl_games / lgchl_standings_snapshots and read here through the public
// views lgchl_standings_current + lgchl_games_board with the publishable key (public, read-only
// RLS). Vercel never contacts LeagueGaming. Shared by api/lgchl-scores.js (site ticker) and the
// War Room landing league crawl. See docs/lgchl-league-feed.md.

export const LEAGUE_ID = 39;
export const SEASON = 55;
export const HITMEN_LG_TEAM_ID = 412;
const BASE = 'https://lrgllzvwgvqagcpiyvfd.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
const CACHE_MS = 60e3;          // per warm instance; the CDN adds s-maxage on top
const GAME_LEN = 35 * 60e3;     // LG slots games 35 minutes apart
const PAGE = 1000;              // PostgREST max rows per request

const GAME_COLS = 'lg_game_id,week,game_at,status,decided_in,away_lg_team_id,home_lg_team_id,away_score,home_score,league,interleague,big_game,big_reasons,source_url,updated_at';
const TEAM_COLS = 'lg_team_id,name,abbr,nickname,league,conference,division,logo_path,gp,w,l,otw,otl,pts,gf,ga,gd,streak,last10,division_rank,conference_rank,conference_size,standings_at';

let restFetch = (url, init) => fetch(url, init); // injectable for tests
export function setRestFetcher(fn) { restFetch = fn; }

async function rest(pathAndQuery) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const r = await restFetch(`${process.env.SUPABASE_URL || BASE}/rest/v1/${pathAndQuery}`, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY || PUBLISHABLE_KEY, Accept: 'application/json', Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok && r.status !== 206) throw Object.assign(new Error('supabase ' + r.status), { status: 502 });
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const cache = new Map();
async function cached(key, fn, now) {
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  try { const value = await fn(); cache.set(key, { at: now, value }); return value; }
  catch (e) { if (hit) return hit.value; throw e; } // serve last good copy if Supabase blips
}

const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const etDay = ms => ET_DAY.format(ms);

export function gameState(g, now) {
  if (g.status === 'final') return 'final';
  if (g.status === 'postponed' || g.status === 'cancelled') return g.status;
  const t = Date.parse(g.game_at);
  if (!Number.isFinite(t)) return 'tbd';
  if (now < t) return 'scheduled';
  if (now < t + GAME_LEN) return 'live';
  return 'pending';
}
function shape(g, now) {
  return {
    id: g.lg_game_id, week: g.week, at: g.game_at, state: gameState(g, now),
    away: g.away_lg_team_id, home: g.home_lg_team_id, away_score: g.away_score, home_score: g.home_score,
    league: g.league, big: g.big_game ? g.big_reasons : null, url: g.source_url,
  };
}
function team(t) {
  return {
    id: t.lg_team_id, name: t.name, abbr: t.abbr, nick: t.nickname, logo: t.logo_path,
    league: t.league, conference: t.conference, table: t.division,
    record: `${t.w}-${t.l}-${t.otl}`, pts: t.pts, gp: t.gp, conf_rank: t.conference_rank, div_rank: t.division_rank,
  };
}

async function loadTeams(now) {
  return cached('teams', async () => {
    const rows = await rest(`lgchl_standings_current?select=${TEAM_COLS}&order=league.asc,conference.asc,conference_rank.asc`);
    return rows;
  }, now);
}
async function loadGames(fromIso, toIso, now) {
  const key = `games|${fromIso}|${toIso}`;
  return cached(key, () => rest(`lgchl_games_board?select=${GAME_COLS}&season=eq.${SEASON}` +
    (fromIso ? `&game_at=gte.${fromIso}` : '') + (toIso ? `&game_at=lt.${toIso}` : '') + '&order=game_at.asc,lg_game_id.asc'), now);
}

function meta(teams, games) {
  const lastUpdate = games.reduce((m, g) => (g.updated_at > m ? g.updated_at : m), '');
  return {
    ok: true, league: 'LGCHL', league_id: LEAGUE_ID, season: SEASON,
    source: 'Supabase lgchl_games (scraped from leaguegaming.com by lgchl-league-sync)',
    standings_at: teams[0]?.standings_at || null, games_updated_at: lastUpdate || null, game_window_min: GAME_LEN / 60e3,
  };
}

// Ticker rule (Seth, 2026-10-04): every WHL game + only the "big games" from OHL/QMJHL
// (lgchl_games_board.big_game, see the migration for the rule). Hitmen games are excluded from the
// league section because the Hitmen block already shows them.
export function featured(g, { scope = 'featured', includeHitmen = false } = {}) {
  if (!includeHitmen && (g.away_lg_team_id === HITMEN_LG_TEAM_ID || g.home_lg_team_id === HITMEN_LG_TEAM_ID)) return false;
  if (scope === 'all') return true;
  if (scope === 'whl') return g.league === 'WHL';
  if (scope === 'big') return !!g.big_game;
  return g.league === 'WHL' || !!g.big_game; // featured
}

export async function view(name, opts = {}, now = Date.now()) {
  const teamsRows = await loadTeams(now);
  const teams = Object.fromEntries(teamsRows.map(t => [t.lg_team_id, team(t)]));
  if (name === 'standings') return { ...meta(teamsRows, []), counts: { teams: teamsRows.length }, teams, standings: teamsRows };
  if (name === 'season') {
    const games = await loadGames(null, null, now);
    return { ...meta(teamsRows, games), counts: { teams: teamsRows.length, games: games.length, finals: games.filter(g => g.status === 'final').length, big: games.filter(g => g.big_game).length }, teams, standings: teamsRows, games: games.map(g => shape(g, now)) };
  }
  // ticker: latest ET night with finals before today + today's slate (+ next night if today is empty)
  const from = new Date(now - 8 * 864e5).toISOString(), to = new Date(now + 8 * 864e5).toISOString();
  const window = await loadGames(from, to, now);
  const all = window.filter(g => g.game_at && featured(g, opts));
  const today = etDay(now);
  const day = g => etDay(Date.parse(g.game_at));
  const todayGames = all.filter(g => day(g) === today);
  const past = window.filter(g => g.status === 'final' && day(g) < today);
  const lastDay = past.length ? day(past[past.length - 1]) : null;
  const lastNight = lastDay ? all.filter(g => day(g) === lastDay) : [];
  let nextDay = null, next = [];
  if (!todayGames.length) {
    const fut = window.find(g => Date.parse(g.game_at) > now);
    if (fut) { nextDay = day(fut); next = all.filter(g => day(g) === nextDay); }
  }
  const used = new Set([...todayGames, ...lastNight, ...next].flatMap(g => [g.away_lg_team_id, g.home_lg_team_id]));
  return {
    ...meta(teamsRows, window),
    scope: opts.scope || 'featured', hitmen_excluded: !opts.includeHitmen,
    counts: { teams: teamsRows.length, window_games: window.length, featured: todayGames.length + lastNight.length + next.length },
    teams: Object.fromEntries(Object.entries(teams).filter(([id]) => used.has(Number(id)))),
    last_night: lastDay ? { day: lastDay, games: lastNight.map(g => shape(g, now)) } : null,
    today: { day: today, games: todayGames.map(g => shape(g, now)) },
    next_night: nextDay ? { day: nextDay, games: next.map(g => shape(g, now)) } : null,
  };
}
export function __clearCache() { cache.clear(); }
