(() => {
  const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const SEASON=55;
  const E=id=>document.getElementById(id);
  const DB=()=>window.VVHLBackend?.db;
  const ST=()=>window.VVHLBackend?.state||{};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const T=(id,v)=>{const el=E(id);if(el)el.textContent=v??'—';};
  const H=(id,v)=>{const el=E(id);if(el)el.innerHTML=v??'';};

  let lgSeason=null;
  let locker=null;
  let reports=[];
  let weekly=[];
  let lineReports=[];
  let signedImage=null;
  let lockerClaimAttempted=false;

  const isAdmin=()=>String(ST().profile?.role||'').toLowerCase()==='admin';
  const member=()=> (ST().memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false);
  const canAccess=()=>Boolean(ST().user&&(isAdmin()||member()||ST().hitmenLockerClaim?.matched===true));
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
    const authUser=(await DB().auth.getUser()).data?.user;
    const uid=authUser?.id||ST().user?.id;
    if(!uid)return null;
    const wanted=new URLSearchParams(location.search).get('player');
    const base=()=>DB().from('team_player_lockers').select('*').eq('team_id',TEAM).eq('season',SEASON);

    const findMine=async()=>{
      const mine=await base().eq('user_id',uid).limit(1).maybeSingle();
      if(mine.error)throw mine.error;
      return mine.data||null;
    };

    let mine=await findMine();

    if(wanted){
      const target=await base().eq('id',wanted).maybeSingle();
      if(target.error)throw target.error;
      if(target.data && (canManage() || target.data.user_id===uid))return target.data;
      if(mine)return mine;
    }

    if(mine)return mine;

    // Self-heal Discord roster linkage on every fresh locker visit when needed.
    // This avoids a stale browser/auth state leaving a correctly pre-linked player
    // staring at "NO STALL LINKED" until management touches the database again.
    if(!lockerClaimAttempted){
      lockerClaimAttempted=true;
      const cr=await DB().rpc('claim_my_hitmen_discord_locker');
      if(cr.error)console.warn('Discord locker claim failed',cr.error);
      else if(cr.data?.matched===true && cr.data?.claimed===true){
        await new Promise(resolve=>setTimeout(resolve,180));
        mine=await findMine();
        if(mine)return mine;
        if(cr.data?.locker_id){
          const claimed=await base().eq('id',cr.data.locker_id).maybeSingle();
          if(claimed.error)throw claimed.error;
          if(claimed.data && claimed.data.user_id===uid)return claimed.data;
        }
      }
    }

    return null;
  }


  function gameNightKey(r){
    if(!r.game_date)return r.evidence?.night_key||'';
    return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.game_date));
  }

  function hasGameStats(r){
    const s=r.stats||{};
    return ['goals','assists','shots','saves','goals_against'].some(k=>s[k]!=null);
  }

  // Collapse visible reports only; retain every source report and review in storage.
  function mergeGameReports(input){
    const groups=new Map();
    input.forEach(r=>{
      const key=r.schedule_game_id||r.stats?.lg_game_id||
        (r.game_date&&r.opponent_name?gameNightKey(r)+'|'+r.opponent_name:r.id);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(r);
    });
    return [...groups.values()].map(rows=>{
      const statsRow=rows.find(r=>!r.ai_review_id&&hasGameStats(r))||
        rows.find(hasGameStats)||rows[0];
      const review=rows.find(r=>r.ai_review_id&&r.evidence?.verification==='approved')||statsRow;
      const merged={...review,...statsRow,ai_review_id:review.ai_review_id,stats:statsRow.stats,
        evidence:{...(statsRow.evidence||{}),...(review.evidence||{})}};
      ['strengths','improvements','tactical_notes','coach_summary'].forEach(k=>{
        const notes=[...new Set(rows.map(r=>r[k]).filter(v=>v&&v!=='Pending VOD review.'))];
        merged[k]=notes.join('\n\n')||null;
      });
      merged.evidence.unit_reports=[...new Map(rows.flatMap(r=>r.evidence?.unit_reports||[])
        .map(u=>[JSON.stringify([u.label,u.summary,u.strengths,u.concerns,u.adjustments]),u])).values()];
      if(hasGameStats(merged))merged.evidence.stat_status='imported';
      return merged;
    });
  }

  function nightRecord(rows){
    let wins=0,losses=0,otl=0;
    for(const r of rows){
      const result=String(r.result||'').toUpperCase().trim();
      if(/^W\b/.test(result))wins++;
      else if(/^OTL\b/.test(result)||(/^L\b/.test(result)&&/\bOT\b/.test(result)))otl++;
      else if(/^L\b/.test(result))losses++;
      else return null;
    }
    return wins+'-'+losses+'-'+otl;
  }

  const add=(o,k)=>Number(o?.[k]||0);
  const pimMinutes=v=>{
    if(v==null||v==='')return 0;
    const s=String(v);
    if(s.includes(':')){const [m,sec]=s.split(':').map(Number);return (Number(m)||0)+((Number(sec)||0)/60);}
    return Number(v)||0;
  };

  function officialAggregate(){
    if(!lgSeason)return null;
    const s=lgSeason.stats||{},games=Number(lgSeason.games_played||s.gp||s.ggp||0);
    const goalie=String(locker?.position||lgSeason.position||'').toUpperCase()==='G';
    const t={games,goals:0,assists:0,points:0,plus_minus:0,shots:0,hits:0,takeaways:0,giveaways:0,pim:0,blocks:0,faceoff_pct:0,passing_pct:0,foN:0,passN:0,saves:0,shots_faced:0,goals_against:0,save_pct:0};
    if(goalie){
      t.shots_faced=Number(s.sog||0);t.goals_against=Number(s.ga||0);t.saves=Math.max(0,t.shots_faced-t.goals_against);
      t.save_pct=s.savep!=null?Number(s.savep)*100:(t.shots_faced?(t.saves/t.shots_faced)*100:0);
      return t;
    }
    t.goals=Number(s.goals||0);t.assists=Number(s.assists||0);t.points=Number(s.points??(t.goals+t.assists));
    t.plus_minus=Number(s.plusminus||0);t.shots=Number(s.shots||0);t.hits=Number(s.hits||0);
    t.takeaways=Number(s.takeaway||0);t.giveaways=Number(s.giveaway||0);t.blocks=Number(s.bs||0);t.pim=pimMinutes(s.pim);
    if(s.fop!=null){t.faceoff_pct=Number(s.fop);t.foN=1}
    if(s.passp!=null){t.passing_pct=Number(s.passp);t.passN=1}
    return t;
  }

  function aggregate(){
    const official=officialAggregate();
    if(official)return official;
    const statReports=reports.filter(r=>hasGameStats(r));
    const t={games:statReports.length,goals:0,assists:0,points:0,plus_minus:0,shots:0,hits:0,takeaways:0,giveaways:0,pim:0,blocks:0,faceoff_pct:0,passing_pct:0,foN:0,passN:0,saves:0,shots_faced:0,goals_against:0,save_pct:0};
    statReports.forEach(r=>{
      const s=r.stats||{};
      ['goals','assists','plus_minus','shots','hits','takeaways','giveaways','pim'].forEach(k=>t[k]+=add(s,k));
      t.blocks+=s.blocks!=null?add(s,'blocks'):add(s,'blocked_shots');
      t.saves+=add(s,'saves');
      t.shots_faced+=add(s,'shots_faced');
      t.goals_against+=add(s,'goals_against');
      if(s.faceoff_pct!=null){t.faceoff_pct+=Number(s.faceoff_pct);t.foN++;}
      if(s.passing_pct!=null){t.passing_pct+=Number(s.passing_pct);t.passN++;}
    });
    t.points=t.goals+t.assists;
    if(t.foN)t.faceoff_pct/=t.foN;
    if(t.passN)t.passing_pct/=t.passN;
    if(t.shots_faced)t.save_pct=(t.saves/t.shots_faced)*100;
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
    const games=reports.filter(r=>hasGameStats(r)).slice(0,5).reverse();
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

  function reportStatLine(r){
    const s=r.stats||{};
    if(String(r.evidence?.stat_status||'')==='pending_box_score'&&!Object.keys(s).length){
      return '<div class="player-report-statline player-report-pending"><span><small>OFFICIAL GAME STATS</small><b>PENDING</b></span><em>Result and participation are linked. The verified LG Public Log will fill this game automatically.</em></div>';
    }
    const pos=String(r.position_played||locker?.position||'').toUpperCase();
    const goalie=pos==='G'||s.shots_faced!=null||s.saves!=null;
    const items=goalie
      ?[['SV',s.saves??0],['SA',s.shots_faced??0],['GA',s.goals_against??0],['SV%',s.save_pct_derived!=null?Number(s.save_pct_derived).toFixed(1)+'%':(Number(s.shots_faced||0)?((Number(s.saves||0)/Number(s.shots_faced))*100).toFixed(1)+'%':'—')]]
      :[['G',s.goals??0],['A',s.assists??0],['PTS',s.points??(Number(s.goals||0)+Number(s.assists||0))],['+/-',s.plus_minus??0],['S',s.shots??0],['TA',s.takeaways??0],['GV',s.giveaways??0],['BLK',s.blocks??s.blocked_shots??0]];
    if(!goalie&&s.passing_pct!=null)items.push(['PASS',Number(s.passing_pct).toFixed(1)+'%']);
    if(!goalie&&s.faceoff_pct!=null)items.push(['FO',Number(s.faceoff_pct).toFixed(1)+'%']);
    return '<div class="player-report-statline">'+items.map(([k,v])=>'<span><small>'+esc(k)+'</small><b>'+esc(v)+'</b></span>').join('')+'</div>';
  }

  function renderNightSummary(){
    const box=E('playerNightSummary');if(!box)return;
    const allRows=reports.filter(r=>r.game_date);
    if(!allRows.length){box.innerHTML='';return}
    const key=gameNightKey(allRows[0]);
    const rows=allRows.filter(r=>gameNightKey(r)===key);
    const complete=rows.every(hasGameStats);
    const s={...(rows[0].evidence?.night_totals||{})};
    s.record=nightRecord(rows)||s.record||'—';
    if(complete){
      s.games=rows.length;
      ['goals','assists','points','plus_minus','shots','hits','takeaways','giveaways','blocked_shots','pim','saves','goals_against'].forEach(k=>{
        s[k]=rows.reduce((n,r)=>n+Number(r.stats?.[k]||(k==='blocked_shots'?r.stats?.blocks:0)||0),0);
      });
      s.shots_faced=rows.reduce((n,r)=>n+Number(r.stats?.shots_faced??r.stats?.shots_against??0),0);
      s.save_pct_derived=s.shots_faced?s.saves/s.shots_faced*100:null;
    }
    const status=complete?'Individual game stats are imported from the box scores. VOD scouting appears when approved.':
      'Some individual game stats are still pending. VOD scouting appears when approved.';
    const goalie=String(locker?.position||'').toUpperCase()==='G';
    const items=goalie
      ?[['REC',s.record||'—'],['GP',s.games??rows.length],['SV',s.saves??0],['SA',s.shots_faced??0],['GA',s.goals_against??0],['SV%',s.save_pct_derived!=null?Number(s.save_pct_derived).toFixed(1)+'%':'—']]
      :[['REC',s.record||'—'],['GP',s.games??rows.length],['G',s.goals??0],['A',s.assists??0],['PTS',s.points??0],['+/-',s.plus_minus??0],['S',s.shots??0],['HIT',s.hits??0],['TA',s.takeaways??0],['GV',s.giveaways??0],['BLK',s.blocked_shots??0],['PIM',s.pim??0]];
    const gameRows=rows.slice().sort((a,b)=>new Date(a.game_date)-new Date(b.game_date));
    const label=new Date(key+'T12:00:00').toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'});
    box.innerHTML='<article class="night-summary-card"><div class="night-summary-head"><div><small>'+esc(label.toUpperCase())+' · '+rows.length+'-GAME SET</small><h3>LAST NIGHT TOTALS</h3></div><b>'+esc(s.record||'—')+'</b></div><div class="night-summary-games">'+gameRows.map(r=>'<span>'+esc(r.result||'GAME')+' · '+esc(r.opponent_name||'Opponent')+'</span>').join('')+'</div><div class="player-report-statline">'+items.map(([k,v])=>'<span><small>'+esc(k)+'</small><b>'+esc(v)+'</b></span>').join('')+'</div><p>'+esc(status)+'</p></article>';
  }

  function renderReports(){
    const box=E('playerGameReports');
    if(!box)return;
    if(!reports.length){
      box.innerHTML='<div class="locker-empty">No game reports yet. Your individual breakdowns will appear here after games are reviewed.</div>';
      return;
    }
    const baseline=window.WildmanVODReview.baseline(reports);
    const baselineText=baseline.score==null?'No approved game ratings yet.':`Game-performance baseline: ${baseline.score}/100 across ${baseline.games} rated games. This is not a permanent skill rating.`;
    box.innerHTML='<p class="locker-empty">'+esc(baselineText)+'</p>'+reports.map(r=>
      '<article class="player-report"><div class="player-report-head"><div><small>'+esc(r.game_date?new Date(r.game_date).toLocaleDateString():'GAME REPORT')+'</small><h3>'+esc(r.opponent_name||'Opponent')+(r.result?' · '+esc(r.result):'')+'</h3></div><small>'+esc(r.position_played||locker.position||'')+(r.line_label?' · '+esc(r.line_label):'')+'</small></div>'+reportStatLine(r)+(r.evidence?.rating?.score!=null?'<p>Reviewed game rating: '+esc(r.evidence.rating.score)+'/100 · '+esc(r.evidence.rating.reason||'')+'</p>':'')+'<div class="player-report-grid"><div class="report-note"><small>WHAT WORKED</small><p>'+esc(r.strengths||'Pending VOD review.')+'</p></div><div class="report-note"><small>NEXT IMPROVEMENT</small><p>'+esc(r.improvements||'Pending VOD review.')+'</p></div><div class="report-note"><small>TACTICAL NOTES</small><p>'+esc(r.tactical_notes||'Pending VOD review.')+'</p></div><div class="report-note"><small>COACH SUMMARY</small><p>'+esc(r.coach_summary||'Pending VOD review.')+'</p></div></div>'+((r.evidence?.unit_reports||[]).map(u=>'<section class="report-note"><small>'+esc(u.label)+' · LINE / D-PAIR</small><p>'+esc([u.summary,u.strengths,u.concerns,u.adjustments].filter(Boolean).join('\n'))+'</p></section>').join(''))+'</article>'
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
    const profileBits=[];
    if(locker.height_label)profileBits.push(locker.height_label);
    if(locker.weight_lbs)profileBits.push(locker.weight_lbs+' lbs');
    T('profileSalary',profileBits.length?profileBits.join(' · '):money(locker.salary));
    T('equipmentSyncLabel',String(locker.equipment_sync_status||'not_connected').replaceAll('_',' '));
    if(E('profileHandednessInput'))E('profileHandednessInput').value=locker.handedness||'';
    if(E('profilePlayerTypeInput'))E('profilePlayerTypeInput').value=locker.player_type||'';
    if(E('profileHeightInput'))E('profileHeightInput').value=locker.height_label||'';
    if(E('profileWeightInput'))E('profileWeightInput').value=locker.weight_lbs||'';
    if(E('profileCountryInput'))E('profileCountryInput').value=locker.country_code||'';
    if(E('profileSecondaryInput'))E('profileSecondaryInput').value=locker.secondary_position||'';

    const goalie=String(locker.position||'').toUpperCase()==='G';
    if(E('offenseMetrics'))E('offenseMetrics').innerHTML=goalie
      ?metric('Games',t.games)+metric('Saves',t.saves)+metric('Shots Faced',t.shots_faced)+metric('Save %',t.shots_faced?t.save_pct.toFixed(1)+'%':'—')
      :metric('Games',t.games)+metric('Goals',t.goals)+metric('Assists',t.assists)+metric('Points / Game',t.games?(t.points/t.games).toFixed(2):'0.00')+metric('Shots',t.shots);

    if(E('defenseMetrics'))E('defenseMetrics').innerHTML=goalie
      ?metric('Goals Against',t.goals_against)+metric('Saves / Game',t.games?(t.saves/t.games).toFixed(1):'0.0')+metric('GA / Game',t.games?(t.goals_against/t.games).toFixed(2):'0.00')
      :metric('+ / -',t.plus_minus)+metric('Hits',t.hits)+metric('Takeaways',t.takeaways)+metric('Giveaways',t.giveaways)+metric('Turnover Diff',t.takeaways-t.giveaways)+metric('Blocks',t.blocks);

    if(E('teamMetrics'))E('teamMetrics').innerHTML=goalie
      ?metric('Position','G')+metric('Games',t.games)+metric('Save %',t.shots_faced?t.save_pct.toFixed(1)+'%':'—')
      :metric('PIM',t.pim)+metric('Faceoff %',t.foN?t.faceoff_pct.toFixed(1)+'%':'—')+metric('Passing %',t.passN?t.passing_pct.toFixed(1)+'%':'—')+metric('Position',locker.position||'—');

    H('profileStatsTab',goalie
      ?metric('Games',t.games)+metric('Saves',t.saves)+metric('Shots Faced',t.shots_faced)+metric('Goals Against',t.goals_against)+metric('Save %',t.shots_faced?t.save_pct.toFixed(1)+'%':'—')
      :metric('Games',t.games)+metric('Goals',t.goals)+metric('Assists',t.assists)+metric('Points',t.points)+metric('Points / Game',t.games?(t.points/t.games).toFixed(2):'0.00')+metric('Shots',t.shots)+metric('Hits',t.hits)+metric('Takeaways',t.takeaways)+metric('Giveaways',t.giveaways)+metric('Blocks',t.blocks)+metric('PIM',t.pim)
    );

    H('profileScoutingTab',scoutingSummaryHtml());
    const vodReviewed=reports.filter(r=>r.coach_summary||r.tactical_notes||r.strengths||r.improvements||String(r.evidence?.vod_status||'').toLowerCase()==='complete').length;
    const pendingBoxes=reports.filter(r=>!hasGameStats(r)&&String(r.evidence?.stat_status||'')==='pending_box_score').length;
    let vodText=vodReviewed
      ?vodReviewed+' VOD-reviewed game'+(vodReviewed===1?'':'s')+' currently feed this player profile.'
      :reports.length?'Game results and stat history are loaded. VOD scouting is pending.':'Game review evidence will populate here as VOD reports are attached.';
    if(pendingBoxes)vodText+=' '+pendingBoxes+' recent game box'+(pendingBoxes===1?' is':'es are')+' linked and waiting on the official LG Public Logs.';
    T('profileVodSummary',vodText);

    renderDashboardScouting();
    renderWeeklyPerformance();
    renderNightSummary();
    renderReports();
    renderWeekly();
    renderLineReports();
    syncFlipButtons();
  }

  async function load(){
    if(!canAccess()||!DB())return;
    try{
      locker=await chooseLocker();
      if(!locker){
        // One delayed re-check covers OAuth redirects where the identity/membership
        // finishes settling a fraction after the first auth-change event.
        if(!load._rechecked){
          load._rechecked=true;
          setTimeout(()=>load(),650);
          T('playerTitle','LINKING LOCKER…');
          T('profileStatusText','Checking your Discord roster link.');
          return;
        }
        T('playerTitle','NO STALL LINKED');
        T('profileStatusText','Discord account is signed in, but no roster locker is linked.');
        T('profileAvailability','LINK NEEDED');
        H('stallScoutingNotes','<div class="locker-empty">Your Discord login worked, but this account is not mapped to a Season 55 locker yet. Management can fix the Discord-to-roster link without creating a new account.</div>');
        return;
      }
      let seasonStatQuery=DB().from('lg_player_season_stats').select('games_played,stats,fetched_at,position,lg_user_id,gamertag').eq('season',SEASON).eq('league_code','LGCHL');
      seasonStatQuery=locker.lg_user_id?seasonStatQuery.eq('lg_user_id',locker.lg_user_id):seasonStatQuery.ilike('gamertag',locker.gamertag);
      const [gr,wr,lr,sr]=await Promise.all([
        DB().from('team_player_game_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('game_date',{ascending:false}),
        DB().from('team_player_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('week',{ascending:false}),
        DB().from('team_line_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).order('week',{ascending:false}),
        seasonStatQuery.order('fetched_at',{ascending:false}).limit(1).maybeSingle()
      ]);
      if(gr.error)throw gr.error;
      if(wr.error)throw wr.error;
      if(lr.error)throw lr.error;
      if(sr.error)console.warn('LG season stat snapshot unavailable',sr.error);
      reports=mergeGameReports((gr.data||[]).filter(r=>!r.ai_review_id||r.evidence?.verification==='approved'));
      weekly=wr.data||[];
      lineReports=(lr.data||[]).filter(r=>(r.player_locker_ids||[]).includes(locker.id));
      lgSeason=sr.data||null;
      await render();
    }catch(e){
      console.error(e);
      T('playerTitle','LOCKER UNAVAILABLE');
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

  E('savePlayerProfile')?.addEventListener('click',async()=>{
    if(!canEdit()||!locker)return;
    const weightRaw=String(E('profileWeightInput')?.value||'').trim();
    const payload={
      handedness:E('profileHandednessInput')?.value||null,
      player_type:E('profilePlayerTypeInput')?.value.trim()||null,
      height_label:E('profileHeightInput')?.value.trim()||null,
      weight_lbs:weightRaw?Number(weightRaw):null,
      country_code:E('profileCountryInput')?.value.trim().toUpperCase()||null,
      secondary_position:E('profileSecondaryInput')?.value.trim().toUpperCase()||null,
      updated_at:new Date().toISOString()
    };
    T('profileSaveStatus','Saving…');
    const r=await DB().from('team_player_lockers').update(payload).eq('id',locker.id).eq('team_id',TEAM).select('*').single();
    if(r.error){T('profileSaveStatus',r.error.message);return;}
    locker=r.data;
    T('profileSaveStatus','Saved ✓');
    await render();
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
