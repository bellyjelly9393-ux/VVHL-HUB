(() => {
  const data = window.WildmanHubData || { players: [], archivedGames: [], proSeries: {} };
  const esc = (v) => String(v ?? "").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);

  function renderPlayers(){
    const grid = document.getElementById('playerDirectoryGrid');
    if(!grid) return;
    const search = document.getElementById('playerDirectorySearch');
    const pool = document.getElementById('playerDirectoryPool');
    const draw = () => {
      const q = String(search?.value || '').toLowerCase().trim();
      const p = pool?.value || 'all';
      const rows = data.players.filter(x => (!q || `${x.gt} ${x.displayName} ${x.role}`.toLowerCase().includes(q)) && (p==='all' || x.pool===p));
      grid.innerHTML = rows.length ? rows.map(x=>`<a class="directory-card" href="${esc(x.profileUrl)}"><img src="${esc(x.image)}" alt="${esc(x.gt)}"><div class="directory-card-body"><small>${esc(x.role)}</small><h3>${esc(x.gt)}</h3><div class="directory-meta"><span class="directory-pill">${esc(x.pool)}</span><span class="directory-pill">POS ${esc(x.position)}</span><span class="directory-pill">${esc(x.platform)}</span></div><p>${esc(x.summary)}</p><b class="ops-link">Open Profile →</b></div></a>`).join('') : `<div class="empty-state">No players match this filter.</div>`;
    };
    search?.addEventListener('input',draw); pool?.addEventListener('change',draw); draw();
  }

  function renderGames(){
    const list = document.getElementById('gameCenterList');
    if(!list) return;
    list.innerHTML = data.archivedGames.map(g=>`<a class="game-row" href="game.html?id=${encodeURIComponent(g.id)}"><div><strong>${esc(g.date)}</strong><small style="display:block">${esc(g.time)}</small></div><div><strong>Wildman Hockey vs ${esc(g.opponent)}</strong><small style="display:block">${esc(g.event)}</small></div><div class="game-score">${g.wildman}-${g.opponentScore}</div><div class="game-result">${esc(g.result)} · OPEN →</div></a>`).join('');
  }

  function renderGameDetail(){
    const root = document.getElementById('gameDetail');
    if(!root) return;
    const id = new URLSearchParams(location.search).get('id');
    const g = data.archivedGames.find(x=>x.id===id) || data.archivedGames[0];
    if(!g){ root.innerHTML = '<div class="empty-state">Game not found.</div>'; return; }
    document.title = `Wildman ${g.wildman}-${g.opponentScore} ${g.opponent} | Game Center`;
    root.innerHTML = `<a class="profile-back" href="game-center.html">← Back to Game Center</a><div class="eyebrow">ARCHIVED GAME</div><h1 style="font:900 clamp(48px,8vw,92px)/.9 'Barlow Condensed',sans-serif;margin:8px 0 18px;text-transform:uppercase">WILDMAN VS ${esc(g.opponent)}</h1><div class="game-detail-score">${g.wildman} <span style="opacity:.45">-</span> ${g.opponentScore}</div><p>${esc(g.date)} · ${esc(g.time)} · ${esc(g.result)}</p><div class="game-detail-grid" style="margin-top:24px"><div class="wm-card"><small>Archive Status</small><h3>${esc(g.status)}</h3><p>${esc(g.event)}. Full box score, lineup and VOD can attach to this game record when recovered.</p></div><div class="wm-card"><small>Game Intelligence</small><h3>Ready for Enrichment</h3><p>This game page is now a permanent destination for lineup data, player stats, clips, scouting notes and stream/VOD links.</p></div></div>`;
  }

  function renderProSeries(){
    const status = document.getElementById('proSeriesStatus');
    const teams = document.getElementById('proSeriesTeams');
    const schedule = document.getElementById('proSeriesSchedule');
    if(status) status.textContent = data.proSeries?.status || 'Awaiting official release';
    if(teams) teams.innerHTML = data.proSeries?.teams?.length ? '' : '<div class="empty-state">Official Pro Series teams have not been released yet. This panel is wired and ready for the team import.</div>';
    if(schedule) schedule.innerHTML = data.proSeries?.schedule?.length ? '' : '<div class="empty-state">The official schedule has not been released yet. Once it drops, matchups will populate here and each game will open its own Game Center page.</div>';
  }

  renderPlayers(); renderGames(); renderGameDetail(); renderProSeries();
})();