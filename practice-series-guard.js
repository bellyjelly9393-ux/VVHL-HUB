(() => {
  const db = window.VVHLBackend?.db;
  if (!db) return;
  const SANDBOX_SLUG = 'wildman-tournament-sandbox';
  let eventId = null;
  let guardBusy = false;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function ensureBanner(){
    const host = document.querySelector('[data-management-content]');
    if (!host || document.getElementById('practiceSeriesGuard')) return;
    const el = document.createElement('section');
    el.id = 'practiceSeriesGuard';
    el.className = 'control-card';
    el.style.marginBottom = '16px';
    el.innerHTML = '<div class="section-heading"><div><div class="eyebrow">OFFICIAL FORMAT TEST</div><h3 id="practiceSeriesTitle">BEST-OF-5 SERIES</h3></div><span id="practiceSeriesChip" class="status-pill">FIRST TO 3</span></div><p id="practiceSeriesSummary">Loading series state…</p>';
    const summary = host.querySelector('.practice-summary');
    summary?.insertAdjacentElement('afterend', el);
  }

  async function tick(){
    if (guardBusy || !window.VVHLManagementGuard?.hasAccess(window.VVHLBackend?.state)) return;
    guardBusy = true;
    try {
      ensureBanner();
      if (!eventId) {
        const er = await db.from('esports_events').select('id').eq('slug', SANDBOX_SLUG).maybeSingle();
        if (er.error || !er.data) return;
        eventId = er.data.id;
      }
      const [gamesRes, teamsRes] = await Promise.all([
        db.from('esports_games').select('id,home_team_id,away_team_id,status,home_score,away_score,best_of,series_game_number').eq('event_id', eventId).order('series_game_number'),
        db.from('esports_teams').select('id,name')
      ]);
      if (gamesRes.error || teamsRes.error) return;
      const games = gamesRes.data || [];
      if (!games.length) return;
      const teams = teamsRes.data || [];
      const teamName = id => teams.find(t => t.id === id)?.name || 'Team';
      const homeId = games[0].home_team_id, awayId = games[0].away_team_id;
      const bestOf = Number(games[0].best_of) || 5;
      const needed = Math.floor(bestOf / 2) + 1;
      let homeWins = 0, awayWins = 0;
      for (const g of games.filter(x => x.status === 'final')) {
        if (Number(g.home_score) > Number(g.away_score)) homeWins++;
        if (Number(g.away_score) > Number(g.home_score)) awayWins++;
      }
      const clinchedId = homeWins >= needed ? homeId : awayWins >= needed ? awayId : null;
      const summary = document.getElementById('practiceSeriesSummary');
      const title = document.getElementById('practiceSeriesTitle');
      const chip = document.getElementById('practiceSeriesChip');
      if (title) title.textContent = `BEST-OF-${bestOf} SERIES`;
      if (chip) chip.textContent = clinchedId ? 'SERIES FINAL' : `FIRST TO ${needed}`;

      if (clinchedId) {
        const scheduled = games.filter(g => g.status === 'scheduled');
        if (scheduled.length) {
          const ids = scheduled.map(g => g.id);
          const r = await db.from('esports_games').update({status:'cancelled',commentary_status:'complete',commentary_label:'SERIES_NOT_NEEDED',updated_at:new Date().toISOString()}).in('id', ids);
          if (!r.error) document.getElementById('stopPracticeBtn')?.click();
        }
        if (summary) summary.innerHTML = `<strong>${esc(teamName(clinchedId))} wins the series ${homeWins}-${awayWins}.</strong> Remaining games are marked <b>IF NECESSARY / NOT REQUIRED</b>.`;
        const nextAction = document.getElementById('nextAction');
        const nextSub = document.getElementById('nextActionSub');
        if (nextAction) nextAction.textContent = 'SERIES COMPLETE';
        if (nextSub) nextSub.textContent = `${teamName(clinchedId)} reached ${needed} wins.`;
      } else {
        const next = games.find(g => ['live','scheduled'].includes(g.status));
        if (summary) summary.innerHTML = `<strong>${esc(teamName(homeId))} ${homeWins} - ${awayWins} ${esc(teamName(awayId))}</strong> · First to ${needed}${next ? ` · Game ${next.series_game_number || '?'} ${next.status === 'live' ? 'LIVE' : 'next'}` : ''}.`;
      }
    } finally {
      guardBusy = false;
    }
  }

  window.addEventListener('vvhl-auth-change', () => setTimeout(tick, 250));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 400)); else setTimeout(tick, 400);
  setInterval(() => { if (!document.hidden) tick(); }, 3000);
})();
