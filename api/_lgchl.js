// LGCHL (LeagueGaming CHL, league 39) league-wide schedule/scores crawler.
// Shared by api/lgchl-scores.js (site ticker) and, later, the War Room landing crawl.
//
// SOURCE (public LG HTML; there is no league-wide schedule/scores page or JSON API):
//   1. Standings   index.php?leaguegaming/league&action=league&page=standing&leagueid=39&seasonid=55
//      -> all 62 teams, their table (WHL/OHL/QMJHL Eastern/Western) and GP/W/L/OTW/OTL/PTS...
//   2. Per-team full season schedule
//      index.php?leaguegaming/league&action=league_page&page=team_page_schedule&teamid=ID&leagueid=39&seasonid=55
//      -> every game for that team: LG game id, away team (left), home team (right), score if final,
//         date/time in US Eastern ("Sun Oct 04 09:00pm", no year). Each game appears on 2 teams' pages.
//   OT/SO is NOT shown on schedule rows; only on each game page (period columns) and as season
//   OTW/OTL totals on the standings. This prototype therefore does not flag OT for league games.
//
// POLITENESS: identified User-Agent, max 2 concurrent requests with a gap between requests,
// in-memory cache per warm function instance + CDN caching on the endpoint.
//   full crawl  = 1 standings + 62 schedule pages (~11-12 MB), at most every FULL_TTL.
//   delta crawl = standings + a minimum set of team pages that covers games that should have
//                 finished but have no score yet (greedy vertex cover), at most every DELTA_TTL.
// Long term this belongs in a scheduled job writing to a table (see docs/lgchl-league-feed.md).

export const LEAGUE_ID = 39;
export const SEASON = 55;
const LG = 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league';
const UA = 'WildmanHockeyHub/1.0 (+https://wildmanhockey-elitechelmedia.app; league ticker, cached)';
const LOGO_DIR = '/assets/lgchl/s55/48/'; // 48px webp crests; 100px PNGs in /assets/lgchl/s55/
const FULL_TTL = 6 * 3600e3;      // full season re-crawl
const DELTA_TTL = 10 * 60e3;      // pending-finals refresh on game nights
const GAME_LEN = 35 * 60e3;       // LG games are slotted 35 minutes apart
const PENDING_GIVE_UP = 8 * 3600e3;
const CONCURRENCY = 2;
const GAP_MS = 250;

