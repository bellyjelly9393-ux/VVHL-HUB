(() => {
  const TEAM_NAME = 'Calgary Hitmen';
  const SEASON = 'Season 55';
  const STAFF = [
    { role: 'Owner', gamertag: 'IMONA_PLAIN', number: '16' },
    { role: 'GM', gamertag: 'Bad News Kells', number: '5' },
    { role: 'AGM', gamertag: 'Smokoli', number: '83' }
  ];
  const db = () => window.VVHLBackend?.db;
  const auth = () => window.VVHLBackend?.state || {};
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n = v => Number(v) || 0;
  const S = { team:null, sessions:[], games:[], pool:[], reports:[], loading:false };

  function setStatus(text,tone=''){
    const el=$('hitmenStatus'); if(!el)return;
    el.textContent=text; el.className=`hitmen-status ${tone}`.trim();
  }
  function userCanManageHitmen(){
    const state=auth(); if(!state.user||!S.team)return false;
    if(String(state.profile?.role||'').toLowerCase()==='admin') return true;
    return (state.memberships||[]).some(m=>m.team_id===S.team.id && m.active!==false && ['owner','gm','agm','scout'].includes(String(m.role||'').toLowerCase()));
  }
  function enforceHitmenAccess(){
    const ok=userCanManageHitmen();
    document.querySelectorAll('[data-management-content]').forEach(el=>el.hidden=!ok);
    const locked=$('managementLockedMessage');
    if(locked){
      locked.hidden=ok;
      if(!ok&&auth().user) locked.innerHTML='<b>Calgary workspace access not assigned.</b><p>This private LGCHL workspace requires the site admin account or an Owner/GM/AGM/Scout membership on Calgary Hitmen.</p>';
    }
    return ok;
  }
  async function loadTeam(){
    const {data,error}=await db().from('teams').select('id,name,abbreviation,league_id,active,is_public,workspace_kind').eq('name',TEAM_NAME).maybeSingle();
    if(error) throw error;
    S.team=data;
    if(!S.team) throw new Error('Calgary Hitmen workspace is not available to this account.');
    return enforceHitmenAccess();
  }

  function configureTeamPanel(){
    const root=$('hitmenPlayerList');
    const panel=root?.closest('.hitmen-panel');
    if(panel){
      const eyebrow=panel.querySelector('.eyebrow'); if(eyebrow) eyebrow.textContent='CALGARY HITMEN';
      const title=panel.querySelector('h3'); if(title) title.textContent='Team Management';
      panel.querySelector('.hitmen-toolbar')?.remove();
      panel.querySelector('.scout-section-title')?.remove();
      panel.querySelector('.hitmen-add-player')?.remove();
    }
    const detailPanel=$('hitmenEmpty')?.closest('.hitmen-panel');
    if(detailPanel) detailPanel.style.display='none';
  }
  function renderStaff(){
    const root=$('hitmenPlayerList'); if(!root)return;
    root.innerHTML=STAFF.map(s=>`<div class="hitmen-player"><span><strong>${esc(s.gamertag)}</strong><small>Calgary Hitmen · ${esc(SEASON)} · #${esc(s.number)}</small></span><b>${esc(s.role.toUpperCase())}</b></div>`).join('');
  }

  async function loadAll(){
    if(S.loading||!db()||!auth().user)return;
    S.loading=true;
    try{
      const allowed=await loadTeam();
      if(!allowed){setStatus('Calgary Hitmen workspace access is restricted.','error');return;}
      const [sessions,pool,reports]=await Promise.all([
        db().from('team_competitive_sessions').select('*').eq('team_id',S.team.id).order('created_at',{ascending:false}),
        db().from('team_scouting_pool').select('id,status,priority').eq('team_id',S.team.id),
        db().from('team_scouting_reports').select('id').eq('team_id',S.team.id)
      ]);
      if(sessions.error||pool.error||reports.error) throw (sessions.error||pool.error||reports.error);
      S.sessions=sessions.data||[]; S.pool=pool.data||[]; S.reports=reports.data||[];
      const ids=S.sessions.map(x=>x.id);
      if(ids.length){
        const games=await db().from('team_competitive_games').select('*').in('session_id',ids).order('game_number');
        if(games.error) throw games.error;
        S.games=games.data||[];
      } else S.games=[];
      render();
      setStatus(`Calgary Hitmen War Room ready · Owner IMONA_PLAIN · GM Bad News Kells · AGM Smokoli · ${S.sessions.length} tracked session${S.sessions.length===1?'':'s'}.`,'success');
    }catch(e){console.error(e);setStatus(e.message||'Could not load Calgary workspace.','error');}
    finally{S.loading=false;}
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
    try{
      const r=await db().from('team_competitive_games').update({status:'live',started_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id);
      if(r.error)throw r.error;
      await loadAll();setStatus('Scouting game marked LIVE.','success');
    }catch(e){setStatus(e.message||'Could not start game.','error');}
  }
  async function finalGame(id){
    const teamInput=document.querySelector(`[data-team-score="${CSS.escape(id)}"]`),oppInput=document.querySelector(`[data-opp-score="${CSS.escape(id)}"]`);
    const teamScore=n(teamInput?.value),oppScore=n(oppInput?.value);
    if(teamScore===oppScore)return setStatus('A final hockey game cannot be tied. Enter the actual winner.','error');
    try{
      const r=await db().from('team_competitive_games').update({status:'final',team_score:teamScore,opponent_score:oppScore,final_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id);
      if(r.error)throw r.error;
      await new Promise(res=>setTimeout(res,250));await loadAll();setStatus('Game finalized. Series score and if-necessary logic recalculated automatically.','success');
    }catch(e){setStatus(e.message||'Could not finalize game.','error');}
  }
  async function togglePause(s){
    const status=s.status==='paused'?'scheduled':'paused';
    try{
      const r=await db().from('team_competitive_sessions').update({status,updated_at:new Date().toISOString()}).eq('id',s.id);
      if(r.error)throw r.error;
      await loadAll();setStatus(status==='paused'?'Session paused. It will resume from the same series state.':'Session resumed.','success');
    }catch(e){setStatus(e.message||'Could not change session status.','error');}
  }
  function renderKpis(){
    if($('hitmenWatchCount')) $('hitmenWatchCount').textContent=STAFF.length;
    if($('hitmenReportCount')) $('hitmenReportCount').textContent=S.reports.length;
    if($('hitmenSessionCount')) $('hitmenSessionCount').textContent=S.sessions.length;
    if($('hitmenPriorityCount')) $('hitmenPriorityCount').textContent=S.pool.filter(x=>x.status==='priority'||x.status==='bid_target'||Number(x.priority)===1).length;
    if($('hitmenAwaitingCount')) $('hitmenAwaitingCount').textContent=S.pool.filter(x=>!['signed','pass','lost'].includes(String(x.status||''))).length;
    const finals=S.games.filter(g=>g.status==='final');
    const w=finals.filter(g=>n(g.team_score)>n(g.opponent_score)).length,l=finals.filter(g=>n(g.opponent_score)>n(g.team_score)).length;
    if($('hitmenRecord')) $('hitmenRecord').textContent=`${w}-${l}`;
    const cards=document.querySelectorAll('.hitmen-kpi small');
    if(cards[0]) cards[0].textContent='Management';
    if(cards[1]) cards[1].textContent='Scouting Reports';
  }
  function render(){configureTeamPanel();renderStaff();renderKpis();renderActiveSession();renderHistory();}
  function bind(){$('createSession')?.addEventListener('click',createSession);}
  bind();
  window.addEventListener('vvhl-auth-change',()=>loadAll());
  if(auth().user)loadAll();
})();