/* Premium Meet the Core presentation layered over the existing RLS-protected stall controls. */
(() => {
  const root = document.getElementById('wildmanCoreStalls');
  if (!root) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rail = document.getElementById('corePlayerList');
  const search = document.getElementById('corePlayerSearch');
  const headerSearch = document.getElementById('coreHeaderSearch');
  const detail = document.getElementById('corePlayerDetail');
  const panels = document.getElementById('corePerformance');
  let selected = new URLSearchParams(location.search).get('player');
  let tab = 'overview';

  const cards = () => [...root.querySelectorAll('.wc-card')];
  const current = () => cards().find(c => c.dataset.player === selected);
  const numeric = v => v != null && v !== '' && Number.isFinite(Number(v));
  const value = v => numeric(v) ? String(Number(v)) : '—';
  const percent = v => numeric(v) ? Number(v).toFixed(Number(v) % 1 ? 1 : 0) + '%' : '—';
  const plateName = c => c?.querySelector('.wc-plate-name')?.textContent?.trim() || c?.querySelector('h3')?.textContent?.trim() || 'WILDMAN';
  const plateNumber = c => c?.querySelector('.wc-plate-num')?.textContent?.trim() || '—';

  function context() {
    const state = window.WildmanEsportsNetwork?.state;
    const player = state?.players?.find(p => p.id === selected);
    const team = state?.teams?.find(t => t.slug === 'wildman-hockey');
    const memberships = team ? state.eventRosters.filter(r => r.player_id === selected && r.team_id === team.id && r.active !== false) : [];
    const events = (state?.events || []).filter(e => memberships.some(m => m.event_id === e.id))
      .sort((a,b) => (b.status === 'live') - (a.status === 'live') || new Date(b.starts_on || 0) - new Date(a.starts_on || 0));
    const event = events[0];
    const membership = memberships.find(m => m.event_id === event?.id) || memberships[0];
    const priority = s => String(s.source_provider || '').includes('leaguegaming-player-profile') ? 4 : String(s.source_provider || '').includes('leaguegaming-official') ? 3 : String(s.source_provider || '').includes('wildman_game_aggregate') ? 2 : 1;
    const stats = event && team ? state.stats.filter(s => s.player_id === selected && s.team_id === team.id && s.event_id === event.id)
      .sort((a,b) => priority(b)-priority(a) || new Date(b.updated_at || 0)-new Date(a.updated_at || 0))[0] : null;
    const seen = new Set();
    const games = event && team ? state.gamePlayerStats.filter(s => s.player_id === selected && s.team_id === team.id && s.event_id === event.id)
      .map(s => ({...s, game:state.games.find(g => g.id === s.game_id)}))
      .filter(s => s.game?.status === 'final')
      .sort((a,b) => new Date(b.game.scheduled_at || 0)-new Date(a.game.scheduled_at || 0))
      .filter(s => !seen.has(s.game_id) && seen.add(s.game_id)).slice(0,7).reverse() : [];
    return {state,player,team,event,stats,games,membership,memberships};
  }

  function positionOf(card, ctx) {
    return ctx.membership?.position || ctx.player?.primary_position || card?.querySelector('.wc-meta')?.textContent?.split('·').pop()?.trim() || 'PLAYER';
  }

  function drawRail() {
    if (!rail) return;
    const q = (search?.value || headerSearch?.value || '').trim().toLowerCase();
    const filtered = cards().filter(c => (c.querySelector('h3')?.textContent || '').toLowerCase().includes(q));
    rail.innerHTML = filtered.map(c => '<button type="button" class="core-player-choice" data-select="'+esc(c.dataset.player)+'" aria-pressed="'+String(c.dataset.player === selected)+'"><span>'+esc(plateNumber(c))+'</span><b>'+esc(c.querySelector('h3')?.textContent || plateName(c))+'</b><i>›</i></button>').join('') || '<p class="core-empty">No matching players.</p>';
  }

  function statFields(goalie, stats) {
    if (goalie) return [['GP',stats?.games_played],['W',stats?.wins],['L',stats?.losses],['OTL',stats?.ot_losses],['Saves',stats?.saves]];
    return [['Games',stats?.games_played],['Goals',stats?.goals],['Assists',stats?.assists],['Points',stats?.points],['+/−',stats?.plus_minus]];
  }

  function statStrip(fields) {
    return '<div class="core-stat-strip">'+fields.map(([k,v])=>'<div><strong>'+value(v)+'</strong><small>'+esc(k)+'</small></div>').join('')+'</div>';
  }

  function bioMarkup(card, ctx, name, position) {
    const jersey = plateName(card) + (plateNumber(card) && plateNumber(card) !== '—' ? ' · #'+plateNumber(card) : '');
    const bio = [
      ['Gamertag',name],['Position',position],['Jersey',jersey],['Platform',ctx.player?.platform || 'Not supplied'],
      ['Team',ctx.team?.name || 'Wildman Hockey'],['Role',ctx.membership?.roster_role || 'Active roster']
    ];
    return '<section class="core-panel core-bio"><header><h3>Player bio</h3><a href="esports-player.html?id='+encodeURIComponent(selected)+'">Full profile ↗</a></header><dl>'+bio.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl><img src="assets/wildman/stalls/crest.png" alt="" aria-hidden="true"></section>';
  }

  function overviewMarkup(card, ctx, fields, name, position, goalie) {
    const extra = goalie
      ? [['Save %',ctx.stats?.save_percentage],['GAA',ctx.stats?.goals_against_average],['Shots Against',ctx.stats?.shots_against]]
      : [['Shots',ctx.stats?.shots],['Hits',ctx.stats?.hits],['Takeaways',ctx.stats?.takeaways]];
    return statStrip(fields)+bioMarkup(card,ctx,name,position)+'<section class="core-panel" style="margin-top:10px"><header><h3>Current event</h3><small>'+esc(ctx.event?.name || 'WILDMAN HOCKEY')+'</small></header><dl>'+extra.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+(String(k).includes('%')?percent(v):value(v))+'</dd></div>').join('')+'</dl></section>';
  }

  function statsMarkup(ctx, fields, goalie) {
    const profile='esports-player.html?id='+encodeURIComponent(selected);
    const extras = goalie
      ? [['Saves',ctx.stats?.saves],['Shots Against',ctx.stats?.shots_against],['Goals Against',ctx.stats?.goals_against],['Save %',ctx.stats?.save_percentage]]
      : [['Shots',ctx.stats?.shots],['Hits',ctx.stats?.hits],['Takeaways',ctx.stats?.takeaways],['Giveaways',ctx.stats?.giveaways]];
    return statStrip(fields)+'<section class="core-panel"><header><h3>Event statistics</h3><a href="'+profile+'">View history ↗</a></header><p>'+esc(ctx.event?.name || 'No active event linked')+'</p><dl>'+extras.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+(String(k).includes('%')?percent(v):value(v))+'</dd></div>').join('')+'</dl></section>';
  }

  function mediaMarkup() {
    return '<section class="core-panel"><h3>VOD &amp; media</h3><p>Review Wildman games, published clips and tournament coverage from one place.</p><a class="core-tool" href="game-center.html?channel=wildman">Wildman live &amp; game archive <span>↗</span></a><a class="core-tool" href="wildman-media.html">Wildman media <span>↗</span></a><a class="core-tool" href="esports-player.html?id='+encodeURIComponent(selected)+'">Player game history <span>↗</span></a></section>';
  }

  function scoutingMarkup() {
    return '<section class="core-panel"><h3>Scouting workspace</h3><p>Private player notes and evaluation tools stay behind management access rather than being exposed on the public profile.</p><a class="core-tool" href="management.html">Open management scouting <span>↗</span></a><a class="core-tool" href="academy.html">Development pathway <span>↗</span></a></section>';
  }

  function settingsMarkup(canEdit) {
    return '<section class="core-panel"><h3>Locker customization</h3><p>'+(canEdit ? 'Your Discord account owns this stall. Update the jersey name and number using the protected controls.' : 'Sign in with the Discord account assigned to this stall to unlock jersey editing.')+'</p><button type="button" class="core-tool" data-customize>'+(canEdit ? 'Customize jersey' : 'Open Discord sign-in')+' <span>›</span></button><a class="core-tool" href="esports-player.html?id='+encodeURIComponent(selected)+'">Open player profile <span>↗</span></a></section>';
  }

  function drawDetail() {
    const card = current();
    if (!card) { if (detail) detail.innerHTML='<p class="core-empty">Select a player when the locker room is available.</p>'; if (panels) panels.innerHTML=''; return; }
    const ctx = context();
    const name = card.querySelector('h3')?.textContent || plateName(card);
    const position = positionOf(card,ctx);
    const goalie = /^(G|GOALIE|GOALTENDER)$/i.test(position);
    const canEdit = !!card.querySelector('.wc-edit');
    const fields = statFields(goalie,ctx.stats);
    const metaBits = [position, ctx.membership?.roster_role || 'Wildman Hockey Club', ctx.event?.name].filter(Boolean);
    let content = '';
    if (tab === 'overview') content = overviewMarkup(card,ctx,fields,name,position,goalie);
    if (tab === 'stats') content = statsMarkup(ctx,fields,goalie);
    if (tab === 'vod') content = mediaMarkup();
    if (tab === 'scouting') content = scoutingMarkup();
    if (tab === 'settings') content = settingsMarkup(canEdit);
    detail.innerHTML = '<div class="core-player-head"><div class="core-player-head-top"><small>'+(ctx.membership?'<span class="core-dot"></span> ACTIVE ROSTER':'WILDMAN LOCKER')+' &nbsp; #'+esc(plateNumber(card))+' | '+esc(position)+'</small>'+(canEdit?'<button class="core-edit-player" type="button" data-customize>✎ Edit player</button>':'')+'</div><h2>'+esc(name)+'</h2><p>'+metaBits.map(esc).join('<span>|</span>')+'</p></div><nav class="core-detail-tabs" aria-label="Player sections">'+['overview','stats','vod','scouting','settings'].map(t=>'<button type="button" data-tab="'+t+'" aria-pressed="'+String(tab===t)+'">'+t+'</button>').join('')+'</nav><div class="core-detail-content">'+content+'</div><p class="core-source">'+esc(ctx.stats ? (ctx.event?.name || 'Event stats')+' · '+(ctx.stats.source_provider || 'Imported statistics') : window.WildmanEsportsNetwork?.loaded ? 'Event stats not available. Missing values are shown as —.' : 'Loading player statistics…')+'</p>';
    drawPerformance(card,ctx,fields,goalie);
  }

  function drawPerformance(card,ctx,fields,goalie) {
    if (!panels) return;
    const metric = goalie ? 'saves' : 'points';
    const chartGames = ctx.games.filter(g=>numeric(g[metric]));
    const max = Math.max(1,...chartGames.map(g=>Number(g[metric])));
    const bars = chartGames.map((g,i) => {
      const opponent = ctx.state?.teams?.find(t=>t.id===(g.game.home_team_id===ctx.team?.id ? g.game.away_team_id : g.game.home_team_id));
      const label = opponent?.abbreviation || opponent?.name || 'G'+(i+1);
      return '<a href="live-game.html?id='+encodeURIComponent(g.game_id)+'" class="core-bar" aria-label="'+esc(label+': '+g[metric]+' '+metric)+'"><strong>'+value(g[metric])+'</strong><span><i style="height:'+Math.max(2,Number(g[metric])/max*100)+'%"></i></span><small>'+esc(label)+'</small></a>';
    }).join('');
    const recentStats = goalie
      ? [['Saves',ctx.stats?.saves],['Wins',ctx.stats?.wins],['Save %',ctx.stats?.save_percentage],['GAA',ctx.stats?.goals_against_average]]
      : [['Goals',ctx.stats?.goals],['Assists',ctx.stats?.assists],['Points',ctx.stats?.points],['Shots',ctx.stats?.shots],['+/−',ctx.stats?.plus_minus]];
    const canEdit = !!card.querySelector('.wc-edit');
    panels.innerHTML = '<section class="core-panel core-performance-chart"><header><h3>Recent performance</h3><small>'+esc(metric.toUpperCase())+' · LAST 7 TRACKED GAMES</small></header>'+(bars?'<div class="core-chart">'+bars+'</div>':'<p class="core-empty">Game-by-game '+esc(metric)+' will appear as results are imported.</p>')+'</section>'+
      '<section class="core-panel"><header><h3>Recent stats</h3><a href="esports-player.html?id='+encodeURIComponent(selected)+'">View all ↗</a></header><dl>'+recentStats.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+(String(k).includes('%')?percent(v):value(v))+'</dd></div>').join('')+'</dl></section>'+
      '<section class="core-panel"><header><h3>Scouting notes</h3><a href="management.html">Private ↗</a></header><div class="core-note"><div class="core-note-icon">◎</div><div><b>Evaluation workspace</b><small>Management-only notes, tendencies and lineup fit.</small></div></div><div class="core-note"><div class="core-note-icon">◇</div><div><b>VOD review</b><small>Game film and tracked results stay linked to the player profile.</small></div></div><div class="core-note"><div class="core-note-icon">↗</div><div><b>Development</b><small>Academy and coaching pathways remain one click away.</small></div></div></section>'+
      '<section class="core-panel"><h3>Player tools &amp; customization</h3><button type="button" class="core-tool" data-customize>Locker customization <span>'+(canEdit?'UNLOCKED':'›')+'</span></button><a class="core-tool" href="esports-player.html?id='+encodeURIComponent(selected)+'">Player profile <span>↗</span></a><a class="core-tool" href="game-center.html?channel=wildman">Game archive <span>↗</span></a><a class="core-tool" href="wildman-media.html">Highlights &amp; media <span>↗</span></a></section>';
  }

  function select(id, updateUrl = true) {
    if (!cards().some(c=>c.dataset.player===id)) return;
    selected=id;
    cards().forEach(c=>{c.hidden=c.dataset.player!==selected;});
    drawRail();
    drawDetail();
    if (updateUrl) { const url=new URL(location.href); url.searchParams.set('player',selected); history.replaceState(null,'',url); }
  }

  function syncNameplate(card) {
    const plate=card.querySelector('.core-locker-nameplate');
    if (!plate) return;
    plate.querySelectorAll('[data-locker-num]').forEach(n=>n.textContent=plateNumber(card));
    plate.querySelector('[data-locker-name]').textContent=plateName(card);
  }

  function initialize() {
    const all=cards();
    if (!all.length) { if (rail) rail.innerHTML='<p class="core-empty">Waiting for the locker room.</p>'; drawDetail(); return; }
    all.forEach(c=>{
      if (!c.querySelector('.core-locker-nameplate')) {
        const plate=document.createElement('div');
        plate.className='core-locker-nameplate';
        plate.innerHTML='<span data-locker-num>'+esc(plateNumber(c))+'</span><div><strong data-locker-name>'+esc(plateName(c))+'</strong><small>Wildman Hockey Club</small></div><span data-locker-num>'+esc(plateNumber(c))+'</span>';
        c.prepend(plate);
      }
      if (!c.querySelector('.core-flip-controls')) {
        const flip=document.createElement('div');
        flip.className='core-flip-controls';
        flip.innerHTML='<button type="button" data-side="front" aria-pressed="true">Front</button><button type="button" data-side="back" aria-pressed="false">Back</button>';
        c.querySelector('.wc-art')?.appendChild(flip);
        const sync=()=>{const back=c.querySelector('.wc-art')?.classList.contains('is-back');flip.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(back===(b.dataset.side==='back'))));};
        flip.addEventListener('click',e=>{const b=e.target.closest('[data-side]');if(!b)return;const art=c.querySelector('.wc-art');if(art?.classList.contains('is-back')!==(b.dataset.side==='back'))c.querySelector('.wc-flip')?.click();sync();});
        c.querySelectorAll('.wc-flip,.wc-flip-control').forEach(b=>b.addEventListener('click',sync));
      }
      const art=c.querySelector('.wc-art');
      if (art && !art.querySelector('.wc-jersey-crest')) {
        const crest=document.createElement('img');crest.className='wc-jersey-crest';crest.src='https://d2ol7oe51mr4n9.cloudfront.net/user_3Ic50OgPEnsF6yLkPdMjvCnPfo2/72f4c4d6-ce4d-4da6-a1b9-45079d9fb21b.png';crest.alt='';crest.setAttribute('aria-hidden','true');crest.loading='lazy';crest.decoding='async';art.appendChild(crest);
      }
    });
    const defaultCard=all.find(c=>/rusty/i.test(c.querySelector('h3')?.textContent||'')) || all[0];
    select(all.some(c=>c.dataset.player===selected)?selected:defaultCard.dataset.player,false);
  }

  rail?.addEventListener('click',e=>{const b=e.target.closest('[data-select]');if(b)select(b.dataset.select);});
  function syncSearch(source,target){ if (!source) return; source.addEventListener('input',()=>{if(target)target.value=source.value;drawRail();}); }
  syncSearch(search,headerSearch); syncSearch(headerSearch,search);
  document.getElementById('coreDashboard')?.addEventListener('click',e=>{
    const tabButton=e.target.closest('[data-tab]');
    if(tabButton){tab=tabButton.dataset.tab;drawDetail();detail.querySelector('[data-tab="'+tab+'"]')?.focus();}
    if(e.target.closest('[data-customize]')){
      const edit=current()?.querySelector('.wc-edit');
      if(edit){const form=current().querySelector('.wc-form');if(form?.hidden)edit.click();form?.scrollIntoView({block:'center',behavior:'smooth'});form?.elements?.jersey_name?.focus();}
      else {document.querySelector('.wc-auth')?.scrollIntoView({block:'center',behavior:'smooth'});document.getElementById('wildmanStallLogin')?.focus();}
    }
  });
  new MutationObserver(mutations=>{
    const structural=mutations.some(m=>m.type==='childList' && [...m.addedNodes,...m.removedNodes].some(n=>n.nodeType===1 && (n.classList?.contains('wc-card') || n.querySelector?.('.wc-card'))));
    if(structural) initialize();
    cards().forEach(syncNameplate);
  }).observe(root,{childList:true,subtree:true,characterData:true});
  window.addEventListener('wildman-network-ready',drawDetail);
  initialize();
})();