// id -> [abbr, nickname]. Names/tables come live from the standings page.
export const TEAM_META = {
  413: ['PAR', 'Raiders'], 377: ['SCB', 'Broncos'], 411: ['MJW', 'Warriors'], 379: ['SAS', 'Blades'],
  414: ['REG', 'Pats'], 409: ['BDN', 'Wheat Kings'], 415: ['EDM', 'Oil Kings'], 385: ['RDR', 'Rebels'],
  416: ['MHT', 'Tigers'], 412: ['CGY', 'Hitmen'], 418: ['LET', 'Hurricanes'], 2983: ['CHW', 'Bruins'],
  419: ['VIC', 'Royals'], 2981: ['PEN', 'Vees'], 423: ['KAM', 'Blazers'], 400: ['KEL', 'Rockets'],
  422: ['PGC', 'Cougars'], 386: ['VAN', 'Giants'], 420: ['SPO', 'Chiefs'], 399: ['TCA', 'Americans'],
  421: ['SEA', 'Thunderbirds'], 380: ['EVT', 'Silvertips'], 2604: ['WEN', 'Wild'], 398: ['POR', 'Winterhawks'],
  445: ['PBO', 'Petes'], 444: ['KGN', 'Frontenacs'], 446: ['OTT', "67's"], 306: ['BFD', 'Bulldogs'],
  401: ['OSH', 'Generals'], 448: ['NBB', 'Battalion'], 402: ['BRM', 'Steelheads'], 447: ['SBY', 'Wolves'],
  375: ['NIA', 'IceDogs'], 449: ['BAR', 'Colts'], 450: ['SSM', 'Greyhounds'], 451: ['SAR', 'Sting'],
  514: ['FLT', 'Firebirds'], 408: ['SAG', 'Spirit'], 381: ['WSR', 'Spitfires'], 452: ['GUE', 'Storm'],
  370: ['LDN', 'Knights'], 383: ['ERI', 'Otters'], 454: ['KIT', 'Rangers'], 453: ['OSA', 'Attack'],
  364: ['HFX', 'Mooseheads'], 455: ['CBE', 'Eagles'], 468: ['CHI', 'Saguenéens'], 365: ['MON', 'Wildcats'],
  457: ['CHA', 'Islanders'], 469: ['BAC', 'Drakkar'], 465: ['RIM', 'Océanic'], 467: ['QUE', 'Remparts'],
  397: ['SJS', 'Sea Dogs'], 2982: ['NFD', 'Regiment'], 459: ['DRU', 'Voltigeurs'], 460: ['VDO', 'Foreurs'],
  382: ['SHA', 'Cataractes'], 466: ['VVL', 'Tigres'], 461: ['GAT', 'Olympiques'], 463: ['SHE', 'Phoenix'],
  462: ['RNH', 'Huskies'], 458: ['BLB', 'Armada'],
};

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ocirc: 'ô' };
const decode = s => String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const text = s => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// ---- time: LG anonymous pages render US Eastern; convert "Sun Oct 04 09:00pm" -> UTC ISO.
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function nyOffsetMs(utcMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(utcMs).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - utcMs;
}
function easternToUtc(y, mo, d, h, mi) {
  const wall = Date.UTC(y, mo, d, h, mi);
  let t = wall - nyOffsetMs(wall);
  t = wall - nyOffsetMs(t); // second pass handles DST edges
  return t;
}
export function parseLgDate(label, now = Date.now()) {
  const m = /([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})\s*([ap]m)/i.exec(label || '');
  if (!m || !(m[1] in MONTHS)) return null;
  let h = Number(m[3]) % 12; if (m[5].toLowerCase() === 'pm') h += 12;
  const year = new Date(now).getUTCFullYear();
  let best = null;
  for (const y of [year - 1, year, year + 1]) { // no year on LG; pick the closest
    const t = easternToUtc(y, MONTHS[m[1]], Number(m[2]), h, Number(m[4]));
    if (best == null || Math.abs(t - now) < Math.abs(best - now)) best = t;
  }
  return new Date(best).toISOString();
}

// ---- parsers (pure; tested against saved HTML fixtures)
export function parseStandings(html) {
  const out = [];
  const chunks = String(html).split('<th rowspan="2">').slice(1);
  const seen = {};
  for (const chunk of chunks) {
    const name = text(chunk.slice(0, chunk.indexOf('<')));
    const body = chunk.slice(0, chunk.indexOf('</table>') >= 0 ? chunk.indexOf('</table>') : undefined);
    seen[name] = (seen[name] || 0) + 1;
    const table = `${name} ${seen[name]}`; // LG repeats each conference title for its two divisions
    const rows = body.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    for (const row of rows) {
      const link = /teamid=(\d+)&(?:amp;)?leagueid=\d+&(?:amp;)?seasonid=\d+">([^<]+)<\/a>/.exec(row);
      if (!link) continue;
      const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).slice(1).map(text);
      const n = i => (cells[i] === undefined || cells[i] === '' ? null : Number(cells[i]));
      out.push({
        lg_team_id: Number(link[1]), name: decode(link[2]).trim(), league: name.split(' ')[0], conference: name, table,
        rank: Number((/opacity:0\.7;">(\d+)\)/.exec(row) || [])[1]) || null,
        gp: n(0), w: n(1), l: n(2), otw: n(3), otl: n(4), pts: n(5), streak: cells[6] || null,
        gf: n(7), ga: n(8), gd: n(9), l10: cells[10] || null, home: cells[11] || null, away: cells[12] || null,
      });
    }
  }
  return out;
}

export function parseTeamSchedule(html, now = Date.now()) {
  const s = String(html);
  const games = [];
  let week = null;
  const re = /<th colspan="5">Week (\d+)<\/th>|<tr class="td_bg_\d*">([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) { week = Number(m[1]); continue; }
    const row = m[2];
    const gid = /page=game&(?:amp;)?gameid=(\d+)/.exec(row);
    const teams = [...row.matchAll(/page=team_page&(?:amp;)?teamid=(\d+)/g)].map(x => Number(x[1]));
    if (!gid || teams.length < 2) continue;
    const center = /<td style="text-align:center">([\s\S]*?)<\/td>/.exec(row);
    const scoreText = center ? text(center[1].split('<br>')[0]) : '';
    const sc = /^(\d+)\s*vs\s*(\d+)$/.exec(scoreText);
    const when = center ? text(center[1].split('<br>').slice(1).join(' ')) : '';
    games.push({
      lg_game_id: Number(gid[1]), season: SEASON, week,
      at: parseLgDate(when, now), at_label_et: when || null,
      away_id: teams[0], home_id: teams[1],              // LG lists the away team first
      away_score: sc ? Number(sc[1]) : null, home_score: sc ? Number(sc[2]) : null,
      final: !!sc,
    });
  }
  return games;
}

// ---- fetching
// NOTE (2026-10-04): from the dev box, LG's Cloudflare front served plain curl normally but
// answered Node's built-in fetch with a "Just a moment..." managed challenge (403). Whether
// Vercel's egress is challenged is untested. Do not try to evade the challenge; if production
// gets 403s, ask LeagueGaming for an allowlist/feed or run the crawl from an approved worker.
let htmlFetcher = null; // injectable for tests / local fixtures
export function setHtmlFetcher(fn) { htmlFetcher = fn; }
async function getHtml(url) {
  if (htmlFetcher) return htmlFetcher(url);
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Object.assign(new Error('lg ' + r.status), { status: r.status });
  return r.text();
}
const standingsUrl = () => `${LG}&action=league&page=standing&leagueid=${LEAGUE_ID}&seasonid=${SEASON}`;
const scheduleUrl = id => `${LG}&action=league_page&page=team_page_schedule&teamid=${id}&leagueid=${LEAGUE_ID}&seasonid=${SEASON}`;
export const gameUrl = gid => `${LG}&action=league&page=game&gameid=${gid}`;

async function pool(items, fn) {
  const results = []; let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx]); } catch (e) { results[idx] = { error: e }; }
      await new Promise(r => setTimeout(r, GAP_MS));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

