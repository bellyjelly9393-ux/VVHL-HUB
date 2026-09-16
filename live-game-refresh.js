(() => {
  const URL='https://lrgllzvwgvqagcpiyvfd.supabase.co';
  const KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
  const db=window.supabase?.createClient(URL,KEY); if(!db)return;
  const root=document.getElementById('networkGameDetail'); if(!root)return;
  const gameId=new URLSearchParams(location.search).get('id'); if(!gameId)return;
  const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"})[c]);
  const fmt=v=>v?new Date(v).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'TBD';
  const isMobile=()=>window.matchMedia?.('(max-width: 900px)').matches || (navigator.maxTouchPoints||0)>1 || /Android|iPhone|iPad|iPod|Mobile|SamsungBrowser/i.test(navigator.userAgent||'');
  function twitchChannel(raw){try{return new URL(raw).pathname.split('/').filter(Boolean).pop()||'';}catch{return String(raw||'').split('/').filter(Boolean).pop()||'';}}
  function youtubeId(raw){try{const u=new URL(raw);if(u.hostname.includes('youtu.be'))return u.pathname.slice(1);if(u.searchParams.get('v'))return u.searchParams.get('v');const p=u.pathname.split('/').filter(Boolean),i=p.findIndex(x=>x==='embed'||x==='live');return i>=0?p[i+1]||'':'';}catch{return '';}}
  function directStreamCard(g,label='Open stream'){
    return `<div class="stream-direct-card"><div><small>LIVE STREAM</small><strong>${esc(g.broadcast_title||'Watch this matchup')}</strong><span>${esc((g.stream_provider||'external').toUpperCase())} feed</span></div><a class="btn btn-primary" href="${esc(g.stream_url)}" target="_blank" rel="noopener noreferrer">${esc(label)} →</a></div>`;
  }
  function embed(g){
    if(!g.stream_url)return `<div class="stream-placeholder"><strong>STREAM NOT ASSIGNED</strong><span>The broadcast desk can attach a Twitch or YouTube feed to this matchup.</span></div>`;
    const p=String(g.stream_provider||'').toLowerCase();
    if(p==='twitch'){
      const ch=twitchChannel(g.stream_url);
      if(ch){
        if(isMobile()) return `<div class="mobile-stream-fallback"><div class="live-play-icon">▶</div><strong>${esc(g.broadcast_title||'Twitch broadcast')}</strong><p>Twitch's embedded player is currently unreliable on some mobile browsers. Open the live broadcast directly in Twitch while this Game Center keeps the live score and game state updated.</p><a class="btn btn-primary" href="${esc(g.stream_url)}" target="_blank" rel="noopener noreferrer">WATCH ON TWITCH →</a></div>`;
        const parent=encodeURIComponent(location.hostname);
        return `<div class="stream-embed-stack"><iframe class="network-stream" src="https://player.twitch.tv/?channel=${encodeURIComponent(ch)}&parent=${parent}&autoplay=false&muted=true" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="Live Twitch stream"></iframe>${directStreamCard(g,'Open on Twitch')}</div>`;
      }
    }
    if(p==='youtube'){
      const id=youtubeId(g.stream_url);
      if(id)return `<div class="stream-embed-stack"><iframe class="network-stream" src="https://www.youtube.com/embed/${encodeURIComponent(id)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen title="Live YouTube stream"></iframe>${directStreamCard(g,'Open on YouTube')}</div>`;
    }
    return directStreamCard(g,'Open Stream');
  }
  function statsTable(rows,players,teams){if(!rows.length)return '<div class="empty-state">Player game stats have not been entered yet.</div>';return `<div class="wm-table-wrap"><table class="wm-table"><thead><tr><th>GT</th><th>Team</th><th>POS</th><th>G</th><th>A</th><th>P</th><th>+/-</th><th>Shots</th><th>Hits</th></tr></thead><tbody>${rows.sort((a,b)=>(b.points||0)-(a.points||0)).map(s=>{const p=players.find(x=>x.id===s.player_id),t=teams.find(x=>x.id===s.team_id);return `<tr><td><a href="esports-player.html?id=${encodeURIComponent(s.player_id)}">${esc(p?.gamertag||'Player')}</a></td><td>${esc(t?.name||'—')}</td><td>${esc(s.position||'—')}</td><td>${s.goals||0}</td><td>${s.assists||0}</td><td><b>${s.points||0}</b></td><td>${s.plus_minus??'—'}</td><td>${s.shots??'—'}</td><td>${s.hits??'—'}</td></tr>`;}).join('')}</tbody></table></div>`;}
  async function load(){
    const gameRes=await db.from('esports_games').select('*').eq('id',gameId).maybeSingle(); if(gameRes.error||!gameRes.data){root.innerHTML='<div class="empty-state">This game is not available.</div>';return;}
    const g=gameRes.data;
    const [teamsRes,eventRes,statsRes,playersRes]=await Promise.all([db.from('esports_teams').select('*').in('id',[g.home_team_id,g.away_team_id].filter(Boolean)),g.event_id?db.from('esports_events').select('*').eq('id',g.event_id).maybeSingle():Promise.resolve({data:null}),db.from('esports_game_player_stats').select('*').eq('game_id',g.id),db.from('esports_players').select('*')]);
    const teams=teamsRes.data||[],e=eventRes.data,stats=statsRes.data||[],players=playersRes.data||[]; const home=teams.find(x=>x.id===g.home_team_id),away=teams.find(x=>x.id===g.away_team_id);
    document.title=`${home?.name||'TBD'} vs ${away?.name||'TBD'} | Wildman Game Center`;
    const score=g.status==='scheduled'?'VS':`${g.home_score??0} - ${g.away_score??0}`;
    const timing=g.status==='live'?`${g.period?`Period ${g.period}`:'LIVE'}${g.clock?` · ${g.clock}`:''}`:g.status==='final'?'FINAL':fmt(g.scheduled_at);
    const hitmenControls=g.source_provider==='hitmen-workspace'?'<a class="small-btn" href="hitmen-workspace.html">Hitmen Controls</a>':'';
    root.innerHTML=`<div class="game-top-actions"><a class="profile-back" href="game-center.html">← Back to Game Center</a>${hitmenControls}</div><div class="eyebrow">${esc(e?.name||'ESPORTS GAME')}</div><div class="live-scoreboard"><div><a href="${home?.slug==='wildman-hockey'?'team.html':`esports-team.html?team=${encodeURIComponent(home?.slug||'')}`}"><strong>${esc(home?.name||'TBD')}</strong></a></div><div class="live-score"><span>${esc(score)}</span><small>${esc((g.status||'scheduled').toUpperCase())} · ${esc(timing)}</small></div><div><a href="${away?.slug==='wildman-hockey'?'team.html':`esports-team.html?team=${encodeURIComponent(away?.slug||'')}`}"><strong>${esc(away?.name||'TBD')}</strong></a></div></div><div class="stream-shell">${embed(g)}</div><div class="status-board" style="margin-top:18px"><div class="wm-stat"><div class="eyebrow">STAGE</div><strong>${esc(g.stage||'TBD')}</strong><span>${esc(g.round_label||'Tournament')}</span></div><div class="wm-stat"><div class="eyebrow">COMMENTARY</div><strong>${esc((g.commentary_status||'none').toUpperCase())}</strong><span>${esc(g.commentary_label||'Wildman broadcast coverage')}</span></div><div class="wm-stat"><div class="eyebrow">STREAM</div><strong>${g.stream_url?'ASSIGNED':'TBD'}</strong><span>${esc(g.stream_provider||'Provider pending')}</span></div><div class="wm-stat"><div class="eyebrow">AUTO REFRESH</div><strong>8 SEC</strong><span>${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}</span></div></div><section class="profile-section"><div class="section-heading"><div><div class="eyebrow">BOX SCORE</div><h2>PLAYER STATS</h2></div><a class="small-btn" href="multiview.html?games=${encodeURIComponent(g.id)}">Open Multiview</a></div>${statsTable(stats,players,teams)}</section>${g.vod_url?`<section class="profile-section"><a class="ops-card" href="${esc(g.vod_url)}" target="_blank" rel="noopener"><small>Postgame</small><h3>Watch VOD</h3><span class="ops-link">OPEN VOD →</span></a></section>`:''}`;
  }
  load();setInterval(()=>{if(!document.hidden)load();},8000);
})();