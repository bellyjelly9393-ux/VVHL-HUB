// Writes and publishes Calgary Hitmen game recaps from verified LG box scores.
// Called by the authenticated LG bridge (lg-auth-sync.js) right after box scores are saved.
// Runs as the signed-in Calgary manager: Supabase RLS decides what can be read, and
// public.hitmen_publish_auto_recap enforces management access and posts at most one recap per game.
const BASE = 'https://lrgllzvwgvqagcpiyvfd.supabase.co';
const KEY = 'sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
const TEAM = 'b0bcbdda-da9d-419d-8f61-b34937966d49';
const CALGARY = 'Calgary Hitmen';

const fail = (status, message) => Object.assign(new Error(message), { status });

async function rest(path, token, init = {}) {
  const r = await fetch(BASE + path, {
    ...init,
    headers: { apikey: KEY, Authorization: token, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw fail(r.status === 401 ? 401 : r.status === 403 ? 403 : 502, data?.message || data?.error || `Supabase ${r.status}`);
  return data;
}

const STYLE = `You write game recaps for the Calgary Hitmen media desk (EA Sports NHL 6v6, LeagueGaming LGCHL Season 55).
House style, matching the recaps already on the site:
- Title: a punchy newspaper headline naming the key player or storyline and the final score, e.g. "KOLLER stands tall as Lethbridge edges Hitmen 2-1".
- Dek: one sentence that adds the most telling detail.
- Body: plain text. Open with a 1-2 sentence lede that states the result. Then 2-3 short sections, each starting with a "## " header line, such as "## How it was built", "## Where it turned", "## Calgary's answer". Include one "## The number: N" section about the single most telling stat. Then one line with Calgary's updated record ("Calgary climbs to 4-3." / "Calgary falls to 3-4.").
- End the body with a block exactly like:
Three stars
1. gamertag (ABBR): short stat line
2. ...
3. ...
- Gamertags must be written exactly as given, including spaces and capitals.

Accuracy rules (critical):
- Use ONLY numbers and names present in the evidence. Never invent goals, assists, periods, goal order, comebacks, penalties or anything the evidence does not show.
- Team totals and the final score come from the official result. Player lines come from the LG box score.
- If the evidence does not show something (e.g. period-by-period scoring), do not describe it.
- Professional sports-desk tone, no hype words, no emojis.

Return ONLY a JSON object:
{"title": string, "dek": string, "body": string,
 "three_stars": [{"player": string, "team": "ABBR", "line": string}, x3],
 "key_stats": {"shots": "CGY-OPP", "passing": string, "faceoffs": "CGY-OPP", "zone_time": string, "power_play": string, "takeaways_giveaways": string}}
In key_stats, include only keys you can fill from the team stats lines; omit the rest. Calgary's value comes first.`;

async function openRouter(prompt) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw fail(503, 'OPENROUTER_API_KEY is not configured on this deployment.');
  const base = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const model = process.env.RECAP_MODEL || process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-5.5';
  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
      'HTTP-Referer': 'https://wildmanhockey-elitechelmedia.app', 'X-Title': 'Wildman Hockey · Hitmen recap writer' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: STYLE }, { role: 'user', content: prompt }],
      response_format: { type: 'json_object' }, temperature: 0.4, max_tokens: 2500 }),
    signal: AbortSignal.timeout(90000),
  });
  const raw = await r.text(); let data = null; try { data = JSON.parse(raw); } catch {}
  if (!r.ok) throw fail(502, data?.error?.message || `OpenRouter ${r.status}`);
  const content = String(data?.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
  let out; try { out = JSON.parse(content); } catch { throw fail(502, 'The recap model returned unreadable output.'); }
  if (!out?.title || !out?.body) throw fail(502, 'The recap model returned an incomplete recap.');
  return { ...out, model: data.model || model };
}

function statLine(p) {
  const bits = [];
  if (p.saves != null || p.shots_against != null) bits.push(`${p.saves ?? '?'} saves on ${p.shots_against ?? '?'} shots`);
  for (const [k, label] of [['goals','G'],['assists','A'],['points','PTS'],['plus_minus','+/-'],['shots','SOG'],['hits','HIT'],['pim','PIM'],
    ['takeaways','TK'],['giveaways','GV'],['interceptions','INT'],['blocked_shots','BLK'],['faceoff_wins','FOW'],['faceoff_losses','FOL'],
    ['pass_completions','PASS COMP'],['pass_attempts','PASS ATT'],['ppg','PPG'],['shg','SHG'],['gwg','GWG']]) {
    if (p[k] != null) bits.push(`${label} ${p[k]}`);
  }
  return `${p.gamertag}${p.position ? ' (' + p.position + ')' : ''}: ${bits.join(', ')}`;
}

