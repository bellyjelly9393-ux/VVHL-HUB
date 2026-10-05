(function(){
  'use strict';
  var SUPABASE_URL='https://lrgllzvwgvqagcpiyvfd.supabase.co';
  var SUPABASE_KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
  // Public, read-only client. No persisted session: the stage always reads as anon, and it never
  // broadcasts auth events to other tabs. (A persisted client here re-announced SIGNED_IN to the
  // Broadcast Studio every time this page loaded, which reloaded this page, in a loop.)
  var db=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'wm-obs-stage-public'}
  });
  var STATE_COLUMNS='channel,brand,scene,payload,updated_at';
  var FAST_POLL_MS=5000;   // used while realtime is not connected
  var SLOW_POLL_MS=30000;  // safety net while realtime is connected
  var params=new URLSearchParams(location.search);
  var channel=params.get('channel')||'wildman-main';
  var preview=params.get('preview')==='1';
  // layer=feed renders only the attached stream, with nothing on top of it. Twitch pauses its
  // player whenever another element covers it, so Twitch feeds need this layer as its own OBS
  // source with the overlay-only source above it.
  var feedLayer=params.get('layer')==='feed';
  var stage=document.getElementById('obsStage');
  var mount=document.getElementById('streamMount');
  var mark=document.querySelector('.obs-stage-placeholder-mark');
  var status=document.getElementById('stageStatus');
  var overlay=document.getElementById('overlayFrame');
  var streamSignature='';
  var twitchPlayer=null;
  var twitchMuted=null;
  var twitchMountId='twitchPersistentPlayer';
  var realtimeUp=false;
  var pollTimer=null;
  var lastRowKey='';
  var CFG=window.WM_OBS_CONFIG||{defaultFeedFor:function(){return '';},twitchParentList:function(){return [location.hostname];}};
  var offlineCard=document.getElementById('streamOffline');
  var offlineName=document.getElementById('streamOfflineName');

  if(preview) document.body.classList.add('obs-stage-preview');
  if(feedLayer){
    document.body.classList.add('obs-stage-feed-layer');
    if(overlay) overlay.remove();
    overlay=null;
  }else if(overlay){
    overlay.src='obs-overlay.html?channel='+encodeURIComponent(channel);
  }

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
  // Offline card sits over the Twitch player only while the channel is offline (nothing is playing).
  // It is removed the moment Twitch reports ONLINE so the live picture is never covered.
  function setOffline(on,name){
    stage.classList.toggle('feed-offline',!!on);
    if(on&&offlineName)offlineName.textContent='twitch.tv/'+String(name||'').toLowerCase();
  }
  function clearFeed(){
    setOffline(false);
    try{
      if(twitchPlayer&&typeof twitchPlayer.setMuted==='function')twitchPlayer.setMuted(true);
    }catch(e){}
    twitchPlayer=null;
    twitchMuted=null;
    mount.innerHTML='';
    stage.classList.remove('has-feed');
    streamSignature='';
  }
  function twitchIframe(ref,muted){
    var q=ref.video?('video='+encodeURIComponent(ref.video)):('channel='+encodeURIComponent(ref.channel||''));
    var parents=CFG.twitchParentList().map(function(h){return '&parent='+encodeURIComponent(h);}).join('');
    return '<iframe src="https://player.twitch.tv/?'+q+parents+'&autoplay=true&muted='+(muted?'true':'false')+'" allow="autoplay; fullscreen" allowfullscreen title="Twitch stream"></iframe>';
  }
  function ensurePersistentTwitch(ref,muted){
    var key=ref.video?('video:'+ref.video):('channel:'+String(ref.channel||''));
    var sdk=window.Twitch&&typeof window.Twitch.Player==='function';
    if(!sdk){
      // Embed SDK failed to load (blocked or offline CDN): plain iframe player instead.
      var sig=key+'|iframe|'+muted;
      if(streamSignature!==sig){
        twitchPlayer=null;twitchMuted=null;
        mount.innerHTML=twitchIframe(ref,muted);
        streamSignature=sig;
      }
      return;
    }
    if(streamSignature!==key||!twitchPlayer){
      mount.innerHTML='<div id="'+twitchMountId+'" style="width:100%;height:100%"></div>';
      twitchPlayer=new window.Twitch.Player(twitchMountId,{
        width:'100%',
        height:'100%',
        autoplay:true,
        muted:true,
        parent:CFG.twitchParentList(),
        channel:ref.video?undefined:(ref.channel||''),
        video:ref.video||undefined
      });
      twitchMuted=true;
      streamSignature=key;
      setOffline(false);
      if(!ref.video&&window.Twitch.Player.OFFLINE){
        var player=twitchPlayer;
        player.addEventListener(window.Twitch.Player.OFFLINE,function(){if(player===twitchPlayer)setOffline(true,ref.channel);});
        player.addEventListener(window.Twitch.Player.ONLINE,function(){
          if(player!==twitchPlayer)return;
          setOffline(false);
          try{player.play();}catch(e){}
        });
      }
    }
    if(twitchMuted!==!!muted){
      try{
        if(twitchPlayer&&typeof twitchPlayer.setMuted==='function'){twitchPlayer.setMuted(!!muted);twitchMuted=!!muted;}
      }catch(e){}
    }
  }
  function renderFeed(payload,scene,brand){
    var attached=String(payload.streamUrl||'').trim();
    // No feed attached in the Studio: fall back to the channel's default feed from obs-config.js.
    var url=attached||String(CFG.defaultFeedFor(channel)||'').trim();
    var provider=providerFor(url,attached?payload.streamProvider:'auto');
    var activeScene=scene==='game'||scene==='player';
    var desiredMute=preview||payload.streamMuted===true||!activeScene;
    if(mark)mark.textContent=brand==='hitmen'?'H':'W';

    if(!url){clearFeed();return '';}

    if(provider==='twitch'){
      var ref=twitchRef(url);
      if(ref.clip){
        var clipSig='clip:'+ref.clip+'|'+desiredMute;
        if(clipSig!==streamSignature){
          twitchPlayer=null;twitchMuted=null;setOffline(false);
          mount.innerHTML='<iframe src="https://clips.twitch.tv/embed?clip='+encodeURIComponent(ref.clip)+'&parent='+encodeURIComponent(location.hostname)+'&autoplay=true&muted='+(desiredMute?'true':'false')+'" allow="autoplay; fullscreen" allowfullscreen title="Twitch clip"></iframe>';
          streamSignature=clipSig;
        }
      }else if(ref.video||ref.channel){
        ensurePersistentTwitch(ref,desiredMute);
      }else{
        clearFeed();return 'UNSUPPORTED FEED';
      }
      // Never cover a Twitch player: covering it pauses playback and it does not resume on its
      // own. Off-air scenes are muted instead; the overlay's full-screen card hides the picture.
      stage.classList.add('has-feed');
      return feedLayer?'':'TWITCH · USE FEED LAYER + OVERLAY IN OBS';
    }

    var signature=[url,provider,desiredMute,location.hostname].join('|');
    if(signature!==streamSignature){
      var html='';
      if(provider==='youtube'){
        var id=youtubeId(url);
        if(id)html='<iframe src="https://www.youtube.com/embed/'+encodeURIComponent(id)+'?autoplay=1&mute='+(desiredMute?'1':'0')+'&playsinline=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="YouTube stream"></iframe>';
      }else if(provider==='video'){
        html='<video src="'+url.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')+'" autoplay '+(desiredMute?'muted ':'')+'playsinline controls></video>';
      }
      if(!html){clearFeed();return 'UNSUPPORTED FEED';}
      twitchPlayer=null;twitchMuted=null;setOffline(false);
      mount.innerHTML=html;
      streamSignature=signature;
    }
    if(activeScene||feedLayer)stage.classList.add('has-feed');else stage.classList.remove('has-feed');
    return '';
  }
  function render(row){
    if(!row)return;
    var p=row.payload||{};
    var note=renderFeed(p,row.scene||'game',row.brand||'wildman');
    setStatus((row.scene||'game').toUpperCase()+' · '+channel.toUpperCase()+(note?' · '+note:''));
  }
  async function refresh(){
    try{
      var result=await db.from('obs_broadcast_state').select(STATE_COLUMNS).eq('channel',channel).maybeSingle();
      if(result.error)throw result.error;
      if(!result.data){
        if(CFG.defaultFeedFor(channel)&&!lastRowKey){lastRowKey='default';render({scene:'game',brand:'wildman',payload:{}});}
        setStatus('CHANNEL NOT FOUND · '+channel.toUpperCase());return;
      }
      var key=String(result.data.updated_at||'')+'|'+String(result.data.scene||'');
      if(key===lastRowKey)return;
      lastRowKey=key;
      render(result.data);
    }catch(err){
      setStatus('RETRYING');
      console.warn('OBS stage refresh failed',err);
    }
  }
  function schedulePoll(){
    clearTimeout(pollTimer);
    pollTimer=setTimeout(async function(){await refresh();schedulePoll();},realtimeUp?SLOW_POLL_MS:FAST_POLL_MS);
  }

  var realtime=db.channel('obs-stage-'+channel)
    .on('postgres_changes',{event:'*',schema:'public',table:'obs_broadcast_state',filter:'channel=eq.'+channel},function(evt){
      if(evt&&evt.new&&evt.new.payload){lastRowKey=String(evt.new.updated_at||'')+'|'+String(evt.new.scene||'');render(evt.new);}
      else refresh();
    })
    .subscribe(function(state){
      var up=state==='SUBSCRIBED';
      if(up&&!realtimeUp)refresh(); // catch anything published while disconnected
      realtimeUp=up;
      schedulePoll();
    });

  window.addEventListener('beforeunload',function(){db.removeChannel(realtime);});
  refresh();
  schedulePoll();
})();