// ---- cache (per warm instance)
const state = { games: new Map(), standings: [], teams: {}, fullAt: 0, deltaAt: 0, requests: 0, errors: 0, inflight: null };

function mergeGames(list) {
  for (const g of list) {
    const prev = state.games.get(g.lg_game_id);
    // never let a page without the score overwrite a known final
    if (prev && prev.final && !g.final) continue;
    state.games.set(g.lg_game_id, { ...prev, ...g });
  }
}

function teamsFromStandings(rows) {
  const teams = {};
  for (const r of rows) {
    const meta = TEAM_META[r.lg_team_id] || [];
    teams[r.lg_team_id] = {
      id: r.lg_team_id, name: r.name, abbr: meta[0] || r.name.slice(0, 3).toUpperCase(), nick: meta[1] || r.name,
      logo: TEAM_META[r.lg_team_id] ? `${LOGO_DIR}team${r.lg_team_id}.webp` : null,
      league: r.league, table: r.table,
      record: `${r.w}-${r.l}-${r.otl}`, pts: r.pts, // LG convention: W includes OT wins
    };
  }
  return teams;
}

async function fetchStandings() {
  state.requests++;
  const rows = parseStandings(await getHtml(standingsUrl()));
  if (rows.length >= 40) { state.standings = rows; state.teams = teamsFromStandings(rows); }
  return rows;
}

async function fetchSchedules(ids, now) {
  const res = await pool(ids, async id => { state.requests++; return parseTeamSchedule(await getHtml(scheduleUrl(id)), now); });
  for (const r of res) { if (r && !r.error) mergeGames(r); else state.errors++; }
}

function pendingGames(now) {
  return [...state.games.values()].filter(g => !g.final && g.at && now > Date.parse(g.at) + GAME_LEN && now - Date.parse(g.at) < PENDING_GIVE_UP);
}
// Greedy vertex cover: fewest team pages that include every pending game.
export function coverTeams(games) {
  const left = new Set(games.map(g => g.lg_game_id)); const pick = [];
  while (left.size) {
    const count = new Map();
    for (const g of games) if (left.has(g.lg_game_id)) for (const t of [g.away_id, g.home_id]) count.set(t, (count.get(t) || 0) + 1);
    const [best] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    pick.push(best);
    for (const g of games) if (g.away_id === best || g.home_id === best) left.delete(g.lg_game_id);
  }
  return pick;
}