async function writeOne(id, token) {
  const [box] = await rest(`/rest/v1/lg_game_box_scores?select=*&lg_game_id=eq.${id}`, token);
  if (!box) throw fail(404, 'No verified box score (or no Calgary management access).');
  const lines = await rest(`/rest/v1/lg_game_player_lines?select=*&lg_game_id=eq.${id}&order=points.desc.nullslast`, token);
  const calgaryHome = box.home_team_name === CALGARY;
  if (!calgaryHome && box.away_team_name !== CALGARY) throw fail(400, 'Not a Calgary game.');
  const opponent = calgaryHome ? box.away_team_name : box.home_team_name;
  const cgy = calgaryHome ? box.home_score : box.away_score;
  const opp = calgaryHome ? box.away_score : box.home_score;

  const [game] = await rest(`/rest/v1/lgchl_games?select=lg_game_id,game_at,week,source_url&lg_game_id=eq.${id}`, token);
  const teams = await rest(`/rest/v1/lgchl_teams?select=lg_team_id,name,abbr&season=eq.${box.season}`, token);
  const abbr = name => teams.find(t => t.name === name)?.abbr || name.slice(0, 3).toUpperCase();
  const calgaryId = teams.find(t => t.name === CALGARY)?.lg_team_id;
  // Season record through this game, from the official LGCHL game index.
  const finals = await rest(`/rest/v1/lgchl_games?select=lg_game_id,game_at,home_lg_team_id,away_lg_team_id,home_score,away_score&season=eq.${box.season}&status=eq.final&or=(home_lg_team_id.eq.${calgaryId},away_lg_team_id.eq.${calgaryId})&order=game_at`, token);
  let w = 0, l = 0, gameNo = 0;
  for (const g of finals) {
    if (Date.parse(g.game_at) > Date.parse(game.game_at)) break;
    const home = g.home_lg_team_id === calgaryId;
    const f = home ? g.home_score : g.away_score, a = home ? g.away_score : g.home_score;
    if (f > a) w++; else l++;
    gameNo++;
  }
  const record = `${w}-${l}`;
  const sched = await rest(`/rest/v1/hitmen_schedule_games?select=id,week,scheduled_at&team_id=eq.${TEAM}&season=eq.${box.season}&opponent_name=eq.${encodeURIComponent(opponent)}`, token);
  const sg = sched.find(s => Math.abs(Date.parse(s.scheduled_at) - Date.parse(game.game_at)) <= 30 * 60000);

  const side = s => lines.filter(p => p.side === s).map(statLine).join('\n') || '(no matched players)';
  const unmatched = lines.filter(p => !p.side).map(statLine).join('\n');
  const gameDate = new Date(game.game_at).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const weekday = new Date(game.game_at).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Toronto' });
  const prompt = [
    `OFFICIAL RESULT: ${CALGARY} ${cgy}, ${opponent} ${opp} (${cgy > opp ? 'Calgary win' : 'Calgary loss'}). Calgary was the ${calgaryHome ? 'home' : 'away'} team.`,
    `Played ${weekday} ${gameDate}, LGCHL Season ${box.season}${sg?.week ? ', week ' + sg.week : ''}. Calgary game number ${gameNo} of the season; record after this game: ${record}.`,
    `Team abbreviations: ${CALGARY} = ${abbr(CALGARY)}, ${opponent} = ${abbr(opponent)}.`,
    `\nCALGARY PLAYER LINES (LG box score):\n${side(calgaryHome ? 'home' : 'away')}`,
    `\n${opponent.toUpperCase()} PLAYER LINES (LG box score):\n${side(calgaryHome ? 'away' : 'home')}`,
    unmatched ? `\nPLAYERS NOT MATCHED TO A TEAM (do not attribute them to either team):\n${unmatched}` : '',
    `\nTEAM STATS LINES, raw from the LG box score in page order (labels followed by values; use the team names in these lines to tell the two teams apart, and omit any stat you cannot attribute with certainty):\n${(box.team_stats || []).slice(0, 200).join(' | ')}`,
    box.period_stats?.length ? `\nPERIOD STATS LINES (raw):\n${box.period_stats.slice(0, 120).join(' | ')}` : '',
  ].filter(Boolean).join('\n');

  const recap = await openRouter(prompt);
  const metrics = {
    dek: String(recap.dek || '').slice(0, 300),
    team: CALGARY, league: 'LGCHL', season: box.season, week: sg?.week ?? game.week ?? null,
    final: `${cgy}-${opp}`, record, result: cgy > opp ? 'W' : 'L', game_no: gameNo,
    sort_at: new Date(game.game_at).toISOString().replace(/\.\d{3}Z$/, 'Z'), opponent, game_date: gameDate,
    key_stats: recap.key_stats && typeof recap.key_stats === 'object' ? recap.key_stats : {},
    three_stars: Array.isArray(recap.three_stars) ? recap.three_stars.slice(0, 3) : [],
    source: 'LG', calgary_score: cgy, opponent_score: opp, vod_available: false,
    source_label: 'LeagueGaming box score', schedule_game_id: sg?.id || null, model: recap.model,
  };
  const postId = await rest('/rest/v1/rpc/hitmen_publish_auto_recap', token, {
    method: 'POST',
    body: JSON.stringify({ p_lg_game_id: Number(id), p_title: String(recap.title).slice(0, 160), p_body: String(recap.body), p_metrics: metrics }),
  });
  return { lgGameId: Number(id), ok: true, postId, title: String(recap.title).slice(0, 160) };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const token = String(req.headers.authorization || '');
  if (!/^Bearer \S+$/.test(token)) return res.status(401).json({ error: 'Sign in to Wildman management.' });
  try {
    const user = await rest('/auth/v1/user', token);
    if (!user?.id) throw fail(401, 'Sign in to Wildman management.');
    const ids = [...new Set((req.body?.lgGameIds || []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, 12);
    if (!ids.length) throw fail(400, 'No LG game ids supplied.');
    const results = await Promise.all(ids.map(id => writeOne(id, token).catch(e => ({ lgGameId: id, ok: false, error: String(e.message || e).slice(0, 300) }))));
    return res.status(200).json({ results });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Recap writer failed.' });
  }
};
