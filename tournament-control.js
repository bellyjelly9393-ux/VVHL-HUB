(() => {
  const db = window.VVHLBackend?.db;
  if (!db) return;
  const S = {events:[],teams:[],players:[],eventTeams:[],rosters:[],games:[],gameStats:[],backlog:[],eventId:""};
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
  const slugify = v => String(v||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const lower = v => String(v||"").toLowerCase();
  const num = (id, fallback=0) => { const n = Number($(id)?.value); return Number.isFinite(n) ? n : fallback; };
  const msg = (id,text,bad=false) => { const el=$(id); if(el){el.textContent=text; el.style.color=bad?'#ff9a9a':'#9ff4bc';} };
  const selectedEvent = () => S.events.find(e=>e.id===S.eventId);
  const teamById = id => S.teams.find(t=>t.id===id);
  const playerById = id => S.players.find(p=>p.id===id);
  const gameById = id => S.games.find(g=>g.id===id);
  const parseLine = line => {
    const delimiter = line.includes('|') ? '|' : line.includes('\t') ? '\t' : ',';
    return line.split(delimiter).map(x=>x.trim());
  };
  const parseRows = text => String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(parseLine);
  const gameLabel = g => {
    const h=teamById(g.home_team_id)?.name||'TBD', a=teamById(g.away_team_id)?.name||'TBD';
    const d=g.scheduled_at?new Date(g.scheduled_at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'TBD';
    return `${d} · ${h} vs ${a}`;
  };
  const currentEventRosters = () => S.rosters.filter(r=>r.event_id===S.eventId && r.active!==false);
  const currentEventGames = () => S.games.filter(g=>g.event_id===S.eventId).sort((a,b)=>new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0));

  async function loadData(){
    const [events,teams,players,eventTeams,rosters,games,gameStats,backlog] = await Promise.all([
      db.from('esports_events').select('*').eq('active',true).order('starts_on'),
      db.from('esports_teams').select('*').eq('active',true).order('name'),
      db.from('esports_players').select('*').eq('active',true).order('gamertag'),
      db.from('esports_event_teams').select('*'),
      db.from('esports_event_rosters').select('*'),
      db.from('esports_games').select('*').order('scheduled_at'),
      db.from('esports_game_player_stats').select('*'),
      db.from('site_backlog').select('*').neq('status','done').order('created_at',{ascending:false})
    ]);
    const errors=[events,teams,players,eventTeams,rosters,games,gameStats,backlog].map(x=>x.error).filter(Boolean);
    if(errors.length){ console.error(errors); return; }
    Object.assign(S,{events:events.data||[],teams:teams.data||[],players:players.data||[],eventTeams:eventTeams.data||[],rosters:rosters.data||[],games:games.data||[],gameStats:gameStats.data||[],backlog:backlog.data||[]});
    if(!S.eventId || !S.events.some(e=>e.id===S.eventId)) S.eventId=S.events.find(e=>e.slug==='road-to-pro-2026')?.id || S.events[0]?.id || '';
    render();
  }

  function render(){
    const event=selectedEvent();
    if($('controlEventName')) $('controlEventName').textContent=event?.name||'No event';
    if($('controlTeamCount')) $('controlTeamCount').textContent=new Set(S.eventTeams.filter(x=>x.event_id===S.eventId).map(x=>x.team_id)).size;
    if($('controlPlayerCount')) $('controlPlayerCount').textContent=new Set(currentEventRosters().map(x=>x.player_id)).size;
    if($('controlGameCount')) $('controlGameCount').textContent=currentEventGames().length;
    if($('controlLiveCount')) $('controlLiveCount').textContent=currentEventGames().filter(x=>x.status==='live').length;
    const eventSelect=$('controlEventSelect');
    if(eventSelect){ eventSelect.innerHTML=S.events.map(e=>`<option value="${e.id}" ${e.id===S.eventId?'selected':''}>${esc(e.name)}</option>`).join(''); }
    renderGameSelects(); renderBroadcastList(); renderBacklog();
  }

  function renderGameSelects(){
    const games=currentEventGames();
    ['broadcastGameSelect','statGameSelect'].forEach(id=>{
      const el=$(id); if(!el) return;
      const prev=el.value;
      el.innerHTML=games.length?games.map(g=>`<option value="${g.id}" ${g.id===prev?'selected':''}>${esc(gameLabel(g))}</option>`).join(''):'<option value="">No games loaded</option>';
      if(prev && games.some(g=>g.id===prev)) el.value=prev;
    });
    loadBroadcastForm(); populateStatPlayers();
  }

  function renderBroadcastList(){
    const root=$('broadcastGameList'); if(!root) return;
    root.innerHTML=currentEventGames().length?currentEventGames().map(g=>{
      const h=teamById(g.home_team_id)?.name||'TBD', a=teamById(g.away_team_id)?.name||'TBD';
      return `<div class="broadcast-item"><div><strong>${esc(h)} vs ${esc(a)}</strong><small>${esc(g.status.toUpperCase())}${g.stream_url?' · STREAM SET':''}${g.featured?' · FEATURED':''} · ${esc(gameLabel(g).split(' · ')[0])}</small></div><button class="small-btn" type="button" data-edit-game="${g.id}">Edit</button></div>`;
    }).join(''):'<div class="empty-state">No schedule loaded yet.</div>';
    root.querySelectorAll('[data-edit-game]').forEach(btn=>btn.onclick=()=>{ $('broadcastGameSelect').value=btn.dataset.editGame; loadBroadcastForm(); $('broadcast').scrollIntoView({behavior:'smooth'}); });
  }

  function renderBacklog(){
    const root=$('backlogList'); if(!root) return;
    root.innerHTML=S.backlog.length?S.backlog.map(x=>`<div class="backlog-item"><div><span class="backlog-priority">${esc(x.area)} · ${esc(x.priority.replaceAll('_',' '))}</span><strong>${esc(x.title)}</strong><small>${esc(x.notes||x.deferred_reason||'Queued for after tournament operations.')}</small></div><span class="status-pill">${esc(x.status.toUpperCase())}</span></div>`).join(''):'<div class="empty-state">Queue is empty. Miracles happen.</div>';
  }

  async function ensureTeams(names){
    const map=new Map(S.teams.map(t=>[slugify(t.name),t]));
    const missing=[...new Set(names.map(x=>String(x||'').trim()).filter(Boolean))].filter(n=>!map.has(slugify(n)));
    if(missing.length){
      const payload=missing.map(name=>({slug:slugify(name),name,team_type:'external',active:true,source_provider:'manual'}));
      const {data,error}=await db.from('esports_teams').upsert(payload,{onConflict:'slug'}).select();
      if(error) throw error;
      (data||[]).forEach(t=>map.set(t.slug,t));
    }
    return map;
  }

  async function importRosters(){
    try{
      msg('rosterImportMessage','Importing…');
      let rows=parseRows($('rosterImportText').value).filter(r=>r.length>=2);
      rows=rows.filter(r=>!lower(r[0]).includes('team name') && lower(r[1])!=='gamertag');
      if(!rows.length) throw new Error('Paste at least one roster row.');
      const teams=await ensureTeams(rows.map(r=>r[0]));
      const existingPlayers=new Map(S.players.map(p=>[slugify(p.gamertag),p]));
      const missing=[];
      const seen=new Set();
      for(const r of rows){ const gt=r[1]; const key=slugify(gt); if(gt && !existingPlayers.has(key) && !seen.has(key)){seen.add(key); missing.push({slug:key,gamertag:gt,display_name:gt,platform:r[3]||null,primary_position:r[2]||null,source_provider:'manual',active:true});} }
      if(missing.length){
        const {data,error}=await db.from('esports_players').upsert(missing,{onConflict:'slug'}).select(); if(error) throw error;
        (data||[]).forEach(p=>existingPlayers.set(p.slug,p));
      }
      const eventTeamRows=[]; const rosterRows=[];
      for(const r of rows){
        const team=teams.get(slugify(r[0])); const player=existingPlayers.get(slugify(r[1])); if(!team||!player) continue;
        eventTeamRows.push({event_id:S.eventId,team_id:team.id,status:'active'});
        rosterRows.push({event_id:S.eventId,team_id:team.id,player_id:player.id,position:r[2]||null,roster_status:'active',active:true});
      }
      const uniqueTeams=[...new Map(eventTeamRows.map(x=>[x.team_id,x])).values()];
      let res=await db.from('esports_event_teams').upsert(uniqueTeams,{onConflict:'event_id,team_id'}); if(res.error) throw res.error;
      res=await db.from('esports_event_rosters').upsert(rosterRows,{onConflict:'event_id,team_id,player_id'}); if(res.error) throw res.error;
      msg('rosterImportMessage',`Imported ${rosterRows.length} roster rows across ${uniqueTeams.length} teams.`); await loadData();
    }catch(e){ console.error(e); msg('rosterImportMessage',e.message||'Roster import failed.',true); }
  }

  async function importSchedule(){
    try{
      msg('scheduleImportMessage','Importing…');
      let rows=parseRows($('scheduleImportText').value).filter(r=>r.length>=3);
      rows=rows.filter(r=>!lower(r[0]).includes('date'));
      if(!rows.length) throw new Error('Paste at least one schedule row.');
      const teams=await ensureTeams(rows.flatMap(r=>[r[1],r[2]]));
      const event=selectedEvent(); const payload=[]; const eventTeamRows=[];
      rows.forEach((r,i)=>{
        const home=teams.get(slugify(r[1])), away=teams.get(slugify(r[2])); if(!home||!away) return;
        const local=new Date(String(r[0]).trim().replace(' ','T')); if(Number.isNaN(local.getTime())) throw new Error(`Invalid date/time: ${r[0]}`);
        const external=`${event?.slug||'event'}-${slugify(r[0])}-${home.slug}-${away.slug}`;
        payload.push({event_id:S.eventId,home_team_id:home.id,away_team_id:away.id,scheduled_at:local.toISOString(),status:'scheduled',stage:r[3]||'Tournament',round_label:r[4]||null,best_of:Number(r[5])||1,source_provider:'manual',external_game_id:external});
        eventTeamRows.push({event_id:S.eventId,team_id:home.id,status:'active'},{event_id:S.eventId,team_id:away.id,status:'active'});
      });
      const uniqueTeams=[...new Map(eventTeamRows.map(x=>[x.team_id,x])).values()];
      let res=await db.from('esports_event_teams').upsert(uniqueTeams,{onConflict:'event_id,team_id'}); if(res.error) throw res.error;
      res=await db.from('esports_games').upsert(payload,{onConflict:'source_provider,external_game_id'}); if(res.error) throw res.error;
      msg('scheduleImportMessage',`Imported ${payload.length} matchups.`); await loadData();
    }catch(e){console.error(e);msg('scheduleImportMessage',e.message||'Schedule import failed.',true);}
  }

  function loadBroadcastForm(){
    const g=gameById($('broadcastGameSelect')?.value); if(!g) return;
    $('broadcastStatus').value=g.status||'scheduled'; $('broadcastProvider').value=g.stream_provider||'';
    $('broadcastHomeScore').value=g.home_score??0; $('broadcastAwayScore').value=g.away_score??0;
    $('broadcastPeriod').value=g.period??''; $('broadcastClock').value=g.clock||''; $('broadcastCommentary').value=g.commentary_status||'none';
    $('broadcastStreamUrl').value=g.stream_url||''; $('broadcastTitle').value=g.broadcast_title||''; $('broadcastVodUrl').value=g.vod_url||'';
    $('broadcastFeatured').checked=!!g.featured; $('broadcastOvertime').checked=!!g.overtime;
  }

  async function saveBroadcast(){
    try{
      const id=$('broadcastGameSelect').value; const g=gameById(id); if(!g) throw new Error('Choose a game first.');
      msg('broadcastMessage','Publishing…');
      if($('broadcastFeatured').checked){ const clear=await db.from('esports_games').update({featured:false}).eq('event_id',g.event_id).neq('id',id); if(clear.error) throw clear.error; }
      const update={status:$('broadcastStatus').value,stream_provider:$('broadcastProvider').value||null,stream_url:$('broadcastStreamUrl').value.trim()||null,broadcast_title:$('broadcastTitle').value.trim()||null,commentary_status:$('broadcastCommentary').value,home_score:num('broadcastHomeScore'),away_score:num('broadcastAwayScore'),period:$('broadcastPeriod').value?num('broadcastPeriod'):null,clock:$('broadcastClock').value.trim()||null,featured:$('broadcastFeatured').checked,overtime:$('broadcastOvertime').checked,vod_url:$('broadcastVodUrl').value.trim()||null,updated_at:new Date().toISOString()};
      const res=await db.from('esports_games').update(update).eq('id',id); if(res.error) throw res.error;
      msg('broadcastMessage','Published. Public Game Center will pick up the update automatically.'); await rebuildEventStats(g.event_id); await loadData();
    }catch(e){console.error(e);msg('broadcastMessage',e.message||'Broadcast update failed.',true);}
  }

  function populateStatPlayers(){
    const game=gameById($('statGameSelect')?.value); const playerSelect=$('statPlayerSelect'); if(!playerSelect) return;
    if(!game){ playerSelect.innerHTML='<option value="">No game selected</option>'; return; }
    const rows=currentEventRosters().filter(r=>r.team_id===game.home_team_id||r.team_id===game.away_team_id);
    const prev=playerSelect.value;
    playerSelect.innerHTML=rows.map(r=>{const p=playerById(r.player_id),t=teamById(r.team_id);return `<option value="${r.player_id}" ${r.player_id===prev?'selected':''}>${esc(p?.gamertag||'Player')} · ${esc(r.position||p?.primary_position||'TBD')} · ${esc(t?.name||'Team')}</option>`;}).join('')||'<option value="">No roster players loaded</option>';
    loadStatForm();
  }

  function loadStatForm(){
    const gameId=$('statGameSelect')?.value, playerId=$('statPlayerSelect')?.value;
    const s=S.gameStats.find(x=>x.game_id===gameId&&x.player_id===playerId)||{};
    const fields={statGoals:'goals',statAssists:'assists',statPlusMinus:'plus_minus',statShots:'shots',statHits:'hits',statTakeaways:'takeaways',statGiveaways:'giveaways',statPim:'pim',statFoWins:'faceoff_wins',statFoLosses:'faceoff_losses',statGoalieSaves:'goalie_saves',statGoalieShots:'goalie_shots'};
    Object.entries(fields).forEach(([id,key])=>{if($(id)) $(id).value=s[key]??0;});
  }

  async function savePlayerStats(){
    try{
      const game=gameById($('statGameSelect').value), player=playerById($('statPlayerSelect').value); if(!game||!player) throw new Error('Choose a game and player.');
      const roster=currentEventRosters().find(r=>r.player_id===player.id&&(r.team_id===game.home_team_id||r.team_id===game.away_team_id));
      const goals=num('statGoals'),assists=num('statAssists'),goalieShots=num('statGoalieShots'),goalieSaves=num('statGoalieSaves');
      const row={game_id:game.id,event_id:game.event_id,team_id:roster?.team_id||null,player_id:player.id,position:roster?.position||player.primary_position||null,goals,assists,points:goals+assists,plus_minus:num('statPlusMinus'),shots:num('statShots'),hits:num('statHits'),takeaways:num('statTakeaways'),giveaways:num('statGiveaways'),pim:num('statPim'),faceoff_wins:num('statFoWins'),faceoff_losses:num('statFoLosses'),goalie_saves:goalieSaves,goalie_shots:goalieShots,goalie_goals_against:Math.max(0,goalieShots-goalieSaves),save_pct:goalieShots?goalieSaves/goalieShots:null,source_provider:'manual',updated_at:new Date().toISOString()};
      msg('statMessage','Saving…'); const res=await db.from('esports_game_player_stats').upsert(row,{onConflict:'game_id,player_id'}); if(res.error) throw res.error;
      await rebuildEventStats(game.event_id); msg('statMessage',`${player.gamertag} saved and event totals rebuilt.`); await loadData();
    }catch(e){console.error(e);msg('statMessage',e.message||'Stat save failed.',true);}
  }

  async function rebuildEventStats(eventId=S.eventId){
    const [statsRes,gamesRes,eventTeamsRes]=await Promise.all([
      db.from('esports_game_player_stats').select('*').eq('event_id',eventId),
      db.from('esports_games').select('*').eq('event_id',eventId),
      db.from('esports_event_teams').select('*').eq('event_id',eventId)
    ]);
    if(statsRes.error) throw statsRes.error; if(gamesRes.error) throw gamesRes.error; if(eventTeamsRes.error) throw eventTeamsRes.error;
    const stats=statsRes.data||[], games=gamesRes.data||[];
    const pMap=new Map();
    for(const s of stats){
      const k=s.player_id; if(!pMap.has(k)) pMap.set(k,{event_id:eventId,team_id:s.team_id,player_id:k,games_played:0,wins:0,losses:0,ot_losses:0,goals:0,assists:0,points:0,plus_minus:0,shots:0,hits:0,takeaways:0,giveaways:0,interceptions:0,blocked_shots:0,pim:0,faceoff_wins:0,faceoff_losses:0,goalie_shots:0,goalie_saves:0,goalie_goals_against:0,source_provider:'manual',source_updated_at:new Date().toISOString()});
      const a=pMap.get(k); a.games_played++; ['goals','assists','points','plus_minus','shots','hits','takeaways','giveaways','interceptions','blocked_shots','pim','faceoff_wins','faceoff_losses','goalie_shots','goalie_saves','goalie_goals_against'].forEach(f=>a[f]+=(Number(s[f])||0));
      const g=games.find(x=>x.id===s.game_id); if(g?.status==='final'&&s.team_id){ const isHome=s.team_id===g.home_team_id, gf=isHome?g.home_score:g.away_score, ga=isHome?g.away_score:g.home_score; if(gf>ga)a.wins++;else if(gf<ga){if(g.overtime)a.ot_losses++;else a.losses++;} }
    }
    const playerRows=[...pMap.values()].map(a=>({...a,shooting_pct:a.shots?100*a.goals/a.shots:null,save_pct:a.goalie_shots?a.goalie_saves/a.goalie_shots:null,updated_at:new Date().toISOString()}));
    if(playerRows.length){ const r=await db.from('esports_player_event_stats').upsert(playerRows,{onConflict:'event_id,player_id'}); if(r.error) throw r.error; }
    const teamIds=[...new Set((eventTeamsRes.data||[]).map(x=>x.team_id))]; const tRows=[];
    for(const teamId of teamIds){
      let gp=0,w=0,l=0,otl=0,gf=0,ga=0;
      games.filter(g=>g.status==='final'&&(g.home_team_id===teamId||g.away_team_id===teamId)).forEach(g=>{const home=g.home_team_id===teamId, f=home?g.home_score:g.away_score, a=home?g.away_score:g.home_score;gp++;gf+=f;ga+=a;if(f>a)w++;else if(f<a){if(g.overtime)otl++;else l++;}});
      tRows.push({event_id:eventId,team_id:teamId,games_played:gp,wins:w,losses:l,ot_losses:otl,goals_for:gf,goals_against:ga,points:w*2+otl,updated_at:new Date().toISOString()});
    }
    tRows.sort((a,b)=>b.points-a.points||(b.goals_for-b.goals_against)-(a.goals_for-a.goals_against)||b.goals_for-a.goals_for).forEach((r,i)=>r.seed=i+1);
    if(tRows.length){ const r=await db.from('esports_team_event_stats').upsert(tRows,{onConflict:'event_id,team_id'}); if(r.error) throw r.error; }
  }

  async function addBacklog(){
    try{const title=$('backlogTitle').value.trim(); if(!title) throw new Error('Add a title first.'); const row={title,area:$('backlogArea').value.trim()||'general',priority:'after_tournament',status:'queued',notes:$('backlogNotes').value.trim()||null,deferred_reason:'Deferred while Road to Pro tournament hosting is the active priority.',created_by:window.VVHLBackend?.state?.user?.id||null}; const r=await db.from('site_backlog').insert(row); if(r.error) throw r.error; $('backlogTitle').value='';$('backlogArea').value='';$('backlogNotes').value='';msg('backlogMessage','Queued for after the tournament.');await loadData();}catch(e){msg('backlogMessage',e.message||'Could not queue item.',true);}
  }

  function bind(){
    $('controlEventSelect')?.addEventListener('change',e=>{S.eventId=e.target.value;render();});
    $('refreshControlBtn')?.addEventListener('click',loadData); $('importRostersBtn')?.addEventListener('click',importRosters); $('importScheduleBtn')?.addEventListener('click',importSchedule);
    $('broadcastGameSelect')?.addEventListener('change',loadBroadcastForm); $('saveBroadcastBtn')?.addEventListener('click',saveBroadcast);
    $('statGameSelect')?.addEventListener('change',populateStatPlayers); $('statPlayerSelect')?.addEventListener('change',loadStatForm); $('savePlayerStatsBtn')?.addEventListener('click',savePlayerStats);
    $('rebuildEventStatsBtn')?.addEventListener('click',async()=>{try{msg('statMessage','Rebuilding…');await rebuildEventStats();msg('statMessage','Event totals and standings rebuilt.');await loadData();}catch(e){msg('statMessage',e.message||'Rebuild failed.',true);}});
    $('addBacklogBtn')?.addEventListener('click',addBacklog);
  }

  bind();
  window.addEventListener('vvhl-auth-change',e=>{ if(window.VVHLManagementGuard?.hasAccess(e.detail)) loadData(); });
  if(window.VVHLManagementGuard?.hasAccess(window.VVHLBackend?.state)) loadData();
})();