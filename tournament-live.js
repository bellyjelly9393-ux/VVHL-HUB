(() => {
  const URL='https://lrgllzvwgvqagcpiyvfd.supabase.co';
  const KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
  const db=window.VVHLBackend?.db || (window.supabase?window.supabase.createClient(URL,KEY):null);
  if(!db) return;
  const S={events:[],teams:[],players:[],games:[],teamStats:[],playerStats:[],eventTeams:[],rosters:[],rankings:[]};
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
    const seen=new Set();
    const rows=S.games
      .filter(g=>g.event_id===e.id&&!['cancelled','postponed'].includes(g.status))
      .filter(g=>{
        const key=g.external_game_id||g.id;
        if(seen.has(key))return false;
        seen.add(key);return true;
      })
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
    root.innerHTML=`
      <div class="pro-time-tabs">${groups.map((g,i)=>`<button type="button" class="${i===0?'active':''}" data-pro-slot="${esc(g.key)}">${esc(g.label)}</button>`).join('')}</div>
      <div class="pro-schedule-meta"><strong>SEASON 14 · GROUP PLAY</strong><span>${finalCount} finals · ${rows.length} official matchups loaded</span></div>
      ${groups.map((g,i)=>`<div class="pro-matchup-grid" data-pro-slot-panel="${esc(g.key)}" ${i?'hidden':''}>${g.rows.map(game=>{
        const home=team(game.home_team_id),away=team(game.away_team_id);
        const wild=home?.slug==='wildman-hockey'||away?.slug==='wildman-hockey';
        const final=game.status==='final';
        const awayWin=final&&Number(game.away_score)>Number(game.home_score);
        const homeWin=final&&Number(game.home_score)>Number(game.away_score);
        return `<a class="pro-matchup-card ${wild?'is-wildman':''}" href="${gameHref(game)}">
          <div class="pro-match-team ${awayWin?'is-winner':''}">${teamLogo(away)}<span>${esc(away?.name||'TBD')}</span></div>
          <div class="pro-match-mid"><b>${final?`${game.away_score??0}–${game.home_score??0}`:'@'}</b><small>${esc(fmtTime(game.scheduled_at))}</small></div>
          <div class="pro-match-team home ${homeWin?'is-winner':''}">${teamLogo(home)}<span>${esc(home?.name||'TBD')}</span></div>
          <em>${game.status==='scheduled'?'GAME CENTER →':game.status==='live'?'LIVE NOW →':'FINAL →'}</em>
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
      const races=['Race 1','Race 2','Race 3','Race 4'];
      root.innerHTML=`<div class="pro-race-grid">${races.map(race=>{
        const ids=S.eventTeams.filter(x=>x.event_id===e.id&&x.group_name===race).map(x=>x.team_id);
        const rows=S.teamStats.filter(x=>x.event_id===e.id&&ids.includes(x.team_id)).sort((a,b)=>b.points-a.points||b.wins-a.wins||((b.goals_for-b.goals_against)-(a.goals_for-a.goals_against))||(a.seed??99)-(b.seed??99));
        return `<section class="pro-race-card"><div class="pro-race-head"><small>REGULAR SEASON</small><h3>${esc(race)}</h3></div><div class="wm-table-wrap"><table class="wm-table standings-table"><thead><tr><th>#</th><th>Team</th><th>GP</th><th>W</th><th>L</th><th>OTL</th><th>GD</th><th>PTS</th></tr></thead><tbody>${rows.map((r,i)=>{
          const t=team(r.team_id); return `<tr class="${t?.slug==='wildman-hockey'?'is-wildman':''}"><td>${i+1}</td><td><a class="pro-stand-team" href="${teamHref(t)}">${teamLogo(t)}<span>${esc(t?.name||'Team')}</span></a></td><td>${r.games_played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.ot_losses}</td><td>${r.goals_for-r.goals_against}</td><td><b>${r.points}</b></td></tr>`;
        }).join('')}</tbody></table></div></section>`;
      }).join('')}</div>`;
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
    const e=roadEvent(); if(!e)return; const games=S.games.filter(g=>g.event_id===e.id); const set=(id,v)=>{if($(id))$(id).textContent=v;};
    set('proGameCount',games.length); set('liveBroadcastCount',games.filter(g=>g.status==='live').length);
  }

  async function load(){
    const [events,teams,players,games,teamStats,playerStats,eventTeams,rosters,rankings]=await Promise.all([
      db.from('esports_events').select('*').eq('active',true),
      db.from('esports_teams').select('*').eq('active',true),
      db.from('esports_players').select('*').eq('active',true),
      db.from('esports_games').select('*'),
      db.from('esports_team_event_stats').select('*'),
      db.from('esports_player_event_stats').select('*'),
      db.from('esports_event_teams').select('*'),
      db.from('esports_event_rosters').select('*').eq('active',true),
      db.from('esports_event_rankings').select('*')
    ]);
    const all=[events,teams,players,games,teamStats,playerStats,eventTeams,rosters,rankings];
    if(all.some(x=>x.error)){console.error('Tournament live refresh failed',all.map(x=>x.error));return;}
    Object.assign(S,{
      events:events.data||[],teams:teams.data||[],players:players.data||[],games:games.data||[],
      teamStats:teamStats.data||[],playerStats:playerStats.data||[],eventTeams:eventTeams.data||[],
      rosters:rosters.data||[],rankings:rankings.data||[]
    });
    renderFeatured();renderBoard();renderSchedule();renderStories();renderStandings();renderLeaderboard();renderCounts();
    const stamp=$('liveRefreshStamp'); if(stamp)stamp.textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}`;
  }
  load();
  setInterval(()=>{if(!document.hidden)load();},10000);
})();