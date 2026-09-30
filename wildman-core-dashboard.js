/* Meet the Core: presentation over the existing RLS-protected stall controls. */
(() => {
  const root = document.getElementById('wildmanCoreStalls');
  if (!root) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rail = document.getElementById('corePlayerList');
  const search = document.getElementById('corePlayerSearch');
  const detail = document.getElementById('corePlayerDetail');
  const panels = document.getElementById('corePerformance');
  let selected = new URLSearchParams(location.search).get('player'), tab = 'overview';
  const cards = () => [...root.querySelectorAll('.wc-card')];
  const current = () => cards().find(c => c.dataset.player === selected);
  const value = v => v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : String(Number(v));
  const numeric = v => v != null && v !== '' && Number.isFinite(Number(v));
  function context() {
    const state = window.WildmanEsportsNetwork?.state;
    const player = state?.players.find(p => p.id === selected);
    const team = state?.teams.find(t => t.slug === 'wildman-hockey');
    const memberships = team ? state.eventRosters.filter(r => r.player_id === selected && r.team_id === team.id && r.active !== false) : [];
    const events = (state?.events || []).filter(e => memberships.some(m => m.event_id === e.id))
      .sort((a,b) => (b.status === 'live') - (a.status === 'live') || new Date(b.starts_on || 0) - new Date(a.starts_on || 0));
    const event = events[0];
    const priority = s => String(s.source_provider || '').includes('leaguegaming-player-profile') ? 4 : String(s.source_provider || '').includes('leaguegaming-official') ? 3 : String(s.source_provider || '').includes('wildman_game_aggregate') ? 2 : 1;
    const stats = event ? state.stats.filter(s => s.player_id === selected && s.team_id === team.id && s.event_id === event.id)
      .sort((a,b) => priority(b)-priority(a) || new Date(b.updated_at || 0)-new Date(a.updated_at || 0))[0] : null;
    const seen = new Set();
    const games = (event ? state.gamePlayerStats.filter(s => s.player_id === selected && s.team_id === team.id && s.event_id === event.id) : [])
      .map(s => ({...s, game:state.games.find(g => g.id === s.game_id)}))
      .filter(s => s.game?.status === 'final')
      .sort((a,b) => new Date(b.game.scheduled_at || 0)-new Date(a.game.scheduled_at || 0))
      .filter(s => !seen.has(s.game_id) && seen.add(s.game_id)).slice(0,7).reverse();
    return {state,player,team,event,stats,games,membership:memberships.find(m => m.event_id === event?.id)};
  }
  function drawRail() {
    const q = search.value.trim().toLowerCase();
    const filtered = cards().filter(c => c.querySelector('h3').textContent.toLowerCase().includes(q));
    rail.innerHTML = filtered.map(c => '<button type="button" class="core-player-choice" data-select="'+esc(c.dataset.player)+'" aria-pressed="'+(c.dataset.player === selected)+'"><span>'+esc(c.querySelector('.wc-plate-num').textContent || '—')+'</span><b>'+esc(c.querySelector('h3').textContent)+'</b><i>›</i></button>').join('') || '<p class="core-empty">No matching players.</p>';
  }
  function drawDetail() {
    const card = current();
    if (!card) { detail.innerHTML = '<p class="core-empty">Select a player when the locker room is available.</p>'; panels.innerHTML=''; return; }
    const {state,player,team,event,stats,games,membership} = context();
    const name = card.querySelector('h3').textContent;
    const position = membership?.position || player?.primary_position || card.querySelector('.wc-meta').textContent.split('·').pop().trim();
    const goalie = /^(G|GOALIE|GOALTENDER)$/i.test(position);
    const canEdit = !!card.querySelector('.wc-edit');
    const profile = 'esports-player.html?id='+encodeURIComponent(selected);
    const fields = goalie ? [['GP',stats?.games_played],['Wins',stats?.wins],['Losses',stats?.losses],['OTL',stats?.ot_losses]] : [['Games',stats?.games_played],['Goals',stats?.goals],['Assists',stats?.assists],['Points',stats?.points],['+/−',stats?.plus_minus]];
    const statMarkup = '<div class="core-stat-strip">'+fields.map(([k,v])=>'<div><strong>'+value(v)+'</strong><small>'+k+'</small></div>').join('')+'</div>';
    const bio = [['Gamertag',name],['Position',position],['Jersey',card.querySelector('.wc-plate-name').textContent+' · #'+card.querySelector('.wc-plate-num').textContent],['Platform',player?.platform || 'Not supplied'],['Team',team?.name || 'Wildman Hockey'],['Role',membership?.roster_role || 'Not supplied']];
    let content = '';
    if (tab === 'overview') content = statMarkup+'<section class="core-panel core-bio"><h3>Player bio</h3><dl>'+bio.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl><img src="assets/wildman/stalls/crest.png" alt="" aria-hidden="true"></section>';
    if (tab === 'stats') content = statMarkup+'<section class="core-panel"><h3>Event statistics</h3><p>'+esc(event?.name || 'No current event linked')+'</p><dl>'+[['Shots',stats?.shots],['Hits',stats?.hits],['Takeaways',stats?.takeaways],['Giveaways',stats?.giveaways]].map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+value(v)+'</dd></div>').join('')+'</dl><a href="'+profile+'">Full event history ↗</a></section>';
    if (tab === 'media') content = '<section class="core-panel"><h3>Wildman media</h3><p>Watch tournament coverage and browse published game archives.</p><a class="core-tool" href="game-center.html?channel=wildman">Wildman Live <span>↗</span></a><a class="core-tool" href="wildman-media.html">Features &amp; highlights <span>↗</span></a><a class="core-tool" href="'+profile+'">Player game history <span>↗</span></a></section>';
    if (tab === 'settings') content = '<section class="core-panel"><h3>Locker customization</h3><p>'+ (canEdit ? 'Your jersey name and number can be updated using the controls beneath the locker.' : 'Sign in with your assigned Discord account to customize your own jersey.')+'</p><button type="button" class="small-btn" data-customize>'+ (canEdit ? 'Customize jersey' : 'View sign-in options')+'</button></section>';
    detail.innerHTML = '<div class="core-player-head"><small>'+(membership ? '<span class="core-dot"></span> ACTIVE EVENT ROSTER' : 'WILDMAN LOCKER')+' &nbsp; #'+esc(card.querySelector('.wc-plate-num').textContent)+'</small><h2>'+esc(name)+'</h2><p>'+esc(position)+' <span>|</span> WILDMAN HOCKEY CLUB</p></div><nav class="core-detail-tabs" aria-label="Player sections">'+['overview','stats','media','settings'].map(t=>'<button type="button" data-tab="'+t+'" aria-pressed="'+(tab===t)+'">'+t+'</button>').join('')+'</nav><div class="core-detail-content">'+content+'</div><p class="core-source">'+esc(stats ? (event?.name || 'Event stats')+' · '+(stats.source_provider || 'Imported statistics') : window.WildmanEsportsNetwork?.loaded ? 'Event stats not available. Missing values are shown as —.' : 'Loading player statistics…')+'</p>';
    const metric = goalie ? 'saves' : 'points';
    const chartGames = games.filter(g=>numeric(g[metric]));
    const max = Math.max(1,...chartGames.map(g=>Number(g[metric])));
    const bars = chartGames.map((g,i) => {
      const opponent = state.teams.find(t=>t.id===(g.game.home_team_id===team.id ? g.game.away_team_id : g.game.home_team_id));
      const label = opponent?.abbreviation || opponent?.name || 'Game '+(i+1);
      return '<a href="live-game.html?id='+encodeURIComponent(g.game_id)+'" class="core-bar" aria-label="'+esc(label+': '+g[metric]+' '+metric)+'"><strong>'+value(g[metric])+'</strong><span><i style="height:'+Math.max(2,Number(g[metric])/max*100)+'%"></i></span><small>'+esc(label)+'</small></a>';
    }).join('');
    panels.innerHTML = '<section class="core-panel core-performance-chart"><header><h3>Recent performance</h3><small>'+esc(metric.toUpperCase())+' · LAST 7 TRACKED GAMES</small></header>'+(bars ? '<div class="core-chart">'+bars+'</div>' : '<p class="core-empty">Game-by-game '+metric+' will appear as results are imported.</p>')+'</section><section class="core-panel"><header><h3>Event totals</h3><a href="'+profile+'">View all ↗</a></header><dl>'+fields.map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+value(v)+'</dd></div>').join('')+'</dl></section><section class="core-panel"><h3>Scouting &amp; development</h3><p>Private scouting notes stay in the management workspace.</p><a class="core-tool" href="management.html">Management sign-in <span>↗</span></a><a class="core-tool" href="academy.html">Wildman Academy <span>↗</span></a></section><section class="core-panel"><h3>Player tools</h3><button type="button" class="core-tool" data-customize>Locker customization <span>›</span></button><a class="core-tool" href="'+profile+'">Player profile <span>↗</span></a><a class="core-tool" href="wildman-media.html">Highlights &amp; media <span>↗</span></a></section>';
  }
  function select(id, updateUrl = true) {
    if (!cards().some(c=>c.dataset.player===id)) return;
    selected=id;
    cards().forEach(c=>{c.hidden=c.dataset.player!==selected;});
    drawRail(); drawDetail();
    if (updateUrl) {
      const url=new URL(location.href);url.searchParams.set('player',selected);
      history.replaceState(null,'',url);
    }
  }
  function initialize() {
    const all=cards();
    if (!all.length) {rail.innerHTML='<p class="core-empty">Waiting for the locker room.</p>';drawDetail();return;}
    all.forEach(c=>{
      if (c.querySelector('.core-flip-controls')) return;
      const flip=document.createElement('div');flip.className='core-flip-controls';
      flip.innerHTML='<button type="button" data-side="front" aria-pressed="true">Front</button><button type="button" data-side="back" aria-pressed="false">Back</button>';
      c.querySelector('.wc-art').appendChild(flip);
      const sync=()=>{const back=c.querySelector('.wc-art').classList.contains('is-back');flip.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(back===(b.dataset.side==='back'))));};
      flip.addEventListener('click',e=>{const b=e.target.closest('[data-side]');if(!b)return;if(c.querySelector('.wc-art').classList.contains('is-back')!==(b.dataset.side==='back'))c.querySelector('.wc-flip').click();sync();});
      c.querySelectorAll('.wc-flip,.wc-flip-control').forEach(b=>b.addEventListener('click',sync));
    });
    const defaultCard=all.find(c=>/rusty/i.test(c.querySelector('h3').textContent)) || all[0];
    select(all.some(c=>c.dataset.player===selected)?selected:defaultCard.dataset.player,false);
  }
  rail.addEventListener('click',e=>{const b=e.target.closest('[data-select]');if(b)select(b.dataset.select);});
  search.addEventListener('input',drawRail);
  document.getElementById('coreDashboard').addEventListener('click',e=>{
    const tabButton=e.target.closest('[data-tab]');
    if(tabButton){tab=tabButton.dataset.tab;drawDetail();detail.querySelector('[data-tab="'+tab+'"]')?.focus();}
    if(e.target.closest('[data-customize]')){
      const edit=current()?.querySelector('.wc-edit');
      if(edit){const form=current().querySelector('.wc-form');if(form.hidden)edit.click();form.scrollIntoView({block:'center',behavior:'auto'});form.elements.jersey_name.focus();}
      else {document.querySelector('.wc-auth').scrollIntoView({block:'center',behavior:'auto'});document.getElementById('wildmanStallLogin').focus();}
    }
  });
  // Only direct card replacements trigger setup. Jersey edits keep their native handlers.
  new MutationObserver(initialize).observe(root,{childList:true});
  window.addEventListener('wildman-network-ready',drawDetail);
  initialize();
})();
