(() => {
  const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const SEASON=55;
  const E=id=>document.getElementById(id);
  const DB=()=>window.VVHLBackend?.db;
  const ST=()=>window.VVHLBackend?.state||{};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const T=(id,v)=>{const el=E(id);if(el)el.textContent=v??'—';};
  const H=(id,v)=>{const el=E(id);if(el)el.innerHTML=v??'';};

  let locker=null;
  let reports=[];
  let weekly=[];
  let lineReports=[];
  let signedImage=null;
  let loadSeq=0;

  const isAdmin=()=>String(ST().profile?.role||'').toLowerCase()==='admin';
  const member=()=> (ST().memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false);
  const canAccess=()=>Boolean(ST().user&&(isAdmin()||member()));
  const canManage=()=>isAdmin()||['owner','gm','agm'].includes(String(member()?.role||'').toLowerCase());
  const canEdit=()=>Boolean(locker&&(canManage()||locker.user_id===ST().user?.id));
  const money=v=>v==null?'—':Number(v)===0?'MANAGEMENT':'$'+(Number(v)/1000000).toFixed(Number(v)%1000000?2:0)+'M';

  function gate(){
    const ok=canAccess();
    const content=document.querySelector('[data-locker-content]');
    const locked=E('lockerLockedMessage');
    const accessShell=document.querySelector('.locker-access-shell');
    if(content)content.hidden=!ok;
    if(locked)locked.hidden=ok;
    if(accessShell)accessShell.hidden=ok;
    if(ok)load();
  }

  async function chooseLocker(){
    const params=new URLSearchParams(location.search);
    const wanted=params.get('player');
    const inspect=params.get('inspect')==='1';
    const claimedLocker=ST().hitmenLockerClaim?.locker_id||null;
    const userId=ST().user?.id||null;

    async function by(field,value){
      if(!value)return null;
      const r=await DB().from('team_player_lockers')
        .select('*')
        .eq('team_id',TEAM)
        .eq('season',SEASON)
        .eq(field,value)
        .limit(1)
        .maybeSingle();
      if(r.error)throw r.error;
      return r.data||null;
    }

    // Explicit team browsing is allowed for signed-in team members, but it
    // must be marked inspect=1. Normal Discord/player entry always resolves
    // the signed-in person's own locker first.
    if(inspect&&wanted){
      const inspected=await by('id',wanted);
      if(inspected)return inspected;
    }

    const claimed=await by('id',claimedLocker);
    if(claimed)return claimed;

    const own=await by('user_id',userId);
    if(own)return own;

    // Backward compatibility: an old player= URL may still be valid if it
    // points to the signed-in player's own locker.
    if(wanted){
      const legacy=await by('id',wanted);
      if(legacy&&legacy.user_id===userId)return legacy;
    }

    return null;
  }

  const add=(o,k)=>Number(o?.[k]||0);

  function aggregate(){
    const t={games:reports.length,goals:0,assists:0,points:0,plus_minus:0,shots:0,hits:0,takeaways:0,giveaways:0,pim:0,blocks:0,faceoff_pct:0,passing_pct:0,foN:0,passN:0};
    reports.forEach(r=>{
      const s=r.stats||{};
      ['goals','assists','plus_minus','shots','hits','takeaways','giveaways','pim','blocks'].forEach(k=>t[k]+=add(s,k));
      if(s.faceoff_pct!=null){t.faceoff_pct+=Number(s.faceoff_pct);t.foN++;}
      if(s.passing_pct!=null){t.passing_pct+=Number(s.passing_pct);t.passN++;}
    });
    t.points=t.goals+t.assists;
    if(t.foN)t.faceoff_pct/=t.foN;
    if(t.passN)t.passing_pct/=t.passN;
    return t;
  }

  const metric=(label,value)=>'<div class="metric-row"><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>';

  async function imageUrl(path){
    if(!path)return null;
    const r=await DB().storage.from('hitmen-player-images').createSignedUrl(path,3600);
    return r.error?null:r.data?.signedUrl||null;
  }

  function positionLong(p){
    return ({LW:'Left Wing',C:'Center',RW:'Right Wing',LD:'Left Defense',RD:'Right Defense',G:'Goaltender'})[String(p||'').toUpperCase()]||p||'—';
  }

  function paintStall(name,num){
    const host=E('stallScene');
    if(!host||!window.HitmenStall)return;
    const opts={name,number:num,empty:false};
    if(!host.firstChild)HitmenStall.mount(host,opts);
    else HitmenStall.update(host,opts);
    requestAnimationFrame(syncFlipButtons);
  }

  function setStallView(back){
    const stall=E('stallScene')?.querySelector('.hs-stall');
    if(!stall||!window.HitmenStall)return;
    HitmenStall.setBack(stall,Boolean(back));
    syncFlipButtons();
  }

  function syncFlipButtons(){
    const back=Boolean(E('stallScene')?.querySelector('.hs-stall')?.classList.contains('is-back'));
    E('jerseyFrontBtn')?.classList.toggle('active',!back);
    E('jerseyBackBtn')?.classList.toggle('active',back);
  }

  function scoutingSummaryHtml(){
    const items=[
      ['Strengths',locker?.scouting_strengths],
      ['Development',locker?.development_focus],
      ['Tendencies',locker?.scouting_tendencies],
      ['Chemistry',locker?.chemistry_notes]
    ].filter(([,v])=>v);
    return items.length
      ?items.map(([k,v])=>'<div class="profile-scout-line"><small>'+esc(k.toUpperCase())+'</small><p>'+esc(v)+'</p></div>').join('')
      :'<div class="locker-empty">Scouting and development notes will populate as the season is reviewed.</div>';
  }

  function renderDashboardScouting(){
    const box=E('stallScoutingNotes');
    if(!box)return;
    const notes=[
      {tone:'good',title:'Strengths',text:locker?.scouting_strengths||weekly[0]?.strengths},
      {tone:'focus',title:'Development Focus',text:locker?.development_focus||weekly[0]?.focus_next_week},
      {tone:'neutral',title:'Line / Chemistry',text:locker?.chemistry_notes||lineReports[0]?.summary}
    ].filter(x=>x.text);
    box.innerHTML=notes.length
      ?notes.map(x=>'<div class="stall-note '+x.tone+'"><i></i><div><b>'+esc(x.title)+'</b><p>'+esc(x.text)+'</p></div></div>').join('')
      :'<div class="locker-empty">Player notes will populate after coaching and game review.</div>';
  }

  function shortTeam(v){
    const parts=String(v||'').trim().split(/\s+/);
    return parts.length>1?parts.map(x=>x[0]).join('').slice(0,4).toUpperCase():String(v||'OPP').slice(0,4).toUpperCase();
  }

  function renderWeeklyPerformance(){
    const box=E('weeklyPerformanceChart');
    if(!box)return;
    const games=reports.slice(0,5).reverse();
    if(!games.length){
      box.innerHTML='<div class="weekly-chart-empty">GAME DATA WILL POPULATE HERE</div>';
      return;
    }
    const vals=games.map(r=>{
      const s=r.stats||{};
      return {p:Number(s.goals||0)+Number(s.assists||0),opp:r.opponent_name||'OPP',res:r.result||''};
    });
    const max=Math.max(1,...vals.map(x=>x.p));
    box.innerHTML='<div class="weekly-bars">'+vals.map(x=>
      '<div class="weekly-bar-item"><div class="weekly-bar-track"><i style="height:'+Math.max(8,Math.round((x.p/max)*100))+'%"></i></div><b>'+x.p+' PT'+(x.p===1?'':'S')+'</b><small>'+esc(x.res||'GAME')+' · '+esc(shortTeam(x.opp))+'</small></div>'
    ).join('')+'</div>';
  }

  function renderReports(){
    const box=E('playerGameReports');
    if(!box)return;
    if(!reports.length){
      box.innerHTML='<div class="locker-empty">No game reports yet. Your individual breakdowns will appear here after games are reviewed.</div>';
      return;
    }
    box.innerHTML=reports.map(r=>
      '<article class="player-report"><div class="player-report-head"><div><small>'+esc(r.game_date?new Date(r.game_date).toLocaleDateString():'GAME REPORT')+'</small><h3>'+esc(r.opponent_name||'Opponent')+(r.result?' · '+esc(r.result):'')+'</h3></div><small>'+esc(r.position_played||locker.position||'')+(r.line_label?' · '+esc(r.line_label):'')+'</small></div><div class="player-report-grid"><div class="report-note"><small>WHAT WORKED</small><p>'+esc(r.strengths||'Pending review.')+'</p></div><div class="report-note"><small>NEXT IMPROVEMENT</small><p>'+esc(r.improvements||'Pending review.')+'</p></div><div class="report-note"><small>TACTICAL NOTES</small><p>'+esc(r.tactical_notes||'No tactical notes yet.')+'</p></div><div class="report-note"><small>COACH SUMMARY</small><p>'+esc(r.coach_summary||'Report is still being built.')+'</p></div></div></article>'
    ).join('');
  }

  function renderWeekly(){
    const box=E('playerWeeklyReport');
    if(!box)return;
    const r=weekly[0];
    if(!r){
      box.innerHTML='<div class="locker-empty">Your first weekly development report will appear after Week 1 games are reviewed.</div>';
      return;
    }
    T('weeklyLabel','WEEK '+r.week);
    box.innerHTML='<div class="weekly-card"><div><h4>WEEK SUMMARY</h4><p>'+esc(r.summary||'—')+'</p></div><div><h4>STRENGTHS</h4><p>'+esc(r.strengths||'—')+'</p></div><div><h4>NEXT WEEK FOCUS</h4><p>'+esc(r.focus_next_week||'—')+'</p></div></div>';
  }

  function renderLineReports(){
    const box=E('playerLineReports');
    if(!box)return;
    if(!lineReports.length){
      box.innerHTML='<div class="locker-empty">Your unit’s weekly chemistry report will appear once line reports are created.</div>';
      return;
    }
    box.innerHTML=lineReports.slice(0,4).map(r=>
      '<article class="player-report"><div class="player-report-head"><div><small>WEEK '+r.week+'</small><h3>'+esc(r.line_label)+'</h3></div><small>'+esc(r.record||'')+'</small></div><div class="player-report-grid"><div class="report-note"><small>UNIT SUMMARY</small><p>'+esc(r.summary||'—')+'</p></div><div class="report-note"><small>NEXT ADJUSTMENTS</small><p>'+esc(r.next_adjustments||'—')+'</p></div></div></article>'
    ).join('');
  }

  async function render(){
    if(!locker)return;

    const displayName=(locker.jersey_name||locker.gamertag||'PLAYER').toUpperCase();
    const displayNum=String(locker.jersey_number||'').replace(/\D/g,'').slice(0,2);

    T('playerSideName',locker.gamertag);
    T('playerSidePos',locker.position||'—');
    T('playerTitle',locker.gamertag);
    T('playerClaimStatus',locker.user_id?'PLAYER ACCESS LINKED':'STALL NOT YET CLAIMED');

    if(E('jerseyNameInput'))E('jerseyNameInput').value=locker.jersey_name||locker.gamertag;
    if(E('jerseyNumberInput'))E('jerseyNumberInput').value=displayNum;
    paintStall(displayName,displayNum);

    if(E('editLockerBox'))E('editLockerBox').hidden=!canEdit();
    if(E('uploadChelImage'))E('uploadChelImage').disabled=!canEdit();
    if(E('chelImageInput'))E('chelImageInput').disabled=!canEdit();

    signedImage=await imageUrl(locker.chel_player_image_path);
    const photo=signedImage?'<img src="'+esc(signedImage)+'" alt="">':'<span>CHEL</span>';
    H('playerMiniImage',photo);
    H('uploadPreview',signedImage?'<img src="'+esc(signedImage)+'" alt="CHEL player upload">':'<span>NO IMAGE YET</span>');
    H('profileChelSilhouette',signedImage?'<img src="'+esc(signedImage)+'" alt="CHEL player">':'<span>CHEL</span>');

    const t=aggregate();
    T('performanceSample',t.games+' GAME'+(t.games===1?'':'S'));

    [
      ['psGoals',t.goals],['psAssists',t.assists],['psPoints',t.points],['psPlusMinus',t.plus_minus],
      ['psShots',t.shots],['psHits',t.hits],['psTakeaways',t.takeaways],['psGiveaways',t.giveaways],
      ['profileGP',t.games],['profileGoals',t.goals],['profileAssists',t.assists],['profilePoints',t.points],['profilePlusMinus',t.plus_minus]
    ].forEach(([id,v])=>T(id,v));

    T('profileGamertag',locker.gamertag);
    T('profileBioPosition',locker.position||'—');
    T('profileBioHandedness',locker.handedness||'—');
    T('profilePlayerType',locker.player_type||'—');
    T('profileDepthRole',locker.depth_role||locker.management_role||'Roster');
    T('profileDepthLine',locker.depth_line||'Unassigned');
    T('profileStatusText',String(locker.availability_status||'active roster').replaceAll('_',' '));
    T('profileAvailability',String(locker.availability_status||'ACTIVE').replaceAll('_',' ').toUpperCase());
    T('profileNumberPos',(displayNum?'#'+displayNum:'#—')+' · '+(locker.position||'—'));
    T('profilePositionLong',positionLong(locker.position));
    T('profileHandedness',locker.handedness?locker.handedness+' handed':'Handedness —');
    T('profileSalary',money(locker.salary));
    T('equipmentSyncLabel',String(locker.equipment_sync_status||'not_connected').replaceAll('_',' '));

    if(E('offenseMetrics'))E('offenseMetrics').innerHTML=
      metric('Games',t.games)+metric('Goals',t.goals)+metric('Assists',t.assists)+
      metric('Points / Game',t.games?(t.points/t.games).toFixed(2):'0.00')+metric('Shots',t.shots);

    if(E('defenseMetrics'))E('defenseMetrics').innerHTML=
      metric('+ / -',t.plus_minus)+metric('Hits',t.hits)+metric('Takeaways',t.takeaways)+
      metric('Giveaways',t.giveaways)+metric('Turnover Diff',t.takeaways-t.giveaways)+metric('Blocks',t.blocks);

    if(E('teamMetrics'))E('teamMetrics').innerHTML=
      metric('PIM',t.pim)+metric('Faceoff %',t.foN?t.faceoff_pct.toFixed(1)+'%':'—')+
      metric('Passing %',t.passN?t.passing_pct.toFixed(1)+'%':'—')+metric('Position',locker.position||'—');

    H('profileStatsTab',
      metric('Games',t.games)+metric('Goals',t.goals)+metric('Assists',t.assists)+metric('Points',t.points)+
      metric('Points / Game',t.games?(t.points/t.games).toFixed(2):'0.00')+metric('Shots',t.shots)+
      metric('Hits',t.hits)+metric('Takeaways',t.takeaways)+metric('Giveaways',t.giveaways)+metric('Blocks',t.blocks)+metric('PIM',t.pim)
    );

    H('profileScoutingTab',scoutingSummaryHtml());
    T('profileVodSummary',reports.length?reports.length+' reviewed game'+(reports.length===1?'':'s')+' currently feed this player profile.':'Game review evidence will populate here as VOD reports are attached.');

    renderDashboardScouting();
    renderWeeklyPerformance();
    renderReports();
    renderWeekly();
    renderLineReports();
    syncFlipButtons();
  }

  async function load(){
    if(!canAccess()||!DB())return;
    const seq=++loadSeq;
    try{
      let resolved=await chooseLocker();
      if(seq!==loadSeq)return;

      // Discord auth can emit more than one state change while the locker claim
      // finishes. Retry once before declaring the player unlinked.
      if(!resolved){
        await new Promise(r=>setTimeout(r,300));
        if(seq!==loadSeq)return;
        resolved=await chooseLocker();
      }

      if(seq!==loadSeq)return;

      // Never let a transient second auth pass erase an already-resolved locker.
      if(!resolved){
        if(locker)return;
        T('playerTitle','NO STALL LINKED');
        return;
      }

      locker=resolved;

      const [gr,wr,lr]=await Promise.all([
        DB().from('team_player_game_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('game_date',{ascending:false}),
        DB().from('team_player_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('week',{ascending:false}),
        DB().from('team_line_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).order('week',{ascending:false})
      ]);

      if(seq!==loadSeq)return;
      if(gr.error)throw gr.error;
      if(wr.error)throw wr.error;
      if(lr.error)throw lr.error;

      reports=gr.data||[];
      weekly=wr.data||[];
      lineReports=(lr.data||[]).filter(r=>(r.player_locker_ids||[]).includes(locker.id));

      if(seq!==loadSeq)return;
      await render();
    }catch(e){
      if(seq!==loadSeq)return;
      console.error(e);
      if(!locker)T('playerTitle','LOCKER UNAVAILABLE');
    }
  }
  const liveStall=()=>{
    if(!locker)return;
    const name=E('jerseyNameInput')?.value.trim()||locker.gamertag||'';
    const num=(E('jerseyNumberInput')?.value||'').replace(/\D/g,'').slice(0,2);
    paintStall(name,num);
  };

  E('jerseyNameInput')?.addEventListener('input',liveStall);
  E('jerseyNumberInput')?.addEventListener('input',e=>{
    e.target.value=e.target.value.replace(/\D/g,'').slice(0,2);
    liveStall();
  });

  E('saveJersey')?.addEventListener('click',async()=>{
    if(!canEdit()||!locker)return;
    const name=E('jerseyNameInput')?.value.trim().slice(0,18)||locker.gamertag;
    const num=(E('jerseyNumberInput')?.value||'').trim();
    T('jerseySaveStatus','Saving…');
    const r=await DB().from('team_player_lockers').update({
      jersey_name:name,
      jersey_number:num||null,
      updated_at:new Date().toISOString()
    }).eq('id',locker.id);
    T('jerseySaveStatus',r.error?r.error.message:'Saved ✓');
    if(!r.error){
      locker.jersey_name=name;
      locker.jersey_number=num||null;
      await render();
    }
  });

  E('uploadChelImage')?.addEventListener('click',async()=>{
    if(!canEdit()||!locker)return;
    const file=E('chelImageInput')?.files?.[0];
    if(!file){T('uploadStatus','Choose an image first.');return;}
    if(file.size>8*1024*1024){T('uploadStatus','Keep the image under 8 MB.');return;}
    T('uploadStatus','Uploading…');
    const ownerFolder=locker.user_id||ST().user.id;
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
    const path=TEAM+'/'+ownerFolder+'/'+locker.id+'-'+Date.now()+'.'+ext;
    const up=await DB().storage.from('hitmen-player-images').upload(path,file,{upsert:false,contentType:file.type});
    if(up.error){T('uploadStatus',up.error.message);return;}
    const save=await DB().from('team_player_lockers').update({
      chel_player_image_path:path,
      chel_player_image_updated_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq('id',locker.id);
    if(save.error){T('uploadStatus',save.error.message);return;}
    locker.chel_player_image_path=path;
    T('uploadStatus','Uploaded ✓');
    await render();
  });

  E('jerseyFrontBtn')?.addEventListener('click',()=>setStallView(false));
  E('jerseyBackBtn')?.addEventListener('click',()=>setStallView(true));

  document.querySelectorAll('[data-stall-tab-jump]').forEach(btn=>btn.addEventListener('click',()=>{
    const target=btn.dataset.stallTabJump;
    document.querySelector('[data-stall-tab="'+target+'"]')?.click();
  }));

  document.querySelectorAll('[data-stall-tab]').forEach(btn=>btn.addEventListener('click',()=>{
    const tab=btn.dataset.stallTab;
    document.querySelectorAll('[data-stall-tab]').forEach(b=>b.classList.toggle('active',b===btn));
    document.querySelectorAll('[data-stall-panel]').forEach(p=>p.classList.toggle('active',p.dataset.stallPanel===tab));
  }));

  document.querySelectorAll('[data-tool-target]').forEach(btn=>btn.addEventListener('click',()=>{
    const target=btn.dataset.toolTarget;
    if(target==='profile'){
      E('profile')?.scrollIntoView({behavior:'smooth',block:'start'});
      return;
    }
    if(target==='settings'||target==='equipment'){
      document.querySelector('[data-stall-tab="settings"]')?.click();
      document.querySelector('.stall-player-profile')?.scrollIntoView({behavior:'smooth',block:'start'});
    }
  }));

  if(window.MutationObserver){
    const host=E('stallScene');
    if(host)new MutationObserver(()=>syncFlipButtons()).observe(host,{subtree:true,attributes:true,attributeFilter:['class']});
  }

  paintStall('','');
  window.addEventListener('vvhl-auth-change',gate);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',gate);
  else gate();
})();