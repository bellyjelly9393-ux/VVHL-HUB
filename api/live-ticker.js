// Site-wide Calgary Hitmen live ticker feed.
// GET /api/live-ticker -> compact, public-safe JSON (record, streak, recent finals,
// next game, live window, upcoming) built from public.hitmen_schedule_games.
//
// Access model (hitmen_schedule_games RLS only allows signed-in Calgary staff/lockers):
//   1. If SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) is set in the Vercel env,
//      the function reads server-side and serves everyone (CDN cached ~30s).
//      Only schedule/score columns are selected; scouting notes never leave the server.
//   2. Otherwise it forwards the visitor's own Supabase session (Authorization: Bearer)
//      with the publishable key, so RLS decides. Anonymous visitors get 401 and the
//      ticker hides itself.
// The service key is never sent to the browser.

const TEAM_ID = 'b0bcbdda-da9d-419d-8f61-b34937966d49';
const BASE = 'https://lrgllzvwgvqagcpiyvfd.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
const COLUMNS = 'id,season,week,scheduled_at,opponent_name,calgary_side,status,calgary_score,opponent_score,overtime,source_url';
const GAME_WINDOW_MIN = 35; // LG nights run 3 games 35 minutes apart.
const LOGO_DIR = '/assets/lgchl/s55/';

// LGCHL team ids derived from S55 roster overlap (hitmen_opponent_roster_players x lg_player_season_stats).
const TEAMS = {
  'Calgary Hitmen': ['CGY', 412],
  'Baie-Comeau Drakkar': ['BAC', 469], 'Barrie Colts': ['BAR', 449], 'Brandon Wheat Kings': ['BDN', 409],
  'Brantford Bulldogs': ['BFD', 306], 'Chicoutimi Saguenéens': ['CHI', 468], 'Chilliwack Bruins': ['CHW', 2983],
  'Edmonton Oil Kings': ['EDM', 415], 'Everett Silvertips': ['EVT', 380], 'Flint Firebirds': ['FLT', 514],
  'Gatineau Olympiques': ['GAT', 461], 'Kelowna Rockets': ['KEL', 400], 'Kingston Frontenacs': ['KGN', 444],
  'Lethbridge Hurricanes': ['LET', 418], 'London Knights': ['LDN', 370], 'Medicine Hat Tigers': ['MHT', 416],
  'Moncton Wildcats': ['MON', 365], 'Moose Jaw Warriors': ['MJW', 411], 'Niagara IceDogs': ['NIA', 375],
  'North Bay Battalion': ['NBB', 448], "Ottawa 67's": ['OTT', 446], 'Portland Winterhawks': ['POR', 398],
  'Prince Albert Raiders': ['PAR', 413], 'Prince George Cougars': ['PGC', 422], 'Red Deer Rebels': ['RDR', 385],
  'Regina Pats': ['REG', 414], 'Saginaw Spirit': ['SAG', 408], 'Saint John Sea Dogs': ['SJS', 397],
  'Sarnia Sting': ['SAR', 451], 'Saskatoon Blades': ['SAS', 379], 'Seattle Thunderbirds': ['SEA', 421],
  'Shawinigan Cataractes': ['SHA', 382], 'Spokane Chiefs': ['SPO', 420], 'Sudbury Wolves': ['SBY', 447],
  'Swift Current Broncos': ['SCB', 377], 'Tri-City Americans': ['TCA', 399], "Val-d'Or Foreurs": ['VDO', 460],
  'Vancouver Giants': ['VAN', 386], 'Victoria Royals': ['VIC', 419], 'Windsor Spitfires': ['WSR', 381],
};

// calgary_side -> home/away. Verified 2026-10-04 against official LGCHL S55 data:
// the LG standings list Calgary 1-3-0 at home / 3-2-0 away, which matches exactly the
// 'right' rows (EDM L, LET L, BDN L, SAS W) and the 'left' rows (MHT W, CHW W, RDR W, REG L, SCB L).
// LG game pages agree: the away team is listed first, and that is the 'left' side here.
//   'right' = Calgary is HOME  ->  ticker shows "vs OPP"
//   'left'  = Calgary is AWAY  ->  ticker shows "@ OPP"
const SIDE_HOME = { right: true, left: false };

// STOPGAP: official LeagueGaming game ids for S55 finals whose hitmen_schedule_games.source_url
// is still NULL (looked up on LG's team_page_schedule for team 412, 2026-10-04). The key matches
// the table's unique (scheduled_at, opponent_name) pair. A DB value always wins over this map.
// Remove these entries once the rows have source_url populated.
const LG_GAME_URL = 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=game&gameid=';
const FALLBACK_LG_GAME_IDS = {
  '2026-09-28T01:00:00.000Z|Edmonton Oil Kings': 916747,
  '2026-09-28T01:35:00.000Z|Medicine Hat Tigers': 916774,
  '2026-09-28T02:10:00.000Z|Chilliwack Bruins': 916805,
  '2026-09-30T01:00:00.000Z|Regina Pats': 916925,
  '2026-09-30T01:35:00.000Z|Saskatoon Blades': 916958,
  '2026-09-30T02:10:00.000Z|Swift Current Broncos': 916986,
};

const fail = (status, code) => Object.assign(new Error(code), { status, code });

