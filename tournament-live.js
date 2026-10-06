(() => {
  const URL='https://lrgllzvwgvqagcpiyvfd.supabase.co';
  const KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
  const db=window.VVHLBackend?.db || (window.supabase?window.supabase.createClient(URL,KEY):null);
  if(!db) return;
  let requestedChannel=new URLSearchParams(location.search).get('channel')||'';
  const S={events:[],teams:[],players:[],games:[],series:[],sources:[],teamStats:[],playerStats:[],eventTeams:[],rosters:[],rankings:[],selectedBroadcastKey:sessionStorage.getItem('wildman-live-channel')||''};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
  const team=id=>S.teams.find(x=>x.id===id);
  const event=id=>S.events.find(x=>x.id===id);
  const player=id=>S.players.find(x=>x.id===id);
  const eventTeam=(eventId,teamId)=>S.eventTeams.find(x=>x.event_id===eventId&&x.team_id===teamId);
  const rosterPos=(eventId,playerId)=>S.rosters.find(x=>x.event_id===eventId&&x.player_id===playerId)?.position||player(playerId)?.primary_position||'';
  const fmt=v=>v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'TBD';
  const fmtTime=v=>v?new Date(v).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'TBD';
  const teamLogo=t=>t?.logo_url?`<img src="${esc(t.logo_url)}" alt="${esc(t.name)} logo">`:`<span class="pro-live-fallback">${esc((t?.abbreviation||t?.name||'T').split(/\s+/).map(x=>x[0]).join('').slice(0,3))}</span>`;
  const teamHref=t=>t?.slug==='wildman-hockey'?'team.html':`esports-team.html?team=${encodeURIComponent(t?.slug||'')}`;
  const score=g=>g.status==='scheduled'?'VS':`${g.home_score??0}-${g.away_score??0}`;
  const statusRank={live:0,scheduled:1,final:2,postponed:3,cancelled:4};
  const gameHref=g=>`live-game.html?id=${encodeURIComponent(g.id)}`;
  const fmtSlot=v=>v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'TBD';
  const eventStat=(eventId,teamId)=>S.teamStats.find(x=>x.event_id===eventId&&x.team_id===teamId);
  const preSeed=(eventId,teamId)=>eventTeam(eventId,teamId)?.seed??null;
  const teamRecord=(eventId,teamId)=>{
    const s=eventStat(eventId,teamId);
    return s?`${s.wins||0}-${s.losses||0}-${s.ot_losses||0}`:'—';
  };

  function twitchChannel(raw){try{const u=new URL(raw);return u.pathname.split('/').filter(Boolean).pop()||'';}catch{return String(raw||'').split('/').filter(Boolean).pop()||'';}}
  function youtubeId(raw){try{const u=new URL(raw);if(u.hostname.includes('youtu.be'))return u.pathname.slice(1);if(u.searchParams.get('v'))return u.searchParams.get('v');const parts=u.pathname.split('/').filter(Boolean);const i=parts.findIndex(x=>x==='embed'||x==='live');return i>=0?parts[i+1]||'':'';}catch{return '';}}
  function streamEmbed(g){
    if(g?._kind==='source'&&channelFamily(g.channel_key)==='hitmen'){
      return '<iframe src="public-broadcast-stage.html?channel=hitmen-main" allow="autoplay; fullscreen" allowfullscreen title="Calgary Hitmen EliteChel broadcast"></iframe>';
    }
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

  function publicSources(){
    return S.sources
      .filter(s=>s.active!==false&&s.public_visible===true&&s.url)
      .map(s=>({
        _kind:'source',
        _key:'source:'+s.id,
        id:s.id,
        event_id:s.event_id,
        stream_url:s.url,
        stream_provider:s.provider||'external',
        broadcast_title:s.display_label||s.metadata?.title||'Live Channel',
        status:'live',
        scheduled_at:s.created_at,
        intake_mode:s.intake_mode||'media',
        channel_key:s.metadata?.channel_key||'',
        channel_group:s.metadata?.channel_group||'',
        channel_kind:s.metadata?.channel_kind||''
      }))
      .sort((a,b)=>(Number(S.sources.find(x=>x.id===a.id)?.slot_order||99)-Number(S.sources.find(x=>x.id===b.id)?.slot_order||99))||new Date(b.scheduled_at||0)-new Date(a.scheduled_at||0));
  }

  function channelFamily(value){
    const key=String(value||'').trim().toLowerCase();
    if(key==='wildman'||key.startsWith('wildman-'))return 'wildman';
    if(key==='hitmen'||key.startsWith('hitmen-'))return 'hitmen';
    return key;
  }

  function renderChannelPicker(){
    const root=$('broadcastChannelPicker'); if(!root)return;
    const sources=publicSources();
    if(!sources.length){root.innerHTML='<div class="empty-state">No public live channels are configured.</div>';return;}

    if(requestedChannel){
      const wantedFamily=channelFamily(requestedChannel);
      const wanted=sources.find(s=>channelFamily(s.channel_key)===wantedFamily);
      if(wanted){
        S.selectedBroadcastKey=wanted._key;
        sessionStorage.setItem('wildman-live-channel',S.selectedBroadcastKey);
      }
      requestedChannel='';
    }

    if(!S.selectedBroadcastKey||!sources.some(s=>s._key===S.selectedBroadcastKey)){
      const wild=sources.find(s=>channelFamily(s.channel_key)==='wildman')||sources[0];
      S.selectedBroadcastKey=wild._key;
      sessionStorage.setItem('wildman-live-channel',S.selectedBroadcastKey);
    }

    const selected=sources.find(s=>s._key===S.selectedBroadcastKey)||sources[0];
    root.innerHTML=`
      <div class="broadcast-channel-switcher">
        <label for="broadcastChannelSelect"><span>WATCH CHANNEL</span>
          <select id="broadcastChannelSelect" class="select-field">
            ${sources.map(s=>`<option value="${esc(s._key)}" ${S.selectedBroadcastKey===s._key?'selected':''}>${esc(channelFamily(s.channel_key)==='hitmen'?'Calgary Hitmen Live':'Wildman Live')} · ${esc(s.broadcast_title)}</option>`).join('')}
          </select>
        </label>
        <a class="small-btn broadcast-channel-open" href="live-channel.html?source=${encodeURIComponent(selected.id)}">Open Selected Channel →</a>
      </div>
      <div class="broadcast-channel-grid">
        ${sources.map(s=>`<div class="broadcast-channel-card ${S.selectedBroadcastKey===s._key?'active':''}">
          <button type="button" data-channel-key="${esc(s._key)}">
            <span class="broadcast-channel-live">${channelFamily(s.channel_key)==='hitmen'?'HITMEN CHANNEL':'WILDMAN CHANNEL'}</span>
            <strong>${esc(s.broadcast_title)}</strong>
            <small>${esc(s.channel_group||event(s.event_id)?.name||'Wildman Network')} · ${esc(String(s.stream_provider||'stream').toUpperCase())}</small>
          </button>
          <a href="live-channel.html?source=${encodeURIComponent(s.id)}">OPEN CHANNEL →</a>
        </div>`).join('')}
      </div>`;

    const choose=(key)=>{
      const source=sources.find(s=>s._key===key); if(!source)return;
      S.selectedBroadcastKey=source._key;
      sessionStorage.setItem('wildman-live-channel',S.selectedBroadcastKey);
      const family=channelFamily(source.channel_key)||'wildman';
      const next=new URL(location.href);
      next.searchParams.set('channel',family);
      history.replaceState(null,'',next.pathname+next.search+next.hash);
      renderChannelPicker();
      renderFeatured();
    };

    root.querySelector('#broadcastChannelSelect')?.addEventListener('change',e=>choose(e.target.value));
    root.querySelectorAll('[data-channel-key]').forEach(btn=>btn.onclick=()=>choose(btn.dataset.channelKey));
  }

  function featuredCopy(g){
    if(g._kind==='source'){
      const hitmen=channelFamily(g.channel_key)==='hitmen';
      return {
        key:g._key,
        title:hitmen?'Calgary Hitmen Live':(g.broadcast_title||'Wildman Club Live'),
        subtitle:hitmen?'EliteChel broadcast output · live scenes from Hitmen Broadcast Studio':(g.channel_group||event(g.event_id)?.name||'Wildman Esports')+' · Live '+String(g.stream_provider||'stream').toUpperCase()+' broadcast',
        status:'LIVE NOW',
        detail:hitmen?'OBS-controlled Hitmen broadcast':'Public club stream',
        provider:hitmen?'ELITE MEDIA OBS':String(g.stream_provider||'stream').toUpperCase(),
        primaryHref:hitmen?'live-channel.html?channel=hitmen':g.stream_url,
        primaryLabel:hitmen?'Open Hitmen Live':'Open on Twitch'
      };
    }
    const h=team(g.home_team_id)?.name||'TBD',a=team(g.away_team_id)?.name||'TBD';
    return {
      key:'game:'+g.id,
      title:h+' vs '+a,
      subtitle:(event(g.event_id)?.name||'Tournament')+' · '+(g.broadcast_title||g.round_label||g.stage||'Featured matchup'),
      status:g.status==='live'?'LIVE NOW':String(g.status||'scheduled').toUpperCase(),
      detail:(score(g))+' · '+(g.status==='live'&&g.period?('Period '+g.period+(g.clock?' · '+g.clock:'')):fmt(g.scheduled_at)),
      provider:String(g.stream_provider||'TBD').toUpperCase(),
      primaryHref:gameHref(g),
      primaryLabel:'Open Game Page'
    };
  }

  function renderFeatured(){
    const root=$('featuredBroadcast'); if(!root)return;
    const rows=[...S.games].sort((a,b)=>(statusRank[a.status]??9)-(statusRank[b.status]??9)||new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0));
    const sources=publicSources();
    const selected=sources.find(x=>x._key===S.selectedBroadcastKey);
    const source=selected||sources.find(x=>channelFamily(x.channel_key)==='wildman')||sources[0];
    const heading=document.querySelector('#featured .section-heading h2');
    const intro=document.querySelector('#featured .live-channel-intro');
    if(heading)heading.textContent=channelFamily(source?.channel_key)==='hitmen'?'CALGARY HITMEN LIVE':'WILDMAN NETWORK LIVE';
    if(intro)intro.textContent=channelFamily(source?.channel_key)==='hitmen'
      ?'Calgary Hitmen LGCHL coverage. Switch back to Wildman for tournament and network broadcasts, or use Multiview for both.'
      :'Wildman tournament and esports-network coverage. Switch to Calgary Hitmen for the dedicated LGCHL team feed, or open Multiview for both.';
    const g=source||
            rows.find(x=>x.featured&&x.status==='live'&&x.stream_url)||
            rows.find(x=>x.status==='live'&&x.stream_url)||
            rows.find(x=>x.featured&&x.stream_url)||
            rows.find(x=>x.status==='scheduled'&&x.stream_url);
    if(!g){
      if(root.dataset.broadcastKey!=='empty'){
        root.dataset.broadcastKey='empty';
        root.innerHTML='<div class="featured-placeholder"><div><strong>No live broadcast attached</strong><p>Add a public Twitch source or attach a stream to a game. The player will stay mounted while the data board refreshes.</p></div></div>';
      }
      return;
    }
    const copy=featuredCopy(g),embed=streamEmbed(g);
    const same=root.dataset.broadcastKey===copy.key;
    if(!same){
      root.dataset.broadcastKey=copy.key;
      root.innerHTML=`<div class="featured-stage">${embed||`<div class="featured-placeholder"><div><strong>Open broadcast</strong><p>This provider opens externally.</p><a class="btn btn-primary" href="${esc(g.stream_url)}" target="_blank" rel="noopener">Open Stream</a></div></div>`}<div class="featured-meta"><span class="live-chip" data-feature-status></span><h3 data-feature-title></h3><p data-feature-subtitle></p></div></div><aside class="live-sidecard"><div class="eyebrow">MAIN BROADCAST</div><h3 data-feature-side-title></h3><p data-feature-detail></p><p>Stream: <b data-feature-provider></b></p><a class="btn btn-primary" data-feature-primary></a><a class="btn btn-secondary" href="multiview.html" style="margin-top:8px">Open Multiview</a></aside>`;
    }
    root.querySelector('[data-feature-status]')?.replaceChildren(document.createTextNode(copy.status));
    root.querySelector('[data-feature-title]')?.replaceChildren(document.createTextNode(copy.title));
    root.querySelector('[data-feature-subtitle]')?.replaceChildren(document.createTextNode(copy.subtitle));
    root.querySelector('[data-feature-side-title]')?.replaceChildren(document.createTextNode(copy.title));
    root.querySelector('[data-feature-detail]')?.replaceChildren(document.createTextNode(copy.detail));
    root.querySelector('[data-feature-provider]')?.replaceChildren(document.createTextNode(copy.provider));
    const primary=root.querySelector('[data-feature-primary]');
    if(primary){primary.href=copy.primaryHref;primary.textContent=copy.primaryLabel;if(g._kind==='source'&&channelFamily(g.channel_key)!=='hitmen'){primary.target='_blank';primary.rel='noopener';}else{primary.removeAttribute('target');primary.removeAttribute('rel');}}
  }

  function renderBoard(){
    const root=$('networkGameList'); if(!root)return;
    const eFilter=$('gameEventFilter'),sFilter=$('gameStatusFilter');
    if(eFilter&&eFilter.options.length<=1){S.events.forEach(e=>eFilter.insertAdjacentHTML('beforeend',`<option value="${e.id}">${esc(e.name)}</option>`));}
    const draw=()=>{
      const eid=eFilter?.value||'all',st=sFilter?.value||'all';
      const road=roadEvent(),roadHasPlayoffs=road&&S.games.some(g=>g.event_id===road.id&&g.stage==='Playoffs');
      const rows=S.games
        .filter(g=>!(roadHasPlayoffs&&g.event_id===road.id&&g.stage!=='Playoffs'))
        .filter(g=>(eid==='all'||g.event_id===eid)&&(st==='all'||g.status===st))
        .sort((a,b)=>(statusRank[a.status]??9)-(statusRank[b.status]??9)||new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0));
      root.innerHTML=rows.length?rows.map(gameCard).join(''):'<div class="empty-state">No games match this view yet.</div>';
    };
    if(eFilter&&!eFilter.dataset.liveBound){eFilter.dataset.liveBound='1';eFilter.addEventListener('change',draw);} if(sFilter&&!sFilter.dataset.liveBound){sFilter.dataset.liveBound='1';sFilter.addEventListener('change',draw);} draw();
  }

  function roadEvent(){return S.events.find(e=>e.slug==='road-to-pro-2026');}
  function playoffSeries(e){
    return S.series.filter(s=>s.event_id===e?.id&&s.stage==='Playoffs'&&s.round_label==='Round 1')
      .sort((a,b)=>Number(String(a.session_label||'').match(/Matchup\s+(\d+)/i)?.[1]||99)-Number(String(b.session_label||'').match(/Matchup\s+(\d+)/i)?.[1]||99));
  }
  function playoffGameRows(e){
    const rows=S.games.filter(g=>g.event_id===e?.id&&g.stage==='Playoffs'&&g.round_label==='Round 1'&&!['cancelled','postponed'].includes(g.status));
    return rows.sort((a,b)=>new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0)||(a.series_game_number||0)-(b.series_game_number||0)||(a.broadcast_order||0)-(b.broadcast_order||0));
  }
  function renderPlayoffs(){
    const root=$('proPlayoffBracket'),e=roadEvent(); if(!root||!e)return;
    const rows=playoffSeries(e);
    if(!rows.length){root.innerHTML='<div class="empty-state">Round 1 bracket has not been loaded yet.</div>';return;}
    root.innerHTML=`<div class="pro-playoff-grid">${rows.map((s,i)=>{
      const home=team(s.home_team_id),away=team(s.away_team_id);
      const homeEt=eventTeam(e.id,s.home_team_id),awayEt=eventTeam(e.id,s.away_team_id);
      const games=S.games.filter(g=>g.series_id===s.id).sort((a,b)=>(a.series_game_number||0)-(b.series_game_number||0));
      const wild=home?.slug==='wildman-hockey'||away?.slug==='wildman-hockey';
      const seedLabel=String(s.session_label||'').split('·').slice(1).join('·').trim()||'Round 1';
      return `<article class="pro-playoff-series ${wild?'is-wildman':''}">
        <div class="pro-playoff-head"><span>MATCHUP ${i+1}</span><strong>${esc(seedLabel.toUpperCase())}</strong></div>
        <div class="pro-playoff-team"><div>${teamLogo(away)}<span><b>${esc(away?.name||'TBD')}</b><small>Seed ${esc(awayEt?.playoff_seed??'—')} · ${esc(awayEt?.group_play_record||teamRecord(e.id,away?.id))}</small></span></div><em>${s.away_wins||0}</em></div>
        <div class="pro-playoff-team"><div>${teamLogo(home)}<span><b>${esc(home?.name||'TBD')}</b><small>Seed ${esc(homeEt?.playoff_seed??'—')} · ${esc(homeEt?.group_play_record||teamRecord(e.id,home?.id))}</small></span></div><em>${s.home_wins||0}</em></div>
        <div class="pro-playoff-games">${games.map(g=>`<a href="${gameHref(g)}"><span>G${g.series_game_number}${g.if_necessary?' · IF NEC.':''}</span><b>${esc(fmtTime(g.scheduled_at))}</b>${g.stream_url?'<i>STREAM</i>':''}</a>`).join('')}</div>
      </article>`;
    }).join('')}</div>`;
  }
  function renderSchedule(){
    const root=$('proSeriesSchedule'),e=roadEvent(); if(!root||!e)return;
    const playoffs=playoffGameRows(e);
    const seen=new Set();
    const rows=(playoffs.length?playoffs:S.games.filter(g=>g.event_id===e.id&&!['cancelled','postponed'].includes(g.status)))
      .filter(g=>{const key=g.external_game_id||g.id;if(seen.has(key))return false;seen.add(key);return true;})
      .sort((a,b)=>new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0)||(a.broadcast_order||0)-(b.broadcast_order||0));
    if(!rows.length){root.innerHTML='<div class="empty-state">Official schedule has not been imported yet.</div>';return;}
    const groups=[];
    for(const g of rows){
      const key=new Date(g.scheduled_at).toISOString().slice(0,16);
      let bucket=groups.find(x=>x.key===key);
      if(!bucket){bucket={key,label:fmtSlot(g.scheduled_at),rows:[]};groups.push(bucket);}
      bucket.rows.push(g);
    }
    const finalCount=rows.filter(g=>g.status==='final').length;
    const playoffMode=playoffs.length>0;
    root.innerHTML=`
      <div class="pro-time-tabs">${groups.map((g,i)=>`<button type="button" class="${i===0?'active':''}" data-pro-slot="${esc(g.key)}">${esc(g.label)}</button>`).join('')}</div>
      <div class="pro-schedule-meta"><strong>${playoffMode?'SEASON 14 · ROUND 1 PLAYOFFS':'SEASON 14 · GROUP PLAY'}</strong><span>${finalCount} finals · ${rows.length} official game slots loaded${playoffMode?' · best-of-5 series':''}</span></div>
      ${groups.map((g,i)=>`<div class="pro-matchup-grid" data-pro-slot-panel="${esc(g.key)}" ${i?'hidden':''}>${g.rows.map(game=>{
        const home=team(game.home_team_id),away=team(game.away_team_id);
        const wild=home?.slug==='wildman-hockey'||away?.slug==='wildman-hockey';
        const final=game.status==='final';
        const awayWin=final&&Number(game.away_score)>Number(game.home_score);
        const homeWin=final&&Number(game.home_score)>Number(game.away_score);
        return `<a class="pro-matchup-card ${wild?'is-wildman':''}" href="${gameHref(game)}">
          <div class="pro-match-team ${awayWin?'is-winner':''}">${teamLogo(away)}<span>${esc(away?.name||'TBD')}</span></div>
          <div class="pro-match-mid"><b>${final?`${game.away_score??0}–${game.home_score??0}`:'@'}</b><small>G${game.series_game_number||1} · ${esc(fmtTime(game.scheduled_at))}${game.if_necessary?' · IF NEC.':''}</small></div>
          <div class="pro-match-team home ${homeWin?'is-winner':''}">${teamLogo(home)}<span>${esc(home?.name||'TBD')}</span></div>
          <em>${game.stream_url?'STREAM · ':''}${game.status==='scheduled'?'GAME CENTER →':game.status==='live'?'LIVE NOW →':'FINAL →'}</em>
        </a>`;
      }).join('')}</div>`).join('')}`;
    root.querySelectorAll('[data-pro-slot]').forEach(btn=>btn.onclick=()=>{
      root.querySelectorAll('[data-pro-slot]').forEach(x=>x.classList.toggle('active',x===btn));
      root.querySelectorAll('[data-pro-slot-panel]').forEach(p=>p.hidden=p.dataset.proSlotPanel!==btn.dataset.proSlot);
    });
  }

  function renderStories(){
    const root=$('proStoryGrid'),e=roadEvent(); if(!root||!e)return;
    const configs=[
      {
        gameId:'919748',tag:'BIGGEST SEED-LINE UPSET',title:'SHAKE N BAKE BLOWS THE DOORS OFF EMPIRE',
        copy:(g,w,l,ws,ls)=>`Pre-event No. ${ws} Shake N Bake did not sneak past No. ${ls} Empire. They hammered them ${Math.max(g.home_score,g.away_score)}-${Math.min(g.home_score,g.away_score)}. A 27-place seed gap and a five-goal margin made this the loudest upset of group play.`
      },
      {
        gameId:'919663',tag:'WILDMAN SPOTLIGHT',title:'WILDMAN MAKES AN EARLY STATEMENT',
        copy:(g,w,l,ws,ls)=>`Wildman entered as the No. ${ws} pre-event seed and opened group play by taking down No. ${ls} Entourage 3-1. The 16-place seed gap made it one of the clearest early signals that the original field order was not going to survive the night untouched.`
      },
      {
        gameId:'919734',tag:'SHUTOUT UPSET',title:'TREK GAMING SLAMS THE DOOR ON BIGS',
        copy:(g,w,l,ws,ls)=>`No. ${ws} TreK Gaming blanked No. ${ls} Bigs 3-0. Upsets are irritating enough for the favorite; getting zero on the board adds a little extra human suffering for presentation value.`
      },
      {
        gameId:'919738',tag:'ONE-GOAL KNIFE FIGHT',title:'P R X P H E C Y STEALS A 1-0 DECISION',
        copy:(g,w,l,ws,ls)=>`Pre-event No. ${ws} P R X P H E C Y squeezed out a 1-0 win over No. ${ls} 9th Wonder. No track meet, no seven-goal chaos, just a single goal holding up for one of the cleanest defensive upsets on the board.`
      },
      {
        gameId:'919768',tag:'HEAVYWEIGHT GAME',title:'PRODIGY FINISHES THE JOB AGAINST KLUTCH KREW',
        copy:(g,w,l,ws,ls)=>`Prodigy and Klutch Krew finished Race 4 with two of the best records in the tournament. Their head-to-head ended 2-1 for Prodigy, the result that helped cap a perfect 7-0 group stage while Klutch finished 6-1.`
      },
      {
        gameId:'919665',tag:'TOP-SEED STATEMENT',title:'THE UNDERDOGS LOOK EVERY BIT THE PART',
        copy:(g,w,l,ws,ls)=>`The pre-event No. ${ws} seed handled Final Form 4-1 and eventually completed a 7-0 group stage. Final Form still finished 5-2, which makes this less of a routine favorite win and more of a reminder that The Underdogs separated from a legitimately strong opponent.`
      }
    ];
    const stories=configs.map(cfg=>{
      const g=S.games.find(x=>x.event_id===e.id&&String(x.external_game_id||'')===cfg.gameId);
      if(!g||g.status!=='final')return '';
      const home=team(g.home_team_id),away=team(g.away_team_id);
      const winner=Number(g.home_score)>Number(g.away_score)?home:away;
      const loser=winner?.id===home?.id?away:home;
      const ws=preSeed(e.id,winner?.id),ls=preSeed(e.id,loser?.id);
      return `<article class="pro-story-card">
        <div class="pro-story-tag">${esc(cfg.tag)}</div>
        <div class="pro-story-match">
          <div class="pro-story-team">${teamLogo(home)}<span>${esc(home?.name||'TBD')}</span><small>Pre-event #${esc(preSeed(e.id,home?.id)??'—')} · ${esc(teamRecord(e.id,home?.id))}</small></div>
          <div class="pro-story-score"><strong>${esc(g.home_score??0)}–${esc(g.away_score??0)}</strong><small>FINAL</small></div>
          <div class="pro-story-team">${teamLogo(away)}<span>${esc(away?.name||'TBD')}</span><small>Pre-event #${esc(preSeed(e.id,away?.id)??'—')} · ${esc(teamRecord(e.id,away?.id))}</small></div>
        </div>
        <div class="pro-story-copy"><h3>${esc(cfg.title)}</h3><p>${esc(cfg.copy(g,winner,loser,ws,ls))}</p></div>
        <a class="pro-story-link" href="${gameHref(g)}">OPEN GAME CENTER →</a>
      </article>`;
    }).filter(Boolean);
    root.innerHTML=stories.length?stories.join(''):'<div class="empty-state">Tournament desk stories will appear as official finals are loaded.</div>';
  }

  function renderStandings(){
    const root=$('proStandings'),divRoot=$('proDivisions'),e=roadEvent(); if(!e)return;
    if(root){
      const playoffRows=S.eventTeams
        .filter(x=>x.event_id===e.id&&x.status==='playoffs')
        .sort((a,b)=>(a.playoff_matchup??99)-(b.playoff_matchup??99)||(a.playoff_seed??99)-(b.playoff_seed??99));
      if(playoffRows.length){
        root.innerHTML=`<div class="pro-playoff-field-head"><strong>ROUND 1 PLAYOFF FIELD</strong><span>${playoffRows.length} qualified · ${S.eventTeams.filter(x=>x.event_id===e.id&&x.status==='eliminated').length} eliminated after group play</span></div>
        <div class="wm-table-wrap"><table class="wm-table standings-table"><thead><tr><th>Matchup</th><th>Seed</th><th>Team</th><th>Group Record</th><th>Status</th></tr></thead><tbody>${playoffRows.map(r=>{
          const t=team(r.team_id);
          return `<tr class="${t?.slug==='wildman-hockey'?'is-wildman':''}"><td>R1 · M${r.playoff_matchup??'—'}</td><td><b>#${r.playoff_seed??'—'}</b></td><td><a class="pro-stand-team" href="${teamHref(t)}">${teamLogo(t)}<span>${esc(t?.name||'Team')}</span></a></td><td><b>${esc(r.group_play_record||teamRecord(e.id,r.team_id))}</b></td><td>PLAYOFFS</td></tr>`;
        }).join('')}</tbody></table></div>`;
      }else root.innerHTML='<div class="empty-state">Playoff field has not been loaded yet.</div>';
    }
    if(divRoot){
      const divisions=[1,2,3];
      divRoot.innerHTML=`<div class="pro-division-stack">${divisions.map(div=>{
        const rows=S.rankings.filter(x=>x.event_id===e.id&&x.division===div).sort((a,b)=>a.rank-b.rank);
        return `<section class="pro-division-card division-${div}"><div class="pro-division-head"><div><small>ESHL HISTORY · PRO SERIES FIELD</small><h3>DIVISION ${div}</h3></div><span>${rows.length} TEAMS</span></div><div class="wm-table-wrap"><table class="wm-table"><thead><tr><th>Rank</th><th>Team</th><th>ESHL Pts</th><th>Events</th><th>Record</th><th>Top 8</th></tr></thead><tbody>${rows.map(r=>{
          const t=team(r.team_id); return `<tr class="${t?.slug==='wildman-hockey'?'is-wildman':''}"><td><b>#${r.rank}</b></td><td><a class="pro-stand-team" href="${teamHref(t)}">${teamLogo(t)}<span>${esc(t?.name||'Team')}</span></a></td><td><b>${Number(r.eshl_points||0).toLocaleString()}</b></td><td>${r.events||0}</td><td>${esc(r.career_record||'0-0-0')}</td><td>${r.top8||0}</td></tr>`;
        }).join('')}</tbody></table></div></section>`;
      }).join('')}</div>`;
    }
  }
  function renderLeaderboard(){
    const skaterRoot=$('proSkaterLeaderboard'),goalieRoot=$('proGoalieLeaderboard'),e=roadEvent(); if(!e)return;
    const allEventRows=S.playerStats.filter(x=>x.event_id===e.id);
    const officialRows=allEventRows.filter(x=>String(x.source_provider||'').startsWith('leaguegaming-official-player-stats'));
    const eventRows=officialRows.length?officialRows:allEventRows;
    const isGoalie=r=>{
      const pos=String(rosterPos(e.id,r.player_id)||'').toUpperCase();
      return pos==='G'||Number(r.goalie_shots||0)>0||Number(r.goalie_saves||0)>0;
    };
    if(skaterRoot){
      const rows=eventRows.filter(r=>!isGoalie(r)).sort((a,b)=>b.points-a.points||b.goals-a.goals||b.assists-a.assists||(b.plus_minus||0)-(a.plus_minus||0)).slice(0,100);
      skaterRoot.innerHTML=rows.length?`<div class="wm-table-wrap"><table class="wm-table pro-leader-table"><thead><tr><th>#</th><th>Skater</th><th>Team</th><th>GP</th><th>G</th><th>A</th><th>P</th><th>P/GP</th><th>+/-</th><th>S</th></tr></thead><tbody>${rows.map((r,i)=>{
        const p=player(r.player_id),t=team(r.team_id),ppg=r.games_played?Number(r.points||0)/r.games_played:0;
        return `<tr><td><b>${i+1}</b></td><td><a href="esports-player.html?id=${encodeURIComponent(r.player_id)}">${esc(p?.gamertag||'Player')}</a><small class="pro-leader-pos">${esc(rosterPos(e.id,r.player_id)||'F')}</small></td><td><a class="pro-stand-team compact" href="${teamHref(t)}">${teamLogo(t)}<span>${esc(t?.name||'—')}</span></a></td><td>${r.games_played}</td><td>${r.goals}</td><td>${r.assists}</td><td><b>${r.points}</b></td><td>${ppg.toFixed(2)}</td><td>${r.plus_minus??'—'}</td><td>${r.shots??'—'}</td></tr>`;
      }).join('')}</tbody></table></div>`:'<div class="empty-state">Skater leaderboard is wired and ready. It will populate automatically as Week 3 game stats are finalized.</div>';
    }
    if(goalieRoot){
      const rows=eventRows.filter(isGoalie).sort((a,b)=>b.wins-a.wins||(Number(b.save_pct)||0)-(Number(a.save_pct)||0)||(a.goalie_goals_against||999)-(b.goalie_goals_against||999)).slice(0,50);
      goalieRoot.innerHTML=rows.length?`<div class="wm-table-wrap"><table class="wm-table pro-leader-table"><thead><tr><th>#</th><th>Goalie</th><th>Team</th><th>GP</th><th>W</th><th>L</th><th>OTL</th><th>Shots</th><th>Saves</th><th>GA</th><th>SV%</th></tr></thead><tbody>${rows.map((r,i)=>{
        const p=player(r.player_id),t=team(r.team_id),pct=r.save_pct!=null?Number(r.save_pct):(r.goalie_shots?Number(r.goalie_saves||0)/Number(r.goalie_shots):null);
        return `<tr><td><b>${i+1}</b></td><td><a href="esports-player.html?id=${encodeURIComponent(r.player_id)}">${esc(p?.gamertag||'Goalie')}</a></td><td><a class="pro-stand-team compact" href="${teamHref(t)}">${teamLogo(t)}<span>${esc(t?.name||'—')}</span></a></td><td>${r.games_played}</td><td><b>${r.wins}</b></td><td>${r.losses}</td><td>${r.ot_losses}</td><td>${r.goalie_shots??'—'}</td><td>${r.goalie_saves??'—'}</td><td>${r.goalie_goals_against??'—'}</td><td><b>${pct==null?'—':(pct*100).toFixed(1)+'%'}</b></td></tr>`;
      }).join('')}</tbody></table></div>`:'<div class="empty-state">Goalie leaderboard is wired and ready. Wins, saves and save percentage will appear automatically after finalized games.</div>';
    }
  }
  function renderCounts(){
    const e=roadEvent(); if(!e)return; const playoffGames=playoffGameRows(e); const games=playoffGames.length?playoffGames:S.games.filter(g=>g.event_id===e.id); const set=(id,v)=>{if($(id))$(id).textContent=v;};
    set('proGameCount',games.length); set('liveBroadcastCount',games.filter(g=>g.status==='live'&&g.stream_url).length+publicSources().length);
  }

  async function load(){
    const [events,teams,players,games,series,sources,teamStats,playerStats,eventTeams,rosters,rankings]=await Promise.all([
      db.from('esports_events').select('*').eq('active',true),
      db.from('esports_teams').select('*').eq('active',true),
      db.from('esports_players').select('*').eq('active',true),
      db.from('esports_games').select('*'),
      db.from('esports_series').select('*'),
      db.from('tournament_automation_sources').select('*').eq('active',true).eq('public_visible',true).order('slot_order'),
      db.from('esports_team_event_stats').select('*'),
      db.from('esports_player_event_stats').select('*'),
      db.from('esports_event_teams').select('*'),
      db.from('esports_event_rosters').select('*').eq('active',true),
      db.from('esports_event_rankings').select('*')
    ]);
    const all=[events,teams,players,games,series,sources,teamStats,playerStats,eventTeams,rosters,rankings];
    if(all.some(x=>x.error)){console.error('Tournament live refresh failed',all.map(x=>x.error));return;}
    Object.assign(S,{
      events:events.data||[],teams:teams.data||[],players:players.data||[],games:games.data||[],series:series.data||[],sources:sources.data||[],
      teamStats:teamStats.data||[],playerStats:playerStats.data||[],eventTeams:eventTeams.data||[],
      rosters:rosters.data||[],rankings:rankings.data||[]
    });
    renderChannelPicker();renderFeatured();renderBoard();renderPlayoffs();renderSchedule();renderStories();renderStandings();renderLeaderboard();renderCounts();
    const stamp=$('liveRefreshStamp'); if(stamp)stamp.textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}`;
  }
  load();
  setInterval(()=>{if(!document.hidden)load();},10000);
})();