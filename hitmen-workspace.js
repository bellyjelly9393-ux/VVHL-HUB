(() => {
  const TEAM_NAME = 'Calgary Hitmen';
  const SEASON = 'Season 55';
  const db = () => window.VVHLBackend?.db;
  const auth = () => window.VVHLBackend?.state || {};
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n = v => Number(v) || 0;
  const S = { team:null, sessions:[], games:[], schedule:[], lockers:[], reports:[], lineups:[], loading:false };

  // Season record from hitmen_schedule_games: only final rows that carry both scores count.
  // W = Calgary scored more; OTL = lost in overtime; L = any other loss. 2 pts per W, 1 per OTL.
  function seasonRecord(rows){
    let w=0,l=0,otl=0,gf=0,ga=0;
    const finals=(rows||[]).filter(g=>g.status==='final'&&g.calgary_score!=null&&g.opponent_score!=null)
      .sort((a,b)=>String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
    const results=finals.map(g=>{
      const cs=Number(g.calgary_score),os=Number(g.opponent_score);
      gf+=cs; ga+=os;
      if(cs>os){w++;return 'W';}
      if(g.overtime){otl++;return 'OT';}
      l++;return 'L';
    });
    let streak='';
    if(results.length){
      const last=results[results.length-1];let k=0;
      for(let i=results.length-1;i>=0&&results[i]===last;i--)k++;
      streak=`${last}${k}`;
    }
    return {w,l,otl,gp:w+l+otl,pts:w*2+otl,gf,ga,diff:gf-ga,streak};
  }

  // LGCHL S55 crest ids + abbreviations (same map as the live-ticker branch; crests in assets/lgchl/s55/).
  const LG_TEAMS = {
    'Calgary Hitmen':['CGY',412],'Baie-Comeau Drakkar':['BAC',469],'Barrie Colts':['BAR',449],'Brandon Wheat Kings':['BDN',409],
    'Brantford Bulldogs':['BFD',306],'Chicoutimi Saguenéens':['CHI',468],'Chilliwack Bruins':['CHW',2983],'Edmonton Oil Kings':['EDM',415],
    'Everett Silvertips':['EVT',380],'Flint Firebirds':['FLT',514],'Gatineau Olympiques':['GAT',461],'Kelowna Rockets':['KEL',400],
    'Kingston Frontenacs':['KGN',444],'Lethbridge Hurricanes':['LET',418],'London Knights':['LDN',370],'Medicine Hat Tigers':['MHT',416],
    'Moncton Wildcats':['MON',365],'Moose Jaw Warriors':['MJW',411],'Niagara IceDogs':['NIA',375],'North Bay Battalion':['NBB',448],
    "Ottawa 67's":['OTT',446],'Portland Winterhawks':['POR',398],'Prince Albert Raiders':['PAR',413],'Prince George Cougars':['PGC',422],
    'Red Deer Rebels':['RDR',385],'Regina Pats':['REG',414],'Saginaw Spirit':['SAG',408],'Saint John Sea Dogs':['SJS',397],
    'Sarnia Sting':['SAR',451],'Saskatoon Blades':['SAS',379],'Seattle Thunderbirds':['SEA',421],'Shawinigan Cataractes':['SHA',382],
    'Spokane Chiefs':['SPO',420],'Sudbury Wolves':['SBY',447],'Swift Current Broncos':['SCB',377],'Tri-City Americans':['TCA',399],
    "Val-d'Or Foreurs":['VDO',460],'Vancouver Giants':['VAN',386],'Victoria Royals':['VIC',419],'Windsor Spitfires':['WSR',381]
  };
  const ASSET_V = '20261004-broadcast';
  const teamAbbr = name => (LG_TEAMS[name]?.[0]) || String(name||'').split(/\s+/).filter(Boolean).map(w=>w[0]).join('').slice(0,3).toUpperCase() || 'TBA';
  // Crest <img> with an abbreviation fallback if the file is missing or fails to load.
  function crestHtml(name){
    const id=LG_TEAMS[name]?.[1];
    const abbr=`<span class="bc-abbr">${esc(teamAbbr(name))}</span>`;
    return id?`<img src="assets/lgchl/s55/team${id}.png?v=${ASSET_V}" alt="" data-abbr="${esc(teamAbbr(name))}" decoding="async">`:abbr;
  }
  function wireCrestFallbacks(root){
    root?.querySelectorAll('img[data-abbr]').forEach(img=>{
      const swap=()=>{const sp=document.createElement('span');sp.className='bc-abbr';sp.textContent=img.dataset.abbr;img.replaceWith(sp);};
      if(img.complete&&img.naturalWidth===0) swap(); else img.addEventListener('error',swap,{once:true});
    });
  }
  // Time zones: LG schedule is ET; Calgary is MT.
  const ET='America/New_York', MT='America/Edmonton';
  const fmt = (d,tz,opts) => new Intl.DateTimeFormat('en-US',{timeZone:tz,...opts}).format(d);
  const etDateKey = d => fmt(d,ET,{year:'numeric',month:'2-digit',day:'2-digit'}); // MM/DD/YYYY
  const clock = (d,tz) => fmt(d,tz,{hour:'numeric',minute:'2-digit'});
  const dayLabel = d => fmt(d,ET,{weekday:'short'}).toUpperCase();
  const dateLabel = d => `${dayLabel(d)} ${fmt(d,ET,{month:'short'}).toUpperCase()} ${fmt(d,ET,{day:'numeric'})}`;

  function nextGame(rows,now=new Date()){
    return (rows||[]).filter(g=>g.status!=='final'&&g.status!=='cancelled'&&new Date(g.scheduled_at)>now)
      .sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at))[0]||null;
  }
  function setText(id,v){const el=$(id); if(el) el.textContent=v;}
  let countdownTimer=null;
  function renderScoreboard(){
    if(!$('hitmenBroadcast')) return;
    const rec=seasonRecord(S.schedule);
    const big=$('hitmenSbRecord');
    if(big){
      if(rec.gp){big.innerHTML=`<span>${rec.w}<small>W</small></span><i>&ndash;</i><span>${rec.l}<small>L</small></span><i>&ndash;</i><span>${rec.otl}<small>OTL</small></span>`;big.setAttribute('aria-label',`Season record ${rec.w} wins, ${rec.l} losses, ${rec.otl} overtime losses`);}
      else big.textContent='\u2014';
    }
    setText('hitmenSbPts',rec.gp?rec.pts:'\u2014');
    setText('hitmenSbGf',rec.gp?rec.gf:'\u2014');
    setText('hitmenSbGa',rec.gp?rec.ga:'\u2014');
    setText('hitmenSbDiff',rec.gp?(rec.diff>0?`+${rec.diff}`:rec.diff<0?`\u2212${Math.abs(rec.diff)}`:'0'):'\u2014');
    setText('hitmenSbStreak',rec.streak||'\u2014');
    renderNextGame();
  }
  function renderNextGame(){
    const now=new Date(), g=nextGame(S.schedule,now);
    const tag=$('hitmenSbNextTag'), crest=$('hitmenSbOppCrest');
    if(countdownTimer){clearInterval(countdownTimer);countdownTimer=null;}
    if(!g){
      if(tag){tag.className='bc-k';tag.textContent='Next game';}
      setText('hitmenSbNextDate','\u2014'); setText('hitmenSbOppName','Schedule TBA'); setText('hitmenSbCountdown','--:--:--');
      if(crest) crest.innerHTML=''; if($('hitmenSbTimes')) $('hitmenSbTimes').innerHTML='&mdash; ET<br>&mdash; MT';
      setText('hitmenSbRailRight','Puck drop \u00b7 ET / MT');
      return;
    }
    const at=new Date(g.scheduled_at), tonight=etDateKey(at)===etDateKey(now);
    if(tag){tag.className=tonight?'bc-k bc-onair':'bc-k';tag.textContent=tonight?'Tonight':'Next game';}
    setText('hitmenSbNextDate',dateLabel(at));
    setText('hitmenSbOppName',g.opponent_name||'TBA');
    if(crest){crest.innerHTML=crestHtml(g.opponent_name);wireCrestFallbacks(crest);}
    if($('hitmenSbTimes')) $('hitmenSbTimes').innerHTML=`${esc(clock(at,ET))} ET<br>${esc(clock(at,MT))} MT`;
    const sameNight=S.schedule.filter(x=>x!==g&&x.status!=='final'&&etDateKey(new Date(x.scheduled_at))===etDateKey(at)&&new Date(x.scheduled_at)>at)
      .sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
    setText('hitmenSbRailLeft',`LGCHL \u00b7 Season 55${g.week?` \u00b7 Week ${g.week}`:''}`);
    setText('hitmenSbRailRight',sameNight.length?`Then ${sameNight.map(x=>`${teamAbbr(x.opponent_name)} ${clock(new Date(x.scheduled_at),ET).replace(/\s?[AP]M$/,'')}`).join(' \u00b7 ')} ET`:'Puck drop \u00b7 ET / MT');
    const tick=()=>{
      const ms=at-new Date();
      if(ms<=0){renderNextGame();return;}
      const t=Math.floor(ms/1000),d=Math.floor(t/86400),h=Math.floor(t%86400/3600),m=Math.floor(t%3600/60),sec=t%60,p=v=>String(v).padStart(2,'0');
      setText('hitmenSbCountdown',`${d?`${d}D `:''}${p(h)}:${p(m)}:${p(sec)}`);
    };
    tick(); countdownTimer=setInterval(tick,1000);
  }

  // Jumbotron: one game day at a time (Calgary plays 3 games each Sun, Mon and Tue).
  // The board day rolls over at 06:00 ET; on non-game days it shows the next game day.
  // Every game of that ET date (3 normally, 4 on some days; capped at 4 to fit the board), ordered by puck drop.
  // Finals show the score (winner bold).
  const JUMBO_MAX_GAMES = 4;
  const isoDay = d => { const [mm,dd,yy]=etDateKey(d).split('/'); return `${yy}-${mm}-${dd}`; };
  const boardDayKey = (now=new Date()) => isoDay(new Date(now.getTime()-6*3600*1000));
  function jumboGames(rows,now=new Date()){
    const from=boardDayKey(now);
    const games=(rows||[]).filter(g=>g.status!=='cancelled'&&g.scheduled_at).map(g=>({g,at:new Date(g.scheduled_at)}))
      .map(x=>({...x,day:isoDay(x.at)})).filter(x=>x.day>=from).sort((a,b)=>a.at-b.at);
    if(!games.length) return {day:null,games:[]};
    const day=games[0].day;
    return {day,games:games.filter(x=>x.day===day).slice(0,JUMBO_MAX_GAMES)};
  }
  let jumboKey='';
  function renderJumbotron(){
    const root=$('hitmenJumbo'), sr=$('hitmenJumboSr'); if(!root) return;
    jumboKey=boardDayKey();
    const {games}=jumboGames(S.schedule);
    root.classList.toggle('bc-jt-n4',games.length>3);
    if(!games.length){
      root.innerHTML='<div class="bc-jt-empty">Schedule TBA</div>';
      if(sr) sr.innerHTML='<li>Schedule TBA</li>';
      return;
    }
    const isFinal=g=>g.status==='final'&&g.calgary_score!=null&&g.opponent_score!=null;
    const mid=g=>{
      if(!isFinal(g)) return '<s>VS</s>';
      const c=Number(g.calgary_score),o=Number(g.opponent_score);
      return `<s class="bc-jt-final">${c>o?`<b>${c}</b>`:c}<em>&ndash;</em>${o>c?`<b>${o}</b>`:o}<small>FINAL${g.overtime?' OT':''}</small></s>`;
    };
    const label=dateLabel(games[0].at);
    root.innerHTML=`<div class="bc-jt-day">${esc(label)}</div>`+games.map(({g},i)=>`<div class="bc-jt-row"><i>GM ${i+1}</i><span class="bc-crest">${crestHtml('Calgary Hitmen')}</span>${mid(g)}<span class="bc-crest">${crestHtml(g.opponent_name)}</span></div>`).join('');
    wireCrestFallbacks(root);
    if(sr) sr.innerHTML=games.map(({g},i)=>`<li>${esc(label)}, game ${i+1}: Calgary Hitmen vs ${esc(g.opponent_name||'TBA')}${isFinal(g)?`, final ${Number(g.calgary_score)}-${Number(g.opponent_score)}${g.overtime?' OT':''}`:''}</li>`).join('');
  }
  setInterval(()=>{ if(jumboKey && boardDayKey()!==jumboKey) renderJumbotron(); },60000);

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


  async function loadAll(){
    if(S.loading||!db()||!auth().user)return;
    S.loading=true;
    try{
      const allowed=await loadTeam();
      if(!allowed){setStatus('Calgary Hitmen workspace access is restricted.','error');return;}
      const [sessions,lockers,reports,lineups,schedule]=await Promise.all([
        db().from('team_competitive_sessions').select('*').eq('team_id',S.team.id).order('created_at',{ascending:false}),
        db().from('team_player_lockers').select('id,roster_class,gamertag,position,management_role').eq('team_id',S.team.id).eq('season',55),
        db().from('hitmen_player_reports').select('id').eq('team_id',S.team.id).eq('season',55),
        db().from('lineups').select('id,status,is_active,updated_at').eq('team_id',S.team.id).eq('league','LGCHL'),
        db().from('hitmen_schedule_games').select('id,week,scheduled_at,opponent_name,calgary_side,status,calgary_score,opponent_score,overtime').eq('team_id',S.team.id).eq('season',55).order('scheduled_at')
      ]);
      if(sessions.error||lockers.error||reports.error||lineups.error) throw (sessions.error||lockers.error||reports.error||lineups.error);
      S.sessions=sessions.data||[]; S.lockers=lockers.data||[]; S.reports=reports.data||[]; S.lineups=lineups.data||[];
      if(schedule.error) console.warn('hitmen_schedule_games unavailable',schedule.error);
      S.schedule=schedule.error?[]:(schedule.data||[]);
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
    if(!s){root.innerHTML='<div class="scout-empty compact">No game-night series yet. Create tonight’s BO3 above.</div>';return;}
    const games=sessionGames(s.id), need=Math.floor(n(s.best_of)/2)+1;
    root.innerHTML=`<div class="session-card"><div class="session-head"><div><small>${esc(s.status.toUpperCase())} · BEST OF ${n(s.best_of)} · FIRST TO ${need}</small><h4>${esc(s.label)}</h4></div><div class="series-score">HITMEN ${n(s.team_wins)}–${n(s.opponent_wins)} OPP</div></div>${s.opponent_label?`<p>Opponent / lobby: <strong>${esc(s.opponent_label)}</strong></p>`:''}<div class="hitmen-actions">${streamLink(s.stream_url)}${s.status!=='complete'?`<button class="small-btn" type="button" data-pause-session="${s.id}">${s.status==='paused'?'Resume':'Pause'} Session</button>`:''}</div><div class="session-games">${games.map(g=>`<div class="session-game ${g.status==='not_required'?'not_required':''}"><span><strong>Game ${g.game_number}</strong><small class="game-status ${g.status}">${esc(g.status.replace('_',' '))}</small></span><span>${g.status==='not_required'?'Series already clinched':'Game-night matchup'}</span><input class="field" type="number" min="0" value="${n(g.team_score)}" aria-label="Hitmen score" data-team-score="${g.id}" ${['final','not_required'].includes(g.status)?'disabled':''}><input class="field" type="number" min="0" value="${n(g.opponent_score)}" aria-label="Opponent score" data-opp-score="${g.id}" ${['final','not_required'].includes(g.status)?'disabled':''}>${g.status==='scheduled'?`<button class="small-btn" type="button" data-start-game="${g.id}">Start</button>`:''}${g.status==='live'?`<button class="small-btn primary" type="button" data-final-game="${g.id}">Final</button>`:''}${g.status==='final'?'<b>✓</b>':''}</div>`).join('')}</div></div>`;
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
    const bestOf=Number($('sessionBestOf').value)||3, label=$('sessionLabel').value.trim()||'Calgary Hitmen Game Night';
    try{
      const r=await db().from('team_competitive_sessions').insert({team_id:S.team.id,season_label:SEASON,session_type:'regular',label,opponent_label:$('sessionOpponent').value.trim()||null,best_of:bestOf,stream_url:$('sessionStream').value.trim()||null,status:'scheduled',created_by:auth().user.id}).select('id').single();
      if(r.error)throw r.error;
      const games=Array.from({length:bestOf},(_,i)=>({session_id:r.data.id,game_number:i+1,status:'scheduled'}));
      const g=await db().from('team_competitive_games').insert(games);if(g.error)throw g.error;
      await loadAll();setStatus(`BO${bestOf} game-night series created. Use the real stream and actual game results tonight.`,'success');
    }catch(e){setStatus(e.message||'Could not create game-night series.','error');}
  }
  async function startGame(id){
    try{
      const r=await db().from('team_competitive_games').update({status:'live',started_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id);
      if(r.error)throw r.error;
      await loadAll();setStatus('Game marked LIVE.','success');
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
    if($('hitmenReportCount')) $('hitmenReportCount').textContent=S.reports.length;
    if($('hitmenRosterCount')) $('hitmenRosterCount').textContent=S.lockers.filter(x=>x.roster_class!=='tc').length;
    if($('hitmenTcCount')) $('hitmenTcCount').textContent=S.lockers.filter(x=>x.roster_class==='tc').length;
    if($('hitmenLineupCount')) $('hitmenLineupCount').textContent=S.lineups.length;
    const rec=seasonRecord(S.schedule);
    if($('hitmenRecord')) $('hitmenRecord').textContent=rec.gp?`${rec.w}-${rec.l}-${rec.otl}`:'\u2014';
  }
  function render(){renderKpis();renderScoreboard();renderJumbotron();renderActiveSession();renderHistory();}
  function bind(){$('createSession')?.addEventListener('click',createSession);}
  bind();
  window.addEventListener('vvhl-auth-change',()=>loadAll());
  if(auth().user)loadAll();
})();