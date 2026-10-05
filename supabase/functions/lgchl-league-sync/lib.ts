// Pure helpers for LeagueGaming LGCHL (league 39) standings + team schedule pages.
// No network and no Deno APIs (plain JS syntax), so they can be unit tested against saved HTML.
export const LEAGUE_ID = 39;
export const SEASON = 55;
export const LG = 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league';
export const LOGO_DIR = '/assets/lgchl/s55/48/';

// id -> [abbr, nickname]. Names/divisions come live from the standings page.
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

export const standingsUrl = () => `${LG}&action=league&page=standing&leagueid=${LEAGUE_ID}&seasonid=${SEASON}`;
export const scheduleUrl = (id) => `${LG}&action=league_page&page=team_page_schedule&teamid=${id}&leagueid=${LEAGUE_ID}&seasonid=${SEASON}`;
export const gameUrl = (gid) => `${LG}&action=league&page=game&gameid=${gid}`;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ocirc: 'ô' };
export const decode = (s) => String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
export const text = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// LG anonymous pages render US Eastern without a year: "Sun Oct 04 09:00pm" -> UTC ISO (closest year to now).
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function nyOffsetMs(utcMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(utcMs).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - utcMs;
}
function easternToUtc(y, mo, d, h, mi) {
  const wall = Date.UTC(y, mo, d, h, mi);
  const t = wall - nyOffsetMs(wall);
  return wall - nyOffsetMs(t);
}
export function parseLgDate(label, now = Date.now()) {
  const m = /([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})\s*([ap]m)/i.exec(label || '');
  if (!m || !(m[1] in MONTHS)) return null;
  let h = Number(m[3]) % 12; if (m[5].toLowerCase() === 'pm') h += 12;
  const year = new Date(now).getUTCFullYear();
  let best = null;
  for (const y of [year - 1, year, year + 1]) {
    const t = easternToUtc(y, MONTHS[m[1]], Number(m[2]), h, Number(m[4]));
    if (best == null || Math.abs(t - now) < Math.abs(best - now)) best = t;
  }
  return new Date(best).toISOString();
}

// Standings: 10 tables; LG repeats each conference title for its two divisions ("WHL Eastern" x2).
export function parseStandings(html) {
  const out = [];
  const chunks = String(html).split('<th rowspan="2">').slice(1);
  const seen = {};
  for (const chunk of chunks) {
    const name = text(chunk.slice(0, chunk.indexOf('<')));
    const end = chunk.indexOf('</table>');
    const body = end >= 0 ? chunk.slice(0, end) : chunk;
    seen[name] = (seen[name] || 0) + 1;
    const [league, conference] = name.split(' ');
    const division = `${name} ${seen[name]}`;
    const rows = body.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    for (const row of rows) {
      const link = /teamid=(\d+)&(?:amp;)?leagueid=\d+&(?:amp;)?seasonid=\d+">([^<]+)<\/a>/.exec(row);
      if (!link) continue;
      const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).slice(1).map(text);
      const n = (i) => (cells[i] === undefined || cells[i] === '' || !Number.isFinite(Number(cells[i])) ? null : Number(cells[i]));
      out.push({
        lg_team_id: Number(link[1]), name: decode(link[2]).trim(), league, conference, division,
        division_rank: Number((/opacity:0\.7;">(\d+)\)/.exec(row) || [])[1]) || null,
        gp: n(0), w: n(1), l: n(2), otw: n(3), otl: n(4), pts: n(5), streak: cells[6] || null,
        gf: n(7), ga: n(8), gd: n(9), last10: cells[10] || null, home: cells[11] || null, away: cells[12] || null,
      });
    }
  }
  return out;
}

// One team's full season schedule: away team listed first, home second; "A vs H" score when final.
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
    const teams = [...row.matchAll(/page=team_page&(?:amp;)?teamid=(\d+)/g)].map((x) => Number(x[1]));
    if (!gid || teams.length < 2) continue;
    const center = /<td style="text-align:center">([\s\S]*?)<\/td>/.exec(row);
    const scoreText = center ? text(center[1].split('<br>')[0]) : '';
    const sc = /^(\d+)\s*vs\s*(\d+)$/.exec(scoreText);
    const when = center ? text(center[1].split('<br>').slice(1).join(' ')) : '';
    games.push({
      lg_game_id: Number(gid[1]), season: SEASON, week,
      game_at: parseLgDate(when, now), game_at_label_et: when || null,
      away_lg_team_id: teams[0], home_lg_team_id: teams[1],
      away_score: sc ? Number(sc[1]) : null, home_score: sc ? Number(sc[2]) : null,
      status: sc ? 'final' : 'scheduled', source_url: gameUrl(gid[1]),
    });
  }
  return games;
}

export function teamRows(standings) {
  return standings.map((r) => {
    const meta = TEAM_META[r.lg_team_id] || [];
    return {
      lg_team_id: r.lg_team_id, season: SEASON, name: r.name,
      abbr: meta[0] || r.name.slice(0, 3).toUpperCase(), nickname: meta[1] || r.name,
      league: r.league, conference: r.conference, division: r.division,
      logo_path: `${LOGO_DIR}team${r.lg_team_id}.webp`,
    };
  });
}

const SNAP_KEYS = ['gp', 'w', 'l', 'otw', 'otl', 'pts', 'gf', 'ga', 'gd', 'streak', 'last10', 'home', 'away', 'division_rank'];
export function snapshotRows(standings) {
  return standings.map((r) => Object.fromEntries([['season', SEASON], ['lg_team_id', r.lg_team_id], ...SNAP_KEYS.map((k) => [k, r[k]])]));
}
export function changedSnapshots(rows, current) {
  const byId = new Map((current || []).map((c) => [c.lg_team_id, c]));
  return rows.filter((r) => { const c = byId.get(r.lg_team_id); return !c || SNAP_KEYS.some((k) => (c[k] ?? null) !== (r[k] ?? null)); });
}

// Greedy vertex cover: fewest team pages that include every pending game.
export function coverTeams(games) {
  const left = new Set(games.map((g) => g.lg_game_id)); const pick = [];
  while (left.size) {
    const count = new Map();
    for (const g of games) if (left.has(g.lg_game_id)) for (const t of [g.away_lg_team_id, g.home_lg_team_id]) count.set(t, (count.get(t) || 0) + 1);
    const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    pick.push(best);
    for (const g of games) if (g.away_lg_team_id === best || g.home_lg_team_id === best) left.delete(g.lg_game_id);
  }
  return pick;
}

export function isChallenge(status, body, headers) {
  return status === 403 || status === 503
    ? /Just a moment|cf-chl|challenge-platform/i.test(body || '') || !!headers?.get?.('cf-mitigated')
    : false;
}
