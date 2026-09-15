(() => {
  const db=window.VVHLBackend?.db; if(!db)return;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>Number(v)||0;
  const fmt=v=>v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'TBD';
  const ageMinutes=v=>v?Math.max(0,(Date.now()-new Date(v).getTime())/60000):Infinity;
  const S={events:[],series:[],games:[],teams:[],sources:[],alerts:[],configs:[],eventId:'',seriesId:'',refreshTimer:null,pollBusy:false};
  const event=()=>S.events.find(x=>x.id===S.eventId);
  const series=()=>S.series.find(x=>x.id===S.seriesId);
  const team=id=>S.teams.find(x=>x.id===id);
  const eventGames=()=>S.games.filter(x=>x.event_id===S.eventId).sort((a,b)=>(a.series_game_number??999)-(b.series_game_number??999)||new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0));
  const seriesGames=()=>S.games.filter(x=>x.series_id===S.seriesId).sort((a,b)=>(a.series_game_number??999)-(b.series_game_number??999)||new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0));
  const config=()=>S.configs.find(x=>x.event_id===S.eventId);
  const msg=(id,text,bad=false)=>{const el=$(id);if(el){el.textContent=text;el.style.color=bad?'#ff9a9a':'#9ff4bc';}};

  async function loadData(silent=false){
    const [events,seriesRes,games,teams,sources,alerts,configs]=await Promise.all([
      db.from('esports_events').select('*').eq('active',true).order('starts_on'),
      db.from('esports_series').select('*').order('scheduled_start'),
      db.from('esports_games').select('*').order('scheduled_at'),
      db.from('esports_teams').select('*').eq('active',true).order('name'),
      db.from('tournament_automation_sources').select('*').eq('active',true).order('created_at'),
      db.from('tournament_operator_alerts').select('*').neq('status','resolved').order('created_at',{ascending:false}),
      db.from('tournament_automation_config').select('*')
    ]);
    const err=[events,seriesRes,games,teams,sources,alerts,configs].find(x=>x.error)?.error;
    if(err){console.error(err);if(!silent)msg('operatorConfigMessage','Operator data refresh failed.',true);return;}
    Object.assign(S,{events:events.data||[],series:seriesRes.data||[],games:games.data||[],teams:teams.data||[],sources:sources.data||[],alerts:alerts.data||[],configs:configs.data||[]});
    if(!S.eventId||!S.events.some(x=>x.id===S.eventId))S.eventId=S.events.find(x=>x.slug==='wildman-tournament-sandbox')?.id||S.events.find(x=>x.slug==='road-to-pro-2026')?.id||S.events[0]?.id||'';
    const choices=S.series.filter(x=>x.event_id===S.eventId);
    if(!S.seriesId||!choices.some(x=>x.id===S.seriesId))S.seriesId=choices.find(x=>x.status!=='complete')?.id||choices[0]?.id||'';
    render();
    await evaluateWarnings();
    if(!silent)msg('operatorConfigMessage','Control room refreshed.');
  }

  function render(){
    renderSelectors(); renderKpis(); renderConfig(); renderSources(); renderSeries(); renderReadiness(); renderAlerts();
    if($('operatorRefreshStamp'))$('operatorRefreshStamp').textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}`;
  }

  function renderSelectors(){
    const e=$('operatorEventSelect'); if(e){e.innerHTML=S.events.map(x=>`<option value="${x.id}" ${x.id===S.eventId?'selected':''}>${esc(x.name)}${x.is_sandbox?' · SANDBOX':''}</option>`).join('');e.value=S.eventId;}
    const ss=$('operatorSeriesSelect'),choices=S.series.filter(x=>x.event_id===S.eventId); if(ss){ss.innerHTML=choices.length?choices.map(x=>`<option value="${x.id}" ${x.id===S.seriesId?'selected':''}>${esc(x.round_label||x.stage||'Series')} · ${esc(team(x.home_team_id)?.name||'Team')} vs ${esc(team(x.away_team_id)?.name||'Team')}</option>`).join(''):'<option value="">No series mapped yet</option>';ss.value=S.seriesId||'';}
    const sg=$('sourceGame'); if(sg){const rows=S.seriesId?seriesGames():eventGames();sg.innerHTML='<option value="">Series / event level</option>'+rows.map(g=>`<option value="${g.id}">Game ${g.series_game_number||'?'} · ${esc(team(g.home_team_id)?.name||'Home')} vs ${esc(team(g.away_team_id)?.name||'Away')}</option>`).join('');}
  }

  function currentGame(){
    const rows=S.seriesId?seriesGames():eventGames();
    return rows.find(g=>g.status==='live')||rows.find(g=>g.status==='scheduled'&&!g.not_required)||rows.filter(g=>g.status==='final').at(-1)||rows[0];
  }

  function renderKpis(){
    const c=config(),s=series(),g=currentGame();
    $('operatorModeKpi').textContent=(c?.mode||'assist').replace('_',' ').toUpperCase();
    $('operatorModeSub').textContent=c?.mode==='auto_safe'?'Polling + safe server automation':c?.mode==='off'?'Automation disabled':'Human-confirmed workflow';
    if(s){$('operatorSeriesScore').textContent=`${s.home_wins}-${s.away_wins}`;$('operatorSeriesSub').textContent=`Best of ${s.best_of} · first to ${Math.floor(s.best_of/2)+1}`;}else{$('operatorSeriesScore').textContent='—';$('operatorSeriesSub').textContent='Group/bracket mapping pending';}
    if(g){$('operatorCurrentGame').textContent=`G${g.series_game_number||'?'}`;$('operatorCurrentSub').textContent=`${String(g.status).toUpperCase()} · ${team(g.home_team_id)?.name||'Home'} vs ${team(g.away_team_id)?.name||'Away'}`;}else{$('operatorCurrentGame').textContent='—';$('operatorCurrentSub').textContent='No game loaded';}
    let action='WAIT',sub='Nothing urgent.';
    if(!s){action='FORMAT PENDING';sub='Attach event-level sources now; map series when the official structure is released.';}
    else if(s.status==='complete'){action='SERIES CLINCHED';sub=`${team(s.winner_team_id)?.name||'Winner'} advances. Remaining games are not required.`;}
    else if(g?.status==='live'){action=`MONITOR GAME ${g.series_game_number||''}`.trim();sub='Watch source freshness, score state and stream health.';}
    else if(g?.status==='scheduled'){action=`PREP GAME ${g.series_game_number||''}`.trim();sub='Verify stream and public LG source, then confirm LIVE at puck drop.';}
    else if(g?.status==='final'){action='PREP NEXT GAME';sub='Series math is saved. Confirm the next required game and source links.';}
    $('operatorNextAction').textContent=action;$('operatorNextActionSub').textContent=sub;
  }

  function renderConfig(){
    const c=config()||{mode:'assist',source_poll_seconds:60,stale_live_minutes:10};
    if($('operatorMode'))$('operatorMode').value=c.mode||'assist';
    if($('operatorPollSeconds'))$('operatorPollSeconds').value=c.source_poll_seconds||60;
    if($('operatorStaleMinutes'))$('operatorStaleMinutes').value=c.stale_live_minutes||10;
  }

  async function saveConfig(){
    try{
      const row={event_id:S.eventId,mode:$('operatorMode').value,source_poll_seconds:Math.max(30,Number($('operatorPollSeconds').value)||60),stale_live_minutes:Math.max(2,Number($('operatorStaleMinutes').value)||10),updated_at:new Date().toISOString()};
      const r=await db.from('tournament_automation_config').upsert(row,{onConflict:'event_id'});if(r.error)throw r.error;
      msg('operatorConfigMessage','Automation settings saved. Score/final/report publishing remains human-confirmed.');await loadData(true);
    }catch(e){msg('operatorConfigMessage',e.message||'Could not save automation settings.',true);}
  }

  function providerFor(url){try{const h=new URL(url).hostname.toLowerCase();if(h.includes('leaguegaming.com'))return'leaguegaming';if(h.includes('twitch.tv'))return'twitch';if(h.includes('youtube.com')||h.includes('youtu.be'))return'youtube';return h;}catch{return'other';}}

  async function addSource(){
    const url=$('sourceUrl').value.trim();if(!url){msg('sourceMessage','Paste a source URL first.',true);return;}try{new URL(url);}catch{msg('sourceMessage','That source URL is not valid.',true);return;}
    try{
      const row={event_id:S.eventId,series_id:S.seriesId||null,game_id:$('sourceGame').value||null,source_type:$('sourceType').value,provider:providerFor(url),url,polling_enabled:$('sourcePolling').checked,poll_interval_seconds:Math.max(30,Number(config()?.source_poll_seconds)||60),active:true,updated_at:new Date().toISOString()};
      const r=await db.from('tournament_automation_sources').insert(row).select().single();if(r.error)throw r.error;
      $('sourceUrl').value='';$('sourcePolling').checked=false;msg('sourceMessage','Source attached.');await loadData(true);if(r.data.provider==='leaguegaming')await checkSource(r.data,false);
    }catch(e){msg('sourceMessage',e.message||'Could not attach source.',true);}
  }

  async function removeSource(id){const r=await db.from('tournament_automation_sources').update({active:false,updated_at:new Date().toISOString()}).eq('id',id);if(r.error)msg('sourceMessage',r.error.message,true);else{msg('sourceMessage','Source removed.');await loadData(true);}}

  function renderSources(){
    const root=$('operatorSources');if(!root)return;const rows=S.sources.filter(x=>x.event_id===S.eventId&&(x.series_id===S.seriesId||!x.series_id));
    root.innerHTML=rows.length?rows.map(x=>{const game=S.games.find(g=>g.id===x.game_id);const state=x.last_error?'ERROR':x.last_success_at?'OK':'READY';return `<div class="operator-item ${x.last_error?'alert-warning':''}"><div><strong>${esc(x.source_type.replace('_',' ').toUpperCase())} · ${esc(x.provider||'source')} · ${esc(state)}</strong><small>${game?`Game ${game.series_game_number||'?'} · `:''}${esc(x.url)}</small><small>${x.last_checked_at?`Checked ${fmt(x.last_checked_at)}`:'Not checked yet'}${x.polling_enabled?' · AUTO-POLL':''}${x.last_error?` · ${esc(x.last_error)}`:''}</small></div><div class="operator-actions"><a class="small-btn" href="${esc(x.url)}" target="_blank" rel="noopener">Open</a><button class="small-btn" type="button" data-check-source="${x.id}">Check</button><button class="small-btn" type="button" data-remove-source="${x.id}">Remove</button></div></div>`;}).join(''):'<div class="empty-state">No sources attached yet. Add the LG and stream links when available.</div>';
    root.querySelectorAll('[data-check-source]').forEach(b=>b.onclick=()=>checkSource(S.sources.find(x=>x.id===b.dataset.checkSource),false));
    root.querySelectorAll('[data-remove-source]').forEach(b=>b.onclick=()=>removeSource(b.dataset.removeSource));
  }

  async function ensureAlert({event_id=S.eventId,series_id=S.seriesId||null,game_id=null,alert_type,severity='warning',title,message,metadata={}}){
    const existing=S.alerts.find(a=>a.event_id===event_id&&a.status!=='resolved'&&a.alert_type===alert_type&&(a.game_id||null)===(game_id||null)&&a.title===title);if(existing)return existing;
    const r=await db.from('tournament_operator_alerts').insert({event_id,series_id,game_id,alert_type,severity,title,message,metadata}).select().single();if(!r.error){S.alerts.unshift(r.data);renderAlerts();}return r.data;
  }

  async function checkSource(source,silent=false){
    if(!source)return;const checked=new Date().toISOString();
    try{
      if(source.provider==='leaguegaming'){
        const res=await fetch(`/api/lg-public-stats?url=${encodeURIComponent(source.url)}`);let data={};try{data=await res.json();}catch{}
        if(!res.ok)throw new Error(data.error||`LG check returned ${res.status}`);
        const update={last_checked_at:checked,last_success_at:checked,last_error:null,last_http_status:res.status,metadata:{...(source.metadata||{}),title:data.title||null,tableCount:data.tableCount??null,lastPageText:(data.pageText||'').slice(0,300)},updated_at:checked};
        const r=await db.from('tournament_automation_sources').update(update).eq('id',source.id);if(r.error)throw r.error;
        if(!silent)msg('sourceMessage',`LG source reachable · ${data.tableCount??0} tables detected.`);
      }else{
        const r=await db.from('tournament_automation_sources').update({last_checked_at:checked,last_success_at:checked,last_error:null,metadata:{...(source.metadata||{}),note:'Attached source; browser-side health polling is only supported for LeagueGaming parser links.'},updated_at:checked}).eq('id',source.id);if(r.error)throw r.error;
        if(!silent)msg('sourceMessage','Source is attached. Automated content checks currently run only for LeagueGaming links.');
      }
    }catch(e){
      await db.from('tournament_automation_sources').update({last_checked_at:checked,last_error:e.message||'Source check failed',updated_at:checked}).eq('id',source.id);
      await ensureAlert({game_id:source.game_id||null,alert_type:'source_error',severity:'warning',title:'Source check failed',message:`${source.provider||'Source'}: ${e.message||'Unknown error'}`,metadata:{source_id:source.id}});
      if(!silent)msg('sourceMessage',e.message||'Source check failed.',true);
    }
    await loadData(true);
  }

  async function checkAllSources(manual=true){const rows=S.sources.filter(x=>x.event_id===S.eventId&&(x.series_id===S.seriesId||!x.series_id));for(const src of rows)await checkSource(src,!manual);if(manual)msg('sourceMessage',rows.length?'Source check complete.':'No sources are attached yet.');}

  function renderSeries(){
    const root=$('operatorSeriesBoard'),s=series();if(!root)return;
    if(!s){$('operatorSeriesStatus').textContent='PENDING';root.innerHTML='<div class="empty-state">No series has been mapped for this event yet. That is expected until the official group/bracket structure is released.</div>';return;}
    const h=team(s.home_team_id)?.name||'Home',a=team(s.away_team_id)?.name||'Away',needed=Math.floor(s.best_of/2)+1,rows=seriesGames();$('operatorSeriesStatus').textContent=s.status.toUpperCase();
    root.innerHTML=`<div class="series-head"><div><small>${esc(s.round_label||s.stage||'Series')}</small><strong>${esc(h)}</strong><small>${s.home_wins} win${s.home_wins===1?'':'s'}</small></div><div><div class="series-score">${s.home_wins}–${s.away_wins}</div><small>BEST OF ${s.best_of} · FIRST TO ${needed}</small></div><div><small>${s.status==='complete'?'SERIES FINAL':'IN PROGRESS'}</small><strong>${esc(a)}</strong><small>${s.away_wins} win${s.away_wins===1?'':'s'}</small></div></div><div class="series-games">${rows.map(g=>`<div class="series-game ${g.status==='live'?'is-live':''} ${g.not_required?'is-unneeded':''}"><b>GAME ${g.series_game_number||'?'}</b><div><strong>${g.not_required?'NOT REQUIRED':g.status==='final'?`${team(g.home_team_id)?.name||'Home'} ${g.home_score}–${g.away_score} ${team(g.away_team_id)?.name||'Away'}`:`${team(g.home_team_id)?.name||'Home'} vs ${team(g.away_team_id)?.name||'Away'}`}</strong><small>${g.not_required?'Series already clinched':g.status==='live'?`LIVE${g.period?` · P${g.period}`:''}${g.clock?` · ${g.clock}`:''}`:g.status==='final'?'FINAL':fmt(g.scheduled_at)}${g.if_necessary?' · IF NECESSARY':''}</small></div><span class="status-pill">${g.not_required?'SKIP':esc(g.status.toUpperCase())}</span></div>`).join('')}</div>`;
  }

  function renderReadiness(){
    const root=$('operatorReadiness');if(!root)return;const c=config(),s=series(),games=eventGames(),sources=S.sources.filter(x=>x.event_id===S.eventId),streamAttached=sources.some(x=>x.source_type==='stream')||games.some(x=>x.stream_url),openCritical=S.alerts.some(x=>x.event_id===S.eventId&&x.status!=='resolved'&&x.severity==='critical');
    const checks=[['Automation configured',!!c&&c.mode!=='off',c?`Mode: ${c.mode.replace('_',' ')}`:'Save operator settings'],['Tournament games loaded',games.length>0,`${games.length} game record${games.length===1?'':'s'}`],['Series model ready',!!s,s?`BO${s.best_of} · ${s.status}`:'Official bracket/group mapping still pending'],['Public source attached',sources.some(x=>['lg_event','lg_game','stats','schedule'].includes(x.source_type)),sources.length?'Source manager active':'Attach LG source when released'],['Broadcast source attached',streamAttached,streamAttached?'Stream source found':'Attach Twitch/YouTube before puck drop'],['No critical alerts',!openCritical,openCritical?'Critical operator action required':'No critical blockers']];
    const done=checks.filter(x=>x[1]).length;$('operatorReadinessCount').textContent=`${done}/${checks.length}`;root.innerHTML=checks.map(([name,ok,note])=>`<div class="practice-check ${ok?'done':''}"><i>${ok?'✓':'·'}</i><div><strong>${esc(name)}</strong><small>${esc(note)}</small></div></div>`).join('');
  }

  function renderAlerts(){
    const root=$('operatorAlerts');if(!root)return;const rows=S.alerts.filter(x=>x.event_id===S.eventId&&x.status!=='resolved');$('operatorAlertCount').textContent=`${rows.length} OPEN`;
    root.innerHTML=rows.length?rows.map(a=>`<div class="operator-item alert-${esc(a.severity)}"><div><strong>${esc(a.severity.toUpperCase())} · ${esc(a.title)}</strong><small>${esc(a.message||'Operator attention required.')}</small><small>${fmt(a.created_at)} · ${esc(a.status.toUpperCase())}</small></div><div class="operator-actions"><button class="small-btn" type="button" data-ack-alert="${a.id}">${a.status==='acknowledged'?'Resolve':'Acknowledge'}</button></div></div>`).join(''):'<div class="empty-state">No open alerts. Suspiciously civilized.</div>';
    root.querySelectorAll('[data-ack-alert]').forEach(b=>b.onclick=async()=>{const a=S.alerts.find(x=>x.id===b.dataset.ackAlert);if(!a)return;const now=new Date().toISOString(),next=a.status==='acknowledged'?'resolved':'acknowledged';const update=next==='resolved'?{status:next,resolved_at:now}:{status:next,acknowledged_at:now};const r=await db.from('tournament_operator_alerts').update(update).eq('id',a.id);if(!r.error)await loadData(true);});
  }

  async function evaluateWarnings(){
    const c=config();if(!c)return;const live=eventGames().filter(g=>g.status==='live');for(const g of live){if(ageMinutes(g.updated_at)>num(c.stale_live_minutes)){await ensureAlert({game_id:g.id,series_id:g.series_id||null,alert_type:'live_stale',severity:'warning',title:`Game ${g.series_game_number||''} update is stale`.trim(),message:`No game-state update for about ${Math.floor(ageMinutes(g.updated_at))} minutes. Verify the stream/LG source and scoreboard.`});}}
  }

  async function autoPoll(){
    if(S.pollBusy)return;const c=config();if(!c||c.mode!=='auto_safe')return;S.pollBusy=true;try{const due=S.sources.filter(x=>x.event_id===S.eventId&&x.polling_enabled&&x.provider==='leaguegaming'&&(!x.last_checked_at||ageMinutes(x.last_checked_at)*60>=num(c.source_poll_seconds)));for(const src of due)await checkSource(src,true);}finally{S.pollBusy=false;}
  }

  function bind(){
    $('operatorEventSelect')?.addEventListener('change',e=>{S.eventId=e.target.value;S.seriesId='';loadData(true);});
    $('operatorSeriesSelect')?.addEventListener('change',e=>{S.seriesId=e.target.value;render();});
    $('operatorRefreshBtn')?.addEventListener('click',()=>loadData(false));
    $('saveOperatorConfigBtn')?.addEventListener('click',saveConfig);
    $('addSourceBtn')?.addEventListener('click',addSource);
    $('checkAllSourcesBtn')?.addEventListener('click',()=>checkAllSources(true));
  }

  bind();
  window.addEventListener('vvhl-auth-change',e=>{if(window.VVHLManagementGuard?.hasAccess(e.detail)){loadData();if(!S.refreshTimer)S.refreshTimer=setInterval(async()=>{if(!document.hidden){await loadData(true);await autoPoll();}},15000);}});
  if(window.VVHLManagementGuard?.hasAccess(window.VVHLBackend?.state)){loadData();S.refreshTimer=setInterval(async()=>{if(!document.hidden){await loadData(true);await autoPoll();}},15000);}
})();
