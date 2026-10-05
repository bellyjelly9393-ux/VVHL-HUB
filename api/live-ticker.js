// Site-wide Calgary Hitmen live ticker feed.
// GET /api/live-ticker -> compact public JSON: record, streak, last 5, recent finals, next game,
// live window, upcoming.
//
// Source: the PUBLIC league views filled by the Supabase Edge Function lgchl-league-sync
// (public.lgchl_games_board + public.lgchl_standings_current, read-only RLS for anon), read with
// the publishable key. Everyone, signed in or not, gets the same cacheable payload, and no
// secret key is needed on Vercel.
//   * Games: every LG game where LG team 412 (Calgary Hitmen) is home or away. Home/away comes from
//     LG's own listing (away team first), and every game links to its LG game page.
//   * Record: the official LG standings line (W includes OT wins, OTL separate), so OT results are
//     right even though LG schedule rows carry no OT flag.
// Retired 2026-10-04: the old staff-only read of hitmen_schedule_games (service key / user
// session). A read-only diff showed the same 66 games, sides, statuses and scores. That table has
// no postponed/cancelled rows, no OT flags, and only 3 of 9 finals had an LG link, so it added
// nothing to the ticker.
import { rest, cached, loadTeams, HITMEN_LG_TEAM_ID, SEASON } from './_lgchl.js';

const GAME_WINDOW_MIN = 35; // LG nights run 3 games 35 minutes apart.
const GAME_COLS = 'lg_game_id,season,week,game_at,status,away_lg_team_id,home_lg_team_id,away_score,home_score,source_url,updated_at';

const fail = (status, code) => Object.assign(new Error(code), { status, code });

function gameState(g, now) {
  if (g.status === 'final') return 'final';
  if (g.status === 'postponed' || g.status === 'cancelled') return g.status;
  const t = Date.parse(g.at);
  if (!Number.isFinite(t)) return 'tbd';
  if (now < t) return 'scheduled';
  if (now < t + GAME_WINDOW_MIN * 60e3) return 'live'; // inferred from the puck-drop window
  return 'pending'; // window passed, no final posted on LG yet
}

// lgchl_games_board row -> Calgary-centric game.
function shape(g, teams, now) {
  const home = g.home_lg_team_id === HITMEN_LG_TEAM_ID;
  const oppId = home ? g.away_lg_team_id : g.home_lg_team_id;
  const opp = teams.get(oppId);
  const gf = home ? g.home_score : g.away_score;
  const ga = home ? g.away_score : g.home_score;
  const final = g.status === 'final' && gf != null && ga != null;
  const out = {
    id: g.lg_game_id,
    week: g.week,
    at: g.game_at ? new Date(g.game_at).toISOString() : null,
    opponent: { id: oppId, name: opp?.name || 'TBD', abbr: opp?.abbr || '?', logo: opp?.logo_path || null },
    side: home ? 'right' : 'left', // legacy field: LG lists away (left) then home (right)
    home,                           // true = Calgary home ("vs"), false = away ("@")
    status: g.status,
    result: final ? (gf > ga ? 'W' : gf < ga ? 'L' : 'T') : null, // LG schedule rows have no OT flag
    gf, ga,
    ot: null,
    source_url: g.source_url || null,
  };
  out.state = gameState(out, now);
  return out;
}

export function buildTicker(rows, teamRows, now = Date.now()) {
  const teams = new Map((teamRows || []).map(t => [t.lg_team_id, t]));
  const games = (rows || []).filter(r => r && r.game_at)
    .sort((a, b) => Date.parse(a.game_at) - Date.parse(b.game_at) || a.lg_game_id - b.lg_game_id)
    .map(g => shape(g, teams, now));
  const finals = games.filter(g => g.state === 'final' && g.result);

  // Record from the finals, then replaced by the official standings line when present.
  const record = { w: 0, l: 0, otl: 0, t: 0, gp: finals.length, gf: 0, ga: 0 };
  for (const g of finals) { record[g.result === 'W' ? 'w' : g.result === 'T' ? 't' : 'l']++; record.gf += g.gf; record.ga += g.ga; }
  record.source = 'games';
  const st = teams.get(HITMEN_LG_TEAM_ID);
  if (st && st.gp != null) {
    Object.assign(record, { w: st.w, l: st.l, otl: st.otl, otw: st.otw, gp: st.gp, gf: st.gf, ga: st.ga, pts: st.pts, source: 'lg_standings' });
  }
  record.pts ??= record.w * 2 + record.otl + record.t;
  record.diff = record.gf - record.ga;
  record.label = `${record.w}-${record.l}-${record.otl}`;
  if (st) Object.assign(record, { division: st.division, division_rank: st.division_rank, conference_rank: st.conference_rank });

  let streak = null;
  for (let i = finals.length - 1; i >= 0; i--) {
    const kind = finals[i].result === 'W' ? 'W' : finals[i].result === 'T' ? 'T' : 'L';
    if (!streak) streak = { type: kind, count: 1 };
    else if (streak.type === kind) streak.count++;
    else break;
  }
  if (streak) streak.label = `${streak.type}${streak.count}`;

  const live = games.find(g => g.state === 'live') || null;
  const future = games.filter(g => g.state === 'scheduled');
  const season = games.length ? (rows.find(r => r.season)?.season ?? SEASON) : SEASON;
  return {
    ok: true,
    generated_at: new Date(now).toISOString(),
    season,
    game_window_min: GAME_WINDOW_MIN,
    team: { name: st?.name || 'Calgary Hitmen', short: 'Hitmen', abbr: st?.abbr || 'CGY', logo: st?.logo_path || '/assets/lgchl/s55/48/team412.webp', league: 'LGCHL', lg_team_id: HITMEN_LG_TEAM_ID },
    record,
    streak,
    last5: finals.slice(-5).map(g => g.result).join(''),
    live,
    next: future[0] || null,
    recent: finals.slice(-5).reverse(),
    pending: games.filter(g => g.state === 'pending'),
    upcoming: future.slice(0, 9),
    counts: { total: games.length, final: finals.length, remaining: games.length - finals.length },
    source: 'Supabase lgchl_games_board + lgchl_standings_current (public; scraped from leaguegaming.com)',
    standings_at: st?.standings_at || null,
  };
}

async function loadHitmenGames(now) {
  return cached('hitmen-games', () => rest(`lgchl_games_board?select=${GAME_COLS}&season=eq.${SEASON}` +
    `&or=(away_lg_team_id.eq.${HITMEN_LG_TEAM_ID},home_lg_team_id.eq.${HITMEN_LG_TEAM_ID})&order=game_at.asc,lg_game_id.asc`), now);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const now = Date.now();
    const [rows, teamRows] = await Promise.all([loadHitmenGames(now), loadTeams(now)]);
    if (!rows.length) throw fail(404, 'no_games');
    const payload = buildTicker(rows, teamRows, now);
    payload.mode = 'public';
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=120');
    return res.status(200).json(payload);
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(error.status || 502).json({ ok: false, error: error.code || 'upstream_error' });
  }
}
