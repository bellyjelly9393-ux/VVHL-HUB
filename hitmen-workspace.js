(() => {
  const TEAM_NAME = 'Calgary Hitmen';
  const SEASON = 'Season 55';
  const db = () => window.VVHLBackend?.db;
  const auth = () => window.VVHLBackend?.state || {};
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n = v => Number(v) || 0;
  const posLabel = v => ({center:'C',leftwing:'LW',rightwing:'RW',defensemen:'D',defenseman:'D',goalie:'G'})[String(v||'').toLowerCase()] || String(v||'—').toUpperCase();
  const S = {team:null,players:[],stats:new Map(),board:new Map(),reports:new Map(),sessions:[],games:[],selectedId:'',search:'',position:'all',loading:false};

  function setStatus(text,tone=''){
    const el=$('hitmenStatus'); if(!el)return;
    el.textContent=text; el.className=`hitmen-status ${tone}`.trim();
  }
  function userCanManageHitmen(){
    const state=auth(); if(!state.user||!S.team)return false;
    if(String(state.profile?.role||'').toLowerCase()==='admin') return true;
    return (state.memberships||[]).some(m=>m.team_id===S.team.id && m.active!==false && ['owner','gm','agm'].includes(String(m.role||'').toLowerCase()));
  }
  function enforceHitmenAccess(){
    const ok=userCanManageHitmen();
    document.querySelectorAll('[data-management-content]').forEach(el=>el.hidden=!ok);
    const locked=$('managementLockedMessage');
    if(locked){locked.hidden=ok;if(!ok&&auth().user)locked.innerHTML='<b>Calgary workspace access not assigned.</b><p>This private LGCHL workspace requires the site admin account or an Owner/GM/AGM membership on Calgary Hitmen.</p>';}
    return ok;
  }

  async function loadTeam(){
    const {data,error}=await db().from('teams').select('id,name,abbreviation,league_id,active,is_public,workspace_kind').eq('name',TEAM_NAME).maybeSingle();
    if(error) throw error;
    S.team=data;
    if(!S.team) throw new Error('Calgary Hitmen workspace is not available to this account.');
    return enforceHitmenAccess();
  }

  async function loadAll(){
    if(S.loading||!db()||!auth().user)return;
    S.loading=true;
    try{
      const allowed=await loadTeam();
      if(!allowed){setStatus('Calgary Hitmen workspace access is restricted.','error');return;}
      const uid=auth().user.id;
      const [players,stats,board,reports,sessions]=await Promise.all([
        db().from('scouting_players').select('id,gamertag,platform,primary_position,scouting_status,created_at').order('gamertag'),
        db().from('scouting_season_stats').select('scouting_player_id,season,phase,games_played,goals,assists,points,plus_minus,shots,hits,takeaways,giveaways,passing_pct,faceoff_pct,overall_rating').eq('season',SEASON),
        db().from('scouting_draft_board_entries').select('id,scouting_player_id,team_id,season,board_rank,tier,status,note,updated_at').eq('author_id',uid).eq('team_id',S.team.id).eq('season',SEASON),
        db().from('scouting_manual_reports').select('id,scouting_player_id,team_id,season,report_title,summary,strengths,concerns,projected_role,draft_grade,confidence,tags,updated_at').eq('author_id',uid).eq('team_id',S.team.id).eq('season',SEASON).order('updated_at',{ascending:false}),
        db().from('team_competitive_sessions').select('*').eq('team_id',S.team.id).order('created_at',{ascending:false})
      ]);
      const bad=[players,stats,board,reports,sessions].find(x=>x.error)?.error; if(bad) throw bad;
      S.players=players.data||[];
      S.stats=new Map((stats.data||[]).map(x=>[x.scouting_player_id,x]));
      S.board=new Map((board.data||[]).map(x=>[x.scouting_player_id,x]));
      S.reports=new Map();
      for(const r of reports.data||[]) if(!S.reports.has(r.scouting_player_id)) S.reports.set(r.scouting_player_id,r);
      S.sessions=sessions.data||[];
      const ids=S.sessions.map(x=>x.id);
      if(ids.length){const g=await db().from('team_competitive_games').select('*').in('session_id',ids).order('game_number');if(g.error)throw g.error;S.games=g.data||[];}else S.games=[];
      render();
      setStatus(`Calgary Hitmen private workspace ready · ${S.board.size} watched players · ${S.sessions.length} tracked sessions.`,'success');
    }catch(e){console.error(e);setStatus(e.message||'Could not load Calgary workspace.','error');}
    finally{S.loading=false;}
  }

  function filteredPlayers(){
    const q=S.search.trim().toLowerCase();
    return S.players.filter(p=>{
      const matches=!q||String(p.gamertag||'').toLowerCase().includes(q);
      const pos=String(p.primary_position||'').toLowerCase();
      const posOk=S.position==='all'||pos===S.position||(S.position==='defensemen'&&pos.includes('defense'));
      return matches&&posOk;
    });
  }
  function renderPlayers(){
    const root=$('hitmenPlayerList'); if(!root)return;
    const rows=filteredPlayers().slice(0,120);
    root.innerHTML=rows.length?rows.map(p=>{
      const st=S.stats.get(p.id), watched=S.board.has(p.id), active=p.id===S.selectedId;
      return `<button type="button" class="hitmen-player ${active?'active':''}" data-hitmen-player="${esc(p.id)}"><span><strong>${esc(p.gamertag)}</strong><small>${esc(posLabel(p.primary_position))}${st?` · ${n(st.games_played)} GP · ${n(st.points)} PTS`:''}</small></span><b>${watched?'WATCHED':'OPEN'}</b></button>`;
    }).join(''):'<div class="scout-empty">No players match this view.</div>';
    root.querySelectorAll('[data-hitmen-player]').forEach(b=>b.addEventListener('click',()=>selectPlayer(b.dataset.hitmenPlayer)));
  }
  function selectPlayer(id){S.selectedId=id;renderPlayers();renderDetail();}
  function renderDetail(){
    const p=S.players.find(x=>x.id===S.selectedId), empty=$('hitmenEmpty'), detail=$('hitmenDetail');
    if(!p){empty.hidden=false;detail.hidden=true;return;}
    empty.hidden=true;detail.hidden=false;
    const board=S.board.get(p.id), report=S.reports.get(p.id), st=S.stats.get(p.id);
    $('hitmenPlayerName').textContent=p.gamertag;
    $('hitmenPlayerMeta').textContent=`${posLabel(p.primary_position)} · ${p.platform||'Platform TBD'} · ${SEASON}${st?` · ${n(st.games_played)} GP / ${n(st.points)} PTS`:''}`;
    $('hitmenWatchToggle').textContent=board?'Remove from Calgary Watchlist':'Add to Calgary Watchlist';
    $('hitmenBoardStatus').value=board?.status||'watching';
    $('hitmenBoardNote').value=board?.note||'';
    $('hitmenGrade').value=report?.draft_grade||'';
    $('hitmenSummary').value=report?.summary||'';
    $('hitmenStrengths').value=report?.strengths||'';
    $('hitmenConcerns').value=report?.concerns||'';
    $('hitmenRole').value=report?.projected_role||'';
    $('hitmenConfidence').value=String(report?.confidence||3);
  }
  async function toggleWatch(){
    const p=S.players.find(x=>x.id===S.selectedId); if(!p)return;
    const uid=auth().user.id, existing=S.board.get(p.id);
    try{
      if(existing){const r=await db().from('scouting_draft_board_entries').delete().eq('id',existing.id).eq('author_id',uid);if(r.error)throw r.error;}
      else{const r=await db().from('scouting_draft_board_entries').insert({author_id:uid,team_id:S.team.id,scouting_player_id:p.id,season:SEASON,status:'watching'});if(r.error)throw r.error;}
      await loadAll();S.selectedId=p.id;renderDetail();setStatus(existing?'Removed from Calgary watchlist.':'Added to Calgary watchlist.','success');
    }catch(e){setStatus(e.message||'Watchlist update failed.','error');}
  }
  async function saveBoard(){
    const p=S.players.find(x=>x.id===S.selectedId); if(!p)return;
    const existing=S.board.get(p.id), payload={status:$('hitmenBoardStatus').value,note:$('hitmenBoardNote').value.trim()||null,updated_at:new Date().toISOString()};
    try{
      let r;
      if(existing) r=await db().from('scouting_draft_board_entries').update(payload).eq('id',existing.id).eq('author_id',auth().user.id);
      else r=await db().from('scouting_draft_board_entries').insert({...payload,author_id:auth().user.id,team_id:S.team.id,scouting_player_id:p.id,season:SEASON});
      if(r.error)throw r.error;await loadAll();S.selectedId=p.id;renderDetail();setStatus('Calgary board entry saved.','success');
    }catch(e){setStatus(e.message||'Could not save board entry.','error');}
  }
  async function saveReport(){
    const p=S.players.find(x=>x.id===S.selectedId); if(!p)return;
    const existing=S.reports.get(p.id), payload={author_id:auth().user.id,team_id:S.team.id,scouting_player_id:p.id,season:SEASON,report_title:`${p.gamertag} · Calgary Hitmen Scouting`,summary:$('hitmenSummary').value.trim()||null,strengths:$('hitmenStrengths').value.trim()||null,concerns:$('hitmenConcerns').value.trim()||null,projected_role:$('hitmenRole').value.trim()||null,draft_grade:$('hitmenGrade').value.trim()||null,confidence:Number($('hitmenConfidence').value)||3,visibility:'private',updated_at:new Date().toISOString()};
    try{
      const r=existing?await db().from('scouting_manual_reports').update(payload).eq('id',existing.id).eq('author_id',auth().user.id):await db().from('scouting_manual_reports').insert(payload);
      if(r.error)throw r.error;await loadAll();S.selectedId=p.id;renderDetail();setStatus('Private Calgary scouting report saved.','success');
    }catch(e){setStatus(e.message||'Could not save report.','error');}
  }
  async function addPlayer(){
    const gt=$('newHitmenGamertag').value.trim(); if(!gt)return setStatus('Enter a gamertag first.','error');
    const existing=S.players.find(p=>String(p.gamertag).toLowerCase()===gt.toLowerCase());
    if(existing){S.selectedId=existing.id;renderPlayers();renderDetail();return setStatus(`${existing.gamertag} is already in the scouting pool.`,'success');}
    try{
      const r=await db().from('scouting_players').insert({gamertag:gt,primary_position:$('newHitmenPosition').value,platform:$('newHitmenPlatform').value,scouting_status:'needs_scouting'}).select('id').single();
      if(r.error)throw r.error;$('newHitmenGamertag').value='';await loadAll();S.selectedId=r.data.id;renderPlayers();renderDetail();setStatus(`${gt} added to the scouting pool.`,'success');
    }catch(e){setStatus(e.message||'Could not add player.','error');}
  }

  function sessionGames(id){return S.games.filter(g=>g.session_id===id).sort((a,b)=>a.game_number-b.game_number);}
  function streamLink(url){if(!url)return '';return `<a class="small-btn" href="${esc(url)}" target="_blank" rel="noopener">Open Stream</a>`;}
  function renderActiveSession(){
    const root=$('activeSession');if(!root)return;
    const s=S.sessions.find(x=>x.status!=='complete')||S.sessions[0];
    if(!s){root.innerHTML='<div class="scout-empty compact">No scouting series yet. Create tonight’s BO3 above.</div>';return;}
    const games=sessionGames(s.id), need=Math.floor(n(s.best_of)/2)+1;
    root.innerHTML=`<div class="session-card"><div class="session-head"><div><small>${esc(s.status.toUpperCase())} · BEST OF ${n(s.best_of)} · FIRST TO ${need}</small><h4>${esc(s.label)}</h4></div><div class="series-score">HITMEN ${n(s.team_wins)}–${n(s.opponent_wins)} OPP</div></div>${s.opponent_label?`<p>Opponent / lobby: <strong>${esc(s.opponent_label)}</strong></p>`:''}<div class="hitmen-actions">${streamLink(s.stream_url)}${s.status!=='complete'?`<button class="small-btn" type="button" data-pause-session="${s.id}">${s.status==='paused'?'Resume':'Pause'} Session</button>`:''}</div><div class="session-games">${games.map(g=>`<div class="session-game ${g.status==='not_required'?'not_required':''}"><span><strong>Game ${g.game_number}</strong><small class="game-status ${g.status}">${esc(g.status.replace('_',' '))}</small></span><span>${g.status==='not_required'?'Series already clinched':'Actual scouting game'}</span><input class="field" type="number" min="0" value="${n(g.team_score)}" aria-label="Hitmen score" data-team-score="${g.id}" ${['final','not_required'].includes(g.status)?'disabled':''}><input class="field" type="number" min="0" value="${n(g.opponent_score)}" aria-label="Opponent score" data-opp-score="${g.id}" ${['final','not_required'].includes(g.status)?'disabled':''}>${g.status==='scheduled'?`<button class="small-btn" type="button" data-start-game="${g.id}">Start</button>`:''}${g.status==='live'?`<button class="small-btn primary" type="button" data-final-game="${g.id}">Final</button>`:''}${g.status==='final'?'<b>✓</b>':''}</div>`).join('')}</div></div>`;
    root.querySelectorAll('[data-start-game]').forEach(b=>b.addEventListener('click',()=>startGame(b.dataset.startGame)));
    root.querySelectorAll('[data-final-game]').forEach(b=>b.addEventListener('click',()=>finalGame(b.dataset.finalGame)));
    root.querySelectorAll('[data-pause-session]').forEach(b=>b.addEventListener('click',()=>togglePause(s)));
  }
  function renderHistory(){
    const root=$('sessionHistory');if(!root)return;
    if(!S.sessions.length){root.innerHTML='<div class="scout-empty compact">No Hitmen sessions tracked yet.</div>';return;}
    root.innerHTML=S.sessions.slice(0,12).map(s=>`<div class="session-history-row"><span><strong>${esc(s.label)}</strong><small>${esc(s.season_label)} · BO${n(s.best_of)} · ${esc(s.status)}</small></span><b>${n(s.team_wins)}–${n(s.opponent_wins)}</b></div>`).join('');
  }
  async function createSession(){
    const bestOf=Number($('sessionBestOf').value)||3, label=$('sessionLabel').value.trim()||'Calgary Hitmen Scouting Night';
    try{
      const r=await db().from('team_competitive_sessions').insert({team_id:S.team.id,season_label:SEASON,session_type:'scouting',label,opponent_label:$('sessionOpponent').value.trim()||null,best_of:bestOf,stream_url:$('sessionStream').value.trim()||null,status:'scheduled',created_by:auth().user.id}).select('id').single();
      if(r.error)throw r.error;
      const games=Array.from({length:bestOf},(_,i)=>({session_id:r.data.id,game_number:i+1,status:'scheduled'}));
      const g=await db().from('team_competitive_games').insert(games);if(g.error)throw g.error;
      await loadAll();setStatus(`BO${bestOf} scouting series created. Use the real stream and actual game results tonight.`,'success');
    }catch(e){setStatus(e.message||'Could not create scouting series.','error');}
  }
  async function startGame(id){
    try{const r=await db().from('team_competitive_games').update({status:'live',started_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id);if(r.error)throw r.error;await loadAll();setStatus('Scouting game marked LIVE.','success');}catch(e){setStatus(e.message||'Could not start game.','error');}
  }
  async function finalGame(id){
    const teamInput=document.querySelector(`[data-team-score="${CSS.escape(id)}"]`),oppInput=document.querySelector(`[data-opp-score="${CSS.escape(id)}"]`);
    const teamScore=n(teamInput?.value),oppScore=n(oppInput?.value);
    if(teamScore===oppScore)return setStatus('A final hockey game cannot be tied. Enter the actual winner.','error');
    try{const r=await db().from('team_competitive_games').update({status:'final',team_score:teamScore,opponent_score:oppScore,final_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id);if(r.error)throw r.error;await new Promise(res=>setTimeout(res,250));await loadAll();setStatus('Game finalized. Series score and if-necessary logic recalculated automatically.','success');}catch(e){setStatus(e.message||'Could not finalize game.','error');}
  }
  async function togglePause(s){
    const status=s.status==='paused'?'scheduled':'paused';
    try{const r=await db().from('team_competitive_sessions').update({status,updated_at:new Date().toISOString()}).eq('id',s.id);if(r.error)throw r.error;await loadAll();setStatus(status==='paused'?'Session paused. It will resume from the same series state.':'Session resumed.','success');}catch(e){setStatus(e.message||'Could not change session status.','error');}
  }

  function renderKpis(){
    $('hitmenWatchCount').textContent=S.board.size;$('hitmenReportCount').textContent=S.reports.size;$('hitmenSessionCount').textContent=S.sessions.length;
    const finals=S.games.filter(g=>g.status==='final');const w=finals.filter(g=>n(g.team_score)>n(g.opponent_score)).length,l=finals.filter(g=>n(g.opponent_score)>n(g.team_score)).length;$('hitmenRecord').textContent=`${w}-${l}`;
  }
  function render(){renderKpis();renderPlayers();renderDetail();renderActiveSession();renderHistory();}
  function bind(){
    $('hitmenSearch')?.addEventListener('input',e=>{S.search=e.target.value;renderPlayers();});
    $('hitmenPosition')?.addEventListener('change',e=>{S.position=e.target.value;renderPlayers();});
    $('hitmenWatchToggle')?.addEventListener('click',toggleWatch);$('saveHitmenBoard')?.addEventListener('click',saveBoard);$('saveHitmenReport')?.addEventListener('click',saveReport);$('addHitmenPlayer')?.addEventListener('click',addPlayer);$('createSession')?.addEventListener('click',createSession);
  }
  bind();
  window.addEventListener('vvhl-auth-change',()=>loadAll());
  if(auth().user)loadAll();
})();