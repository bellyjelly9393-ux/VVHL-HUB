(function(){
  'use strict';
  var PRODUCTION_ORIGIN='https://wildmanhockey-elitechelmedia.app';
  var OBS_CFG=window.WM_OBS_CONFIG||{defaultFeedFor:function(){return '';}};
  var SCENES=window.WM_OBS_SCENES||null;
  var TEAM_CONFIG={
    '5f36117c-7a51-4514-bf70-d4c672b41e48':{name:'Wildman Hockey',brand:'wildman',channel:'wildman-main'},
    'b0bcbdda-da9d-419d-8f61-b34937966d49':{name:'Calgary Hitmen',brand:'hitmen',channel:'hitmen-main'}
  };
  var currentTeamId='';
  var currentScene='game';
  var currentPresetId='game-matchup';
  var initialized=false;
  var stateRef=null;
  var lastUserId='';
  var previewChannel='';
  var editCount=0;        // bumps on every manual edit; protects unsaved typing from auto refills
  var savedEditCount=0;
  var publishing=false;
  var publishQueued=false;
  var clockState={running:false,baseSeconds:1200,startedAt:'',rate:5};
  var clockUiTimer=null;

  function byId(id){return document.getElementById(id);}
  function val(id){return (byId(id)?.value||'').trim();}
  function clampInt(v,min,max,fallback){var n=parseInt(v,10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}
  function numberVal(id){var n=parseInt(byId(id)?.value||'0',10);return Number.isFinite(n)&&n>=0?n:0;}
  function parseClock(value,fallback){
    var raw=String(value||'').trim();
    var parts=raw.split(':');
    if(parts.length===2){
      var m=parseInt(parts[0],10),s=parseInt(parts[1],10);
      if(Number.isFinite(m)&&Number.isFinite(s)&&m>=0&&s>=0&&s<60)return m*60+s;
    }
    var n=parseInt(raw,10);
    return Number.isFinite(n)&&n>=0?n:(fallback==null?1200:fallback);
  }
  function formatClock(seconds){
    var total=Math.max(0,Math.round(Number(seconds)||0));
    var m=Math.floor(total/60),s=total%60;
    return String(m)+':'+String(s).padStart(2,'0');
  }
  function clockSecondsNow(){
    var base=Math.max(0,Number(clockState.baseSeconds)||0);
    if(!clockState.running||!clockState.startedAt)return base;
    var start=Date.parse(clockState.startedAt);
    if(!Number.isFinite(start))return base;
    var elapsed=Math.max(0,(Date.now()-start)/1000);
    return Math.max(0,base-elapsed*(Number(clockState.rate)||1));
  }
  function syncClockUi(){
    var seconds=clockSecondsNow();
    var display=byId('obsClockDisplay');
    var status=byId('obsClockStatus');
    if(display)display.textContent=formatClock(seconds);
    if(status){
      var active=clockState.running&&seconds>0;
      status.textContent=active?'RUNNING · '+(Number(clockState.rate)||1)+'×':'PAUSED';
      status.classList.toggle('running',active);
    }
    if(clockState.running&&seconds<=0){clockState.running=false;clockState.baseSeconds=0;clockState.startedAt='';}
  }
  function setClockFromPayload(payload){
    var p=payload||{};
    var fallback=parseClock(p.clock||'20:00',1200);
    clockState.rate=[1,4,5,6].includes(Number(p.clockRate))?Number(p.clockRate):5;
    clockState.baseSeconds=Number.isFinite(Number(p.clockBaseSeconds))?Math.max(0,Number(p.clockBaseSeconds)):fallback;
    clockState.startedAt=String(p.clockStartedAt||'');
    clockState.running=p.clockRunning===true&&!!clockState.startedAt;
    if(byId('obsClockRate'))byId('obsClockRate').value=String(clockState.rate);
    if(byId('obsClock'))byId('obsClock').value=formatClock(clockSecondsNow());
    syncClockUi();
  }
  function clockSnapshot(){
    var seconds=clockSecondsNow();
    var active=clockState.running&&seconds>0;
    return {
      clock:formatClock(seconds),
      clockRunning:active,
      clockBaseSeconds:active?Math.max(0,Number(clockState.baseSeconds)||0):Math.max(0,seconds),
      clockStartedAt:active?clockState.startedAt:'',
      clockRate:Number(clockState.rate)||1
    };
  }
  function setStatus(message,isError){
    var status=byId('publishStatus');
    var pill=byId('stateUpdated');
    if(status) status.textContent=message;
    if(pill){pill.textContent=message;pill.style.color=isError?'#ff8a9b':'';}
  }
  function config(){return TEAM_CONFIG[currentTeamId]||TEAM_CONFIG['5f36117c-7a51-4514-bf70-d4c672b41e48'];}
  function stageUrl(){return PRODUCTION_ORIGIN+'/obs-stage.html?channel='+encodeURIComponent(config().channel);}
  function overlayUrl(){return PRODUCTION_ORIGIN+'/obs-overlay.html?channel='+encodeURIComponent(config().channel);}
  function feedLayerUrl(){return stageUrl()+'&layer=feed';}
  function isDirty(){return editCount!==savedEditCount;}
  function providerFor(url,provided){
    var p=String(provided||'').toLowerCase();
    if(p&&p!=='auto')return p;
    var raw=String(url||'').toLowerCase();
    if(raw.includes('twitch.tv'))return 'twitch';
    if(raw.includes('youtube.com')||raw.includes('youtu.be'))return 'youtube';
    if(/\.mp4(?:$|\?)/i.test(raw))return 'video';
    return 'external';
  }
  function feedSummary(){
    var url=val('obsStreamUrl');
    var status=byId('streamFeedStatus');
    if(!status)return;
    if(!url){status.textContent='No feed attached yet.';return;}
    var provider=providerFor(url,val('obsStreamProvider'));
    status.textContent='Attached · '+provider.toUpperCase()+(byId('obsStreamMuted')?.checked?' · MUTED':' · AUDIO ON')+
      (provider==='twitch'?' · In OBS use the Feed Layer source under the Overlay source (Twitch pauses under graphics)':'');
  }
  function updateSourceLinks(){
    var stage=stageUrl(),overlay=overlayUrl();
    byId('obsSourceUrl').value=stage;
    byId('openObsUrl').href=stage;
    byId('obsOverlayOnlyUrl').value=overlay;
    byId('openOverlayUrl').href=overlay;
    byId('openCombinedStage').href=stage;
    if(byId('obsFeedLayerUrl')){byId('obsFeedLayerUrl').value=feedLayerUrl();byId('openFeedLayerUrl').href=feedLayerUrl();}
    byId('heroChannel').textContent=config().channel.toUpperCase();
    // Only reload the preview when the channel actually changes; it follows edits through realtime.
    if(previewChannel!==config().channel){
      previewChannel=config().channel;
      byId('obsPreview').src='obs-stage.html?channel='+encodeURIComponent(previewChannel)+'&preview=1';
    }
  }
  function allowedTeamIds(state){
    var role=String(state.profile?.role||'').toLowerCase();
    if(role==='admin'||role==='commissioner') return Object.keys(TEAM_CONFIG);
    var ids=(state.memberships||[])
      .filter(function(m){return m.active!==false&&['owner','gm','agm'].includes(String(m.role||'').toLowerCase());})
      .map(function(m){return m.team_id;});
    return Object.keys(TEAM_CONFIG).filter(function(id){return ids.includes(id);});
  }
  function populateTeams(state){
    var select=byId('obsTeamSelect');
    var ids=allowedTeamIds(state);
    if(!ids.length) return false;
    select.innerHTML=ids.map(function(id){return '<option value="'+id+'">'+TEAM_CONFIG[id].name+'</option>';}).join('');
    var preferred=ids.includes(currentTeamId)?currentTeamId:(ids.includes(state.teamId)?state.teamId:ids[0]);
    select.value=preferred;
    currentTeamId=preferred;
    return true;
  }
  // Player Stream dropdown: the list lives in obs-config.js (playerStreams); "Custom" = typed URL.
  function populateStreams(){
    var select=byId('obsPlayerStream');if(!select)return;
    var list=(OBS_CFG.playerStreams||[]);
    select.innerHTML=list.map(function(s,i){return '<option value="'+i+'">'+String(s.label).replace(/[<>&"]/g,'')+'</option>';}).join('')+'<option value="custom">Custom URL (type below)</option>';
  }
  function syncStreamSelect(){
    var select=byId('obsPlayerStream');if(!select)return;
    var url=val('obsStreamUrl').toLowerCase().replace(/\/+$/,'');
    var i=(OBS_CFG.playerStreams||[]).findIndex(function(s){return String(s.url).toLowerCase().replace(/\/+$/,'')===url;});
    select.value=i>=0?String(i):'custom';
  }
  function updateScoreDisplay(){
    byId('homeScoreDisplay').textContent=numberVal('obsHomeScore');
    byId('awayScoreDisplay').textContent=numberVal('obsAwayScore');
  }
  function renderSceneButtons(){
    var strip=byId('obsSceneStrip');
    if(!strip)return;
    var list=SCENES&&Array.isArray(SCENES.all)?SCENES.all:[];
    if(!list.length){
      strip.innerHTML='<button type="button" data-preset="game-matchup" data-scene="game"><b>Gameplay</b><small>Matchup Panel</small></button>';
      return;
    }
    strip.innerHTML=list.map(function(item){
      return '<button type="button" data-preset="'+item.id+'" data-scene="'+item.scene+'">'+
        '<b>'+item.label+'</b><small>'+item.sublabel+'</small></button>';
    }).join('');
  }
  function setSceneButtons(){
    document.querySelectorAll('#obsSceneStrip [data-preset]').forEach(function(button){
      button.classList.toggle('active',button.dataset.preset===currentPresetId);
    });
  }
  function setValue(id,value){var node=byId(id);if(node)node.value=value;}
  function setChecked(id,value){var node=byId(id);if(node)node.checked=Boolean(value);}
  function applyScenePreset(presetId){
    var definition=SCENES&&SCENES.get?SCENES.get(presetId):null;
    if(!definition){
      definition={id:'game-matchup',scene:'game',preset:{
        feedLayout:'panel',sidePanel:'matchup',bugPosition:'hidden',
        showScoreboard:false,logoBug:'auto',logoPreset:'ea',logoSize:48,streamMuted:false
      }};
    }
    var preset=definition.preset||{};
    currentPresetId=definition.id;
    currentScene=definition.scene||'game';

    if(preset.feedLayout!==undefined)setValue('obsFeedLayout',preset.feedLayout);
    if(preset.sidePanel!==undefined)setValue('obsSidePanel',preset.sidePanel);
    if(preset.bugPosition!==undefined)setValue('obsBugPosition',preset.bugPosition);
    if(preset.showScoreboard!==undefined)setChecked('obsShowScoreboard',preset.showScoreboard);
    if(preset.logoBug!==undefined)setValue('obsLogoBug',preset.logoBug);
    if(preset.logoPreset!==undefined)setValue('obsLogoPreset',preset.logoPreset);
    if(preset.logoSize!==undefined)setValue('obsLogoSize',preset.logoSize);
    if(preset.streamMuted!==undefined)setChecked('obsStreamMuted',preset.streamMuted);

    editCount++;
    setSceneButtons();
    feedSummary();
  }
  function fill(row){
    if(!row) return;
    var p=row.payload||{};
    currentScene=row.scene||'game';
    var savedPreset=SCENES&&SCENES.infer?SCENES.infer(currentScene,p):null;
    currentPresetId=savedPreset?savedPreset.id:'game-matchup';
    byId('obsEvent').value=p.event||'';
    byId('obsHomeName').value=p.homeName||config().name;
    // 'OPPONENT' was the old placeholder; blank lets the overlay use tonight's opponent.
    byId('obsAwayName').value=String(p.awayName||'').trim().toUpperCase()==='OPPONENT'?'':(p.awayName||'');
    byId('obsBugPosition').value=['left','right','hidden'].includes(p.bugPosition)?p.bugPosition:'hidden';
    byId('obsShowScoreboard').checked=p.showScoreboard===true;
    byId('obsLogoBug').value=['auto','on','off'].includes(p.logoBug)?p.logoBug:'auto';
    byId('obsLogoPreset').value=['ea','top-left','top-right','bottom-right'].includes(p.logoPreset)?p.logoPreset:'ea';
    byId('obsLogoSize').value=Number.isFinite(Number(p.logoSize))&&p.logoSize!==''&&p.logoSize!=null?p.logoSize:48;
    byId('obsLogoX').value=Number(p.logoX)||0;
    byId('obsLogoY').value=Number(p.logoY)||0;
    byId('obsHomeScore').value=Number(p.homeScore||0);
    byId('obsAwayScore').value=Number(p.awayScore||0);
    byId('obsPeriod').value=p.period||'1ST';
    setClockFromPayload(p);
    byId('obsRecord').value=p.record||'';
    byId('obsMessage').value=p.message||'';
    byId('obsIntShotsHome').value=p.intShotsHome||'';
    byId('obsIntShotsAway').value=p.intShotsAway||'';
    byId('obsIntHitsHome').value=p.intHitsHome||'';
    byId('obsIntHitsAway').value=p.intHitsAway||'';
    byId('obsIntFaceoffsHome').value=p.intFaceoffsHome||'';
    byId('obsIntFaceoffsAway').value=p.intFaceoffsAway||'';
    byId('obsFinalShotsHome').value=p.finalShotsHome||'';
    byId('obsFinalShotsAway').value=p.finalShotsAway||'';
    byId('obsFinalPpHome').value=p.finalPpHome||'';
    byId('obsFinalPpAway').value=p.finalPpAway||'';
    byId('obsFinalSavesHome').value=p.finalSavesHome||'';
    byId('obsFinalSavesAway').value=p.finalSavesAway||'';
    byId('obsPlayerName').value=p.playerName||'PLAYER';
    byId('obsPlayerNumber').value=p.playerNumber||'00';
    byId('obsPlayerRole').value=p.playerRole||'PLAYER';
    // Channel default feed (obs-config.js) fills the field when nothing is attached yet.
    byId('obsStreamUrl').value=p.streamUrl||OBS_CFG.defaultFeedFor(config().channel)||'';
    byId('obsStreamProvider').value=['auto','twitch','youtube','video'].includes(String(p.streamProvider||'auto'))?String(p.streamProvider||'auto'):'auto';
    byId('obsStreamMuted').checked=p.streamMuted===true;
    byId('obsFeedLayout').value=p.feedLayout==='panel'?'panel':'full';
    byId('obsSidePanel').value=['brand','matchup','league','socials'].includes(p.sidePanel)?p.sidePanel:'brand';
    syncStreamSelect();
    updateScoreDisplay();
    setSceneButtons();
    feedSummary();
    byId('stateUpdated').textContent=row.updated_at?'SYNCED':'READY';
    savedEditCount=editCount;
  }
  function collectPayload(){
    var streamUrl=val('obsStreamUrl');
    var selectedProvider=val('obsStreamProvider')||'auto';
    var clock=clockSnapshot();
    return {
      presetId:currentPresetId,
      event:val('obsEvent'),
      homeName:val('obsHomeName')||config().name,
      awayName:val('obsAwayName'),
      bugPosition:val('obsBugPosition')||'hidden',
      feedLayout:val('obsFeedLayout')==='full'?'full':'panel',
      sidePanel:val('obsSidePanel')||'brand',
      showScoreboard:Boolean(byId('obsShowScoreboard')?.checked),
      logoBug:val('obsLogoBug')||'auto',
      logoPreset:val('obsLogoPreset')||'ea',
      logoSize:clampInt(val('obsLogoSize'),32,160,48),
      logoX:clampInt(val('obsLogoX'),-400,400,0),
      logoY:clampInt(val('obsLogoY'),-400,400,0),
      homeScore:numberVal('obsHomeScore'),
      awayScore:numberVal('obsAwayScore'),
      period:val('obsPeriod')||'1ST',
      clock:clock.clock,
      clockRunning:clock.clockRunning,
      clockBaseSeconds:clock.clockBaseSeconds,
      clockStartedAt:clock.clockStartedAt,
      clockRate:clock.clockRate,
      record:val('obsRecord'),
      message:val('obsMessage'),
      intShotsHome:val('obsIntShotsHome'),
      intShotsAway:val('obsIntShotsAway'),
      intHitsHome:val('obsIntHitsHome'),
      intHitsAway:val('obsIntHitsAway'),
      intFaceoffsHome:val('obsIntFaceoffsHome'),
      intFaceoffsAway:val('obsIntFaceoffsAway'),
      finalShotsHome:val('obsFinalShotsHome'),
      finalShotsAway:val('obsFinalShotsAway'),
      finalPpHome:val('obsFinalPpHome'),
      finalPpAway:val('obsFinalPpAway'),
      finalSavesHome:val('obsFinalSavesHome'),
      finalSavesAway:val('obsFinalSavesAway'),
      playerName:val('obsPlayerName')||'PLAYER',
      playerNumber:val('obsPlayerNumber')||'00',
      playerRole:val('obsPlayerRole')||'PLAYER',
      streamUrl:streamUrl,
      streamProvider:selectedProvider==='auto'?providerFor(streamUrl,'auto'):selectedProvider,
      streamMuted:Boolean(byId('obsStreamMuted')?.checked)
    };
  }
  async function loadState(force){
    if(!currentTeamId||!window.VVHLBackend?.db) return;
    if(!force&&isDirty()) return; // never overwrite unsaved edits with an automatic reload
    setStatus('LOADING');
    try{
      var result=await window.VVHLBackend.db.from('obs_broadcast_state').select('*').eq('channel',config().channel).maybeSingle();
      if(result.error){setStatus(result.error.message,true);return;}
      fill(result.data);
      setStatus('READY');
    }catch(err){setStatus('LOAD FAILED · '+(err?.message||'network'),true);}
  }
  async function publish(sceneOverride){
    if(!currentTeamId||!stateRef?.user) return;
    if(sceneOverride) currentScene=sceneOverride;
    currentScene=currentScene||'game';
    setSceneButtons();
    // One write at a time, last edit wins: rapid score taps cannot land out of order.
    if(publishing){publishQueued=true;return;}
    publishing=true;
    var editsAtSend=editCount;
    setStatus('PUBLISHING');
    var row={
      channel:config().channel,
      team_id:currentTeamId,
      brand:config().brand,
      scene:currentScene,
      payload:collectPayload(),
      is_public:true,
      updated_by:stateRef.user.id,
      updated_at:new Date().toISOString()
    };
    try{
      var result=await window.VVHLBackend.db.from('obs_broadcast_state').upsert(row,{onConflict:'channel'}).select('channel,updated_at').single();
      if(result.error){setStatus(result.error.message,true);return;}
      savedEditCount=editsAtSend;
      byId('stateUpdated').textContent='SYNCED';
      setStatus('LIVE');
      setTimeout(function(){if(byId('publishStatus')?.textContent==='LIVE') setStatus('READY');},1200);
    }catch(err){
      setStatus('PUBLISH FAILED · '+(err?.message||'network'),true);
    }finally{
      publishing=false;
      if(publishQueued){publishQueued=false;publish();}
    }
  }
  async function copyText(inputId,value){
    try{await navigator.clipboard.writeText(value);setStatus('URL COPIED');}
    catch(err){var input=byId(inputId);input.select();document.execCommand('copy');setStatus('URL COPIED');}
  }
  function wire(){
    document.querySelectorAll('.obs-control-card input,.obs-control-card select:not(#obsTeamSelect)').forEach(function(field){
      field.addEventListener('input',function(){editCount++;});
      field.addEventListener('change',function(){editCount++;});
    });
    byId('obsTeamSelect').addEventListener('change',async function(e){
      currentTeamId=e.target.value;
      window.localStorage.setItem('vvhl-team-context',currentTeamId);
      updateSourceLinks();
      await loadState(true);
    });
    document.querySelectorAll('#obsSceneStrip [data-preset]').forEach(function(button){
      button.addEventListener('click',async function(){
        applyScenePreset(button.dataset.preset);
        await publish(currentScene);
      });
    });
    document.querySelectorAll('[data-score][data-delta]').forEach(function(button){
      button.addEventListener('click',async function(){
        var id=button.dataset.score==='home'?'obsHomeScore':'obsAwayScore';
        var input=byId(id);
        input.value=Math.max(0,numberVal(id)+parseInt(button.dataset.delta,10));
        editCount++;
        updateScoreDisplay();
        await publish();
      });
    });
    byId('obsClockRate').addEventListener('change',function(){
      var current=clockSecondsNow();
      clockState.baseSeconds=current;
      clockState.startedAt=clockState.running?new Date().toISOString():'';
      clockState.rate=Number(byId('obsClockRate').value)||1;
      editCount++;
      syncClockUi();
      publish();
    });
    byId('obsClockSet').addEventListener('click',function(){
      clockState.running=false;
      clockState.startedAt='';
      clockState.baseSeconds=parseClock(val('obsClock'),clockState.baseSeconds);
      editCount++;
      byId('obsClock').value=formatClock(clockState.baseSeconds);
      syncClockUi();
      publish();
    });
    byId('obsClockStart').addEventListener('click',function(){
      if(clockState.running)return;
      clockState.baseSeconds=parseClock(val('obsClock'),clockState.baseSeconds);
      clockState.rate=Number(byId('obsClockRate').value)||1;
      clockState.startedAt=new Date().toISOString();
      clockState.running=clockState.baseSeconds>0;
      editCount++;
      syncClockUi();
      publish();
    });
    byId('obsClockPause').addEventListener('click',function(){
      clockState.baseSeconds=clockSecondsNow();
      clockState.running=false;
      clockState.startedAt='';
      byId('obsClock').value=formatClock(clockState.baseSeconds);
      editCount++;
      syncClockUi();
      publish();
    });
    byId('obsClockMinus').addEventListener('click',function(){
      clockState.baseSeconds=Math.max(0,clockSecondsNow()-5);
      clockState.startedAt=clockState.running?new Date().toISOString():'';
      byId('obsClock').value=formatClock(clockState.baseSeconds);
      editCount++;
      syncClockUi();
      publish();
    });
    byId('obsClockPlus').addEventListener('click',function(){
      clockState.baseSeconds=Math.max(0,clockSecondsNow()+5);
      clockState.startedAt=clockState.running?new Date().toISOString():'';
      byId('obsClock').value=formatClock(clockState.baseSeconds);
      editCount++;
      syncClockUi();
      publish();
    });
    byId('obsClockReset').addEventListener('click',function(){
      clockState.running=false;
      clockState.startedAt='';
      clockState.baseSeconds=1200;
      byId('obsClock').value='20:00';
      editCount++;
      syncClockUi();
      publish();
    });
    if(!clockUiTimer)clockUiTimer=setInterval(syncClockUi,250);
    byId('obsBugPosition').addEventListener('change',function(){publish();});
    byId('obsFeedLayout').addEventListener('change',function(){publish();});
    byId('obsSidePanel').addEventListener('change',function(){publish();});
    byId('obsPlayerStream').addEventListener('change',function(e){
      var pick=(OBS_CFG.playerStreams||[])[Number(e.target.value)];
      if(!pick){byId('obsStreamUrl').focus();return;}
      byId('obsStreamUrl').value=pick.url;
      byId('obsStreamProvider').value='auto';
      feedSummary();
      publish();
    });
    byId('obsStreamUrl').addEventListener('input',syncStreamSelect);
    byId('obsShowScoreboard').addEventListener('change',function(){publish();});
    ['obsLogoBug','obsLogoPreset','obsLogoSize','obsLogoX','obsLogoY'].forEach(function(id){
      byId(id).addEventListener('change',function(){publish();});
    });
    byId('obsLogoReset').addEventListener('click',function(){
      byId('obsLogoSize').value=48;byId('obsLogoX').value=0;byId('obsLogoY').value=0;editCount++;publish();
    });
    byId('obsStreamUrl').addEventListener('input',feedSummary);
    byId('obsStreamProvider').addEventListener('change',feedSummary);
    byId('obsStreamMuted').addEventListener('change',feedSummary);
    byId('attachStreamFeed').addEventListener('click',function(){publish();});
    byId('clearStreamFeed').addEventListener('click',async function(){
      byId('obsStreamUrl').value='';
      byId('obsStreamProvider').value='auto';
      byId('obsStreamMuted').checked=false;
      feedSummary();
      await publish();
    });
    byId('publishObsState').addEventListener('click',function(){publish();});
    byId('reloadObsState').addEventListener('click',function(){loadState(true);});
    byId('copyObsUrl').addEventListener('click',function(){copyText('obsSourceUrl',stageUrl());});
    byId('copyOverlayUrl').addEventListener('click',function(){copyText('obsOverlayOnlyUrl',overlayUrl());});
    byId('copyFeedLayerUrl')?.addEventListener('click',function(){copyText('obsFeedLayerUrl',feedLayerUrl());});
  }
  function showNoTeam(){
    setStatus('NO STUDIO CHANNEL',true);
    var select=byId('obsTeamSelect');
    if(select){select.innerHTML='<option>No studio channel for your team</option>';select.disabled=true;}
  }
  async function init(state){
    stateRef=state||window.VVHLBackend?.state||{};
    if(!window.VVHLManagementGuard?.hasAccess(stateRef)) return;
    var userId=stateRef.user?.id||'';
    if(!initialized){
      if(!populateTeams(stateRef)){showNoTeam();return;}
      byId('obsTeamSelect').disabled=false;
      populateStreams();
      renderSceneButtons();
      wire();
      initialized=true;
      lastUserId=userId;
      updateSourceLinks();
      await loadState(true);
      return;
    }
    // Auth events repeat (tab focus, token refresh, other tabs). Only react when the account changes.
    if(userId===lastUserId) return;
    lastUserId=userId;
    var previousTeam=currentTeamId;
    if(!populateTeams(stateRef)){showNoTeam();return;}
    updateSourceLinks();
    if(currentTeamId!==previousTeam) await loadState(true);
  }
  window.addEventListener('vvhl-auth-change',function(event){init(event.detail);});
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){init(window.VVHLBackend?.state);});
  else init(window.VVHLBackend?.state);
})();