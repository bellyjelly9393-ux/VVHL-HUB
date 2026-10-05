(function(){
  'use strict';
  var PRODUCTION_ORIGIN='https://wildmanhockey-elitechelmedia.app';
  var OBS_CFG=window.WM_OBS_CONFIG||{defaultFeedFor:function(){return '';}};
  var TEAM_CONFIG={
    '5f36117c-7a51-4514-bf70-d4c672b41e48':{name:'Wildman Hockey',brand:'wildman',channel:'wildman-main'},
    'b0bcbdda-da9d-419d-8f61-b34937966d49':{name:'Calgary Hitmen',brand:'hitmen',channel:'hitmen-main'}
  };
  var currentTeamId='';
  var currentScene='game';
  var initialized=false;
  var stateRef=null;
  var lastUserId='';
  var previewChannel='';
  var editCount=0;        // bumps on every manual edit; protects unsaved typing from auto refills
  var savedEditCount=0;
  var publishing=false;
  var publishQueued=false;

  function byId(id){return document.getElementById(id);}
  function val(id){return (byId(id)?.value||'').trim();}
  function clampInt(v,min,max,fallback){var n=parseInt(v,10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}
  function numberVal(id){var n=parseInt(byId(id)?.value||'0',10);return Number.isFinite(n)&&n>=0?n:0;}
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
  function setSceneButtons(){
    document.querySelectorAll('#obsSceneStrip [data-scene]').forEach(function(button){
      button.classList.toggle('active',button.dataset.scene===currentScene);
    });
  }
  function fill(row){
    if(!row) return;
    var p=row.payload||{};
    currentScene=row.scene||'game';
    byId('obsEvent').value=p.event||'';
    byId('obsHomeName').value=p.homeName||config().name;
    // 'OPPONENT' was the old placeholder; blank lets the overlay use tonight's opponent.
    byId('obsAwayName').value=String(p.awayName||'').trim().toUpperCase()==='OPPONENT'?'':(p.awayName||'');
    byId('obsBugPosition').value=['left','right','hidden'].includes(p.bugPosition)?p.bugPosition:'right';
    byId('obsShowScoreboard').checked=p.showScoreboard!==false;
    byId('obsLogoBug').value=['auto','on','off'].includes(p.logoBug)?p.logoBug:'auto';
    byId('obsLogoPreset').value=['ea','top-left','top-right','bottom-right'].includes(p.logoPreset)?p.logoPreset:'ea';
    byId('obsLogoSize').value=Number.isFinite(Number(p.logoSize))&&p.logoSize!==''&&p.logoSize!=null?p.logoSize:56;
    byId('obsLogoX').value=Number(p.logoX)||0;
    byId('obsLogoY').value=Number(p.logoY)||0;
    byId('obsHomeScore').value=Number(p.homeScore||0);
    byId('obsAwayScore').value=Number(p.awayScore||0);
    byId('obsPeriod').value=p.period||'1ST';
    byId('obsClock').value=p.clock||'20:00';
    byId('obsRecord').value=p.record||'';
    byId('obsMessage').value=p.message||'';
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
    return {
      event:val('obsEvent'),
      homeName:val('obsHomeName')||config().name,
      awayName:val('obsAwayName'),
      bugPosition:val('obsBugPosition')||'right',
      feedLayout:val('obsFeedLayout')==='panel'?'panel':'full',
      sidePanel:val('obsSidePanel')||'brand',
      showScoreboard:Boolean(byId('obsShowScoreboard')?.checked),
      logoBug:val('obsLogoBug')||'auto',
      logoPreset:val('obsLogoPreset')||'ea',
      logoSize:clampInt(val('obsLogoSize'),32,160,56),
      logoX:clampInt(val('obsLogoX'),-400,400,0),
      logoY:clampInt(val('obsLogoY'),-400,400,0),
      homeScore:numberVal('obsHomeScore'),
      awayScore:numberVal('obsAwayScore'),
      period:val('obsPeriod')||'1ST',
      clock:val('obsClock')||'20:00',
      record:val('obsRecord'),
      message:val('obsMessage'),
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
    document.querySelectorAll('#obsSceneStrip [data-scene]').forEach(function(button){
      button.addEventListener('click',function(){publish(button.dataset.scene);});
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
      byId('obsLogoSize').value=56;byId('obsLogoX').value=0;byId('obsLogoY').value=0;editCount++;publish();
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