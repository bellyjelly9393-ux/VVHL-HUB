/* Week 2 presentation adapter; reuses the existing public network client and state. */
(() => {
  const C=window.WildmanPublicConfig, M=window.WildmanPublicModel;
  if(!C || !M || window.WildmanPublicUI) return;
  window.WildmanPublicUI={loaded:false};
  setInterval(()=>{if(!document.hidden)window.WildmanEsportsNetwork?.refresh();},60000);
  let posts=[], reports=[], mediaError=false, mediaLoading=true, hitmenLogo=C.brands.hitmen.logo;
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const safeURL=raw=>M.safeURL(raw,location.href);
  const failedLogos=new Set();
  const date=v=>M.stamp(v)?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Time to be confirmed';
  const empty=message=>'<p class="wn-empty">'+esc(message)+'</p>';
  const state=()=>window.WildmanEsportsNetwork?.state || {};
  const mount=(selector,html)=>document.querySelectorAll(selector).forEach(el=>{el.innerHTML=html;});
  const team=id=>M.id(state().teams,id);
  const event=id=>M.id(state().events,id);
  const wildman=()=> (state().teams||[]).find(t=>t.slug===C.brands.wildman.slug);
  const hitmen=()=> (state().teams||[]).find(t=>t.source_team_id===C.brands.hitmen.teamId || t.id===C.brands.hitmen.teamId);
  const badge=t=>safeURL(t?.logo_url)?'<img src="'+esc(safeURL(t.logo_url))+'" alt="'+esc(t.name)+' logo" loading="lazy">':'';
  const brand=key=>{
    const b=C.brands[key],url=safeURL(key==='hitmen'?hitmenLogo:b.logo);
    return url&&!failedLogos.has(url)?'<img src="'+esc(url)+'" alt="'+esc(b.name)+' logo" loading="lazy">':'<span class="wn-logo-pending">'+esc(b.name)+'<small style="display:block">Official logo pending</small></span>';
  };
  const gameHref=g=>'live-game.html?id='+encodeURIComponent(g.id);
  function gameRow(g) {
    const h=team(g.home_team_id),a=team(g.away_team_id);
    return '<a class="wn-game-row" href="'+gameHref(g)+'"><span><span class="wn-game-teams">'+badge(a)+esc(a?.name||'Away team pending')+' at '+badge(h)+esc(h?.name||'Home team pending')+'</span><small>'+esc(g.status==='live'?'LIVE'+(g.period?' · P'+g.period:'')+(g.clock?' · '+g.clock:''):date(g.scheduled_at))+' · '+esc(event(g.event_id)?.name||'Event')+'</small><small>'+esc(M.provenance(g))+'</small></span><strong>'+esc(M.score(g))+'</strong></a>';
  }
  const gameRows=(rows,message,limit=4)=>rows.length?rows.slice(0,limit).map(gameRow).join(''):empty(message);
  const sourceNote=row=>'<p class="wn-note">'+esc(M.provenance(row))+'</p>';
  function teamSummary(key) {
    const t=key==='wildman'?wildman():hitmen();
    if(!t) return empty(key==='hitmen'?'Public Hitmen schedule and stats are not available yet. Published team coverage is in Hitmen Media; team tools require sign-in.':'Wildman game data is not available right now.');
    const games=M.teamGames(state(),t.id),next=M.upcoming(games),recent=M.recent(games);
    return '<h3>'+(next.length?'Next game':'Recent games')+'</h3>'+gameRows(next.length?next:recent,'No published games available.')+'<div class="wn-desk-links"><a href="'+(key==='wildman'?'team.html#core-stalls':'hitmen-team-locker.html')+'">Roster &amp; stalls'+(key==='hitmen'?' · Team sign-in':'')+' →</a><a href="'+(key==='wildman'?'wildman-media.html':'hitmen-media.html')+'">Team media →</a></div>';
  }
  function ticker() {
    const rows=M.ticker(state(),wildman()?.id);
    if(!rows.length) return; // Keep useful editorial/event links when no games are live.
    mount('.wn-score-track', rows.map(g=>'<a class="wn-ticker-item" href="'+gameHref(g)+'"><small class="'+(g.status==='live'?'wn-ticker-live':'')+'">'+esc(g.status==='live'?'LIVE'+(g.period?' · P'+g.period:'')+(g.clock?' · '+g.clock:''):date(g.scheduled_at))+' · '+esc(event(g.event_id)?.name||'Event')+'</small><strong class="wn-ticker-teams">'+badge(team(g.away_team_id))+esc(team(g.away_team_id)?.abbreviation||team(g.away_team_id)?.name||'Away')+' / '+badge(team(g.home_team_id))+esc(team(g.home_team_id)?.abbreviation||team(g.home_team_id)?.name||'Home')+'</strong><small>'+esc(M.score(g))+'</small></a>').join(''));
  }
  const storyHref=p=>p._report?'postgame.html?id='+encodeURIComponent(p.game_id):'media-story.html?id='+encodeURIComponent(p.id);
  const storySeries=p=>p.source_metrics?.series || (p._report?'Postgame Desk':p.post_type==='recap'?'Postgame Desk':'Elite CHEL Media');
  const storyTitle=p=>p.title||p.headline||'Published report';
  const storyExcerpt=p=>String(p.subheadline||p.source_metrics?.summary||p.body||'').slice(0,180);
  const allStories=()=>[...posts,...reports.map(r=>({...r,_report:true}))].sort((a,b)=>M.stamp(b.published_at)-M.stamp(a.published_at));
  const isLG=p=>{
    const metrics=p.source_metrics||{};
    const e=event(metrics.event_id||M.id(M.games(state()),p.game_id||metrics.game_id)?.event_id);
    return e ? M.lgEvent(e) : /^(lg|lgchl|lgahl|lgnhl)$/i.test(String(metrics.league||metrics.league_id||'')) || metrics.coverage_scope==='lg';
  };
  function storyRow(p,lead=false) {
    return '<a class="'+(lead?'wn-lead-story':'wn-story-row')+'" href="'+storyHref(p)+'"><small class="wn-kicker">'+esc(storySeries(p))+'</small><h3>'+esc(storyTitle(p))+'</h3>'+(lead?'<p>'+esc(storyExcerpt(p))+'</p>':'')+'<small>'+esc(date(p.published_at))+'</small>'+(p.source_metrics?.source_label?'<p class="wn-note">'+esc(p.source_metrics.source_label)+'</p>':'')+'</a>';
  }
  function storyRows(rows,message) {
    return rows.length?rows.slice(0,4).map(p=>storyRow(p)).join(''):empty(mediaLoading?'Checking published stories…':mediaError?'Published coverage could not be loaded. Please try again.':message);
  }
  function gotw() {
    const choice=C.gameOfWeek;
    const g=choice?.gameId?M.id(M.games(state()),choice.gameId):null;
    if(!g) return empty('The editorial desk has not announced Game of the Week yet. Explore the latest LG results and upcoming games below.');
    const h=team(g.home_team_id),a=team(g.away_team_id);
    const stat=id=>(state().teamStats||[]).find(s=>s.event_id===g.event_id&&s.team_id===id);
    const record=s=>s&&s.wins!=null&&s.losses!=null?String(s.wins)+'–'+s.losses+(s.ot_losses!=null?'–'+s.ot_losses:''):'Record unavailable';
    const preview=posts.find(p=>String(p.id)===String(choice.previewPostId));
    const form=t=>M.recent(M.teamGames(state(),t?.id)).filter(x=>x.event_id===g.event_id&&x.home_score!=null&&x.away_score!=null&&x.home_score!==x.away_score).slice(0,5).map(x=>(x.home_team_id===t?.id?x.home_score>x.away_score:x.away_score>x.home_score)?'W':'L').join(' · ')||'Recent form unavailable';
    const context=t=>{const s=stat(t?.id);return s?.rank!=null?'Source rank '+s.rank:'Standings context unavailable';};
    const players=(state().stats||[]).filter(s=>s.event_id===g.event_id&&[h?.id,a?.id].includes(s.team_id)&&s.points!=null).sort((a,b)=>Number(b.points)-Number(a.points)).slice(0,3);
    const detail='<p class="wn-note">'+esc(context(a))+' / '+esc(context(h))+'</p><p class="wn-note">Recent form: '+esc(form(a))+' / '+esc(form(h))+'</p>'+(players.length?'<p class="wn-note">Event player leaders: '+players.map(s=>esc(M.id(state().players,s.player_id)?.gamertag||'Player')+' · '+esc(s.points)+' P').join(' / ')+'</p>':'')+(choice.whyItMatters?'<p>'+esc(choice.whyItMatters)+'</p>':'');

    return '<div class="wn-matchup"><span class="wn-brand">'+badge(a)+'</span><span>VS</span><span class="wn-brand">'+badge(h)+'</span></div><h3>'+esc(a?.name||'Away team pending')+' at '+esc(h?.name||'Home team pending')+'</h3><p>'+esc(date(g.scheduled_at))+'</p><p class="wn-note">'+esc(record(stat(a?.id)))+' / '+esc(record(stat(h?.id)))+'</p>'+sourceNote(g)+detail+(preview?'<p>'+esc(storyExcerpt(preview))+'</p><a class="wn-button" href="'+storyHref(preview)+'">Read matchup preview →</a>':empty('Matchup preview, recent form and player context have not been published yet.'))+'<div class="wn-actions"><a href="'+gameHref(g)+'">Open game page →</a></div>';
  }
  function standings(eventId) {
    const rows=M.standings(state(),eventId);
    if(!rows.length) return empty('No source-provided standings ranks are available for this event.');
    return rows.slice(0,6).map(r=>'<div class="wn-standing-row"><b>'+esc(r.rank)+'</b><span>'+esc(team(r.team_id)?.name||'Team pending')+'</span><span>'+esc(r.points??'—')+' <small>PTS</small></span></div>').join('')+sourceNote(rows[0]);
  }
  function eventRow(e) {
    const link='competition.html?event='+encodeURIComponent(e.id);
    return '<a class="wn-event-row" href="'+link+'"><p class="wn-kicker">'+esc(e.organizer||'Competition')+'</p><h3>'+esc(e.name)+'</h3><div class="wn-event-meta"><span>'+esc(e.format||e.event_type||'Format not provided')+'</span><span>'+esc(e.status||'Status pending')+'</span><span>'+esc(e.starts_on?date(e.starts_on):'Date to be confirmed')+'</span></div><p>Schedule, results, standings and roster →</p></a>';
  }
  function eventOverview(e) {
    if(!e) return empty('No public featured competition is available yet. Check the Tournament Hub for updates.');
    const games=M.games(state()).filter(g=>g.event_id===e.id);
    const url=safeURL(e.registration_url||e.registration_link);
    return '<div class="wn-overview-header"><div><p class="wn-kicker">FEATURED COMPETITION</p><h3>'+esc(e.name)+'</h3><p class="wn-note">'+esc(e.status||'Event state pending')+'</p></div></div><div class="wn-three-col"><section><h3>Recent results</h3>'+gameRows(M.recent(games),'No finalized results published.')+'</section><section><h3>Upcoming games</h3>'+gameRows(M.upcoming(games),'No upcoming games published.')+'</section><section><h3>Standings preview</h3>'+standings(e.id)+'</section></div><p class="wn-note">Registration: '+esc(e.registration_status||'Not announced')+'</p>'+(url?'<a class="wn-button" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Registration details ↗</a>':'')+'<div class="wn-actions"><a href="competition.html?event='+encodeURIComponent(e.id)+'">Open event →</a></div>';
  }
  function teamOverview(key) {
    const t=key==='wildman'?wildman():hitmen();
    if(!t) return '<div class="wn-overview-header"><span class="wn-brand">'+brand(key)+'</span><h3>'+esc(C.brands[key].name)+'</h3></div>'+teamSummary(key)+empty(key==='hitmen'?'Current record, WHL Eastern standings, team leaders and league-relative player ranks await a public data source.':'Team leaders and stats await published event data.');
    const games=M.teamGames(state(),t.id),latest=M.recent(games)[0]||M.upcoming(games)[0];
    const stat=(state().teamStats||[]).find(s=>s.team_id===t.id&&s.event_id===latest?.event_id);
    const competitions=M.events(state()).filter(e=>(state().eventTeams||[]).some(r=>r.team_id===t.id&&r.event_id===e.id));
    return '<div class="wn-overview-header"><span class="wn-brand">'+brand(key)+'</span><div><h3>'+esc(t.name)+'</h3><p class="wn-note">'+esc(event(latest?.event_id)?.name||'No current event')+'</p></div></div>'+(stat?'<div class="wn-stat-line"><span>Record '+esc(stat.wins??'—')+'–'+esc(stat.losses??'—')+'–'+esc(stat.ot_losses??'—')+'</span><span>Points '+esc(stat.points??'—')+'</span></div>'+sourceNote(stat):empty('Team record and totals have not been published.'))+'<div class="wn-three-col"><section><h3>Recent games</h3>'+gameRows(M.recent(games),'No recent results available.')+'</section><section><h3>Upcoming games</h3>'+gameRows(M.upcoming(games),'No upcoming games available.')+'</section><section><h3>Tournament involvement</h3>'+(competitions.length?competitions.slice(0,2).map(eventRow).join(''):empty('No tournament entry announced.'))+'</section></div>';
  }
  function renderOverview() {
    const key=document.querySelector('[data-overview-select]')?.value||'wildman';
    mount('[data-overview]',key==='event'?eventOverview(M.featuredEvent(state(),C.featuredEventId)):teamOverview(key));
  }
  function renderRoom(key) {
    const t=key==='wildman'?wildman():hitmen();
    mount('[data-room-games="recent"]',gameRows(t?M.recent(M.teamGames(state(),t.id)):[], 'No public results are available. Published postgame coverage appears below when available.'));
    mount('[data-room-games="upcoming"]',gameRows(t?M.upcoming(M.teamGames(state(),t.id)):[], 'No public upcoming games are available. Matchup reports will appear after editorial publication.'));
    if(key==='wildman') {
      const roster=t?(state().teamPlayers||[]).filter(r=>r.team_id===t.id&&r.active!==false):[];
      mount('[data-room-roster]',roster.length?roster.map(r=>{const p=M.id(state().players,r.player_id);return '<a class="wn-roster-row" href="esports-player.html?id='+encodeURIComponent(r.player_id)+'"><b>'+esc(p?.gamertag||'Player')+'</b><span>'+esc(r.position||p?.primary_position||'Position pending')+'</span></a>';}).join(''):empty('Roster preview is unavailable. Open the existing Wildman locker room for stalls and the tournament roster.'));
    }
    mount('[data-room-overview]',teamOverview(key));
    mount('[data-room-media]',storyRows(allStories().filter(p=>(t && p.source_metrics?.team_id===t.id)||(C.brands[key].teamId && p.source_metrics?.team_id===C.brands[key].teamId)||(p._report&&t&&M.teamGames(state(),t.id).some(g=>g.id===p.game_id))), 'No published stories are linked to this team yet.'));
  }
  function renderCompetition() {
    const query=new URLSearchParams(location.search).get('event');
    const e=query?M.id(M.events(state()),query):M.featuredEvent(state(),C.featuredEventId);
    mount('[data-event-title]',esc(e?.name||(query?'Event unavailable':'Competition Center')));
    mount('[data-event-overview]',query&&!e?empty('This public event was not found. Browse the Tournament Hub.'):eventOverview(e));
    if(!e) {
      ['schedule','standings','teams','rosters','stats'].forEach(key=>mount('[data-event-'+key+']',empty('Select an available event from the Tournament Hub.')));return;
    }
    mount('[data-event-schedule]',gameRows(M.upcoming(M.games(state()).filter(g=>g.event_id===e.id)), 'No upcoming game slots published.',24)+gameRows(M.recent(M.games(state()).filter(g=>g.event_id===e.id)), 'No results published.',24));
    mount('[data-event-standings]',standings(e.id));
    const entries=(state().eventTeams||[]).filter(r=>r.event_id===e.id);
    mount('[data-event-teams]',entries.length?entries.map(r=>'<a class="wn-roster-row" href="esports-team.html?team='+encodeURIComponent(r.team_id)+'"><b>'+esc(team(r.team_id)?.name||'Team pending')+'</b><span>Team page →</span></a>').join(''):empty('Event teams have not been published.'));
    const selector=document.querySelector('[data-roster-team]');
    if(selector&&selector.dataset.event!==e.id) {
      selector.dataset.event=e.id;
      selector.innerHTML='<option value="">Select a team</option>'+entries.map(r=>'<option value="'+esc(r.team_id)+'">'+esc(team(r.team_id)?.name||'Team pending')+'</option>').join('');
    }
    const selected=selector?.value;
    const rows=(state().eventRosters||[]).filter(r=>r.event_id===e.id&&r.team_id===selected&&r.active!==false);
    mount('[data-event-rosters]',!selected?empty('Choose a team to open its tournament roster.'):rows.length?rows.map(r=>'<a class="wn-roster-row" href="esports-player.html?id='+encodeURIComponent(r.player_id)+'"><b>'+esc(M.id(state().players,r.player_id)?.gamertag||'Player')+'</b><span>'+esc(r.position||'Position pending')+'</span></a>').join(''):empty('No roster published for this team.'));
    const stats=(state().stats||[]).filter(s=>s.event_id===e.id&&s.points!=null&&s.games_played!=null).sort((a,b)=>Number(b.points)-Number(a.points)).slice(0,5);
    mount('[data-event-stats]',stats.length?stats.map(s=>'<a class="wn-roster-row" href="esports-player.html?id='+encodeURIComponent(s.player_id)+'"><span>'+esc(M.id(state().players,s.player_id)?.gamertag||'Player')+'<small class="wn-note" style="display:block">'+esc(M.provenance(s))+'</small></span><span>'+esc(s.points)+' P · '+esc(s.games_played)+' GP</span></a>').join(''):empty('Player statistics have not been published for this event.'));
  }
  function renderEvents() {
    const rows=M.events(state()),featured=M.featuredEvent(state(),C.featuredEventId);
    mount('[data-featured-event]',featured?eventRow(featured):empty('Featured event to be announced.'));
    mount('[data-hosted-events]',rows.filter(e=>e.host_type==='wildman'||e.source_provider==='wildman'||e.organizer==='Wildman Hockey').map(eventRow).join('')||empty('No Wildman-hosted events announced yet.'));
    mount('[data-community-events]',rows.filter(e=>e.host_type==='community'||(!['wildman','partnered'].includes(e.host_type)&&e.organizer!=='Wildman Hockey'&&e.source_provider!=='wildman')).map(eventRow).join('')||empty('Community event listings will appear here when confirmed.'));
    mount('[data-upcoming-events]',rows.filter(e=>M.stamp(e.starts_on)>=Date.now()).map(eventRow).join('')||empty('No upcoming competitions announced.'));
  }
  function storyDetail() {
    const key=new URLSearchParams(location.search).get('id'),p=posts.find(p=>String(p.id)===String(key));
    if(!p){mount('[data-story-detail]',empty(mediaLoading?'Loading published story…':mediaError?'The story could not be loaded. Please try again.':'This story is unavailable or has not been published.'));return;}
    document.title=storyTitle(p)+' | Elite CHEL Media';
    mount('[data-story-detail]','<p class="wn-kicker">'+esc(storySeries(p))+'</p><h1>'+esc(storyTitle(p))+'</h1><p class="wn-note">'+esc(date(p.published_at))+'</p><div class="wn-story-body">'+esc(p.body||'Story text unavailable.')+'</div>'+(p.source_metrics?.source_label?'<p class="wn-note">Source: '+esc(p.source_metrics.source_label)+'</p>':'')+'<a href="elite-chel-media.html">Back to the newsroom →</a>');
  }
  function render() {
    document.querySelectorAll('[data-brand]').forEach(el=>{el.innerHTML=brand(el.dataset.brand);});
    document.querySelectorAll('[data-room-name]').forEach(el=>{el.textContent=C.roomName;});
    document.querySelectorAll('[data-team-summary]').forEach(el=>{el.innerHTML=teamSummary(el.dataset.teamSummary);});
    ticker();mount('[data-game-of-week]',gotw());
    const lg=M.lgGames(state()),lgEvent=M.events(state()).find(M.lgEvent);
    mount('[data-games="lg-recent"]',gameRows(M.recent(lg),'No recent LG results are available from the public feed.'));
    mount('[data-games="lg-upcoming"]',gameRows(M.upcoming(lg),'No upcoming LG games are available from the public feed.'));
    mount('[data-standings="lg"]',lgEvent?standings(lgEvent.id):empty('LG standings are not available from the public feed.'));
    mount('[data-stories="lg"]',storyRows(allStories().filter(isLG),'No LG stories have been published yet.'));
    document.querySelectorAll('[data-story-series]').forEach(el=>{el.innerHTML=storyRows(allStories().filter(p=>storySeries(p)===el.dataset.storySeries),'This editorial series has not published a story yet.');});
    const stories=allStories();
    mount('[data-newsroom]',stories.length?'<div class="wn-newsroom">'+storyRow(stories[0],true)+'<div>'+storyRows(stories.slice(1),'More stories will appear here after publication.')+'</div></div>':empty(mediaLoading?'Checking the newsroom…':mediaError?'The newsroom could not be loaded. Please try again.':'The editorial desk has not published a lead story yet. Explore broadcasts, reports and VOD coverage below.'));
    mount('[data-series-list]',C.series.map(s=>'<li>'+esc(s)+'</li>').join(''));
    renderOverview();renderEvents();renderCompetition();storyDetail();
    const room=document.body.dataset.publicRoom;if(room)renderRoom(room);
    window.WildmanPublicUI.loaded=true;
  }
  async function loadPublished() {
    const db=window.WildmanEsportsNetwork?.db;
    if(!db){mediaLoading=false;mediaError=true;render();return;}
    const results=await Promise.allSettled([
      db.from('media_posts').select('id,title,body,post_type,source_metrics,published_at').eq('published',true).order('published_at',{ascending:false}).limit(60),
      db.from('esports_game_reports').select('id,game_id,headline,subheadline,status,published_at,source_url').eq('status','published').order('published_at',{ascending:false}).limit(60),
      db.from('teams').select('id,logo_url').eq('id',C.brands.hitmen.teamId).maybeSingle()
    ]);
    const value=i=>results[i].status==='fulfilled'&&!results[i].value.error?results[i].value.data:null;
    posts=value(0)||[];reports=value(1)||[];hitmenLogo=value(2)?.logo_url||C.brands.hitmen.logo;
    mediaError=[0,1].some(i=>results[i].status!=='fulfilled'||results[i].value.error);
    mediaLoading=false;render();
  }
  document.addEventListener('error',e=>{
    const image=e.target;
    if(image instanceof HTMLImageElement && image.closest('.wn-brand')){
      failedLogos.add(image.src);
      image.parentElement.innerHTML='<span class="wn-logo-pending">'+esc(image.alt.replace(/ logo$/,''))+'<small style="display:block">Official logo unavailable</small></span>';
    }
  },true);
  document.addEventListener('change',e=>{if(e.target.matches('[data-overview-select]'))renderOverview();if(e.target.matches('[data-roster-team]'))renderCompetition();});
  window.addEventListener('wildman-network-ready',render);
  render();
  if(window.WildmanEsportsNetwork)loadPublished();
  else window.addEventListener('wildman-network-ready',loadPublished,{once:true});
})();
