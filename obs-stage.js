(function(){
  'use strict';
  var SUPABASE_URL='https://lrgllzvwgvqagcpiyvfd.supabase.co';
  var SUPABASE_KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
  var db=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
  var params=new URLSearchParams(location.search);
  var channel=params.get('channel')||'wildman-main';
  var preview=params.get('preview')==='1';
  var stage=document.getElementById('obsStage');
  var mount=document.getElementById('streamMount');
  var mark=document.querySelector('.obs-stage-placeholder-mark');
  var status=document.getElementById('stageStatus');
  var overlay=document.getElementById('overlayFrame');
  var streamSignature='';
  var twitchPlayer=null;
  var twitchMountId='twitchPersistentPlayer';

  if(preview) document.body.classList.add('obs-stage-preview');
  overlay.src='obs-overlay.html?channel='+encodeURIComponent(channel);

  function setStatus(value){if(status)status.textContent=value;}
  function twitchRef(raw){
    try{
      var u=new URL(raw);
      var parts=u.pathname.split('/').filter(Boolean);
      if(u.hostname.includes('clips.twitch.tv')&&parts[0])return {clip:parts[0]};
      var clipIndex=parts.indexOf('clip');
      if(clipIndex>=0&&parts[clipIndex+1])return {clip:parts[clipIndex+1]};
      var videos=parts.indexOf('videos');
      if(videos>=0&&parts[videos+1])return {video:'v'+parts[videos+1]};
      return {channel:parts[0]||''};
    }catch(e){return {channel:String(raw||'').split('/').filter(Boolean).pop()||''};}
  }
  function youtubeId(raw){
    try{
      var u=new URL(raw);
      if(u.hostname.includes('youtu.be'))return u.pathname.slice(1);
      if(u.searchParams.get('v'))return u.searchParams.get('v');
      var p=u.pathname.split('/').filter(Boolean);
      var i=p.findIndex(function(x){return x==='embed'||x==='live'||x==='shorts';});
      return i>=0?(p[i+1]||''):'';
    }catch(e){return '';}
  }
  function providerFor(url,provided){
    var p=String(provided||'').toLowerCase();
    if(p&&p!=='auto')return p;
    var raw=String(url||'').toLowerCase();
    if(raw.includes('twitch.tv'))return 'twitch';
    if(raw.includes('youtube.com')||raw.includes('youtu.be'))return 'youtube';
    if(/\.mp4(?:$|\?)/i.test(raw))return 'video';
    return 'external';
  }
  function clearFeed(){
    try{
      if(twitchPlayer&&typeof twitchPlayer.setMuted==='function')twitchPlayer.setMuted(true);
    }catch(e){}
    twitchPlayer=null;
    mount.innerHTML='';
    stage.classList.remove('has-feed');
    streamSignature='';
  }

  function ensurePersistentTwitch(ref,muted){
    var key=ref.video?('video:'+ref.video):('channel:'+String(ref.channel||''));
    if(streamSignature!==key||!twitchPlayer){
      mount.innerHTML='<div id="'+twitchMountId+'" style="width:100%;height:100%"></div>';
      twitchPlayer=new Twitch.Player(twitchMountId,{
        width:'100%',
        height:'100%',
        autoplay:true,
        muted:true,
        parent:[location.hostname],
        channel:ref.video?undefined:(ref.channel||''),
        video:ref.video||undefined
      });
      streamSignature=key;
    }
    try{
      if(twitchPlayer&&typeof twitchPlayer.setMuted==='function')twitchPlayer.setMuted(!!muted);
    }catch(e){}
  }
  function renderFeed(payload,scene,brand){
    var url=String(payload.streamUrl||'').trim();
    var provider=providerFor(url,payload.streamProvider);
    var activeScene=scene==='game'||scene==='player';
    var desiredMute=preview||payload.streamMuted===true||!activeScene;
    if(mark)mark.textContent=brand==='hitmen'?'H':'W';

    if(!url){clearFeed();return;}

    if(provider==='twitch'){
      var ref=twitchRef(url);
      if(ref.clip){
        var clipSig='clip:'+ref.clip+'|'+desiredMute;
        if(clipSig!==streamSignature){
          mount.innerHTML='<iframe src="https://clips.twitch.tv/embed?clip='+encodeURIComponent(ref.clip)+'&parent='+encodeURIComponent(location.hostname)+'&autoplay=true&muted='+(desiredMute?'true':'false')+'" allow="autoplay; fullscreen" allowfullscreen title="Twitch clip"></iframe>';
          streamSignature=clipSig;
        }
      }else if(ref.video||ref.channel){
        ensurePersistentTwitch(ref,desiredMute);
      }else{
        clearFeed();setStatus('UNSUPPORTED FEED');return;
      }
      if(activeScene)stage.classList.add('has-feed');else stage.classList.remove('has-feed');
      return;
    }

    var signature=[url,provider,desiredMute,location.hostname].join('|');
    if(signature!==streamSignature){
      var html='';
      if(provider==='youtube'){
        var id=youtubeId(url);
        if(id)html='<iframe src="https://www.youtube.com/embed/'+encodeURIComponent(id)+'?autoplay=1&mute='+(desiredMute?'1':'0')+'&playsinline=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="YouTube stream"></iframe>';
      }else if(provider==='video'){
        html='<video src="'+url.replace(/"/g,'&quot;')+'" autoplay '+(desiredMute?'muted ':'')+'playsinline controls></video>';
      }
      if(!html){clearFeed();setStatus('UNSUPPORTED FEED');return;}
      twitchPlayer=null;
      mount.innerHTML=html;
      streamSignature=signature;
    }
    if(activeScene)stage.classList.add('has-feed');else stage.classList.remove('has-feed');
  }
  function render(row){
    if(!row)return;
    var p=row.payload||{};
    renderFeed(p,row.scene||'game',row.brand||'wildman');
    setStatus((row.scene||'game').toUpperCase()+' · '+channel.toUpperCase());
  }
  async function refresh(){
    try{
      var result=await db.from('obs_broadcast_state').select('*').eq('channel',channel).maybeSingle();
      if(result.error)throw result.error;
      render(result.data);
    }catch(err){
      setStatus('RETRYING');
      console.warn('OBS stage refresh failed',err);
    }
  }

  var realtime=db.channel('obs-stage-'+channel)
    .on('postgres_changes',{event:'*',schema:'public',table:'obs_broadcast_state',filter:'channel=eq.'+channel},function(evt){
      if(evt&&evt.new)render(evt.new);else refresh();
    })
    .subscribe();

  window.addEventListener('beforeunload',function(){db.removeChannel(realtime);});
  refresh();
  setInterval(refresh,5000);
})();