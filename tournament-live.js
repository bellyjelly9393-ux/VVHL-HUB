(() => {
  const URL='https://lrgllzvwgvqagcpiyvfd.supabase.co';
  const KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
  const db=window.VVHLBackend?.db || (window.supabase?window.supabase.createClient(URL,KEY):null);
  if(!db) return;
  const S={events:[],teams:[],players:[],games:[],teamStats:[],playerStats:[]};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
  const team=id=>S.teams.find(x=>x.id===id);
  const event=id=>S.events.find(x=>x.id===id);
  const player=id=>S.players.find(x=>x.id===id);
  const fmt=v=>v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'TBD';
  const score=g=>g.status==='scheduled'?'VS':`${g.home_score??0}-${g.away_score??0}`;
  const statusRank={live:0,scheduled:1,final:2,postponed:3,cancelled:4};
  const gameHref=g=>`live-game.html?id=${encodeURIComponent(g.id)}`;

  function twitchChannel(raw){try{const u=new URL(raw);return u.pathname.split('/').filter(Boolean).pop()||'';}catch{return String(raw||'').split('/').filter(Boolean).pop()||'';}}
  function youtubeId(raw){try{const u=new URL(raw);if(u.hostname.includes('youtu.be'))return u.pathname.slice(1);if(u.searchParams.get('v'))return u.searchParams.get('v');const parts=u.pathname.split('/').filter(Boolean);const i=parts.findIndex(x=>x==='embed'||x==='live');return i>=0?parts[i+1]||'':'';}catch{return '';}}
  function streamEmbed(g){
    if(!g?.stream_url)return '';
    const p=String(g.stream_provider||'').toLowerCase();
    if(p==='twitch'){const ch=twitchChannel(g.stream_url);return ch?`<iframe src="https://player.twitch.tv/?channel=${encodeURIComponent(ch)}&parent=${encodeURIComponent(location.hostname)}&autoplay=false" allowfullscreen title="${esc(g.broadcast_title||'Twitch broadcast')}"></iframe>`:'';}
    if(p==='youtube'){const id=youtubeId(g.stream_url);return id?`<iframe src="https://www.youtube.com/embed/${encodeURIComponent(id)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen title="${esc(g.broadcast_title||'YouTube broadcast')}"></iframe>`:'';}
    return '';
  }
  function gameCard(g){
    const h=team(g.home_team_id)?.name||'TBD',a=team(g.away_team_id)?.name||'TBD',live=g.status==='live';
    const extra=live&&g.period?`P${g.period}${g.clock?` · ${g.clock}`:''}`:fmt(g.scheduled_at);
    return `<a class="game-row ${live?'is-live':''} ${g.featured?'is-featured':''}" href="${gameHref(g)}"><div><strong>${live?'LIVE':esc(extra)}</strong><small style="display:block">${esc(g.stage||g.round_label||event(g.event_id)?.name||'Tournament')}</small></div><div><strong>${esc(h)} vs ${esc(a)}</strong><small style="display:block">${esc(event(g.event_id)?.name||'Esports Event')}${g.commentary_status==='live'?' · WILDMAN COMMENTARY':''}</small></div><div class="game-score">${esc(score(g))}</div><div class="game-result">${live?'WATCH LIVE':g.status==='final'?'FINAL':'OPEN'} →</div></a>`;
  }

  function renderFeatured(){
    const root=$('featuredBroadcast'); if(!root)return;
    const rows=[...S.games].sort((a,b)=>(statusRank[a.status]??9)-(statusRank[b.status]??9)||new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0));
    const g=rows.find(x=>x.featured&&x.status==='live')||rows.find(x=>x.featured)||rows.find(x=>x.status==='live'&&x.stream_url)||rows.find(x=>x.status==='live')||rows.find(x=>x.status==='scheduled'&&x.stream_url);
    if(!g){root.innerHTML='<div class="featured-placeholder"><div><strong>No featured broadcast yet</strong><p>The broadcast desk can feature any tournament matchup as soon as the schedule and stream are assigned.</p></div></div>';return;}
    const h=team(g.home_team_id)?.name||'TBD',a=team(g.away_team_id)?.name||'TBD',embed=streamEmbed(g);
    root.innerHTML=`<div class="featured-stage">${embed||`<div class="featured-placeholder"><div><strong>${g.stream_url?'Open broadcast':'Stream pending'}</strong><p>${g.stream_url?'This provider opens from the game page.':'A stream has not been attached to this matchup yet.'}</p>${g.stream_url?`<a class="btn btn-primary" href="${esc(g.stream_url)}" target="_blank" rel="noopener">Open Stream</a>`:''}</div></div>`}<div class="featured-meta"><span class="live-chip">${g.status==='live'?'LIVE NOW':esc(g.status.toUpperCase())}</span><h3>${esc(h)} ${g.status==='scheduled'?'vs':g.home_score??0} ${g.status==='scheduled'?'':`- ${g.away_score??0}`} ${g.status==='scheduled'?esc(a):esc(a)}</h3><p>${esc(event(g.event_id)?.name||'Tournament')} · ${esc(g.broadcast_title||g.round_label||g.stage||'Featured matchup')}</p></div></div><aside class="live-sidecard"><div class="eyebrow">FEATURED GAME</div><h3>${esc(h)} vs ${esc(a)}</h3><p><b>${esc(score(g))}</b> · ${g.status==='live'&&g.period?`Period ${g.period}${g.clock?` · ${esc(g.clock)}`:''}`:esc(fmt(g.scheduled_at))}</p><p>Commentary: <b>${esc((g.commentary_status||'none').toUpperCase())}</b></p><p>Stream: <b>${esc(g.stream_provider||'TBD')}</b></p><a class="btn btn-primary" href="${gameHref(g)}">Open Game Page</a><a class="btn btn-secondary" href="multiview.html" style="margin-top:8px">Open Multiview</a></aside>`;
  }

  function renderBoard(){
    const root=$('networkGameList'); if(!root)return;
    const eFilter=$('gameEventFilter'),sFilter=$('gameStatusFilter');
    if(eFilter&&eFilter.options.length<=1){S.events.forEach(e=>eFilter.insertAdjacentHTML('beforeend',`<option value="${e.id}">${esc(e.name)}</option>`));}
    const draw=()=>{
      const eid=eFilter?.value||'all',st=sFilter?.value||'all';
      const rows=S.games.filter(g=>(eid==='all'||g.event_id===eid)&&(st==='all'||g.status===st)).sort((a,b)=>(statusRank[a.status]??9)-(statusRank[b.status]??9)||new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0));
      root.innerHTML=rows.length?rows.map(gameCard).join(''):'<div class="empty-state">No games match this view yet.</div>';
    };
    if(eFilter&&!eFilter.dataset.liveBound){eFilter.dataset.liveBound='1';eFilter.addEventListener('change',draw);} if(sFilter&&!sFilter.dataset.liveBound){sFilter.dataset.liveBound='1';sFilter.addEventListener('change',draw);} draw();
  }

  function roadEvent(){return S.events.find(e=>e.slug==='road-to-pro-2026');}
  function renderSchedule(){
    const root=$('proSeriesSchedule'),e=roadEvent(); if(!root||!e)return;
    const rows=S.games.filter(g=>g.event_id===e.id).sort((a,b)=>new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0));
    root.innerHTML=rows.length?`<div class="game-list">${rows.map(gameCard).join('')}</div>`:'<div class="empty-state">Official schedule has not been imported yet.</div>';
  }
  function renderStandings(){
    const root=$('proStandings'),e=roadEvent(); if(!root||!e)return;
    const rows=S.teamStats.filter(x=>x.event_id===e.id).sort((a,b)=>(a.seed??999)-(b.seed??999)||b.points-a.points);
    root.innerHTML=rows.length?`<div class="wm-table-wrap"><table class="wm-table standings-table"><thead><tr><th>#</th><th>Team</th><th>GP</th><th>W</th><th>L</th><th>OTL</th><th>GF</th><th>GA</th><th>GD</th><th>PTS</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${r.seed??i+1}</td><td><a href="${team(r.team_id)?.slug==='wildman-hockey'?'team.html':`esports-team.html?team=${encodeURIComponent(team(r.team_id)?.slug||'')}`}">${esc(team(r.team_id)?.name||'Team')}</a></td><td>${r.games_played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.ot_losses}</td><td>${r.goals_for}</td><td>${r.goals_against}</td><td>${r.goals_for-r.goals_against}</td><td><b>${r.points}</b></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">Standings will populate from finalized tournament games.</div>';
  }
  function renderLeaderboard(){
    const root=$('proLeaderboard'),e=roadEvent(); if(!root||!e)return;
    const rows=S.playerStats.filter(x=>x.event_id===e.id).sort((a,b)=>b.points-a.points||b.goals-a.goals).slice(0,100);
    root.innerHTML=rows.length?`<div class="wm-table-wrap"><table class="wm-table"><thead><tr><th>GT</th><th>Team</th><th>GP</th><th>G</th><th>A</th><th>P</th><th>+/-</th><th>Shots</th></tr></thead><tbody>${rows.map(r=>`<tr><td><a href="esports-player.html?id=${encodeURIComponent(r.player_id)}">${esc(player(r.player_id)?.gamertag||'Player')}</a></td><td>${esc(team(r.team_id)?.name||'—')}</td><td>${r.games_played}</td><td>${r.goals}</td><td>${r.assists}</td><td><b>${r.points}</b></td><td>${r.plus_minus??'—'}</td><td>${r.shots??'—'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">Player leaderboard will populate as game stats are entered.</div>';
  }
  function renderCounts(){
    const e=roadEvent(); if(!e)return; const games=S.games.filter(g=>g.event_id===e.id); const set=(id,v)=>{if($(id))$(id).textContent=v;};
    set('proGameCount',games.length); set('liveBroadcastCount',games.filter(g=>g.status==='live').length);
  }

  async function load(){
    const [events,teams,players,games,teamStats,playerStats]=await Promise.all([
      db.from('esports_events').select('*').eq('active',true),db.from('esports_teams').select('*').eq('active',true),db.from('esports_players').select('*').eq('active',true),db.from('esports_games').select('*'),db.from('esports_team_event_stats').select('*'),db.from('esports_player_event_stats').select('*')
    ]);
    if([events,teams,players,games,teamStats,playerStats].some(x=>x.error)){console.error('Tournament live refresh failed',[events.error,teams.error,players.error,games.error,teamStats.error,playerStats.error]);return;}
    Object.assign(S,{events:events.data||[],teams:teams.data||[],players:players.data||[],games:games.data||[],teamStats:teamStats.data||[],playerStats:playerStats.data||[]});
    renderFeatured();renderBoard();renderSchedule();renderStandings();renderLeaderboard();renderCounts();
    const stamp=$('liveRefreshStamp'); if(stamp)stamp.textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}`;
  }
  load();
  setInterval(()=>{if(!document.hidden)load();},10000);
})();