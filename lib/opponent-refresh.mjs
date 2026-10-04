// Shared by the scheduled Edge Function and source-validation tests.
export const TEAM = 'b0bcbdda-da9d-419d-8f61-b34937966d49';
export const SEASON = 55;
export const ROSTER_URL = 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=roster&leagueid=39&seasonid=55';
export const LG_STATS_URL = 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=player_stats_advanced&leagueid=39&seasonid=55';
export const clean = (s = '') => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
export const number = v => v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v);
export const exactName = v => String(v || '').trim().toLowerCase();
const TEAM_ALIASES = {'Chicoutimi Sagueneens':'Chicoutimi Saguenéens','Tri City Americans':'Tri-City Americans'};

// Preserve the existing LG roster parser. Completeness is checked per team at commit time.
export function parseRosters(html) {
  const players = [];
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const body = table[1];
    const sourceTeam = clean(body.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1] || body.match(/class=["'][^"']*(?:team|header)[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] || '');
    const team = TEAM_ALIASES[sourceTeam] || sourceTeam;
    if (!team) continue;
    let rosterRole = 'Active';
    for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const label = clean(row[1]);
      if (/training camp/i.test(label)) rosterRole = 'Training Camp';
      const links = [...row[1].matchAll(/<a\b[^>]*href=["']([^"']*(?:userid|user_id)=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      // LG's first link can be a player rating, not their name. Never use team_user_pk.
      const link = links.find(a => /page=team_user(?:&|$)/.test(a[1]) && clean(a[3])) || links.find(a => !/team_user_pk/.test(a[1]) && clean(a[3]));
      if (!link) continue;
      if (!/^\d+\./.test(label) && !/\b(LW|RW|LD|RD|C|G)\b/.test(label)) continue;
      const amount = label.match(/\b([\d.]+)\s*(M|K)\b/i);
      players.push({uid: Number(link[2]), name: clean(link[3]), team, source_team: sourceTeam,
        position: label.match(/\b(LW|RW|LD|RD|C|G)\b/)?.[1] || null,
        salary: amount ? Math.round(Number(amount[1]) * (amount[2].toUpperCase() === 'M' ? 1000000 : 1000)) : null,
        management_role: /\bOwner\b/i.test(label) || /class=["'][^"']*\bbadge\b[^"']*["'][^>]*>\s*O\s*</i.test(row[1]) ? 'Owner' : /\bAGM\b/i.test(label) ? 'AGM' : /\bGM\b/i.test(label) ? 'GM' : null,
        roster_role: /training camp|tc\b/i.test(label) ? 'Training Camp' : rosterRole});
    }
  }
  const rows = [...new Map(players.map(p => [p.team + '|' + p.uid, p])).values()];
  if (rows.length < 50) throw new Error('LG returned an incomplete roster page; saved rosters retained.');
  return rows;
}

function minutes(v) {
  if (typeof v === 'string' && /^\d+:\d{2}$/.test(v)) { const [m, s] = v.split(':').map(Number); return m + s / 60; }
  return number(v);
}
export function lgPlayer(row, roster) {
  const s = row.stats || {}, record = /^(\d+)-(\d+)-(\d+)$/.exec(s.record || '');
  return {gamertag: roster.gamertag, source_player_uid: row.lg_user_id, position: row.position || roster.position,
    games_played: number(row.games_played ?? s.gp ?? s.ggp), wins: record ? +record[1] : null, losses: record ? +record[2] : null,
    goals: number(s.goals), assists: number(s.assists), points: number(s.points), plus_minus: number(s.plusminus),
    shots: number(s.shots), hits: number(s.hits), pim: minutes(s.pim), takeaways: number(s.takeaway), giveaways: number(s.giveaway),
    faceoff_pct: number(s.fop), passing_pct: number(s.passp), goalie_save_pct: number(s.savep) == null ? null : Math.round(number(s.savep) * 1000) / 10,
    goalie_gaa: number(s.gaa), source_updated_at: row.fetched_at,
    raw_stats: {...s, source_gamertag: row.gamertag, lg_user_id: row.lg_user_id, lg_team_id: row.lg_team_id,
      player_kind: row.player_kind, scope: 'LGCHL Season 55 regular-season player totals; may include previous teams',
      current_roster_as_of: roster.source_updated_at, current_roster_position: roster.position}};
}
export function matchLeaguePlayers(roster, stats) {
  const rows = [], unmatched = [];
  for (const p of roster) {
    // A stable LG user ID takes precedence over a renamed gamertag; never fuzzy-match identities.
    const matches = stats.filter(s => p.source_player_uid != null ? String(s.lg_user_id) === String(p.source_player_uid) : exactName(s.gamertag) === exactName(p.gamertag));
    const relevant = matches.filter(s => s.player_kind === (p.position === 'G' ? 'goalie' : 'skater'));
    if (relevant.length === 1) rows.push(lgPlayer(relevant[0], p));
    else unmatched.push(p.gamertag);
  }
  return {rows, unmatched};
}

const pick = (o, keys) => keys.map(k => o[k]).find(v => v != null && v !== '') ?? null;
export function eaMembers(root) {
  const found = new Map();
  const walk = x => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(walk);
    const name = pick(x, ['name', 'playerName', 'playername', 'personaName', 'persona', 'gamertag']);
    if (typeof name === 'string' && ['gamesPlayed', 'gamesplayed', 'goals', 'assists', 'points'].some(k => x[k] != null)) {
      const goals = number(x.goals), assists = number(x.assists);
      found.set(exactName(name), {gamertag: name.trim(), position: pick(x, ['position', 'pos']),
        games_played: number(pick(x, ['gamesPlayed', 'gamesplayed'])), wins: number(x.wins), losses: number(x.losses), goals, assists,
        points: number(x.points) ?? (goals != null && assists != null ? goals + assists : null),
        plus_minus: number(pick(x, ['plusMinus', 'plusminus'])), shots: number(x.shots), hits: number(x.hits), pim: number(x.pim),
        takeaways: number(x.takeaways), giveaways: number(x.giveaways),
        faceoff_pct: number(pick(x, ['faceoffPct', 'faceoffpercent'])), passing_pct: number(pick(x, ['passingPct', 'passingpercent'])),
        goalie_save_pct: number(pick(x, ['savePct', 'savePercentage'])), goalie_gaa: number(x.gaa),
        raw_stats: {...x, scope: 'EA club totals, not LG league-only results'}});
    }
    Object.values(x).forEach(walk);
  };
  walk(root);
  return [...found.values()];
}
