/* LGCHL Media desk (lgchl-media.html).
   Public data only: the same publishable-key REST reads as the other media desks (media-desk.js),
   against public read-only views: lgchl_standings_current, lgchl_standings_snapshots,
   lgchl_games_board and wm_lgchl_s55_player_leaders. Breakout Watch and player movement prefer the narrow public history views, with
   the supplied, explicitly dated snapshot retained while the approved import is unavailable. No private tables,
   no service keys, no Hitmen scouting data. Every sentence is generated from those numbers. */
(() => {
  'use strict';
  const D = window.WMDesk;
  if (!D) return;
  const { $, esc, read, F, ordinal, tint, menu } = D;
  menu();

  const DAY = 864e5;
  const iso = ms => new Date(ms).toISOString();
  const logo = id => Number.isSafeInteger(Number(id)) && Number(id)>0 ? 'assets/lgchl/s55/team' + Number(id) + '.png' : 'assets/wildman/home/lgchl-logo.webp';
  const ev = (kind, text) => '<span class="lg-ev lg-ev-' + kind + '">' + esc(text) + '</span>';
  const sgn = v => { if(v==null || v==='' || !Number.isFinite(Number(v)))return '—'; const n = Number(v); return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0'; };
  const wm = id => '<span class="wm" aria-hidden="true" style="--logo:url(\'' + logo(id) + '\')"></span>';
  const unavailable = what => '<p class="empty">' + esc(what) + ' is unavailable right now.</p>';
  const stamp = v => window.LGCHLPublicDesk.stamp(v);

  // Same formula as lgchl-leaders.js (public, documented under the table).
  function powerScore(s) {
    const gp = Math.max(1, Number(s.gp || 1)), pts = Number(s.pts || 0), gf = Number(s.gf || 0), ga = Number(s.ga || 0);
    return 100 * (.70 * Math.min(1, pts / (2 * gp)) + .20 * Math.max(0, Math.min(1, ((gf - ga) / gp + 3) / 6)) + .10 * Math.max(0, Math.min(1, (gf / gp) / 6)));
  }
  function rankTeams(rows) {
    return rows.filter(s => Number(s.gp) >= 5 && ['pts','gf','ga'].every(k=>s[k]!=null && Number.isFinite(Number(s[k]))))
      .map(s => ({ ...s, score: powerScore(s), gd: Number(s.gf || 0) - Number(s.ga || 0) }))
      .sort((a, b) => b.score - a.score || b.gd - a.gd || Number(b.gf) - Number(a.gf))
      .map((s, i) => ({ ...s, rank: i + 1 }));
  }
  // LG streak strings look like "4W" or "-1L".
  function streak(s) {
    const m = /^-?(\d+)\s*([WL])/i.exec(String(s || '').trim());
    return m ? { n: Number(m[1]), win: m[2].toUpperCase() === 'W', label: m[2].toUpperCase() + m[1] } : null;
  }
  const record = t => [t.w,t.l,t.otl].map(v=>v==null?'—':v).join('-');

  async function main() {
    const now = Date.now();
    const [standingsR, gamesR, histR] = await Promise.allSettled([
      read('lgchl_standings_current', { select: 'lg_team_id,name,abbr,nickname,league,conference,gp,w,l,otl,pts,gf,ga,gd,streak,last10,conference_rank,standings_at' }),
      read('lgchl_games_board', {
        select: 'lg_game_id,week,game_at,status,league,away_lg_team_id,away_abbr,away_nick,away_score,away_conf_rank,home_lg_team_id,home_abbr,home_nick,home_score,home_conf_rank,big_game,big_reasons,source_url,fetched_at',
        season: 'eq.55', and: '(game_at.gte.' + iso(now - 9 * DAY) + ',game_at.lte.' + iso(now + 10 * DAY) + ')', order: 'game_at.asc', limit: '1000'
      }),
      window.LGCHLPublicDesk.loadHistory()
    ]);
    const standings = standingsR.status === 'fulfilled' ? standingsR.value : null;
    const games = gamesR.status === 'fulfilled' ? gamesR.value : null;
    const hist = histR.status === 'fulfilled' ? histR.value : null;
    const teams = new Map((standings || []).map(t => [Number(t.lg_team_id), t]));

    // Latest completed game week, and the standings just before it started (for rank movement).
    let week = null, weekStart = null, lastNight = [], lastFinal = null;
    if (games) {
      const finals = games.filter(g => g.status === 'final');
      if (finals.length) {
        lastFinal = Math.max(...finals.map(g => Date.parse(g.game_at)));
        lastNight = finals.filter(g => lastFinal - Date.parse(g.game_at) <= 6 * 3600e3);
        week = finals.find(g => Date.parse(g.game_at) === lastFinal).week;
        weekStart = Math.min(...games.filter(g => g.week === week).map(g => Date.parse(g.game_at)));
      }
    }
    let ranked = null;
    if (standings) {
      ranked = rankTeams(standings);
      if (weekStart) {
        try {
          const snaps = await read('lgchl_standings_snapshots', { select: 'lg_team_id,taken_at,gp,pts,gf,ga', season: 'eq.55', taken_at: 'lt.' + iso(weekStart), order: 'taken_at.desc', limit: '1000' });
          const seen = new Map();
          snaps.forEach(s => { if (!seen.has(s.lg_team_id)) seen.set(s.lg_team_id, s); });
          const prev = new Map(rankTeams([...seen.values()]).map(t => [Number(t.lg_team_id), t.rank]));
          ranked.forEach(t => { const p = prev.get(Number(t.lg_team_id)); t.prev = p ?? null; t.move = p ? p - t.rank : null; });
        } catch { /* movement simply stays blank */ }
      }
    }

    renderHero(ranked, week);
    renderScores(lastNight, lastFinal);
    renderPower(ranked, week, standings);
    const SEG = window.LGCHLSegments;
    if (SEG) { SEG.renderRaces(standings); SEG.renderStreaks(standings); SEG.renderUpsets(games, ranked); SEG.renderGrinders(); SEG.renderSnipers(); }
    renderBreakout(hist, teams);
    renderMovers(hist, teams);
    // Matchup player spotlights use the same public season leaders as the board.
    const matchupPlayers = await read('wm_lgchl_s55_player_leaders', { select: SKATER_COLS, player_kind: 'eq.skater', order: 'points.desc.nullslast', points: 'not.is.null', limit: '250' }).catch(() => []);
    renderMatchups(games, now, teams, matchupPlayers);
    if (SEG) await SEG.renderForm(teams, games).catch(() => {});
    const leaders = await loadLeaders('points');
    renderNews(ranked, week, leaders);
    loadGoalies();
    document.querySelectorAll('.lg-tabs button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.lg-tabs button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      loadLeaders(b.dataset.metric);
    }));
    tint(document);
  }

  function renderHero(ranked, week) {
    const kicker = $('lgLeadKicker'), feat = $('lgFeat');
    if (!ranked || !ranked.length) { kicker.innerHTML = ev('na', 'Standings unavailable right now'); return; }
    const climbers = ranked.filter(t => t.rank <= 12 && t.move > 0).sort((a, b) => b.move - a.move || a.rank - b.rank);
    const t = climbers[0] || ranked[0];
    const st = streak(t.streak);
    kicker.innerHTML = '<span class="lg-ev">' + (climbers[0] ? 'Team on the rise' : 'Top of the index') + (week ? ' · after Week ' + esc(week) : '') + '</span>';
    $('lgLeadTitle').innerHTML = climbers[0]
      ? esc(t.nickname || t.name) + ' climb <em>' + t.move + ' spot' + (t.move === 1 ? '' : 's') + '</em>'
      : esc(t.nickname || t.name) + ' lead <em>the index</em>';
    let dek = 'The ' + esc(t.name) + ' are ' + esc(record(t)) + ', ' + esc(t.last10) + ' over their last ten';
    if (st && st.win && st.n >= 2) dek += ', on a ' + st.n + '-game win streak';
    dek += climbers[0] ? '. They moved from ' + ordinal(t.prev) + ' to ' + ordinal(t.rank) + ' in the Elitechel power index.' : ', and sit 1st in the Elitechel power index.';
    $('lgLeadDek').innerHTML = dek;
    const mv = t.move > 0 ? '<b class="up">' + t.rank + ' ▲' + t.move + '</b>' : t.move < 0 ? '<b class="dn">' + t.rank + ' ▼' + Math.abs(t.move) + '</b>' : '<b>' + t.rank + '</b>';
    feat.dataset.logo = logo(t.lg_team_id);
    feat.innerHTML = wm(t.lg_team_id) +
      '<div class="lg-feat-head"><img src="' + logo(t.lg_team_id) + '" width="100" height="100" alt="' + esc(t.name) + ' logo"><div><small>' + esc(t.league) + ' · ' + esc(t.conference) + '</small><b>' + esc(t.name) + '</b></div></div>' +
      '<div class="lg-tiles num"><div class="lg-tile"><small>Last 10</small><b>' + esc(t.last10) + '</b></div><div class="lg-tile"><small>Streak</small><b>' + esc(st ? st.label : '—') + '</b></div><div class="lg-tile"><small>Power rank</small>' + mv + '</div><div class="lg-tile"><small>Goal diff</small><b>' + sgn(t.gd) + '</b></div></div>' +
      '<div class="lg-tiles num"><div class="lg-tile"><small>Record</small><b>' + esc(record(t)) + '</b></div><div class="lg-tile"><small>Points</small><b>' + esc(t.pts) + '</b></div><div class="lg-tile"><small>GF</small><b>' + esc(t.gf) + '</b></div><div class="lg-tile"><small>GA</small><b>' + esc(t.ga) + '</b></div></div>' +
      (t.prev ? '<p class="lg-fine">Rank change compares with the standings before Week ' + esc(week) + '.</p>' : '');
    feat.hidden = false;
  }

  function renderScores(lastNight, lastFinal) {
    const box = $('lgScores'), note = $('lgScoresNote');
    if (!lastNight.length) { note.textContent = 'No finals in the last nine days.'; box.innerHTML = unavailable('Recent scores'); return; }
    note.textContent = lastNight.length + ' finals · ' + F.longDay.format(new Date(lastFinal)) + ' · widest margins shown';
    const top = [...lastNight].sort((a, b) => Math.abs(b.home_score - b.away_score) - Math.abs(a.home_score - a.away_score) || (b.home_score + b.away_score) - (a.home_score + a.away_score)).slice(0, 6);
    box.innerHTML = top.map(g => {
      const awayWin = g.away_score > g.home_score, win = awayWin ? g.away_lg_team_id : g.home_lg_team_id;
      const line = (id, ab, sc, w) => '<div class="lg-sc-line' + (w ? ' w' : '') + '"><img src="' + logo(id) + '" alt=""><span>' + esc(ab) + '</span><b class="num">' + esc(sc) + '</b></div>';
      return '<article class="card tinted lg-sc" data-logo="' + logo(win) + '">' + wm(win) +
        line(g.away_lg_team_id, g.away_abbr, g.away_score, awayWin) + line(g.home_lg_team_id, g.home_abbr, g.home_score, !awayWin) +
        '<div class="lg-sc-foot"><span>Final · ' + esc(g.league) + '</span>' + (g.source_url ? '<a href="' + esc(g.source_url) + '" target="_blank" rel="noopener noreferrer">Box score ↗</a>' : '') + '</div></article>';
    }).join('');
  }

  function renderPower(ranked, week, standings) {
    const body = $('lgPower');
    if (!ranked || !ranked.length) { body.innerHTML = '<tr><td colspan="7" class="empty">Standings are unavailable right now.</td></tr>'; return; }
    if (week) $('lgPowerEyebrow').textContent = 'Elitechel power index · after Week ' + week;
    body.innerHTML = ranked.slice(0, 15).map(t => {
      const m = t.move, mv = m == null ? '<td class="lg-mv eq">—</td>' : m > 0 ? '<td class="lg-mv up">▲' + m + '</td>' : m < 0 ? '<td class="lg-mv dn">▼' + Math.abs(m) + '</td>' : '<td class="lg-mv eq">—</td>';
      return '<tr><td class="lg-rk">' + t.rank + '</td>' + mv +
        '<td><div class="lg-team"><img src="' + logo(t.lg_team_id) + '" alt=""><div><b>' + esc(t.nickname || t.name) + '</b><small>' + esc(t.abbr) + ' · ' + esc(t.league) + '</small></div></div></td>' +
        '<td>' + esc(record(t)) + '</td><td class="r">' + sgn(t.gd) + '</td><td>' + esc(t.last10) + '</td>' +
        '<td class="r"><div class="lg-score-cell"><b>' + t.score.toFixed(1) + '</b><div class="lg-bar"><i style="width:' + Math.min(100, t.score).toFixed(1) + '%"></i></div></div></td></tr>';
    }).join('');
    const at = (standings || []).map(s => s.standings_at).filter(Boolean).sort().pop();
    const all = $('lgPowerAll'); if (all) all.textContent = 'FULL POWER RANKINGS · ALL ' + ranked.length + ' TEAMS →';
    $('lgPowerNote').textContent = 'Score = 70% points percentage + 20% goal differential per game + 10% goals per game. Minimum 5 GP. ' +
      (week ? 'Move compares with the standings before Week ' + week + '. ' : '') + 'No subjective boosts, for any team.';
  }

  const rate = (v,d) => v==null || v==='' || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d);
  const SKATER_COLS = 'gamertag,position,player_kind,lg_team_id,team_name,gp,goals,assists,points,plus_minus,save_pct,gaa,fetched_at';
  let leaderRequest=0;
  async function loadLeaders(metric) {
    const request=++leaderRequest;
    const body = $('lgLeaders'), head = $('lgLeadersHead'), goalie = metric === 'save_pct';
    $('lgFullLeaders').href='lgchl-leaders.html?metric='+encodeURIComponent(metric)+'#lgPlayerBoard';
    $('lgFindPlayer').href='lgchl-leaders.html?metric='+encodeURIComponent(metric)+'&search=1#lgPlayerSearch';
    head.innerHTML = goalie
      ? '<tr><th>#</th><th>Goalie</th><th class="r">GP</th><th class="r">SV%</th><th class="r">GAA</th></tr>'
      : '<tr><th>#</th><th>Player</th><th class="r">G</th><th class="r">A</th><th class="r">PTS</th><th class="r">+/-</th></tr>';
    try {
      const params = { select: SKATER_COLS, player_kind: 'eq.' + (goalie ? 'goalie' : 'skater'), order: metric + '.desc.nullslast,gp.desc,gamertag.asc', [metric]:'not.is.null', limit: '10' };
      if (goalie) params.gp = 'gte.8';
      const rows = await read('wm_lgchl_s55_player_leaders', params);
      if(request!==leaderRequest)return null;
      body.innerHTML = rows.map((p, i) => {
        const rank=1+rows.filter(x=>Number(x[metric])>Number(p[metric])).length;
        const who = '<td><div class="lg-team"><img src="' + logo(p.lg_team_id) + '" alt=""><div><b>' + esc(p.gamertag) + '</b><small>' + esc(goalie ? 'G' : p.position) + ' · ' + esc(p.team_name || '') + '</small></div></div></td>';
        return goalie
          ? '<tr><td class="lg-rk">' + rank + '</td>' + who + '<td class="r">' + esc(p.gp) + '</td><td class="r lg-pts">' + rate(p.save_pct,3).replace(/^0/, '') + '</td><td class="r">' + rate(p.gaa,2) + '</td></tr>'
          : '<tr><td class="lg-rk">' + rank + '</td>' + who + '<td class="r">' + esc(p.goals) + '</td><td class="r">' + esc(p.assists) + '</td><td class="r lg-pts">' + esc(p.points) + '</td><td class="r">' + sgn(p.plus_minus) + '</td></tr>';
      }).join('') || '<tr><td colspan="6" class="empty">No qualifying players yet.</td></tr>';
      const at = rows.map(r => r.fetched_at).filter(Boolean).sort().pop();
      $('lgLeadersNote').textContent = (goalie ? 'Goalies with 8+ GP. ' : '') + 'Top 10 players; tied totals share a rank. Search up to 250 on the full board.';
      return rows;
    } catch {
      if(request!==leaderRequest)return null;
      body.innerHTML = '<tr><td colspan="6" class="empty">Leaders are unavailable right now.</td></tr>';
      return null;
    }
  }
  async function loadGoalies() {
    const box = $('lgGoalies');
    try {
      const rows = await read('wm_lgchl_s55_player_leaders', { select: 'gamertag,team_name,gp,save_pct,gaa,fetched_at', player_kind: 'eq.goalie', gp: 'gte.8', order: 'save_pct.desc', limit: '3' });
      box.innerHTML = rows.map((g, i) => '<div><small>Save % · 8+ GP · ' + ordinal(i + 1) + '</small><b>' + esc(g.gamertag) + '</b><span class="num">' + rate(g.save_pct,3).replace(/^0/, '') + '</span> <small>' + esc(g.team_name || '') + ' · ' + rate(g.gaa,2) + ' GAA</small></div>').join('');
    } catch { box.innerHTML = ''; }
  }

  function leagueContext(t) {
    if (!(Number(t.gp) > 0)) return '';
    const attack = Number(t.gf) / Number(t.gp), defense = Number(t.ga) / Number(t.gp);
    if (![t.gf,t.ga].every(v => v != null && Number.isFinite(Number(v)))) return '';
    return '<p class="lg-story-context"><b>The bigger picture</b> ' + esc(t.nickname || t.name) +
      ' average ' + attack.toFixed(2) + ' goals for and ' + defense.toFixed(2) + ' against per game.' +
      (t.conference_rank ? ' They sit ' + ordinal(t.conference_rank) + ' in the ' + esc(t.conference || 'conference') + ' standings.' : '') +
      ' The next test is ' + (attack > defense ? 'protecting that scoring edge as the standings race tightens.' : 'closing that scoring gap to put pressure on the teams above them.') + '</p>';
  }

  function renderNews(ranked, week, leaders) {
    const box = $('lgNews');
    if (!ranked || !ranked.length) { box.innerHTML = unavailable('League notes'); return; }
    const top = ranked[0], hero = ranked.filter(t => t.rank <= 12 && t.move > 0).sort((a, b) => b.move - a.move || a.rank - b.rank)[0];
    const cards = [];
    const story = (t, tag, title, text) => '<article class="card tinted lg-story" data-logo="' + logo(t.lg_team_id) + '">' + wm(t.lg_team_id) +
      '<div class="lg-story-tag"><img src="' + logo(t.lg_team_id) + '" alt="">' + esc(tag) + ' · ' + esc(t.league) + '</div><h3>' + title + '</h3><p>' + text + '</p>' +
      leagueContext(t) + '</article>';
    // Lead: top of the index.
    cards.push('<article class="card tinted lg-story lg-story-lead" data-logo="' + logo(top.lg_team_id) + '">' +
      '<div class="lg-lead-art"><img src="' + logo(top.lg_team_id) + '" width="100" height="100" alt="' + esc(top.name) + ' logo"></div>' +
      '<div class="lg-lead-body"><div class="lg-story-tag">Power index · ' + esc(top.league) + '</div>' +
      '<h3>' + esc(top.name) + (top.prev == null ? ' lead the index' : top.prev === 1 ? ' stay on top' : ' take over No. 1') + '</h3>' +
      '<p>No. 1 in the Elitechel power index' + (week ? ' after Week ' + esc(week) : '') + (top.prev && top.prev !== 1 ? ', up from ' + ordinal(top.prev) : '') + '. ' + esc(record(top)) + ' with a ' + sgn(top.gd) + ' goal differential and ' + esc(top.last10) + ' over their last ten.</p>' +
      '<div class="lg-mini num"><div><small>Record</small><b>' + esc(record(top)) + '</b></div><div><small>Points</small><b>' + esc(top.pts) + '</b></div><div><small>Goal diff</small><b>' + sgn(top.gd) + '</b></div><div><small>Index</small><b>' + top.score.toFixed(1) + '</b></div></div>' +
      leagueContext(top) + '</div></article>');
    const used = new Set([top.lg_team_id, hero && hero.lg_team_id]);
    const climber = ranked.filter(t => t.move > 0 && !used.has(t.lg_team_id) && t.rank <= 16).sort((a, b) => b.move - a.move)[0];
    if (climber) { used.add(climber.lg_team_id); cards.push(story(climber, 'Power index', esc(climber.name) + ' jump ' + climber.move + ' spots', 'From ' + ordinal(climber.prev) + ' to ' + ordinal(climber.rank) + ' after going ' + esc(climber.last10) + ' over their last ten. Goal differential ' + sgn(climber.gd) + '.')); }
    const faller = ranked.filter(t => t.move < 0 && !used.has(t.lg_team_id) && t.prev && t.prev <= 12).sort((a, b) => a.move - b.move)[0];
    if (faller) {
      used.add(faller.lg_team_id);
      const st = streak(faller.streak);
      cards.push(story(faller, 'Team watch', esc(faller.name) + ' slide ' + Math.abs(faller.move) + ' spots', ordinal(faller.prev) + ' to ' + ordinal(faller.rank) + ' in the index. ' + esc(faller.last10) + ' over their last ten' + (st && !st.win && st.n >= 2 ? ', with ' + st.n + ' straight losses' : '') + '.'));
    }
    const hot = ranked.map(t => ({ t, st: streak(t.streak) })).filter(x => x.st && x.st.win && x.st.n >= 3 && !used.has(x.t.lg_team_id)).sort((a, b) => b.st.n - a.st.n || a.t.rank - b.t.rank)[0];
    if (hot) { used.add(hot.t.lg_team_id); cards.push(story(hot.t, 'Streak', esc(hot.t.name) + ': ' + hot.st.n + ' straight wins', esc(record(hot.t)) + ' overall and ' + esc(hot.t.last10) + ' over their last ten. ' + ordinal(hot.t.rank) + ' in the power index.')); }
    const lead = leaders && leaders[0];
    if (lead) {
      const t = { lg_team_id: lead.lg_team_id, standings_at: lead.fetched_at, sourceLabel: 'LG player stats', league: (ranked.find(x => Number(x.lg_team_id) === Number(lead.lg_team_id)) || {}).league || 'LGCHL' };
      cards.push(story(t, 'Player watch', esc(lead.gamertag) + ' leads the league with ' + esc(lead.points) + ' points', esc(lead.goals) + ' goals and ' + esc(lead.assists) + ' assists in ' + esc(lead.gp) + ' games for the ' + esc(lead.team_name || 'club') + '. ' + (Number(lead.gp)>0 ? 'That is '+(Number(lead.points)/Number(lead.gp)).toFixed(2)+' points per game; opponents have a clear name to account for in the scoring race.' : 'A player to watch in the scoring race.')));
    }
    box.innerHTML = cards.join('');
    tint(box);
  }

  function renderBreakout(hist, teams) {
    const box = $('lgBreakout');
    if (!hist || !hist.breakouts) { box.innerHTML = unavailable('Breakout watch'); return; }
    const MAX = Math.max(...hist.breakouts.slice(0, 4).map(b => b.ppg), 1) * 1.05;
    if (hist.breakout_rule) $('lgBoRule').textContent = hist.breakout_rule;
    box.innerHTML = hist.breakouts.slice(0, 4).map(b => {
      const team = teams.get(Number(b.lg_team_id));
      return '<article class="card tinted lg-card" data-logo="' + logo(b.lg_team_id) + '">' + wm(b.lg_team_id) +
        '<div class="lg-card-head"><img src="' + logo(b.lg_team_id) + '" alt=""><div><b>' + esc(b.gamertag) + '</b><small>' + esc(b.position) + ' · ' + esc(team ? team.name : 'LGCHL') + '</small></div></div>' +
        '<div class="lg-jump"><b class="num">+' + (b.ppg - b.prev_ppg).toFixed(2) + '</b><span>points per game vs last season</span></div>' +
        '<div class="lg-cmp num"><div class="lg-cmp-row"><span>S54</span><div class="lg-cmp-bar"><i style="width:' + (100 * b.prev_ppg / MAX).toFixed(1) + '%"></i></div><b>' + b.prev_ppg.toFixed(2) + '</b></div>' +
        '<div class="lg-cmp-row now"><span>S55</span><div class="lg-cmp-bar"><i style="width:' + (100 * b.ppg / MAX).toFixed(1) + '%"></i></div><b>' + b.ppg.toFixed(2) + '</b></div></div>' +
        '<p class="lg-line num">' + esc(b.points) + ' PTS in ' + esc(b.gp) + ' GP · ' + esc(b.goals) + ' G · ' + sgn(b.plus_minus) + '</p>' +
        (b.note ? '<p class="lg-card-note">' + esc(b.note) + '</p>' : '') + '</article>';
    }).join('') || '<p class="empty">No players meet the breakout thresholds yet.</p>';
    $('lgBoNote').textContent = 'Early season: these are paces, not finished seasons.';
  }

  function renderMovers(hist, teams) {
    const box = $('lgMovers');
    if (!hist || !hist.movers) { box.innerHTML = unavailable('Player movement'); return; }
    const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    box.innerHTML = hist.movers.slice(0, 4).map(m => {
      const team = teams.get(Number(m.lg_team_id));
      return '<article class="card tinted lg-card" data-logo="' + logo(m.lg_team_id) + '">' + wm(m.lg_team_id) +
        '<div class="lg-card-head"><img src="' + logo(m.lg_team_id) + '" alt=""><div><b>' + esc(m.gamertag) + '</b><small>' + esc(m.position) + ' · now ' + esc(team ? team.name : 'LGCHL') + '</small></div></div>' +
        '<table class="lg-mvt num"><thead><tr><th></th><th class="r">GP</th><th class="r">PTS</th><th class="r">P/GP</th><th class="r">+/-</th></tr></thead><tbody>' +
        '<tr><td>' + esc(m.from_league) + ' · S' + esc(m.from_season) + '</td><td class="r">' + esc(m.from_gp) + '</td><td class="r">' + esc(m.from_points) + '</td><td class="r">' + m.from_ppg.toFixed(2) + '</td><td class="r ' + cls(m.from_plus_minus) + '">' + sgn(m.from_plus_minus) + '</td></tr>' +
        '<tr class="now"><td>LGCHL · S55</td><td class="r">' + esc(m.gp) + '</td><td class="r">' + esc(m.points) + '</td><td class="r">' + m.ppg.toFixed(2) + '</td><td class="r ' + cls(m.plus_minus) + '">' + sgn(m.plus_minus) + '</td></tr></tbody></table>' +
        (m.note ? '<p class="lg-card-note">' + esc(m.note) + '</p>' : '') + '</article>';
    }).join('') || '<p class="empty">No AHL-to-LGCHL moves to show yet.</p>';
  }

  // Editorial interpretation stays separate from measured season totals and recorded finals.
  function matchupPreview(g, games, teams, players) {
    const a=teams.get(Number(g.away_lg_team_id)), h=teams.get(Number(g.home_lg_team_id));
    const an=a?.name||g.away_nick||g.away_abbr||'The visitors', hn=h?.name||g.home_nick||g.home_abbr||'the hosts';
    const paragraphs=[];
    let title='A measuring-stick night';
    if (a && h) {
      const same=a.conference && a.conference===h.conference && a.league===h.league;
      const gap=a.pts!=null && h.pts!=null ? Math.abs(Number(a.pts)-Number(h.pts)) : null;
      title=same && gap!=null && gap<=2 ? 'No breathing room in the standings' : 'Contenders under the spotlight';
      paragraphs.push(['The stakes', an+' enter '+record(a)+' with '+a.pts+' points; '+hn+' are '+record(h)+' with '+h.pts+'. '+
        (same && gap!=null ? (gap===0?'They are level on points. A win is a chance to separate from a direct conference competitor.':gap+' points separate them in the same conference. This is a chance to change the gap against a direct competitor.') : 'They represent different conference races, making this a test of how their season records travel against another contender.')]);
      paragraphs.push(['Form check', an+' are '+(a.last10||'without a recorded last-ten summary')+' over their last ten, with a '+sgn(a.gd)+' season goal differential. '+hn+' are '+(h.last10||'without a recorded last-ten summary')+' with a '+sgn(h.gd)+' differential.']);
      if (Number(a.gp)>0 && Number(h.gp)>0 && [a.gf,a.ga,h.gf,h.ga].every(v=>v!=null&&Number.isFinite(Number(v)))) {
        paragraphs.push(['What to watch', an+' score '+(a.gf/a.gp).toFixed(2)+' and allow '+(a.ga/a.gp).toFixed(2)+' goals per game; '+hn+' score '+(h.gf/h.gp).toFixed(2)+' and allow '+(h.ga/h.gp).toFixed(2)+'. '+(a.gf/a.gp===h.gf/h.gp ? 'Both clubs carry the same season scoring rate.' : (a.gf/a.gp>h.gf/h.gp ? an : hn)+' carry the higher season scoring rate.')+' The challenge is turning that edge into chances against this opponent; these averages frame the contest rather than predict its score.']);
      }
    } else paragraphs.push(['The stakes', an+' visit '+hn+' in '+g.league+'. '+(g.big_reasons||[]).map(r=>REASONS[r]).filter(Boolean).join(' ')]);
    const finals=games.filter(x=>x.status==='final' && Date.parse(x.game_at)<Date.parse(g.game_at) && [x.away_score,x.home_score].every(v=>v!=null&&Number.isFinite(Number(v))) && ((Number(x.away_lg_team_id)===Number(g.away_lg_team_id)&&Number(x.home_lg_team_id)===Number(g.home_lg_team_id))||(Number(x.home_lg_team_id)===Number(g.away_lg_team_id)&&Number(x.away_lg_team_id)===Number(g.home_lg_team_id)))).sort((x,y)=>Date.parse(y.game_at)-Date.parse(x.game_at));
    if(finals.length){const last=finals[0],winner=Number(last.away_score)>Number(last.home_score)?last.away_lg_team_id:last.home_lg_team_id;paragraphs.push(['The rematch', (Number(winner)===Number(g.away_lg_team_id)?an:hn)+' took the latest recorded meeting in the available schedule, '+Math.max(last.away_score,last.home_score)+'–'+Math.min(last.away_score,last.home_score)+' on '+F.day.format(new Date(last.game_at))+'. One side has a result to defend; the other has a chance to answer.']);}
    const spotlights=[g.away_lg_team_id,g.home_lg_team_id].map(id=>players.filter(p=>Number(p.lg_team_id)===Number(id)&&Number(p.gp)>0).sort((x,y)=>Number(y.points)-Number(x.points))[0]).filter(Boolean);
    if(spotlights.length) paragraphs.push(['Players to watch',spotlights.map(p=>p.gamertag+' ('+p.team_name+'): '+p.points+' points, '+p.goals+' goals and '+p.assists+' assists in '+p.gp+' games').join('; ')+'. These season totals put them on the watch list; game-night availability will determine who takes the ice.']);
    return {title,paragraphs};
  }

  const REASONS = {
    top4_clash: 'Both teams are top 4 in their conference.',
    leader_chase: 'A conference leader against a team within 2 points of it.',
    division_race: 'Division rivals within a point of each other, both in the top half.'
  };
  function renderMatchups(games, now, teams, players = []) {
    const box = $('lgMatchups');
    if (!games) { box.innerHTML = unavailable('The schedule'); return; }
    const upcoming = games.filter(g => g.status === 'scheduled' && Date.parse(g.game_at) > now);
    if (!upcoming.length) { box.innerHTML = '<p class="empty">No games scheduled in the next ten days.</p>'; return; }
    const first = Date.parse(upcoming[0].game_at);
    const night = upcoming.filter(g => Date.parse(g.game_at) - first <= 6 * 3600e3);
    $('lgMatchEyebrow').textContent = (night[0].week ? 'Week ' + night[0].week + ' · ' : '') + F.longDay.format(new Date(first));
    // Best-ranked big games first, preferring games whose teams aren't already shown.
    const big = night.filter(g => g.big_game).sort((a, b) => (a.away_conf_rank + a.home_conf_rank) - (b.away_conf_rank + b.home_conf_rank));
    const picks = [], shown = new Set();
    for (const g of big) { if (picks.length < 4 && !shown.has(g.away_lg_team_id) && !shown.has(g.home_lg_team_id)) { picks.push(g); shown.add(g.away_lg_team_id); shown.add(g.home_lg_team_id); } }
    for (const g of big) { if (picks.length < 4 && !picks.includes(g)) picks.push(g); }
    if (!picks.length) { box.innerHTML = '<p class="empty">No games on the next slate meet the matchup rules.</p>'; return; }
    box.innerHTML = picks.map(g => {
      const preview = matchupPreview(g, games, teams, players);
      const side = (id, ab, rk) => '<div><img src="' + logo(id) + '" alt=""><b>' + esc(ab) + '</b><small>' + (rk ? ordinal(rk) + ' in conf.' : '') + '</small></div>';
      return '<article class="card tinted lg-card" data-logo="' + logo(g.home_lg_team_id) + '">' + wm(g.home_lg_team_id) +
        '<div class="lg-mu-teams">' + side(g.away_lg_team_id, g.away_abbr, g.away_conf_rank) + '<span class="lg-mu-at">@</span>' + side(g.home_lg_team_id, g.home_abbr, g.home_conf_rank) + '</div>' +
        '<h3 class="lg-match-title">' + esc(preview.title) + '</h3>' + preview.paragraphs.map(([label,text]) => '<p class="lg-why"><b>'+esc(label)+'</b> '+esc(text)+'</p>').join('') + '<div class="lg-mu-when num">' + esc(F.day.format(new Date(g.game_at))) + ' · ' + esc(F.time.format(new Date(g.game_at))) + ' ET · ' + esc(g.league) + '</div></article>';
    }).join('');
  }

  main().catch(() => { const k = $('lgLeadKicker'); if (k) k.innerHTML = ev('na', 'League data is unavailable right now'); });
})();
