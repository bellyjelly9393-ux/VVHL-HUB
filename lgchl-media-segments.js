/* LGCHL Media desk: extra league segments (lgchl-media.html).
   Public read-only data only: the standings/schedule already loaded by lgchl-media.js, the public
   season leaders view, and the public week/trending views. Every line is built from those numbers. */
(() => {
  'use strict';
  const D = window.WMDesk;
  if (!D) return;
  const { $, esc, read, ordinal, tint, F } = D;
  const logo = id => Number.isSafeInteger(Number(id)) && Number(id) > 0 ? 'assets/lgchl/s55/team' + Number(id) + '.png' : 'assets/wildman/home/lgchl-logo.webp';
  const wm = id => '<span class="wm" aria-hidden="true" style="--logo:url(\'' + logo(id) + '\')"></span>';
  const sgn = v => { const n = Number(v); if (!Number.isFinite(n)) return '—'; return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0'; };
  const streak = s => { const m = /^-?(\d+)\s*([WL])/i.exec(String(s || '').trim()); return m ? { n: Number(m[1]), win: m[2].toUpperCase() === 'W' } : null; };
  const empty = t => '<p class="empty">' + esc(t) + '</p>';
  const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };

  /* ---------- The Races: every conference, top four and the gap ---------- */
  function renderRaces(standings) {
    const box = $('lgRaces');
    if (!box) return;
    if (!standings || !standings.length) { box.innerHTML = empty('Standings are unavailable right now.'); return; }
    const groups = new Map();
    standings.forEach(t => { const k = t.league + ' · ' + t.conference; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
    const order = ['OHL', 'WHL', 'QMJHL'];
    const keys = [...groups.keys()].sort((a, b) => order.indexOf(a.split(' · ')[0]) - order.indexOf(b.split(' · ')[0]) || a.localeCompare(b));
    box.innerHTML = keys.map(k => {
      const rows = groups.get(k).slice().sort((a, b) => Number(a.conference_rank) - Number(b.conference_rank)).slice(0, 4);
      const lead = rows[0], second = rows[1];
      const gap = second ? Number(lead.pts) - Number(second.pts) : null;
      const line = gap == null ? '' : gap === 0 ? esc(lead.nickname || lead.name) + ' and ' + esc(second.nickname || second.name) + ' are level at the top.'
        : gap <= 2 ? esc(second.nickname || second.name) + ' sit ' + gap + ' point' + (gap === 1 ? '' : 's') + ' off first. Tight at the top.'
        : esc(lead.nickname || lead.name) + ' lead by ' + gap + ' points.';
      return '<article class="card tinted lg-race" data-logo="' + logo(lead.lg_team_id) + '">' + wm(lead.lg_team_id) +
        '<p class="lg-race-tag">' + esc(k) + '</p>' +
        '<ol class="lg-race-list num">' + rows.map((t, i) => '<li><span class="lg-race-rk">' + (i + 1) + '</span><img src="' + logo(t.lg_team_id) + '" alt="" loading="lazy"><b>' + esc(t.nickname || t.name) + '</b><span class="lg-race-pts">' + esc(t.pts) + '</span><small>' + (i ? (Number(t.pts) === Number(lead.pts) ? 'level' : '−' + (Number(lead.pts) - Number(t.pts))) : 'PTS') + '</small></li>').join('') + '</ol>' +
        '<p class="lg-race-line">' + line + '</p></article>';
    }).join('');
    tint(box);
  }

  /* ---------- Heaters & Skids: active streaks ---------- */
  function renderStreaks(standings) {
    const hot = $('lgHeaters'), cold = $('lgSkids');
    if (!hot || !cold) return;
    const rows = (standings || []).map(t => ({ t, s: streak(t.streak) })).filter(x => x.s && x.s.n >= 2);
    const card = (x, win) => '<article class="card tinted lg-streak ' + (win ? 'is-hot' : 'is-cold') + '" data-logo="' + logo(x.t.lg_team_id) + '">' + wm(x.t.lg_team_id) +
      '<b class="lg-streak-n">' + (win ? 'W' : 'L') + x.s.n + '</b>' +
      '<div class="lg-card-head"><img src="' + logo(x.t.lg_team_id) + '" alt="" loading="lazy"><div><b>' + esc(x.t.name) + '</b><small>' + esc(x.t.league) + ' · ' + esc(x.t.last10 || '—') + ' last 10</small></div></div></article>';
    const heaters = rows.filter(x => x.s.win).sort((a, b) => b.s.n - a.s.n || Number(b.t.pts) - Number(a.t.pts)).slice(0, 4);
    const skids = rows.filter(x => !x.s.win).sort((a, b) => b.s.n - a.s.n || Number(a.t.pts) - Number(b.t.pts)).slice(0, 4);
    hot.innerHTML = heaters.map(x => card(x, true)).join('') || empty('No active win streaks of two or more.');
    cold.innerHTML = skids.map(x => card(x, false)).join('') || empty('No active losing streaks of two or more.');
    tint(hot); tint(cold);
  }

  /* ---------- Upset Alert: lower-ranked teams beating the elite ---------- */
  function renderUpsets(games, ranked) {
    const box = $('lgUpsets');
    if (!box) return;
    const rank = new Map((ranked || []).map(t => [Number(t.lg_team_id), t]));
    const finals = (games || []).filter(g => g.status === 'final' && [g.away_score, g.home_score].every(v => v != null && Number.isFinite(Number(v))) && Number(g.away_score) !== Number(g.home_score));
    if (!finals.length || !rank.size) { show('lgUpsetSec', false); return; }
    const lastWeek = Math.max(...finals.map(g => Number(g.week) || 0));
    const ups = finals.filter(g => Number(g.week) === lastWeek).map(g => {
      const awayWon = Number(g.away_score) > Number(g.home_score);
      const w = rank.get(Number(awayWon ? g.away_lg_team_id : g.home_lg_team_id)), l = rank.get(Number(awayWon ? g.home_lg_team_id : g.away_lg_team_id));
      return w && l ? { g, w, l, gap: w.rank - l.rank, ws: awayWon ? g.away_score : g.home_score, ls: awayWon ? g.home_score : g.away_score } : null;
    }).filter(x => x && x.gap >= 15).sort((a, b) => b.gap - a.gap || a.l.rank - b.l.rank);
    // one upset per beaten team keeps the board varied
    const seen = new Set(), picks = [];
    for (const u of ups) { if (picks.length < 4 && !seen.has(u.l.lg_team_id)) { picks.push(u); seen.add(u.l.lg_team_id); } }
    if (!picks.length) { show('lgUpsetSec', false); return; }
    $('lgUpsetEyebrow').textContent = 'Week ' + lastWeek + ' · biggest shocks';
    box.innerHTML = picks.map(u => '<article class="card tinted lg-card lg-upset" data-logo="' + logo(u.w.lg_team_id) + '">' + wm(u.w.lg_team_id) +
      '<div class="lg-upset-vs"><div><img src="' + logo(u.w.lg_team_id) + '" alt=""><small>No. ' + u.w.rank + '</small></div><b class="num">' + esc(u.ws) + '–' + esc(u.ls) + '</b><div><img src="' + logo(u.l.lg_team_id) + '" alt=""><small>No. ' + u.l.rank + '</small></div></div>' +
      '<h3 class="lg-upset-title">' + esc(u.w.nickname || u.w.name) + ' stun ' + esc(u.l.nickname || u.l.name) + '</h3>' +
      '<p class="lg-line">' + u.gap + ' spots apart in the power index · ' + esc(F.day.format(new Date(u.g.game_at))) + '</p></article>').join('');
    tint(box);
  }

  /* ---------- The Grinders + Sniper Watch: season leaders beyond points ---------- */
  async function renderGrinders() {
    const box = $('lgGrinders');
    if (!box) return;
    const cols = 'gamertag,position,lg_team_id,team_name,gp,hits,blocked_shots,takeaways';
    const cats = [['hits', 'Hits', 'Bodies on the boards'], ['blocked_shots', 'Blocks', 'Pucks taken for the team'], ['takeaways', 'Takeaways', 'Pucks stolen back']];
    const results = await Promise.allSettled(cats.map(([k]) => read('wm_lgchl_s55_player_leaders', { select: cols, player_kind: 'eq.skater', order: k + '.desc.nullslast,gp.asc,gamertag.asc', limit: '3' })));
    const html = cats.map(([k, label, sub], i) => {
      const rows = results[i].status === 'fulfilled' ? results[i].value : [];
      if (!rows.length) return '';
      const top = rows[0];
      return '<article class="card tinted lg-grind" data-logo="' + logo(top.lg_team_id) + '">' + wm(top.lg_team_id) +
        '<p class="lg-grind-cat">' + esc(label) + '<small>' + esc(sub) + '</small></p>' +
        '<ol class="lg-grind-list">' + rows.map((p, j) => '<li' + (j ? '' : ' class="lead"') + '><img src="' + logo(p.lg_team_id) + '" alt="" loading="lazy"><div><b>' + esc(p.gamertag) + '</b><small>' + esc(p.position || '') + ' · ' + esc(p.team_name || 'LGCHL') + '</small></div><span class="num">' + esc(p[k]) + '</span></li>').join('') + '</ol></article>';
    }).join('');
    if (!html) { show('lgGrindSec', false); return; }
    box.innerHTML = html;
    tint(box);
  }

  async function renderSnipers() {
    const box = $('lgSnipers');
    if (!box) return;
    let rows = [];
    try {
      rows = await read('wm_lgchl_s55_player_leaders', { select: 'gamertag,position,lg_team_id,team_name,gp,goals,shots', player_kind: 'eq.skater', shots: 'gte.25', order: 'goals.desc', limit: '1000' });
    } catch { show('lgSniperSec', false); return; }
    const top = rows.filter(p => Number(p.shots) > 0).map(p => ({ ...p, pct: Number(p.goals) / Number(p.shots) }))
      .sort((a, b) => b.pct - a.pct || Number(b.goals) - Number(a.goals)).slice(0, 5);
    if (!top.length) { show('lgSniperSec', false); return; }
    box.innerHTML = top.map((p, i) => '<article class="card tinted lg-snipe' + (i ? '' : ' lead') + '" data-logo="' + logo(p.lg_team_id) + '">' + wm(p.lg_team_id) +
      '<span class="lg-snipe-rk">' + ordinal(i + 1) + '</span>' +
      '<b class="lg-snipe-pct num">' + (100 * p.pct).toFixed(1) + '<i>%</i></b>' +
      '<div class="lg-card-head"><img src="' + logo(p.lg_team_id) + '" alt="" loading="lazy"><div><b>' + esc(p.gamertag) + '</b><small>' + esc(p.team_name || 'LGCHL') + '</small></div></div>' +
      '<p class="lg-line num">' + esc(p.goals) + ' goals on ' + esc(p.shots) + ' shots</p></article>').join('');
    tint(box);
  }

  /* ---------- Players of the Week + Trending Now (saved season totals, compared) ---------- */
  function playerCard(p, teams, tag) {
    const team = teams.get(Number(p.lg_team_id));
    const goalie = p.player_kind === 'goalie';
    const sv = goalie && Number(p.shots_against) > 0 ? (Number(p.saves) / Number(p.shots_against)) : null;
    return '<article class="card tinted lg-card lg-form-card" data-logo="' + logo(p.lg_team_id) + '">' + wm(p.lg_team_id) +
      (tag ? '<p class="lg-potw-tag">' + esc(tag) + '</p>' : '') +
      '<div class="lg-card-head"><img src="' + logo(p.lg_team_id) + '" alt=""><div><b>' + esc(p.gamertag) + '</b><small>' + esc(p.position || (goalie ? 'G' : '')) + ' · ' + esc(team ? team.name : 'LGCHL') + '</small></div></div>' +
      (goalie
        ? '<div class="lg-jump"><b class="num">' + (sv == null ? '—' : sv.toFixed(3).replace(/^0/, '')) + '</b><span>save % · ' + esc(p.gp) + ' GP</span></div><p class="lg-line num">' + esc(p.saves) + ' saves · ' + esc(p.goals_against) + ' GA</p>'
        : '<div class="lg-jump"><b class="num">' + esc(p.points) + '</b><span>points in ' + esc(p.gp) + ' GP</span></div><p class="lg-line num">' + esc(p.goals) + ' G · ' + esc(p.assists) + ' A · ' + sgn(p.plus_minus) + ' · ' + esc(p.shots) + ' SOG</p>') +
      '</article>';
  }

  async function renderForm(teams, games) {
    const upcoming = (games || []).filter(g => g.status !== 'final').map(g => Number(g.week)).filter(Boolean);
    const nextWeek = upcoming.length ? Math.min(...upcoming) : null;
    const [wk, tr] = await Promise.allSettled([
      read('lgchl_public_week_players', { select: 'week,player_kind,gamertag,position,lg_team_id,gp,goals,assists,points,plus_minus,shots,saves,shots_against,goals_against', order: 'points.desc,goals.desc,gamertag.asc', limit: '400' }),
      read('lgchl_public_trending_players', { select: 'player_kind,gamertag,position,lg_team_id,gp,goals,assists,points,plus_minus,shots', player_kind: 'eq.skater', order: 'points.desc,goals.desc,gp.asc,gamertag.asc', limit: '6' })
    ]);
    // Players of the Week: top 3 skaters + best goalie (min 25 shots faced).
    const week = wk.status === 'fulfilled' ? wk.value : [];
    const skaters = week.filter(p => p.player_kind === 'skater' && Number(p.points) > 0).slice(0, 3);
    const goalie = week.filter(p => p.player_kind === 'goalie' && Number(p.shots_against) >= 25)
      .sort((a, b) => Number(b.saves) / Number(b.shots_against) - Number(a.saves) / Number(a.shots_against))[0];
    if (skaters.length) {
      const w = skaters[0].week;
      $('lgWeekPlayersNote').textContent = 'Week ' + w + ' · the league\'s top performers, game week totals.';
      $('lgWeekPlayers').innerHTML = skaters.map((p, i) => playerCard(p, teams, ['First star', 'Second star', 'Third star'][i])).join('') + (goalie ? playerCard(goalie, teams, 'Goalie of the week') : '');
    } else {
      $('lgWeekPlayersNote').textContent = 'Three stars and a goalie of the week, every week.';
      $('lgWeekPlayers').innerHTML = '<article class="card lg-card lg-soon"><span class="wm wm-lg lg-wm-league" aria-hidden="true"></span><p class="lg-potw-tag">Coming up</p><h3>' + (nextWeek ? 'Week ' + nextWeek + ' stars' : 'This week\'s stars') + ' drop after Tuesday\'s games</h3><p>The top three skaters and the goalie of the week, straight from the game-week totals.</p></article>';
    }
    // Trending now.
    const trend = tr.status === 'fulfilled' ? tr.value.filter(p => Number(p.points) > 0) : [];
    if (trend.length) {
      $('lgTrendNote').textContent = 'Most points over the last two game nights.';
      $('lgTrendingRecords').innerHTML = trend.map(p => playerCard(p, teams, null)).join('');
    } else {
      $('lgTrendNote').textContent = 'The hottest sticks over the last two game nights.';
      $('lgTrendingRecords').innerHTML = '<article class="card lg-card lg-soon"><span class="wm wm-lg lg-wm-league" aria-hidden="true"></span><p class="lg-potw-tag">Coming up</p><h3>First board after Sunday night</h3><p>Who\'s piling up points right now. Updated after every game night.</p></article>';
    }
    tint($('lgWeekPlayers')); tint($('lgTrendingRecords'));
  }

  window.LGCHLSegments = { renderRaces, renderStreaks, renderUpsets, renderGrinders, renderSnipers, renderForm };
})();