export async function ensureFresh(now = Date.now()) {
  if (state.inflight) return state.inflight;
  const run = (async () => {
    if (!state.fullAt || now - state.fullAt > FULL_TTL || state.games.size === 0) {
      await fetchStandings();
      const ids = Object.keys(state.teams).map(Number);
      await fetchSchedules(ids.length ? ids : Object.keys(TEAM_META).map(Number), now);
      state.fullAt = state.deltaAt = Date.now();
      return 'full';
    }
    const pend = pendingGames(now);
    if (pend.length && now - state.deltaAt > DELTA_TTL) {
      await fetchStandings();
      await fetchSchedules(coverTeams(pend), now);
      state.deltaAt = Date.now();
      return 'delta';
    }
    return 'cache';
  })();
  // If LG is unreachable (outage, Cloudflare challenge) but we already hold data, keep serving it
  // as 'stale' and back off for one delta window instead of failing the ticker.
  const guarded = run.catch(error => {
    if (!state.games.size) throw error;
    state.errors++; state.deltaAt = Date.now();
    return 'stale';
  });
  state.inflight = guarded;
  try { return await guarded; } finally { state.inflight = null; }
}

// ---- views
const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const etDay = ms => ET_DAY.format(ms);

export function gameState(g, now) {
  if (g.final) return 'final';
  const t = Date.parse(g.at);
  if (!Number.isFinite(t)) return 'tbd';
  if (now < t) return 'scheduled';
  if (now < t + GAME_LEN) return 'live';
  return 'pending';
}
function shape(g, now) {
  return {
    id: g.lg_game_id, week: g.week, at: g.at, state: gameState(g, now),
    away: g.away_id, home: g.home_id, away_score: g.away_score, home_score: g.home_score,
    url: gameUrl(g.lg_game_id),
  };
}

export function snapshot() {
  return { games: [...state.games.values()], standings: state.standings, teams: state.teams, fullAt: state.fullAt, deltaAt: state.deltaAt, requests: state.requests, errors: state.errors };
}

export function view(name, now = Date.now()) {
  const all = [...state.games.values()].filter(g => g.at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.lg_game_id - b.lg_game_id);
  const meta = { ok: true, league: 'LGCHL', league_id: LEAGUE_ID, season: SEASON, source: 'leaguegaming.com public team schedules + standings', fetched_at: state.fullAt ? new Date(Math.max(state.fullAt, state.deltaAt)).toISOString() : null, full_crawl_at: state.fullAt ? new Date(state.fullAt).toISOString() : null, game_window_min: GAME_LEN / 60e3, counts: { teams: Object.keys(state.teams).length, games: all.length, finals: all.filter(g => g.final).length } };
  if (name === 'season') return { ...meta, teams: state.teams, standings: state.standings, games: all.map(g => shape(g, now)) };
  if (name === 'standings') return { ...meta, teams: state.teams, standings: state.standings };
  // ticker: the latest night with finals + today's slate (ET game days)
  const today = etDay(now);
  const todayGames = all.filter(g => etDay(Date.parse(g.at)) === today);
  const past = all.filter(g => g.final && etDay(Date.parse(g.at)) < today);
  const lastDay = past.length ? etDay(Date.parse(past[past.length - 1].at)) : null;
  const lastNight = lastDay ? all.filter(g => etDay(Date.parse(g.at)) === lastDay) : [];
  let upcomingDay = null, upcoming = [];
  if (!todayGames.length) {
    const fut = all.find(g => Date.parse(g.at) > now);
    if (fut) { upcomingDay = etDay(Date.parse(fut.at)); upcoming = all.filter(g => etDay(Date.parse(g.at)) === upcomingDay); }
  }
  const used = new Set([...todayGames, ...lastNight, ...upcoming].flatMap(g => [g.away_id, g.home_id]));
  const teams = Object.fromEntries(Object.entries(state.teams).filter(([id]) => used.has(Number(id))));
  return {
    ...meta, teams,
    last_night: lastDay ? { day: lastDay, games: lastNight.map(g => shape(g, now)) } : null,
    today: { day: today, games: todayGames.map(g => shape(g, now)) },
    next_night: upcomingDay ? { day: upcomingDay, games: upcoming.map(g => shape(g, now)) } : null,
  };
}

export function __setStateForTests(s) { Object.assign(state, s); }
