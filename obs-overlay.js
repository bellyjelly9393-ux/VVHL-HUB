(function(){
  'use strict';
  var SUPABASE_URL='https://lrgllzvwgvqagcpiyvfd.supabase.co';
  var SUPABASE_KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
  // Public, read-only client with no persisted session (see obs-stage.js): always reads as anon
  // and never re-broadcasts SIGNED_IN to the Broadcast Studio tab.
  var db=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'wm-obs-overlay-public'}
  });
  var STATE_COLUMNS='channel,brand,scene,payload,updated_at';
  var FAST_POLL_MS=5000;   // used while realtime is not connected
  var SLOW_POLL_MS=30000;  // safety net while realtime is connected
  var realtimeUp=false;
  var pollTimer=null;
  var lastRowKey='';
  var lastRow=null;
  var clockTimer=null;
  // Tonight's Calgary opponent from the public, cached /api/live-ticker feed (built from the public
  // lgchl_games_board / lgchl_standings_current views). Used only when the Studio leaves the away
  // name blank or on the old 'OPPONENT' placeholder.
  var TICKER_REFRESH_MS=5*60*1000;
  var tickerOpponent='';
  var tickerData=null;
  var standingsData=null;
  var logoBug=document.getElementById('logoBug');
  var brandLogo=document.getElementById('brandLogo');
  var fullBrandLogo=document.getElementById('fullBrandLogo');
  function clampNum(v,min,max,fallback){var n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}
  // Logo bug: show = 'auto' (only while our scoreboard is hidden) | 'on' | 'off'.
  // Presets are measured on the 1280x720 source; 'ea' covers the game's logo left of its score bug.
  function placeLogo(payload){
    if(!logoBug)return;
    var mode=['auto','on','off'].indexOf(payload.logoBug)>=0?payload.logoBug:'auto';
    var on=mode==='on'||(mode==='auto'&&payload.showScoreboard===false);
    document.body.dataset.logo=on?'on':'off';
    var size=clampNum(payload.logoSize,32,160,56);
    var w=window.innerWidth||1280,h=window.innerHeight||720;
    var preset=payload.logoPreset||'ea';
    // Video + side panel: the video is scaled to 80% and centred vertically, so map positions into it.
    var panel=payload.feedLayout==='panel';
    var vs=panel?0.8:1, vx=0, vy=panel?(h-w*0.45)/2:0, vw=w*vs;
    if(panel&&preset==='ea')size=Math.round(size*vs);
    var pos={ea:[vx+22*vs,vy+22*vs],'top-left':[38,34],'top-right':[vw-38-size,34],'bottom-right':[vw-38-size,h-34-size]}[preset]||[vx+22*vs,vy+22*vs];
    var x=pos[0]+clampNum(payload.logoX,-400,400,0);
    var y=pos[1]+clampNum(payload.logoY,-400,400,0);
    logoBug.style.width=size+'px';logoBug.style.height=size+'px';
    logoBug.style.left=Math.round(x)+'px';logoBug.style.top=Math.round(y)+'px';
    logoBug.style.padding=Math.round(size*.1)+'px';
    logoBug.style.borderRadius=Math.round(size*.2)+'px';
  }
  window.addEventListener('resize',function(){if(lastRow)placeLogo(lastRow.payload||{});});
  function isPlaceholderName(name){var n=String(name||'').trim().toUpperCase();return !n||n==='OPPONENT';}
  function etTime(iso){
    try{return new Date(iso).toLocaleTimeString('en-US',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit'})+' ET';}
    catch(e){return '';}
  }
  function teamRecord(id){
    var teams=standingsData&&standingsData.teams||{};
    var t=teams[String(id)]||{};
    return t.record||'';
  }
  function renderBreakInfo(){
    var lastMatch=document.getElementById('breakLastMatchup');
    var lastScore=document.getElementById('breakLastScore');
    var nextMatch=document.getElementById('breakNextMatchup');
    var nextRecord=document.getElementById('breakNextRecord');
    var nextTime=document.getElementById('breakNextTime');
    if(!lastMatch||!tickerData)return;
    var recent=(tickerData.recent||[])[0]||null;
    var next=tickerData.live||tickerData.next||((tickerData.upcoming||[])[0]||null);
    if(recent){
      lastMatch.textContent='CALGARY '+(recent.result||'')+' · '+(recent.opponent&&recent.opponent.name||'Opponent').toUpperCase();
      lastScore.textContent=String(recent.gf==null?'—':recent.gf)+' – '+String(recent.ga==null?'—':recent.ga);
    }else{
      lastMatch.textContent='NO PREVIOUS RESULT';
      lastScore.textContent='';
    }
    if(next){
      var opp=next.opponent||{};
      nextMatch.textContent=(next.home?'VS ':'@ ')+(opp.name||'Opponent').toUpperCase();
      var oppRec=teamRecord(opp.id);
      var ourRec=tickerData.record&&tickerData.record.label||'';
      nextRecord.textContent=(ourRec?'CGY '+ourRec:'')+(oppRec?' · '+(opp.abbr||'OPP')+' '+oppRec:'');
      nextTime.textContent=next.state==='live'?'LIVE NOW':etTime(next.at);
    }else{
      nextMatch.textContent='SCHEDULE TBA';nextRecord.textContent='';nextTime.textContent='';
    }
  }
  async function loadTonightOpponent(){
    try{
      var rs=await Promise.all([
        fetch('/api/live-ticker',{headers:{accept:'application/json'}}),
        fetch('/api/lgchl-scores?view=standings',{headers:{accept:'application/json'}})
      ]);
      if(!rs[0].ok)throw new Error('HTTP '+rs[0].status);
      tickerData=await rs[0].json();
      standingsData=rs[1].ok?await rs[1].json():standingsData;
      var game=tickerData&&(tickerData.live||tickerData.next);
      var soon=game&&game.at&&Math.abs(Date.parse(game.at)-Date.now())<12*3600e3;
      var name=(tickerData&&tickerData.live&&tickerData.live.opponent&&tickerData.live.opponent.name)||(soon&&game.opponent&&game.opponent.name)||'';
      tickerOpponent=name;
      renderBreakInfo();
      if(lastRow)render(lastRow);
    }catch(err){console.warn('Tonight opponent lookup failed',err);}
  }
  var params=new URLSearchParams(location.search);
  var channel=params.get('channel')||'wildman-main';
  var forcedScene=params.get('scene')||'';
  var preview=params.get('preview')==='1';
  if(preview) document.body.classList.add('obs-preview');

  var ids=['bugEyebrow','bugTitle','scoreEvent','scorePeriod','scoreClock','homeName','homeScore','awayName','awayScore','fullEyebrow','sceneTitle','fullHomeName','fullHomeScore','fullAwayName','fullAwayScore','sceneMessage','fullEvent','fullRecord','playerNumber','playerRole','playerName','playerBrand','obsStatus','brandLetter','fullBrandLetter'];
  var el={};
  ids.forEach(function(id){el[id]=document.getElementById(id);});

  function text(id,value,fallback){
    if(el[id]) el[id].textContent=(value===undefined||value===null||value==='')?(fallback||''):String(value);
  }
  function parseClock(value,fallback){
    var raw=String(value||'').trim(),parts=raw.split(':');
    if(parts.length===2){
      var m=parseInt(parts[0],10),s=parseInt(parts[1],10);
      if(Number.isFinite(m)&&Number.isFinite(s)&&m>=0&&s>=0&&s<60)return m*60+s;
    }
    return fallback==null?1200:fallback;
  }
  function formatClock(seconds){
    var total=Math.max(0,Math.round(Number(seconds)||0));
    return String(Math.floor(total/60))+':'+String(total%60).padStart(2,'0');
  }
  function liveClock(payload){
    var p=payload||{};
    var base=Number.isFinite(Number(p.clockBaseSeconds))?Math.max(0,Number(p.clockBaseSeconds)):parseClock(p.clock||'20:00',1200);
    if(p.clockRunning!==true||!p.clockStartedAt)return formatClock(base);
    var start=Date.parse(p.clockStartedAt);
    if(!Number.isFinite(start))return formatClock(base);
    var elapsed=Math.max(0,(Date.now()-start)/1000);
    var rate=Number(p.clockRate)||1;
    return formatClock(Math.max(0,base-elapsed*rate));
  }
  function updateLiveClock(){
    if(!lastRow)return;
    text('scoreClock',liveClock(lastRow.payload||{}),'20:00');
  }
  function sceneLabel(scene){
    return {
      starting:'STARTING SOON',
      intermission:'INTERMISSION',
      final:'FINAL',
      brb:'BE RIGHT BACK'
    }[scene]||'LIVE';
  }
  function render(row){
    if(!row) return;
    lastRow=row;
    var payload=row.payload||{};
    var brand=row.brand==='hitmen'?'hitmen':'wildman';
    var scene=forcedScene||row.scene||'game';
    document.body.dataset.brand=brand;
    document.body.dataset.scene=scene;
    document.body.dataset.bug=['left','right','hidden'].indexOf(payload.bugPosition)>=0?payload.bugPosition:'right';
    document.body.dataset.scoreboard=payload.showScoreboard===false?'off':'on';
    document.body.dataset.layout=payload.feedLayout==='panel'?'panel':'full';
    placeLogo(payload);
    var awayName=isPlaceholderName(payload.awayName)?(brand==='hitmen'?tickerOpponent:''):payload.awayName;

    var isHitmen=brand==='hitmen';
    if(brandLogo)brandLogo.src=isHitmen?'assets/lgchl/s55/team412.png':'assets/wildman/logo.webp';
    if(fullBrandLogo)fullBrandLogo.src=isHitmen?'assets/lgchl/s55/team412.png':'assets/wildman/logo.webp';
    text('bugEyebrow',isHitmen?'CALGARY HITMEN':'WILDMAN HOCKEY');
    text('bugTitle',isHitmen?'LGCHL SEASON 55':'ESPORTS NETWORK');
    text('brandLetter',isHitmen?'H':'W');
    text('fullBrandLetter',isHitmen?'H':'W');

    text('scoreEvent',payload.event,'LIVE GAME');
    text('scorePeriod',payload.period,'1ST');
    text('scoreClock',liveClock(payload),'20:00');
    text('homeName',payload.homeName,isHitmen?'CALGARY HITMEN':'WILDMAN HOCKEY');
    text('homeScore',payload.homeScore,0);
    text('awayName',awayName,'');
    text('awayScore',payload.awayScore,0);

    text('fullEyebrow',isHitmen?'CALGARY HITMEN · LGCHL SEASON 55':'WILDMAN HOCKEY ESPORTS NETWORK');
    text('sceneTitle',sceneLabel(scene));
    text('fullHomeName',payload.homeName,isHitmen?'CALGARY HITMEN':'WILDMAN HOCKEY');
    text('fullHomeScore',payload.homeScore,0);
    text('fullAwayName',awayName,'');
    text('fullAwayScore',payload.awayScore,0);
    text('sceneMessage',payload.message,isHitmen?'CALGARY HITMEN':'WILDMAN HOCKEY ESPORTS NETWORK');
    text('fullEvent',payload.event,'LIVE GAME');
    text('fullRecord',payload.record,'');
    if(isHitmen)renderBreakInfo();

    text('playerNumber',payload.playerNumber,'00');
    text('playerRole',payload.playerRole,'PLAYER');
    text('playerName',payload.playerName,'PLAYER');
    text('playerBrand',isHitmen?'CALGARY HITMEN':'WILDMAN HOCKEY');
    text('obsStatus','LIVE · '+channel.toUpperCase());
  }

  async function refresh(){
    try{
      var result=await db.from('obs_broadcast_state').select(STATE_COLUMNS).eq('channel',channel).maybeSingle();
      if(result.error) throw result.error;
      if(!result.data){text('obsStatus','CHANNEL NOT FOUND');return;}
      var key=String(result.data.updated_at||'')+'|'+String(result.data.scene||'');
      if(key===lastRowKey){text('obsStatus','LIVE · '+channel.toUpperCase());return;}
      lastRowKey=key;
      render(result.data);
    }catch(err){
      text('obsStatus','RETRYING');
      console.warn('OBS state refresh failed',err);
    }
  }
  function schedulePoll(){
    clearTimeout(pollTimer);
    pollTimer=setTimeout(async function(){await refresh();schedulePoll();},realtimeUp?SLOW_POLL_MS:FAST_POLL_MS);
  }

  var realtime=db.channel('obs-state-'+channel)
    .on('postgres_changes',{event:'*',schema:'public',table:'obs_broadcast_state',filter:'channel=eq.'+channel},function(payload){
      if(payload&&payload.new&&payload.new.payload){lastRowKey=String(payload.new.updated_at||'')+'|'+String(payload.new.scene||'');render(payload.new);}
      else refresh();
    })
    .subscribe(function(status){
      var up=status==='SUBSCRIBED';
      if(up){text('obsStatus','LIVE · '+channel.toUpperCase());if(!realtimeUp)refresh();}
      realtimeUp=up;
      schedulePoll();
    });

  window.addEventListener('beforeunload',function(){db.removeChannel(realtime);});
  refresh();
  schedulePoll();
  clockTimer=setInterval(updateLiveClock,250);
  if(channel==='hitmen-main'){loadTonightOpponent();setInterval(loadTonightOpponent,TICKER_REFRESH_MS);}
})();
