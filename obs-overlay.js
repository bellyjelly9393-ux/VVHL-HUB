(function(){
  'use strict';
  var SUPABASE_URL='https://lrgllzvwgvqagcpiyvfd.supabase.co';
  var SUPABASE_KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
  var db=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
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
    var payload=row.payload||{};
    var brand=row.brand==='hitmen'?'hitmen':'wildman';
    var scene=forcedScene||row.scene||'game';
    document.body.dataset.brand=brand;
    document.body.dataset.scene=scene;

    var isHitmen=brand==='hitmen';
    text('bugEyebrow',isHitmen?'CALGARY HITMEN':'WILDMAN HOCKEY');
    text('bugTitle',isHitmen?'LGCHL SEASON 55':'ESPORTS NETWORK');
    text('brandLetter',isHitmen?'H':'W');
    text('fullBrandLetter',isHitmen?'H':'W');

    text('scoreEvent',payload.event,'LIVE GAME');
    text('scorePeriod',payload.period,'1ST');
    text('scoreClock',payload.clock,'20:00');
    text('homeName',payload.homeName,isHitmen?'CALGARY HITMEN':'WILDMAN HOCKEY');
    text('homeScore',payload.homeScore,0);
    text('awayName',payload.awayName,'OPPONENT');
    text('awayScore',payload.awayScore,0);

    text('fullEyebrow',isHitmen?'CALGARY HITMEN · LGCHL SEASON 55':'WILDMAN HOCKEY ESPORTS NETWORK');
    text('sceneTitle',sceneLabel(scene));
    text('fullHomeName',payload.homeName,isHitmen?'CALGARY HITMEN':'WILDMAN HOCKEY');
    text('fullHomeScore',payload.homeScore,0);
    text('fullAwayName',payload.awayName,'OPPONENT');
    text('fullAwayScore',payload.awayScore,0);
    text('sceneMessage',payload.message,isHitmen?'CALGARY HITMEN':'WILDMAN HOCKEY ESPORTS NETWORK');
    text('fullEvent',payload.event,'LIVE GAME');
    text('fullRecord',payload.record,'');

    text('playerNumber',payload.playerNumber,'00');
    text('playerRole',payload.playerRole,'PLAYER');
    text('playerName',payload.playerName,'PLAYER');
    text('playerBrand',isHitmen?'CALGARY HITMEN':'WILDMAN HOCKEY');
    text('obsStatus','LIVE · '+channel.toUpperCase());
  }

  async function refresh(){
    try{
      var result=await db.from('obs_broadcast_state').select('*').eq('channel',channel).maybeSingle();
      if(result.error) throw result.error;
      if(result.data) render(result.data);
      else text('obsStatus','CHANNEL NOT FOUND');
    }catch(err){
      text('obsStatus','RETRYING');
      console.warn('OBS state refresh failed',err);
    }
  }

  var realtime=db.channel('obs-state-'+channel)
    .on('postgres_changes',{event:'*',schema:'public',table:'obs_broadcast_state',filter:'channel=eq.'+channel},function(payload){
      if(payload&&payload.new) render(payload.new);
      else refresh();
    })
    .subscribe(function(status){
      if(status==='SUBSCRIBED') text('obsStatus','LIVE · '+channel.toUpperCase());
    });

  window.addEventListener('beforeunload',function(){db.removeChannel(realtime);});
  refresh();
  setInterval(refresh,5000);
})();