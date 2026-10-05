/* OBS Stage side panel ("Video + side panel" layout). Four presets picked in the Studio
   (payload.sidePanel): brand | matchup | league | socials. Data comes only from the public,
   cached same-origin feeds /api/live-ticker and /api/lgchl-scores (public lgchl views). */
(function(){
  'use strict';
  var CFG=window.WM_OBS_CONFIG||{};
  var root=document.getElementById('sidePanel');
  if(!root)return;
  var REFRESH_MS=120000;
  var data={ticker:null,league:null};
  var view={preset:'brand',payload:{},channel:'',on:false};
  var timer=null;
  var SHIELD='assets/brand/elitechel-shield-320.webp';
  var HITMEN_MARK='assets/lgchl/s55/team412.png';

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function getJson(url){return fetch(url,{headers:{accept:'application/json'}}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();});}
  function etDay(iso){try{return new Date(iso).toLocaleDateString('en-CA',{timeZone:'America/Toronto'});}catch(e){return '';}}
  function etTime(iso){try{return new Date(iso).toLocaleTimeString('en-US',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit'})+' ET';}catch(e){return '';}}
  function live(){return '<span class="sp-live"><i></i>LIVE</span>';}
  function head(eyebrow){return '<header class="sp-head"><small>'+esc(eyebrow)+'</small>'+live()+'</header>';}
  function foot(){return '<footer class="sp-foot"><img src="'+SHIELD+'" alt=""><span>EliteChel Series Media</span></footer>';}

  function streamHandle(){
    var url=String(view.payload.streamUrl||'').trim()||String((CFG.defaultFeedFor&&CFG.defaultFeedFor(view.channel))||'');
    try{
      var u=new URL(url);var parts=u.pathname.split('/').filter(Boolean);
      var who=CFG.playerForUrl&&CFG.playerForUrl(url);
      if(u.hostname.indexOf('twitch.tv')>=0)return {platform:'TWITCH',player:who&&who.player,handle:parts[0]||'',link:'twitch.tv/'+(parts[0]||'')};
      if(u.hostname.indexOf('youtu')>=0)return {platform:'YOUTUBE',handle:(parts[0]||'').replace(/^@/,''),link:u.hostname.replace(/^www\./,'')+'/'+parts.join('/')};
      return {platform:'STREAM',handle:u.hostname,link:u.hostname};
    }catch(e){return null;}
  }

  function brand(){
    return '<div class="sp-body sp-brand">'+head('LGCHL · SEASON 55')+
      '<img class="sp-shield" src="'+SHIELD+'" alt="EliteChel Series Media">'+
      '<div class="sp-rule"></div>'+
      '<div class="sp-team"><img src="'+HITMEN_MARK+'" alt=""><div><small>CALGARY</small><strong>HITMEN</strong></div></div>'+
      '<p class="sp-caption">EliteChel Series Media<br>Live broadcast</p></div>';
  }

  function matchup(){
    var t=data.ticker;
    var g=t&&(t.live||t.next);
    if(!g)return '<div class="sp-body">'+head('TONIGHT')+'<p class="sp-empty">Schedule loading</p>'+foot()+'</div>';
    var all=[].concat(t.recent||[],t.pending||[],t.live?[t.live]:[],t.next?[t.next]:[],t.upcoming||[]);
    var seen={};var night=all.filter(function(x){if(!x||!x.at||seen[x.id])return false;seen[x.id]=1;return etDay(x.at)===etDay(g.at);})
      .sort(function(a,b){return Date.parse(a.at)-Date.parse(b.at);});
    var idx=night.findIndex(function(x){return x.id===g.id;});
    var teams=(data.league&&data.league.teams)||{};
    var opp=teams[String(g.opponent&&g.opponent.id)]||{};
    var hitRec=(t.record&&t.record.label)||'';
    var state=t.live&&g===t.live?'LIVE NOW':etTime(g.at);
    return '<div class="sp-body sp-matchup">'+head('TONIGHT · GAME '+(idx>=0?idx+1:1)+' OF '+(night.length||1))+
      '<div class="sp-side"><img src="'+HITMEN_MARK+'" alt=""><strong>CALGARY HITMEN</strong><span>'+esc(hitRec)+'</span></div>'+
      '<div class="sp-vs">'+(g.home?'VS':'@')+'</div>'+
      '<div class="sp-side"><img src="'+esc((g.opponent&&g.opponent.logo)||'')+'" alt=""><strong>'+esc(((g.opponent&&g.opponent.name)||'TBD').toUpperCase())+'</strong><span>'+esc(opp.record||'')+'</span></div>'+
      '<div class="sp-state">'+esc(state)+'</div>'+foot()+'</div>';
  }

  function league(){
    var teams=(data.league&&data.league.teams)||{};
    var rows=Object.keys(teams).map(function(k){return teams[k];}).filter(function(x){return x.league==='WHL';})
      .sort(function(a,b){return String(a.conference).localeCompare(String(b.conference))||(a.conf_rank||99)-(b.conf_rank||99);});
    if(!rows.length)return '<div class="sp-body">'+head('WHL STANDINGS')+'<p class="sp-empty">Standings loading</p>'+foot()+'</div>';
    var html='';var conf='';
    rows.forEach(function(r){
      if(r.conference!==conf){conf=r.conference;html+='<li class="sp-conf">'+esc(String(conf).toUpperCase())+'</li>';}
      html+='<li class="sp-row'+(r.id===412?' is-us':'')+'"><b>'+esc(r.conf_rank||'')+'</b><img src="'+esc(r.logo||'')+'" alt=""><span>'+esc(r.abbr||'')+'</span><em>'+esc(r.record||'')+'</em><strong>'+esc(r.pts==null?'':r.pts)+'</strong></li>';
    });
    // Rendered twice so the CSS scroll loops seamlessly.
    return '<div class="sp-body sp-league">'+head('WHL STANDINGS')+
      '<div class="sp-table-head"><span>TEAM</span><em>W-L-OTL</em><strong>PTS</strong></div>'+
      '<div class="sp-scroll"><ul class="sp-track">'+html+html+'</ul></div>'+foot()+'</div>';
  }

  function socials(){
    var s=streamHandle();
    var sc=CFG.socials||{};
    return '<div class="sp-body sp-socials">'+head('NOW STREAMING')+
      (s?'<div class="sp-handle"><small>'+esc(s.platform)+(s.player?' · '+esc(s.player):'')+'</small><strong>'+esc(s.handle)+'</strong><span>'+esc(s.link)+'</span></div>':'<p class="sp-empty">No feed attached</p>')+
      '<div class="sp-cta"><small>'+esc(sc.followText||'Follow the stream')+'</small>'+(s?'<strong>'+esc(s.link)+'</strong>':'')+'</div>'+
      (sc.discord?'<div class="sp-cta"><small>DISCORD</small><strong>'+esc(sc.discord)+'</strong></div>':'')+
      '<div class="sp-team sp-team-small"><img src="'+HITMEN_MARK+'" alt=""><div><small>CALGARY</small><strong>HITMEN</strong></div></div>'+
      foot()+'</div>';
  }

  function draw(){
    if(!view.on){root.innerHTML='';return;}
    var fn={brand:brand,matchup:matchup,league:league,socials:socials}[view.preset]||brand;
    root.innerHTML=fn();
    root.dataset.preset=view.preset;
  }
  function load(){
    return Promise.all([
      getJson('/api/live-ticker').catch(function(){return null;}),
      getJson('/api/lgchl-scores?view=standings').catch(function(){return null;})
    ]).then(function(r){
      if(r[0])data.ticker=r[0];
      if(r[1])data.league=r[1];
      draw();
    });
  }
  window.WMSidePanel={
    update:function(payload,channel){
      var on=payload.feedLayout==='panel';
      var preset=['brand','matchup','league','socials'].indexOf(payload.sidePanel)>=0?payload.sidePanel:'brand';
      var changed=on!==view.on||preset!==view.preset||String(payload.streamUrl||'')!==String(view.payload.streamUrl||'');
      view.payload=payload;view.channel=channel;view.preset=preset;view.on=on;
      if(on&&!timer){load();timer=setInterval(load,REFRESH_MS);}
      if(!on&&timer){clearInterval(timer);timer=null;}
      if(changed)draw();
      return on;
    }
  };
})();