function initials(name) {
  const words = String(name || '').replace(/[^A-Za-zÀ-ÿ0-9' -]/g, '').split(/[\s-]+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, words.length > 2 ? 2 : words.length).map(w => w[0]).join('').toUpperCase();
}

function teamInfo(name) {
  const hit = TEAMS[String(name || '').trim()];
  return {
    name: String(name || 'TBD'),
    abbr: hit ? hit[0] : initials(name),
    logo: hit ? `${LOGO_DIR}team${hit[1]}.png` : null,
  };
}

function resultOf(g) {
  if (g.status !== 'final' || g.calgary_score == null || g.opponent_score == null) return null;
  if (g.calgary_score > g.opponent_score) return 'W';
  if (g.calgary_score < g.opponent_score) return g.overtime ? 'OTL' : 'L';
  return 'T';
}

function gameState(g, now) {
  if (g.status === 'final') return 'final';
  if (g.status === 'postponed' || g.status === 'cancelled') return g.status;
  const t = Date.parse(g.scheduled_at);
  if (!Number.isFinite(t)) return 'tbd';
  if (now < t) return 'scheduled';
  if (now < t + GAME_WINDOW_MIN * 60e3) return 'live'; // inferred from the puck-drop window
  return 'pending'; // window passed, no final recorded yet
}

function sourceUrl(g, at) {
  if (/^https:\/\/(www\.)?leaguegaming\.com\//.test(g.source_url || '')) return g.source_url;
  const id = at && FALLBACK_LG_GAME_IDS[`${at}|${String(g.opponent_name || '').trim()}`];
  return id ? LG_GAME_URL + id : null;
}

function shape(g, now) {
  const result = resultOf(g);
  const at = g.scheduled_at ? new Date(g.scheduled_at).toISOString() : null;
  const home = Object.prototype.hasOwnProperty.call(SIDE_HOME, g.calgary_side) ? SIDE_HOME[g.calgary_side] : null;
  return {
    id: g.id,
    week: g.week,
    at,
    opponent: teamInfo(g.opponent_name),
    side: g.calgary_side || null,
    home, // true = Calgary home ("vs"), false = away ("@"), null = unknown
    status: g.status,
    state: gameState(g, now),
    result,
    gf: g.calgary_score,
    ga: g.opponent_score,
    ot: !!g.overtime,
    source_url: sourceUrl(g, at),
  };
}

export function buildTicker(rows, now = Date.now()) {
  const all = (rows || []).filter(r => r && r.scheduled_at);
  const season = all.reduce((m, r) => Math.max(m, Number(r.season) || 0), 0) || null;
  const games = all
    .filter(r => Number(r.season) === season)
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))
    .map(g => shape(g, now));

  const finals = games.filter(g => g.state === 'final' && g.result);
  const record = { w: 0, l: 0, otl: 0, t: 0, gp: finals.length, gf: 0, ga: 0 };
  for (const g of finals) {
    if (g.result === 'W') record.w++;
    else if (g.result === 'OTL') record.otl++;
    else if (g.result === 'T') record.t++;
    else record.l++;
    record.gf += g.gf; record.ga += g.ga;
  }
  record.pts = record.w * 2 + record.otl + record.t;
  record.diff = record.gf - record.ga;
  record.label = `${record.w}-${record.l}-${record.otl}`;

  let streak = null;
  for (let i = finals.length - 1; i >= 0; i--) {
    const kind = finals[i].result === 'W' ? 'W' : finals[i].result === 'T' ? 'T' : 'L';
    if (!streak) streak = { type: kind, count: 1 };
    else if (streak.type === kind) streak.count++;
    else break;
  }
  if (streak) streak.label = `${streak.type}${streak.count}`;

  const recent = finals.slice(-5).reverse();
  const live = games.find(g => g.state === 'live') || null;
  const pending = games.filter(g => g.state === 'pending');
  const future = games.filter(g => g.state === 'scheduled');
  const next = future[0] || null;

  return {
    ok: true,
    generated_at: new Date(now).toISOString(),
    season,
    game_window_min: GAME_WINDOW_MIN,
    team: { name: 'Calgary Hitmen', short: 'Hitmen', abbr: 'CGY', logo: `${LOGO_DIR}team412.png`, league: 'LGCHL' },
    record,
    streak,
    last5: finals.slice(-5).map(g => g.result).join(''),
    live,
    next,
    recent,
    pending,
    upcoming: future.slice(0, 9),
    counts: { total: games.length, final: finals.length, remaining: games.length - finals.length },
  };
}

async function readRows(headers) {
  const url = `${process.env.SUPABASE_URL || BASE}/rest/v1/hitmen_schedule_games?select=${COLUMNS}&team_id=eq.${TEAM_ID}&order=scheduled_at.asc&limit=400`;
  const r = await fetch(url, { headers: { ...headers, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (r.status === 401 || r.status === 403) throw fail(401, 'auth_required');
  if (!r.ok) throw fail(502, 'upstream_error');
  const body = await r.json().catch(() => null);
  if (!Array.isArray(body)) throw fail(502, 'upstream_error');
  return body;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const serverKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
  const auth = String(req.headers.authorization || '');
  let headers, mode;
  if (serverKey) {
    mode = 'public';
    headers = serverKey.startsWith('sb_secret_') ? { apikey: serverKey } : { apikey: serverKey, Authorization: `Bearer ${serverKey}` };
  } else if (/^Bearer [A-Za-z0-9._-]{20,}$/.test(auth)) {
    mode = 'member';
    headers = { apikey: process.env.SUPABASE_ANON_KEY || PUBLISHABLE_KEY, Authorization: auth };
  } else {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(401).json({ ok: false, error: 'auth_required' });
  }
  try {
    const rows = await readRows(headers);
    if (!rows.length) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(mode === 'member' ? 403 : 404).json({ ok: false, error: mode === 'member' ? 'no_access' : 'no_games' });
    }
    const payload = buildTicker(rows);
    payload.mode = mode;
    res.setHeader('Cache-Control', mode === 'public'
      ? 'public, max-age=15, s-maxage=30, stale-while-revalidate=120'
      : 'private, no-store');
    return res.status(200).json(payload);
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(error.status || 500).json({ ok: false, error: error.code || 'server_error' });
  }
}
